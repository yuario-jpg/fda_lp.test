<?php
/**
 * FDA LP -> Google Apps Script secure proxy
 * ブラウザにはGAS URLとLP_PROXY_SECRETを公開しません。
 */

declare(strict_types=1);

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwau_lwj4MkLXnOggRytybZakDdxMorJh_TYvT0owcW1waKuyxqMet7F1JjLXYsrmy6/exec';
const LP_PROXY_SECRET = 'dkNIdmueVquEmA5MkhX1RwUrrlkJbp2A_gbHb_QMxwTn6toPXYfXscTjgG67RMve';
const MAX_REQUEST_BYTES = 25 * 1024 * 1024; // 添付ファイル(base64)を考慮
const RATE_WINDOW_SECONDS = 600;
const RATE_LIMIT_GET = 600;
const RATE_LIMIT_POST = 80;
const BUSY_PROXY_CACHE_SECONDS = 15; // 通常の空き状況取得だけ短時間キャッシュ。予約確定直前の再確認（_付き）は必ずGASへ問い合わせる。

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function failResponse(string $message, int $status = 400): never {
    http_response_code($status);
    echo json_encode(['result' => 'error', 'error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function clientIp(): string {
    return $_SERVER['REMOTE_ADDR'] ?? 'unknown';
}

function enforceSameSiteWhenPresent(): void {
    $host = strtolower($_SERVER['HTTP_HOST'] ?? '');
    foreach (['HTTP_ORIGIN', 'HTTP_REFERER'] as $key) {
        if (empty($_SERVER[$key])) continue;
        $sourceHost = strtolower((string)(parse_url($_SERVER[$key], PHP_URL_HOST) ?? ''));
        if ($sourceHost !== '' && $host !== '' && $sourceHost !== $host) {
            failResponse('許可されていない送信元です。', 403);
        }
    }
}

function enforceRateLimit(string $method): void {
    $limit = $method === 'POST' ? RATE_LIMIT_POST : RATE_LIMIT_GET;
    $bucket = (int)floor(time() / RATE_WINDOW_SECONDS);
    $key = hash('sha256', clientIp() . '|' . $method . '|' . $bucket);
    $path = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'fda_lp_' . $key . '.rate';

    $fp = @fopen($path, 'c+');
    if (!$fp) return; // 制限機構の障害で本番フォームを止めない
    try {
        if (!flock($fp, LOCK_EX)) return;
        rewind($fp);
        $raw = stream_get_contents($fp);
        $count = $raw !== false && ctype_digit(trim($raw)) ? (int)trim($raw) : 0;
        $count++;
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, (string)$count);
        fflush($fp);
        if ($count > $limit) {
            failResponse('アクセスが集中しています。時間をおいて再度お試しください。', 429);
        }
    } finally {
        @flock($fp, LOCK_UN);
        @fclose($fp);
    }
}

function busyCachePath(int $year, int $month): string {
    return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'fda_busy_' . $year . '_' . $month . '.json';
}

function readBusyProxyCache(int $year, int $month): ?string {
    $path = busyCachePath($year, $month);
    if (!is_file($path)) return null;
    $mtime = @filemtime($path);
    if ($mtime === false || (time() - $mtime) > BUSY_PROXY_CACHE_SECONDS) return null;
    $raw = @file_get_contents($path);
    return ($raw === false || $raw === '') ? null : $raw;
}

function writeBusyProxyCache(int $year, int $month, string $response): void {
    @file_put_contents(busyCachePath($year, $month), $response, LOCK_EX);
}

function clearBusyProxyCache(): void {
    $files = glob(rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'fda_busy_*.json');
    if (!is_array($files)) return;
    foreach ($files as $file) @unlink($file);
}

function requestGas(string $method, string $url, ?string $body = null): array {
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 500, 'response' => '', 'error' => 'サーバー通信機能が利用できません。'];
    }

    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_USERAGENT => 'Worldshift-FDA-LP-Proxy/1.0',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ];
    if ($method === 'POST') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = $body ?? '';
        $opts[CURLOPT_HTTPHEADER] = ['Accept: application/json', 'Content-Type: text/plain;charset=utf-8'];
    }
    curl_setopt_array($ch, $opts);
    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    return [
        'ok' => !($response === false || $curlError !== ''),
        'status' => $status,
        'response' => $response === false ? '' : (string)$response,
        'error' => $curlError,
    ];
}

function forwardToGas(string $method, string $url, ?string $body = null): never {
    if (!function_exists('curl_init')) {
        failResponse('サーバー通信機能が利用できません。', 500);
    }

    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_USERAGENT => 'Worldshift-FDA-LP-Proxy/1.0',
        CURLOPT_HTTPHEADER => ['Accept: application/json'],
    ];

    if ($method === 'POST') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = $body ?? '';
        $opts[CURLOPT_HTTPHEADER] = [
            'Accept: application/json',
            'Content-Type: text/plain;charset=utf-8',
        ];
    }

    curl_setopt_array($ch, $opts);
    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    if ($response === false || $curlError !== '') {
        failResponse('通信に失敗しました。時間をおいて再度お試しください。', 502);
    }

    if ($status >= 500) http_response_code(502);
    elseif ($status >= 400) http_response_code($status);
    else http_response_code(200);

    echo $response;
    exit;
}

enforceSameSiteWhenPresent();
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if (!in_array($method, ['GET', 'POST'], true)) {
    failResponse('許可されていないHTTPメソッドです。', 405);
}
enforceRateLimit($method);

if ($method === 'GET') {
    $params = $_GET;
    $action = isset($params['action']) ? (string)$params['action'] : '';
    if ($action !== '' && !in_array($action, ['busy', 'booking', 'advisory'], true)) {
        failResponse('未対応のactionです。');
    }

    // 通常のカレンダー表示だけ15秒キャッシュする。
    // 予約確定直前の再確認はHTML側が「_」を付けるため、ここを必ずバイパスする。
    $useBusyCache = $action === 'busy' && !isset($params['_']);
    $busyYear = isset($params['year']) ? (int)$params['year'] : 0;
    $busyMonth = isset($params['month']) ? (int)$params['month'] : 0;
    if ($useBusyCache && $busyYear > 0 && $busyMonth >= 1 && $busyMonth <= 12) {
        $cached = readBusyProxyCache($busyYear, $busyMonth);
        if ($cached !== null) {
            echo $cached;
            exit;
        }
    }

    $params['proxySecret'] = LP_PROXY_SECRET;
    $url = GAS_ENDPOINT . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

    if ($useBusyCache && $busyYear > 0 && $busyMonth >= 1 && $busyMonth <= 12) {
        $r = requestGas('GET', $url);
        if (!$r['ok']) failResponse('通信に失敗しました。時間をおいて再度お試しください。', 502);
        if ($r['status'] >= 500) http_response_code(502);
        elseif ($r['status'] >= 400) http_response_code($r['status']);
        else http_response_code(200);
        if ($r['status'] >= 200 && $r['status'] < 300 && $r['response'] !== '') {
            writeBusyProxyCache($busyYear, $busyMonth, $r['response']);
        }
        echo $r['response'];
        exit;
    }

    forwardToGas('GET', $url);
}

$contentLength = isset($_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : 0;
if ($contentLength > MAX_REQUEST_BYTES) {
    failResponse('送信データが大きすぎます。', 413);
}
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    failResponse('送信データがありません。');
}
if (strlen($raw) > MAX_REQUEST_BYTES) {
    failResponse('送信データが大きすぎます。', 413);
}
$data = json_decode($raw, true);
if (!is_array($data)) {
    failResponse('送信形式が正しくありません。');
}
$formType = isset($data['formType']) ? trim((string)$data['formType']) : '';
$allowedFormTypes = ['', 'advisoryHearing', 'hearing', 'fileUpload', 'cancel', 'reschedule'];
if (!in_array($formType, $allowedFormTypes, true)) {
    failResponse('未対応のformTypeです。');
}
$isInquiryOnly = $formType === '' && empty($data['date']) && empty($data['time']);

// 予約・変更・キャンセル系POSTの直後は、次のカレンダー表示で古い15秒キャッシュを使わない。
// 問い合わせのみはカレンダーに影響しないため対象外。
if (!$isInquiryOnly && in_array($formType, ['', 'cancel', 'reschedule'], true)) {
    clearBusyProxyCache();
}

if ($isInquiryOnly) {
    // ブラウザがTrello通知・メール送信まで待たなくてよいよう、まず保存だけ完了させる。
    $data['_deferInquiryNotifications'] = true;
    $data['_proxySecret'] = LP_PROXY_SECRET;
    $body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($body === false) failResponse('送信データの変換に失敗しました。');

    $r = requestGas('POST', GAS_ENDPOINT, $body);
    if (!$r['ok']) failResponse('通信に失敗しました。時間をおいて再度お試しください。', 502);
    $decoded = json_decode($r['response'], true);
    if ($r['status'] >= 400 || !is_array($decoded) || ($decoded['result'] ?? '') !== 'success') {
        if ($r['status'] >= 500) http_response_code(502);
        elseif ($r['status'] >= 400) http_response_code($r['status']);
        else http_response_code(500);
        echo $r['response'] !== '' ? $r['response'] : json_encode(['result' => 'error', 'error' => '送信に失敗しました。'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // LPには従来と同じ success だけを即返す。
    http_response_code(200);
    echo json_encode(['result' => 'success'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        @ob_flush();
        @flush();
    }
    ignore_user_abort(true);

    // ここから先はブラウザへの完了表示後の後処理。
    $notifyData = $data;
    unset($notifyData['_deferInquiryNotifications']);
    $notifyData['formType'] = 'inquiryNotificationOnly';
    $notifyData['bookingRow'] = isset($decoded['deferredInquiry']['bookingRow']) ? (int)$decoded['deferredInquiry']['bookingRow'] : 0;
    $notifyData['_proxySecret'] = LP_PROXY_SECRET;
    $notifyBody = json_encode($notifyData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($notifyBody !== false) {
        $notifyResult = requestGas('POST', GAS_ENDPOINT, $notifyBody);
        if (!$notifyResult['ok'] || $notifyResult['status'] >= 400) {
            error_log('FDA inquiry notification post-process failed: HTTP ' . $notifyResult['status'] . ' ' . $notifyResult['error']);
        }
    }
    exit;
}

$data['_proxySecret'] = LP_PROXY_SECRET;
$body = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($body === false) {
    failResponse('送信データの変換に失敗しました。');
}
forwardToGas('POST', GAS_ENDPOINT, $body);
