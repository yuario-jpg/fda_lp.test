/**
 * ==============================================================
 *  FDA Compliance Partner - 無料相談予約フォーム バックエンド
 * ==============================================================
 *
 * ■ これは何か
 *   booking.html（および index.html 埋め込みウィジェット）から送信された
 *   「カレンダー予約フォーム」の内容を受け取り、指定した Google スプレッドシートに
 *   1行ずつ追記する Google Apps Script（GAS）です。
 *   あわせて、予約ごとに専用の「ヒアリングシート」（hearing.html）リンクを自動生成し、
 *   スプレッドシートのC列に記載します。hearing.html の回答は「ヒアリング回答」タブに
 *   別途保存されます。予約完了後、お客様へ自動で予約完了メールを送信します
 *   （送信元：BOOKING_CONFIRMATION_FROM_EMAIL。下記セットアップ参照）。
 *
 *   ★予約完了メールのセットアップ
 *   ・GmailApp.sendEmailのfromオプションでfda@worldshift-inc.comから送信するため、
 *     このスクリプトを実行するGoogleアカウントで、Gmailの「設定」→
 *     「アカウントとインポート」→「名前」→「他のメールアドレスを追加」から
 *     fda@worldshift-inc.com を送信エイリアスとして追加・認証しておく必要があります
 *     （そのアカウント自身のアドレスがfda@worldshift-inc.comであれば不要です）
 *   ・初回実行時、Gmail送信の権限（gmail.send）の承認画面が新たに出ます
 *   ・送信元アドレスに設定されているGmail署名を自動で本文末尾に付けるため、
 *     エディタ左メニュー「サービス」→「+」→「Gmail API」を追加してください
 *     （追加していない場合、署名なしでメールは正常に送信されます）
 *
 *   ★2026/07 追加：kintoneカレンダーアプリとの連携
 *     流れ： kintone ⇔ スプレッドシート「カレンダー_元データ」／「カレンダー」 ⇔ LP
 *
 *     対象は「①スケジュール（予定）」のみ。「②経営本部スケジュール（予約）」は
 *     方針により無視（読み込み・書き込みどちらも対象外）。
 *
 *     ・pullKintoneToCalendarSheet()：kintone→シート方向。時間主導型トリガーで定期実行し、
 *       kintoneの予定を「カレンダー_元データ」（生データ）と「カレンダー」（見た目の
 *       カレンダー表、月ブロックが下に積み上がっていく）に反映する。kintoneへの
 *       書き込みは一切行わない。
 *     ・pushSelectedRowsToKintone()：シート→kintone方向。「カレンダー_元データ」に
 *       手入力した行を選択し、メニュー「kintone連携」→「選択中の行をkintoneとLPに反映」を
 *       押した時だけkintoneに新規追加する（自動化はしない方針）。反映後、レコードIDが
 *       G列に書き戻され、カレンダータブもその場で更新される。
 *     ・handleBusyRequest（LPの?action=busy）：kintoneに直接問い合わせるのではなく、
 *       「カレンダー_元データ」を参照する。あわせて次の3条件を追加で除外する：
 *       土日／日本の祝日（Googleの祝日カレンダーを参照）／今日から3営業日未満
 *       （現在の設定：土日・日本の祝日を除いて3営業日後から予約可）。
 *       また、タイトルにBUSY_CHECK_EXCLUDED_TITLE_KEYWORDS（例："幹部会"）を含む予定は
 *       空き状況判定の対象から除外する（その予定があっても予約可能扱いにする）。
 *     ・上記の計算結果は「カレンダー_空き状況キャッシュ」（非表示シート）に事前計算して
 *       保存しておき、LPからのリクエストは基本このキャッシュを読むだけにしている（高速化）。
 *       キャッシュはpullKintoneToCalendarSheet実行のたび（トリガーやボタン経由）に
 *       自動で作り直される。
 *
 *     ・LP予約時の反映：appendBookingToCalendarDataAndKintone_() が、予約フォーム送信の
 *       たびに「カレンダー_元データ」への追記とkintoneへの新規登録を両方行い、
 *       LPの空き状況キャッシュもその場で作り直す（自動・都度実行、手動反映ボタンとは別経路）
 * ■ セットアップ手順
 *   1. Google スプレッドシートを新規作成する（例：「FDA無料相談_予約管理」）
 *   2. スプレッドシートのURLから「スプレッドシートID」をコピーする
 *        https://docs.google.com/spreadsheets/d/【ここがID】/edit
 *   3. スプレッドシートのメニュー「拡張機能」→「Apps Script」を開く
 *   4. デフォルトの Code.gs の中身を全て削除し、このファイルの内容を貼り付ける
 *   5. 下の SHEET_ID に手順2でコピーしたIDを貼り付ける
 *   6. 画面右上「デプロイ」→「新しいデプロイ」をクリック
 *        - 種類の選択：「ウェブアプリ」
 *        - 説明：任意（例：予約フォーム v1）
 *        - 次のユーザーとして実行：自分
 *        - アクセスできるユーザー：全員
 *      → 「デプロイ」をクリックし、表示された「ウェブアプリのURL」をコピーする
 *   7. booking.html・index.html・hearing.html 内の ENDPOINT_URL に、
 *      手順6でコピーしたURLをそれぞれ貼り付ける
 *
 *   ★kintone連携のセットアップ
 *   8. 左メニュー「プロジェクトの設定」（歯車アイコン）→ 一番下「スクリプト プロパティ」→
 *      「スクリプト プロパティを追加」で、以下3つを登録する
 *        KINTONE_SUBDOMAIN / KINTONE_APP_ID / KINTONE_API_TOKEN
 *      （APIトークンはkintoneのアプリ設定 →「APIトークン」で発行。
 *        「レコード閲覧」「レコード追加」権限を付与してください）
 *      ※こうしておくと、今後Code.gsの中身を丸ごと差し替えても、
 *        これらの値は消えず再入力の必要がありません
 *   9. エディタ上部のプルダウンで関数 debugKintoneFields を選択し「実行」する
 *      → 「実行数」→「ログを表示」で、実際のフィールドコード一覧が出力されます
 *   10. 出力されたフィールドコードに合わせて、下の KINTONE_FIELD の値を書き換える
 *   11. エディタ上部のプルダウンで rebuildCalendarSheetFromScratch を実行し、
 *       「カレンダー」「カレンダー_元データ」タブが正しく作られるか確認する
 *   12. 左メニュー「トリガー」→「トリガーを追加」で以下を設定する
 *       実行する関数: pullKintoneToCalendarSheet
 *       イベントのソース: 時間主導型 → 分ベースのタイマー → 例:30分おき
 *       （kintone→シート方向のみ。kintone側の予定を定期的に「カレンダー_元データ」
 *         「カレンダー」タブへ反映する。kintoneへの書き込みは一切行わない）
 *
 *       ★方針：kintoneへの反映（シート→kintone方向）は自動化せず、
 *       スプレッドシートのメニュー「kintone連携」→「選択中の行をkintoneとLPに反映」を
 *       押した時だけ行う。
 *   13. 再度「デプロイ」→「デプロイを管理」→ 新しいバージョンとしてデプロイし直す
 *
 * ■ 注意
 *   - コードを更新した場合は、再度「デプロイ」→「デプロイを管理」→
 *     鉛筆アイコンから「新しいバージョン」を選んで再デプロイしてください。
 *     （URLを変えずに中身だけ更新できます）
 *   - 初回デプロイ時に Google の権限確認画面が出るので、
 *     自分のアカウントで許可してください。
 * ==============================================================
 */

// ▼▼▼ ここを自分のスプレッドシートIDに差し替えてください ▼▼▼
const SHEET_ID = '1ZCHT5DrBhlorPtsDPbAZPHB431hPo3CqNKnUDCAL_nk';
// ▲▲▲ ここまで ▲▲▲

/**
 * ★APIキーなどの秘密情報は、コードに直接書かず「スクリプトのプロパティ」
 *   （Apps Scriptの設定画面に保存される、コードと切り離された保存領域）から読み込む。
 *   これにより、Code.gsやTrelloNotifications.gsの中身を今後アップデートしても、
 *   一度設定した値はそのまま残り、毎回貼り直す必要が無くなる。
 *
 *   設定方法：エディタ左メニュー「プロジェクトの設定」（歯車アイコン）→
 *   一番下の「スクリプト プロパティ」→「スクリプト プロパティを追加」で、
 *   下記のキー名（KINTONE_SUBDOMAINなど）と値を1つずつ登録する。
 *   （まとめて設定したい場合は setupScriptProperties_ を参照）
 */
function getScriptProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/**
 * ★セットアップの近道（お好みで）：スクリプトのプロパティ画面で1つずつ登録する代わりに、
 *   ここに値を貼り付けてこの関数を一度だけ実行すると、まとめて登録できる。
 *   実行後は、下の値を空文字（''）に戻すか、この関数ごと削除して構わない
 *  （実際の値はスクリプトのプロパティ側に保存されるので、コードに残しておく必要はない）。
 */
function setupScriptProperties_() {
  // 空文字をsetPropertiesすると既存値を消してしまうため、実値が入った項目だけ保存する。
  const candidates = {
    KINTONE_SUBDOMAIN: '',
    KINTONE_APP_ID: '',
    KINTONE_API_TOKEN: '',
    FDA_BOOKING_API_KEY: '',
    LP_PROXY_SECRET: '',
    LP_PROXY_ENFORCE: '',
    ZOOM_ACCOUNT_ID: '',
    ZOOM_CLIENT_ID: '',
    ZOOM_CLIENT_SECRET: '',
    TRELLO_API_KEY: '',
    TRELLO_TOKEN: '',
    TRELLO_LIST_ID: '',
    HEARING_UPLOAD_FOLDER_ID: ''
  };
  const nonEmpty = {};
  Object.keys(candidates).forEach(function(key) {
    const value = String(candidates[key] || '').trim();
    if (value) nonEmpty[key] = value;
  });
  if (Object.keys(nonEmpty).length) {
    PropertiesService.getScriptProperties().setProperties(nonEmpty, false);
  }
  Logger.log('実値が入力された項目だけをスクリプトプロパティへ登録しました。');
}

/**
 * ★設定確認用：現在スクリプトのプロパティに何が登録されているか一覧表示する
 *  （値そのものはログに出さず、設定済みかどうかだけを表示する）。
 */
function debugListScriptProperties_() {
  const keys = [
    'KINTONE_SUBDOMAIN', 'KINTONE_APP_ID', 'KINTONE_API_TOKEN',
    'FDA_BOOKING_API_KEY', 'LP_PROXY_SECRET', 'LP_PROXY_ENFORCE',
    'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
    'TRELLO_API_KEY', 'TRELLO_TOKEN', 'TRELLO_LIST_ID',
    'HEARING_UPLOAD_FOLDER_ID'
  ];
  const props = PropertiesService.getScriptProperties();
  keys.forEach(function (key) {
    const value = props.getProperty(key);
    Logger.log(key + ': ' + (value ? '設定済み' : '未設定'));
  });
}

const SHEET_NAME = '予約一覧';
// ↑このシート名を持つタブが無い場合は、自動的に一番左のシート（既存のシート）に書き込みます。
// タブ名を「予約一覧」に変更しておくと確実です。

// 通知メールを送りたい場合はここにアドレスを入れる（不要なら空文字のままでOK）
const NOTIFY_EMAIL = '';

// ★予約完了メール（お客様向け自動送信）の設定
// 送信元アドレス。GmailApp.sendEmailのfromオプションで指定するアドレスなので、
// このスクリプトを実行するGoogleアカウント自身のメールアドレスであるか、
// そのアカウントのGmail設定→「アカウントとインポート」→「名前」で
// 「他のメールアドレスを追加」して送信エイリアスとして認証済みである必要があります。
const BOOKING_CONFIRMATION_FROM_EMAIL = 'fda@worldshift-inc.com';
const BOOKING_CONFIRMATION_SENDER_NAME = 'FDA Compliance Partner'; // 差出人表示名のフォールバック（Gmail側の「名前」設定が優先され、取得できた場合はそちらが使われる）

// A〜C列（担当者・対応履歴・ヒアリングシート）は手動運用のため、送信データはD列以降に入る
const HEADER_ROW = [
  '担当者', '対応履歴', 'ヒアリングシート', '記入状況', 'ヒアリングシート更新日',
  '送信日時', '希望日', '希望時間', '会社名', 'お名前',
  'メールアドレス', '電話番号', '都道府県', '製品カテゴリ', 'ご相談内容', '送信元ページ',
  '予約ID', 'kintoneレコードID', 'アクセストークン'
];
// キャンセル済みの予約に設定する「対応履歴」の値（既存のプルダウン選択肢と一致させること）
const CANCELLED_STATUS_LABEL = '予約キャンセル';
// 予約日時の何時間前まで、お客様自身でのキャンセル・変更を受け付けるか
const CHANGE_CANCEL_MIN_HOURS_BEFORE = 24;

// ★セキュリティ：新規予約に発行するアクセス用トークンは予約一覧の末尾列に保存する。
// 既存予約（この列が空欄）は移行互換のため従来どおりIDのみでアクセス可能。
// 既存予約がすべて消化された後は REQUIRE_TOKEN_FOR_LEGACY_ROWS を true にすると完全移行できます。
const BOOKING_ACCESS_TOKEN_COLUMN = 19; // S列
const REQUIRE_TOKEN_FOR_LEGACY_ROWS = false;

// ★予約時の流入元を「予約一覧」のX列へ保存する
const BOOKING_TRAFFIC_SOURCE_COLUMN = 24; // X列
const BOOKING_TRAFFIC_SOURCE_HEADER = '流入元';

// ヒアリングシート（hearing.html）の回答を保存するタブ
const HEARING_SHEET_NAME = 'ヒアリング回答';
const HEARING_HEADER_ROW = [
  '受付日時', '紐付けID', '会社名', 'ホームページURL', '担当者名', '電話番号', 'メールアドレス', '会社所在地',
  'FDA対応・認証取得のご経験', '対応方法（自社/外部）', 'その後の状況・課題',
  '希望する支援内容', '商材数', '商品情報（詳細）', '予定している米国での販路', 'その他ご相談',
  '添付ファイル', '送信元ページ', '回答データ(JSON)'
];

/* =========================================================================
   ★kintone連携設定
   ここから下を、ご自身のkintone環境に合わせて書き換えてください。
   ========================================================================= */

// あなたのkintoneのサブドメイン（例: https://example.cybozu.com なら 'example'）
const KINTONE_SUBDOMAIN = getScriptProp_('KINTONE_SUBDOMAIN');

// カレンダーアプリのアプリID（アプリを開いたときのURLの app=数字 の部分）
const KINTONE_APP_ID = getScriptProp_('KINTONE_APP_ID');

// APIトークン（kintoneのアプリ設定→「APIトークン」で発行。閲覧・追加権限を付与）
const KINTONE_API_TOKEN = getScriptProp_('KINTONE_API_TOKEN');

// debugKintoneFieldsのログで判明した、実際のアプリの構造に合わせた設定。
// このアプリには性質の異なる2種類の予定が同居しています：
//   ①スケジュール（予定）  … 通常の予定。開始日時/終了日時(DATETIME)＋タイトル＋カテゴリ
//   ②経営本部スケジュール（予約） … 役員会議室予約など。日付＋開始時間/終了時間(TIME)＋チェックボックスのカテゴリ（タイトル項目なし）
// LP予約や手入力からの新規追加は①の形式で作成します（②は読み取り＝空き判定のみ対応）。
const KINTONE_FIELD = {
  schedule: {
    startDateTime: '開始日時', // DATETIME
    endDateTime:   '終了日時', // DATETIME
    title:         'a_memo',   // タイトル（スケジュールタイトル）
    category:      'カテゴリ'  // DROP_DOWN（単一選択、絵文字付きの選択肢）
  }
};

// 「カテゴリ」(DROP_DOWN)の実際の選択肢。debugKintoneFieldsの出力からそのまま転記したもの
// （絵文字を含むため、必ずこの定数経由で値を指定してください。手入力で似た文字を打つと
//   一致せずkintone側でエラーになります）
const KINTONE_CATEGORY_OPTIONS = {
  outing:   '\uD83D\uDE83外出',
  business: '\uD83D\uDEEC出張',
  training: '\uD83D\uDC54研修',
  meeting:  '\uD83D\uDCBB会議',
  visit:    '\uD83C\uDFE2来社',
  other:    '\uD83D\uDCACその他'
};
// LP予約・手入力から新規追加する際に使うデフォルトカテゴリ（上のキーのどれかを指定）
const KINTONE_DEFAULT_CATEGORY_KEY = 'other';

// LP予約1件あたりの所要時間（分）。終了時刻の自動算出に使用
const BOOKING_DURATION_MIN = 60;

/* =========================================================================
   ★FDA予約連携API（新カレンダー基盤）
   ------------------------------------------------------------------------
   APIキーだけ入力してください。LPブラウザには公開せず、GASからのみ送信します。
   ========================================================================= */
const FDA_BOOKING_API_BASE = 'https://asia-northeast1-member-database-242b3.cloudfunctions.net/fdaBooking';
const FDA_BOOKING_API_KEY = getScriptProp_('FDA_BOOKING_API_KEY');
const FDA_BOOKING_MEMBERS = ['秀徳', '有尾'];
const FDA_BOOKING_ROOM = true;
const FDA_BOOKING_SOURCE = 'fda-lp';
const FDA_BOOKING_BUFFER_AFTER_MIN = 30;

function fdaBookingApiCall_(method, path, body) {
  if (!FDA_BOOKING_API_KEY) {
    throw new Error('FDA_BOOKING_API_KEY が未設定です。スクリプトプロパティを確認してください。');
  }
  const options = {
    method: method,
    contentType: 'application/json',
    headers: { 'x-api-key': FDA_BOOKING_API_KEY },
    muteHttpExceptions: true
  };
  if (body !== undefined && body !== null) options.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(FDA_BOOKING_API_BASE + path, options);
  const code = res.getResponseCode();
  const text = res.getContentText() || '';
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { message: text }; }

  if (code === 409) return { conflict: true, body: parsed };
  if (code !== 200) {
    throw new Error('FDA予約連携API失敗: HTTP ' + code + (parsed.message ? ' / ' + parsed.message : ''));
  }
  return parsed;
}

function getFdaBookingEvents_(from, to) {
  const r = fdaBookingApiCall_('get', '/events?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
  return (r && Array.isArray(r.events)) ? r.events : [];
}

function createFdaBooking_(form) {
  return fdaBookingApiCall_('post', '/bookings', {
    date: form.date,
    start: form.start,
    end: form.end,
    company: form.company || '',
    members: form.members || [],
    room: FDA_BOOKING_ROOM,
    memo: form.memo || ''
  });
}

function updateFdaBooking_(id, patch) {
  return fdaBookingApiCall_('patch', '/bookings/' + encodeURIComponent(id), patch);
}

function cancelFdaBooking_(id) {
  return fdaBookingApiCall_('delete', '/bookings/' + encodeURIComponent(id));
}

/* =========================================================================
   ★kintone → スプレッドシート「カレンダー」自動反映（2026/07 方針変更）
   ------------------------------------------------------------------------
   ・kintoneカレンダーアプリの内容を、定期的にこのスプレッドシートへ書き出す
   ・「カレンダー_元データ」タブ：LP連携用の生データ（1予定=1行）
   ・「カレンダー」タブ：人が見るためのカレンダー表（月ごとのブロックが
     下にどんどん積み上がっていく想定）
   ・pullKintoneToCalendarSheet() を時間主導型トリガーで定期実行してください
     （エディタ左メニュー「トリガー」→ 追加 → 実行する関数:
      pullKintoneToCalendarSheet、イベントのソース: 時間主導型、
      例: 30分おき）
   ========================================================================= */
const CAL_SHEET_NAME = 'カレンダー';
const CAL_BLOCK_INDEX_PROP_KEY = 'CAL_MONTH_BLOCK_INDEX'; // PropertiesServiceに保存する月ブロック位置インデックスのキー
const CAL_BUSY_CACHE_SHEET_NAME = 'カレンダー_空き状況キャッシュ'; // LP向け空き状況の事前計算結果を保存する非表示シート
const BUSY_CACHE_FORWARD_MONTHS = 3; // 今月から何か月先までキャッシュしておくか（LPの予約可能範囲をカバーできる数）
const BUSY_CACHE_TTL_SECONDS = 21600; // CacheServiceの保存期間（秒）。21600=6時間（CacheServiceの上限）
const CAL_DATA_SHEET_NAME = 'カレンダー_元データ';

const CAL_BACKFILL_MONTHS = 2;      // 過去何か月分をバックフィル表示するか
const CAL_FORWARD_MONTHS = 6;       // 先何か月分を常に用意しておくか
const CAL_REFRESH_BACK_MONTHS = 1;  // 直近何か月分は毎回内容を最新化するか（当月と前後1か月）
const CAL_WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const CAL_WEEK_ROWS_PER_MONTH = 6;  // 月ブロックの週の行数（常に6行固定にしてブロック全体のサイズを揃える）
const CAL_ROWS_PER_MONTH_BLOCK = 1 /*月見出し*/ + 1 /*曜日見出し*/ + CAL_WEEK_ROWS_PER_MONTH + 1 /*区切り空行*/;

// カテゴリごとの色分け（該当が無ければ末尾の色を順番に使う）
const CAL_CATEGORY_COLORS = ['#2563EB', '#D97706', '#DB2777', '#059669', '#7C3AED', '#DC2626'];

/**
/**
 * ★kintone→シート方向のみを行う（kintoneへの書き込みは一切行わない）。
 *   時間主導型トリガー、およびメニュー「カレンダーを今すぐ同期」はこちらを使う。
 *   kintoneへの反映（シート→kintone）は、メニュー「選択中の行をkintoneとLPに反映」
 *   ボタンを押した時だけ行われる方針のため。
 */
function pullKintoneToCalendarSheet() {
  pullKintoneToCalendarSheet_();
  Logger.log('pullKintoneToCalendarSheet 完了');
}

function pullKintoneToCalendarSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const dataSheet = getOrCreateDataSheet_(ss);
  const calSheet = getOrCreateCalendarSheet_(ss);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStartMonth = new Date(today.getFullYear(), today.getMonth() - CAL_BACKFILL_MONTHS, 1);
  const rangeEndMonth = new Date(today.getFullYear(), today.getMonth() + CAL_FORWARD_MONTHS + 1, 0);

  const startStr = Utilities.formatDate(rangeStartMonth, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(rangeEndMonth, 'Asia/Tokyo', 'yyyy-MM-dd');

  const records = fetchKintoneRecordsInRange(startStr, endStr);
  const kintoneEvents = kintoneRecordsToEvents_(records);
  // ★「終日対応不可日」シートの内容も、見える化のためカレンダー_元データ／カレンダーに含める
  //   （kintoneには一切書き込まない。recordIdに印を付けて誤ってpushされないようにしている）
  const fullDayBlockEvents = getFullDayBlockSheetEvents_(rangeStartMonth, rangeEndMonth);
  // ★kintone側の検索インデックス反映が遅れて、作ったばかりの予約がまだこの取得結果に
  //   含まれていないことがある。その場合に「消えた」と誤判定して消してしまわないよう、
  //   直近に同期された行は今回の取得結果に無くても一旦残しておく（で、次回以降の同期で
  //   実際にkintoneから読み込めればそのまま更新され、十分時間が経っても見当たらなければ
  //   本当に削除されたとみなして自然に消える）。
  const preservedEvents = getRecentlyMissingKintoneEvents_(dataSheet, kintoneEvents);
  const events = mergeAndSortEvents_(kintoneEvents, fullDayBlockEvents, preservedEvents);

  writeRawDataSheet_(dataSheet, events);

  for (let i = -CAL_BACKFILL_MONTHS; i <= CAL_FORWARD_MONTHS; i++) {
    const targetMonthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = targetMonthDate.getFullYear();
    const m = targetMonthDate.getMonth(); // 0-11
    const label = monthLabel_(y, m);

    try {
      const existingRow = findMonthBlockRow_(calSheet, y, m);
      const shouldRefresh = i >= -CAL_REFRESH_BACK_MONTHS; // 直近〜将来の月は毎回最新化する

      if (!existingRow) {
        Logger.log('「' + label + '」の既存ブロックが見つからなかったため新規追加します（現在の最終行: ' + calSheet.getLastRow() + '）');
        appendMonthBlock_(calSheet, y, m, events);
      } else if (shouldRefresh) {
        rewriteMonthBlock_(calSheet, existingRow, y, m, events);
      }
      // 過去の古い月（バックフィル対象外になった月）は既存のブロックをそのまま残す
    } catch (blockErr) {
      // 1か月分の描画に失敗しても、他の月の処理は続行する。原因はログで確認できるようにする。
      Logger.log('「' + label + '」のカレンダーブロック作成でエラー: ' + blockErr.toString());
    }
  }

  // ★LPが毎回その場で計算しなくて済むように、空き状況キャッシュもここで作り直しておく
  rebuildBusyCache_();

  Logger.log('pullKintoneToCalendarSheet_ 完了: ' + events.length + '件の予定を反映しました');
}

/**
 * ★「カレンダー」シートに反映されない/内容が古いままの時の応急処置用。
 *   「カレンダー」タブの中身を一度すべて消してから、kintoneの最新データで
 *   全月分を作り直す（「カレンダー_元データ」は通常のpullKintoneToCalendarSheetと同じ内容になる）。
 *   エディタ上部のプルダウンで rebuildCalendarSheetFromScratch を選んで実行してください。
 */
function rebuildCalendarSheetFromScratch() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const dataSheet = getOrCreateDataSheet_(ss);
  const calSheet = getOrCreateCalendarSheet_(ss);

  calSheet.clear(); // 既存の内容（古いプレビュー分も含む）を全部消す
  clearMonthBlockIndex_(); // ★シートを作り直すので、行位置インデックスも一度リセットする

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStartMonth = new Date(today.getFullYear(), today.getMonth() - CAL_BACKFILL_MONTHS, 1);
  const rangeEndMonth = new Date(today.getFullYear(), today.getMonth() + CAL_FORWARD_MONTHS + 1, 0);
  const startStr = Utilities.formatDate(rangeStartMonth, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(rangeEndMonth, 'Asia/Tokyo', 'yyyy-MM-dd');

  const records = fetchKintoneRecordsInRange(startStr, endStr);
  const kintoneEvents = kintoneRecordsToEvents_(records);
  const fullDayBlockEvents = getFullDayBlockSheetEvents_(rangeStartMonth, rangeEndMonth);
  const events = mergeAndSortEvents_(kintoneEvents, fullDayBlockEvents);
  writeRawDataSheet_(dataSheet, events);

  for (let i = -CAL_BACKFILL_MONTHS; i <= CAL_FORWARD_MONTHS; i++) {
    const targetMonthDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = targetMonthDate.getFullYear();
    const m = targetMonthDate.getMonth();
    try {
      // clear()済みで既存ブロックが無いので、常に新規追加でよい
      appendMonthBlock_(calSheet, y, m, events);
    } catch (blockErr) {
      Logger.log('「' + monthLabel_(y, m) + '」のカレンダーブロック作成でエラー: ' + blockErr.toString());
    }
  }

  rebuildBusyCache_();

  Logger.log('rebuildCalendarSheetFromScratch 完了: ' + events.length + '件の予定を反映しました');
}

/* =========================================================================
   ★スプレッドシート手入力 → kintone 反映
   ------------------------------------------------------------------------
   運用イメージ：
   ・「カレンダー_元データ」シートに、担当者が直接1行追加する
     （A:日付 B:開始時刻 C:終了時刻 D:終日 E:タイトル F:カテゴリ を入力。
      G:kintoneレコードID と H:最終同期日時 は空欄のままにしておく）
   ・入力が終わったら、その行を選択してメニュー「kintone連携」→
     「選択中の行をkintoneとLPに反映」を押す（pushSelectedRowsToKintone）
   ・G列にIDが入っている行は「連携済み」とみなし、以後は二重登録しない
   ========================================================================= */

/**
 * ★スプレッドシートを開いた時に自動で呼ばれる（シンプルトリガー）。
 *   メニューに「kintone連携」を追加し、行を選んでボタン的に反映できるようにする。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('kintone連携')
    .addItem('選択中の行をkintoneとLPに反映', 'pushSelectedRowsToKintone')
    .addItem('カレンダーを今すぐ同期', 'syncKintoneToCalendarSheetManual')
    .addToUi();

  addAdvisoryMenu_();
}

/**
 * メニュー「カレンダーを今すぐ同期」から呼ばれる。pullKintoneToCalendarSheetを実行して
 * 完了をダイアログで知らせる（トリガー実行時と違い、手動実行なのでUI操作が可能）。
 */
function syncKintoneToCalendarSheetManual() {
  pullKintoneToCalendarSheet();
  SpreadsheetApp.getUi().alert('kintone→カレンダーの同期が完了しました。');
}

/**
 * ★手入力した行を「編集した瞬間」ではなく「選択して自分のタイミングで」kintoneに反映するための関数。
 *   「カレンダー_元データ」シートで、反映したい行（1行でも複数行でもOK）を選択してから、
 *   メニュー「kintone連携」→「選択中の行をkintoneとLPに反映」を実行してください。
 *   （日付・タイトルの両方が入っていて、かつkintoneレコードID列が空の行だけが対象になる）
 */
function pushSelectedRowsToKintone() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (sheet.getName() !== CAL_DATA_SHEET_NAME) {
    ui.alert('「' + CAL_DATA_SHEET_NAME + '」シートで、反映したい行を選択してから実行してください。');
    return;
  }

  const selection = sheet.getActiveRange();
  if (!selection) {
    ui.alert('反映したい行を選択してから実行してください。');
    return;
  }

  const startRow = selection.getRow();
  const numRows = selection.getNumRows();
  let pushedCount = 0;
  const notes = [];

  for (let i = 0; i < numRows; i++) {
    const row = startRow + i;
    if (row === 1) continue; // ヘッダー行は無視

    const rowValues = sheet.getRange(row, 1, 1, 8).getValues()[0];
    const [dateVal, startTimeVal, endTimeVal, allDayVal, titleVal, categoryVal, recordIdVal] = rowValues;

    if (!dateVal && !titleVal) continue; // 完全な空行は何も言わず無視

    if (!dateVal || !titleVal) {
      notes.push(row + '行目: 日付またはタイトルが未入力のためスキップ');
      continue;
    }
    if (recordIdVal) {
      notes.push(row + '行目: 既に連携済み（kintoneレコードID: ' + recordIdVal + '）のためスキップ');
      continue;
    }

    const ev = {
      date: formatDateValueForKintone_(dateVal),
      startTime: formatTimeValueForKintone_(startTimeVal),
      endTime: formatTimeValueForKintone_(endTimeVal),
      allDay: (String(allDayVal).trim() === '終日'),
      title: String(titleVal),
      category: categoryVal ? String(categoryVal) : ''
    };

    const result = createKintoneRecordFromSheetRowWithError_(ev);
    if (result.id) {
      sheet.getRange(row, 7).setValue(String(result.id));
      sheet.getRange(row, 8).setValue(new Date());
      SpreadsheetApp.flush(); // ★このすぐ後にpullKintoneToCalendarSheetが同じ行を読むため、確実に書き込みを反映させる
      pushedCount++;
      if (result.categoryFallback) {
        notes.push(
          row + '行目: カテゴリ「' + categoryVal + '」を認識できず、デフォルト（'
          + result.categoryUsedLabel + '）で登録しました'
        );
      }
    } else {
      notes.push(row + '行目: kintoneへの登録に失敗（' + result.error + '）');
    }
  }

  if (pushedCount > 0) {
    // ★kintoneはレコード作成直後、検索(records.json)にごく短時間反映が遅れることがあるため、
    //   少し待ってから「カレンダー」タブの再構築を行う
    Utilities.sleep(1500);
    pullKintoneToCalendarSheet(); // カレンダー表示にもすぐ反映させる（他の未入力行を巻き込んで反映しないよう、pull専用の処理を使う）
  }

  let message = pushedCount + '件をkintoneに反映しました。';
  if (notes.length > 0) {
    message += '\n\n' + notes.join('\n');
  }
  ui.alert(message);
}

/**
 * シートの1件分のイベント情報から、kintoneに新規レコードを追加する。
 * 成功すると { id, error: null, categoryFallback, categoryUsedLabel } を、
 * 失敗すると { id: null, error: <理由> } を返す（メニュー実行時にその場で理由を表示するため）。
 */
function createKintoneRecordFromSheetRowWithError_(ev) {
  try {
    const matchedKey = categoryKeyFromText_(ev.category);
    const categoryKey = matchedKey || KINTONE_DEFAULT_CATEGORY_KEY;
    const categoryFallback = !matchedKey && !!ev.category; // 入力はあったが認識できなかった

    const id = createKintoneScheduleRecord_({
      date: ev.date,
      startTime: ev.startTime,
      endTime: ev.endTime,
      allDay: ev.allDay,
      title: ev.title,
      categoryKey: categoryKey
    });
    return {
      id: id,
      error: null,
      categoryFallback: categoryFallback,
      categoryUsedLabel: KINTONE_CATEGORY_OPTIONS[categoryKey]
    };
  } catch (err) {
    const msg = err.message || err.toString();
    Logger.log('createKintoneRecordFromSheetRowWithError_ エラー: ' + msg);
    return { id: null, error: msg };
  }
}

/**
 * シートに手入力された素朴なカテゴリ文言（外出／出張／研修／会議／来社／その他）を
 * KINTONE_CATEGORY_OPTIONS のキーに変換する。一致しなければ null を返す。
 */
function categoryKeyFromText_(text) {
  if (!text) return null;
  const raw = String(text).trim();

  // すでにkintoneの正式な選択肢そのもの（絵文字込み）が入っている場合はそのまま判定する
  // （例：一度同期された行の値をコピーした場合など）
  for (const key in KINTONE_CATEGORY_OPTIONS) {
    if (KINTONE_CATEGORY_OPTIONS[key] === raw) return key;
  }

  // 絵文字の有無に関わらず、含まれる言葉で判定する（例："🏢来社" でも "来社" でも一致）
  const plainWordMap = {
    '外出': 'outing', '出張': 'business', '研修': 'training',
    '会議': 'meeting', '来社': 'visit', 'その他': 'other'
  };
  for (const word in plainWordMap) {
    if (raw.indexOf(word) !== -1) return plainWordMap[word];
  }

  return null; // どれにも一致しない
}

/**
 * シートのセル値（Date型または文字列）を 'YYYY-MM-DD' 形式の文字列に正規化する。
 * （日付として入力すると、スプレッドシートがDate型に自動変換することがあるため）
 */
function formatDateValueForKintone_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(v).trim();
}

/**
 * シートのセル値（Date型または文字列）を 'HH:mm' 形式の文字列に正規化する。
 */
function formatTimeValueForKintone_(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm');
  }
  return String(v).trim();
}

/**
 * kintoneレコード配列 → 扱いやすいイベントオブジェクト配列に変換する。
 * このアプリには「①スケジュール（開始日時/終了日時）」と
 * 「②経営本部スケジュール（b_date/b_start/b_end）」の2種類のレコードが混在しているため、
 * レコードごとにどちらの形式が入っているかを判定して振り分ける。
 * 複数日にまたがる予定は、含まれる日ごとに1件ずつのイベントとして展開する。
 */
function kintoneRecordsToEvents_(records) {
  const events = [];

  records.forEach(function (r) {
    // ★方針：①スケジュール（予定）のみ処理する。②経営本部スケジュール（予約）は無視する。
    const schedStart = getKintoneFieldValue(r, KINTONE_FIELD.schedule.startDateTime);
    if (schedStart) {
      pushScheduleEvents_(events, r);
    }
  });

  events.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.startTime || '').localeCompare(b.startTime || '');
  });

  return events;
}

/**
 * 「①スケジュール（予定）」形式のレコード（開始日時/終了日時がDATETIME）を
 * イベント配列に展開して追加する。
 */
function pushScheduleEvents_(events, r) {
  const startVal = getKintoneFieldValue(r, KINTONE_FIELD.schedule.startDateTime);
  const endVal = getKintoneFieldValue(r, KINTONE_FIELD.schedule.endDateTime) || startVal;
  if (!startVal) return;

  const title = getKintoneFieldValue(r, KINTONE_FIELD.schedule.title) || '(無題の予定)';
  const category = getKintoneFieldValue(r, KINTONE_FIELD.schedule.category) || '';
  const recordId = r.$id ? r.$id.value : '';

  // ★重要：kintoneのDATETIME型はAPI上UTC（末尾Z）で返ってくるため、
  //   文字列を単純に切り出すのではなく、Dateとして解釈してから
  //   日本時間（Asia/Tokyo）にフォーマットし直す必要がある。
  const startDateObj = new Date(startVal);
  const endDateObj = new Date(endVal);

  const startDateOnly = Utilities.formatDate(startDateObj, 'Asia/Tokyo', 'yyyy-MM-dd');
  const endDateOnly = Utilities.formatDate(endDateObj, 'Asia/Tokyo', 'yyyy-MM-dd');
  const startTime = Utilities.formatDate(startDateObj, 'Asia/Tokyo', 'HH:mm');
  const endTime = Utilities.formatDate(endDateObj, 'Asia/Tokyo', 'HH:mm');

  const isMultiDay = startDateOnly !== endDateOnly;
  const allDay = isMultiDay || !startTime || !endTime;

  expandEventAcrossDays_(events, startDateOnly, endDateOnly, {
    startTime: allDay ? '' : startTime,
    endTime: allDay ? '' : endTime,
    allDay: allDay,
    title: title,
    category: category,
    recordId: recordId
  });
}

/**
 * 開始日〜終了日の各日について、共通のイベント内容を1件ずつeventsに追加する共通ヘルパー。
 */
function expandEventAcrossDays_(events, startDateOnly, endDateOnly, base) {
  let d = new Date(startDateOnly + 'T00:00:00');
  const last = new Date(endDateOnly + 'T00:00:00');

  while (d <= last) {
    events.push(Object.assign({ date: Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') }, base));
    d.setDate(d.getDate() + 1);
  }

  return events;
}

/**
 * 「カレンダー_元データ」シートを取得（無ければ作成）する。
 */
function getOrCreateDataSheet_(ss) {
  let sheet = ss.getSheetByName(CAL_DATA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CAL_DATA_SHEET_NAME);
  }
  return sheet;
}

/**
 * 「カレンダー_元データ」シートの内容を、今回取得したイベント一覧で丸ごと書き換える。
 * LP側の空き状況判定（今後の連携）は、この生データを参照する想定。
 */
function writeRawDataSheet_(sheet, events) {
  sheet.clear();
  const header = ['日付', '開始時刻', '終了時刻', '終日', 'タイトル', 'カテゴリ', 'kintoneレコードID', '最終同期日時'];
  sheet.appendRow(header);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');

  const now = new Date();
  const rows = events.map(function (ev) {
    // ★「preserve（一時的に見つからないだけとみなして残した）」イベントは、
    //   元の最終同期日時を維持する（＝毎回「今」にリセットしない）。
    //   そうしないと、猶予時間のカウントが永久にリセットされ続け、
    //   本当にkintoneから削除された予定が消えなくなってしまう。
    const syncTime = ev.lastSyncOverride instanceof Date ? ev.lastSyncOverride : now;
    return [ev.date, ev.startTime, ev.endTime, ev.allDay ? '終日' : '', ev.title, ev.category, ev.recordId, syncTime];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, header.length);
}

/**
 * 「カレンダー」シートを取得（無ければ作成し、列幅など初期体裁を整える）する。
 */
function getOrCreateCalendarSheet_(ss) {
  let sheet = ss.getSheetByName(CAL_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CAL_SHEET_NAME);
  }
  if (sheet.getMaxColumns() < 7) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 7 - sheet.getMaxColumns());
  }
  for (let c = 1; c <= 7; c++) {
    sheet.setColumnWidth(c, 150);
  }
  return sheet;
}

/**
 * 「カレンダー」シート内で、指定した年月の月ブロックが何行目から始まっているかを調べる。
 * ★方式変更：見出しセルのテキストを毎回スキャンして判定するのはやめた。
 *   Googleスプレッドシートが"2026年7月"のような文字列を勝手に日付として解釈してしまう
 *   ことがあり、見た目は同じでも中身が文字列でなくなって比較が一致しなくなる問題が
 *   何度も再発したため、行番号は PropertiesService（スクリプトの永続ストレージ）に
 *   保存・管理する方式にした。これによりセルの中身がどう表示されるかに一切依存しない。
 */
function findMonthBlockRow_(sheet, year, month /* 0-11 */) {
  const index = getMonthBlockIndex_();
  const row = index[monthKey_(year, month)];
  return row || null;
}

/**
 * 月ブロックの開始行インデックス（{ "2026-07": 16, ... }）をPropertiesServiceから読み込む。
 */
function getMonthBlockIndex_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CAL_BLOCK_INDEX_PROP_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/**
 * 月ブロックの開始行インデックスをPropertiesServiceに保存する。
 */
function saveMonthBlockIndex_(index) {
  PropertiesService.getScriptProperties().setProperty(CAL_BLOCK_INDEX_PROP_KEY, JSON.stringify(index));
}

/**
 * インデックスに1件登録・更新する。
 */
function setMonthBlockRow_(year, month, row) {
  const index = getMonthBlockIndex_();
  index[monthKey_(year, month)] = row;
  saveMonthBlockIndex_(index);
}

/**
 * インデックスを空にする（「カレンダー」タブを丸ごと作り直す時に使う）。
 */
function clearMonthBlockIndex_() {
  saveMonthBlockIndex_({});
}

/**
 * インデックスのキー形式（例: "2026-07"）を作る。
 */
function monthKey_(year, month /* 0-11 */) {
  return year + '-' + String(month + 1).padStart(2, '0');
}

function monthLabel_(year, month /* 0-11 */) {
  return year + '年' + (month + 1) + '月';
}

/**
 * シートの一番下に、新しい月のブロックを追加する（＝カレンダーが下にどんどん積み上がる）。
 */
function appendMonthBlock_(sheet, year, month, events) {
  const startRow = sheet.getLastRow() + 1;
  // 既存データが無い場合、getLastRow()は0を返すのでそのまま1行目から開始される
  writeMonthBlockAt_(sheet, startRow, year, month, events);
  setMonthBlockRow_(year, month, startRow); // ★インデックスに登録しておく
}

/**
 * 既に存在する月ブロックの中身だけを最新の内容で上書きする（行位置は変えない）。
 */
function rewriteMonthBlock_(sheet, startRow, year, month, events) {
  writeMonthBlockAt_(sheet, startRow, year, month, events);
}

/**
 * 指定した開始行に、1か月分のカレンダーブロック（見出し＋曜日行＋週6行＋区切り空行）を描画する。
 */
/**
 * シートの行数が足りない場合、必要な分だけ末尾に行を追加する。
 * ブロックが積み重なってシートの現在の行数を超えると「範囲外」エラーになるため、
 * 各ブロックを書き込む前に必ず呼び出す。
 */
function ensureSheetHasRows_(sheet, neededLastRow) {
  const currentMaxRows = sheet.getMaxRows();
  if (neededLastRow > currentMaxRows) {
    sheet.insertRowsAfter(currentMaxRows, neededLastRow - currentMaxRows);
  }
}

function writeMonthBlockAt_(sheet, startRow, year, month, allEvents) {
  const titleRow = startRow;
  const weekdayRow = startRow + 1;
  const firstWeekRow = startRow + 2;
  const spacerRow = firstWeekRow + CAL_WEEK_ROWS_PER_MONTH;

  // ★このブロックを書き込むのに十分な行数がシートに無い場合、先に行を追加する
  //   （これが無いと、たくさんのブロックが積み上がった状態で「これらの行は範囲外にあります」
  //   という例外が発生することがある）
  ensureSheetHasRows_(sheet, spacerRow);

  // --- 月見出し ---
  const titleRange = sheet.getRange(titleRow, 1, 1, 7);
  titleRange.breakApart();
  titleRange.merge();
  // ★重要："2026年7月"のような文字列は、書式を指定しないとGoogleスプレッドシートが
  //   自動的に「日付」として解釈し、文字列ではなく日付値に変換してしまうことがある。
  //   そうなるとfindMonthBlockRow_の文字列比較が常に不一致になり、既存の月ブロックを
  //   見つけられず、実行のたびに新しい月ブロックが下に追加され続けてしまう。
  //   これを防ぐため、書き込み前に必ずセルの表示形式を「プレーンテキスト」に固定する。
  titleRange.setNumberFormat('@');
  titleRange.setValue(monthLabel_(year, month));
  titleRange.setFontSize(14);
  titleRange.setFontWeight('bold');
  titleRange.setBackground('#1F2937');
  titleRange.setFontColor('#FFFFFF');
  titleRange.setHorizontalAlignment('center');
  sheet.setRowHeight(titleRow, 28);

  // --- 曜日見出し ---
  const weekdayRange = sheet.getRange(weekdayRow, 1, 1, 7);
  weekdayRange.setValues([CAL_WEEKDAY_LABELS]);
  weekdayRange.setFontWeight('bold');
  weekdayRange.setBackground('#F3F4F6');
  weekdayRange.setHorizontalAlignment('center');
  sheet.getRange(weekdayRow, 1).setFontColor('#DC2626'); // 日曜=赤
  sheet.getRange(weekdayRow, 7).setFontColor('#2563EB'); // 土曜=青
  sheet.setRowHeight(weekdayRow, 20);

  // --- その月のイベントを日付ごとにまとめる ---
  const eventsByDate = {};
  allEvents.forEach(function (ev) {
    const evDate = new Date(ev.date + 'T00:00:00');
    if (evDate.getFullYear() === year && evDate.getMonth() === month) {
      if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
      eventsByDate[ev.date].push(ev);
    }
  });

  // --- 週6行分のマス目を作る ---
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0=日
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let week = 0; week < CAL_WEEK_ROWS_PER_MONTH; week++) {
    const rowIndex = firstWeekRow + week;
    sheet.setRowHeight(rowIndex, 70);

    for (let wd = 0; wd < 7; wd++) {
      const dayNumber = week * 7 + wd - startWeekday + 1;
      const cell = sheet.getRange(rowIndex, wd + 1);

      if (dayNumber < 1 || dayNumber > daysInMonth) {
        cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText('').build());
        cell.setBackground('#FAFAFA');
        continue;
      }

      const dateStr = Utilities.formatDate(new Date(year, month, dayNumber), 'Asia/Tokyo', 'yyyy-MM-dd');
      const dayEvents = eventsByDate[dateStr] || [];
      cell.setBackground('#FFFFFF');
      cell.setVerticalAlignment('top');
      cell.setWrap(true);
      cell.setRichTextValue(buildDayCellRichText_(dayNumber, dayEvents));
    }
  }

  // --- 区切りの空行 ---
  sheet.getRange(spacerRow, 1, 1, 7).setBackground(null).setValue('');
  sheet.setRowHeight(spacerRow, 10);
}

/**
 * 1日分のセルのリッチテキスト（日付＋予定一覧、カテゴリごとに色分け）を組み立てる。
 */
function buildDayCellRichText_(dayNumber, dayEvents) {
  let text = String(dayNumber);
  const runs = []; // {start, end, color, bold}

  runs.push({ start: 0, end: text.length, bold: true, color: '#111827' });

  dayEvents.forEach(function (ev) {
    const timeLabel = ev.allDay ? '終日' : (ev.startTime + '-' + ev.endTime);
    const line = '\n' + timeLabel + ' ' + ev.title;
    const lineStart = text.length + 1; // 先頭の改行の次から
    text += line;
    runs.push({
      start: lineStart,
      end: text.length,
      bold: false,
      color: categoryColor_(ev.category)
    });
  });

  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  runs.forEach(function (run) {
    const style = SpreadsheetApp.newTextStyle()
      .setForegroundColor(run.color)
      .setBold(!!run.bold)
      .build();
    builder.setTextStyle(run.start, run.end, style);
  });

  return builder.build();
}

/**
 * カテゴリ名から一貫した色を割り当てる（簡易ハッシュ）。
 */
function categoryColor_(category) {
  if (!category) return '#374151';
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) % CAL_CATEGORY_COLORS.length;
  }
  return CAL_CATEGORY_COLORS[Math.abs(hash) % CAL_CATEGORY_COLORS.length];
}

/**
 * ★セットアップ確認用：カレンダーアプリの実際のフィールド一覧をログに出力する。
 * エディタ上部でこの関数を選択して「実行」→「実行数」→「ログを表示」で確認してください。
 * 正しいフィールドコードが分かったら、上の KINTONE_FIELD に反映してください。
 */
function debugKintoneFields() {
  assertKintoneConfigured_();
  const url = 'https://' + KINTONE_SUBDOMAIN + '.cybozu.com/k/v1/app/form/fields.json'
    + '?app=' + encodeURIComponent(KINTONE_APP_ID);
  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-Cybozu-API-Token': KINTONE_API_TOKEN },
    muteHttpExceptions: true
  });
  Logger.log('HTTPステータス: ' + res.getResponseCode());
  Logger.log(res.getContentText());
}

/* =========================================================================
   ★LP → GAS プロキシ認証
   -------------------------------------------------------------------------
   ブラウザからGASへ直接アクセスさせず、XServer上の api.php を経由させる。
   api.php だけが知る LP_PROXY_SECRET を各リクエストに付与し、GAS側で照合する。

   移行時は LP_PROXY_ENFORCE が true になるまで旧HTMLからの直接アクセスも許可する。
   新HTML/APIプロキシの動作確認後、enableLpProxyEnforcement() を1回実行すると完全施行。
   ========================================================================= */
const LP_PROXY_SECRET = getScriptProp_('LP_PROXY_SECRET');

function isLpProxyEnforced_() {
  return String(getScriptProp_('LP_PROXY_ENFORCE')).toLowerCase() === 'true';
}

function assertLpProxyRequest_(providedSecret) {
  const provided = String(providedSecret || '').trim();

  // 移行期間中は、秘密値が付いていない旧HTMLからのアクセスのみ許可する。
  if (!provided && !isLpProxyEnforced_()) return true;

  if (!LP_PROXY_SECRET) {
    throw new Error('AUTH_REQUIRED:LPプロキシ認証が未設定です。');
  }
  if (!provided || !safeTokenEquals_(LP_PROXY_SECRET, provided)) {
    throw new Error('AUTH_REQUIRED:このAPIへの直接アクセスは許可されていません。');
  }
  return true;
}

/** 新しいXServerプロキシへの切替確認後に1回だけ実行する。 */
function enableLpProxyEnforcement() {
  if (!getScriptProp_('LP_PROXY_SECRET')) {
    throw new Error('LP_PROXY_SECRET が未設定です。先にスクリプトプロパティへ登録してください。');
  }
  PropertiesService.getScriptProperties().setProperty('LP_PROXY_ENFORCE', 'true');
  Logger.log('LP_PROXY_ENFORCE=true にしました。以後、GASへの直接アクセスは拒否されます。');
}

/** 緊急時のロールバック用。通常は使わない。 */
function disableLpProxyEnforcement() {
  PropertiesService.getScriptProperties().setProperty('LP_PROXY_ENFORCE', 'false');
  Logger.log('LP_PROXY_ENFORCE=false にしました。移行互換モードへ戻しました。');
}

/* =========================================================================
   フォームの受け口
   ========================================================================= */

/**
 * フォームからのPOSTリクエストを受け取るエントリーポイント
 */
function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') {
      throw new Error('INVALID_REQUEST:送信データがありません。');
    }
    const data = JSON.parse(e.postData.contents);
    assertLpProxyRequest_(data._proxySecret || '');
    delete data._proxySecret; // 秘密値をシートのJSON列等へ保存しない

    const formType = String(data.formType || '').trim();

    // ★「まずはメールで確認したい」の完了表示高速化用。
    // 保存処理とは切り離して、PHPプロキシがレスポンス返却後にこの通知処理だけを呼ぶ。
    // LP_PROXY_SECRETで認証されたプロキシ経由のみ実行される。
    if (formType === 'inquiryNotificationOnly') {
      const bookingRow = Number(data.bookingRow || 0) || null;
      try {
        notifyTrelloInquiry_(data, bookingRow);
      } catch (trelloErr) {
        Logger.log('Trello通知（問い合わせ・後処理）の呼び出しでエラー: ' + trelloErr.toString());
      }
      sendInquiryConfirmationEmail_(data);
      return jsonOutput({ result: 'success' });
    }

    if (formType === 'advisoryHearing') {
      appendAdvisoryHearingToSheet_(data);
      return jsonOutput({ result: 'success' });
    } else if (formType === 'hearing') {
      // ヒアリングシート（hearing.html）からの送信
      const isFirstSubmission = appendHearingToSheet(data);
      return jsonOutput({ result: 'success', firstSubmission: isFirstSubmission });
    } else if (formType === 'fileUpload') {
      // ヒアリングシートの添付ファイル（1ファイルごとに個別送信される）
      return jsonOutput(handleHearingFileUpload_(data));
    } else if (formType === 'cancel') {
      // 変更・キャンセルページ（manage.html）からのキャンセル
      handleCancelRequest_(data);
    } else if (formType === 'reschedule') {
      // 変更・キャンセルページ（manage.html）からの日程変更
      handleRescheduleRequest_(data);
    } else {
      // 通常予約フォームは formType を送らない既存仕様。未知のformTypeは予約として扱わず拒否する。
      if (formType) {
        throw new Error('INVALID_REQUEST:未対応のformTypeです。');
      }
      // 通常の予約フォーム（booking.html / トップページ埋め込み）からの送信
      const submissionId = Utilities.getUuid();
      // ★新規ミーティング予約のヒアリング・予約管理URL用トークン。
      // 問い合わせのみの場合は管理URLを発行しないため空欄のまま。
      const accessToken = generateAccessToken_();
      // ★「まずはメールで確認したい方はこちら」等、日時未選択の問い合わせはミーティング予約ではない
      const isInquiryOnly = !data.date || !data.time;

      let recordId = '';
      if (!isInquiryOnly) {
        // 新予約APIへ登録。409（二重予約）の場合は、予約一覧・メール等を作る前にフロントへ返す。
        const bookingResult = appendBookingToCalendarDataAndKintone_(data);
        if (bookingResult && bookingResult.conflict) {
          return jsonOutput({ result: 'conflict', error: bookingResult.message || 'その枠は埋まりました。別の時間を選択してください。' });
        }
        recordId = bookingResult && bookingResult.id ? bookingResult.id : '';
        if (!recordId) throw new Error('予約APIから予約IDが返りませんでした');
      }

      const bookingSheetResult = appendToSheet(data, submissionId, recordId, isInquiryOnly ? '' : accessToken);
      const hearingUrl = bookingSheetResult.hearingUrl;
      const bookingRow = bookingSheetResult.row;

      if (isInquiryOnly) {
        // ★問い合わせのみ：保存が完了した時点でPHPプロキシへ成功を返せるようにする。
        // Trello通知・受付メールは、PHP側がブラウザへのレスポンス返却後に
        // inquiryNotificationOnly として同じGASへ再送し、後処理する。
        if (data._deferInquiryNotifications) {
          return jsonOutput({
            result: 'success',
            deferredInquiry: {
              submissionId: submissionId,
              bookingRow: bookingRow
            }
          });
        }

        // 旧経路や直接テストでは従来どおり同期実行する。
        try {
          // ★appendToSheetで確定した行番号をそのまま使い、再度シートを開いて検索する待ち時間を省く。
          notifyTrelloInquiry_(data, bookingRow);
        } catch (trelloErr) {
          Logger.log('Trello通知（問い合わせ）の呼び出しでエラー: ' + trelloErr.toString());
        }
        sendInquiryConfirmationEmail_(data);
      } else {
        // ★manage.htmlの読み込みをすぐ速くできるよう、この時点でキャッシュしておく
        cacheBookingLookupInfo_(submissionId, {
          cancelled: false,
          date: data.date || '',
          time: data.time || '',
          company: data.company || '',
          name: data.name || ''
        });

        // ★Trelloへの通知カード作成（失敗しても予約自体は成立させる）
        try {
          // ★appendToSheetで確定した行番号をそのまま使い、再度シートを開いて検索する待ち時間を省く。
          notifyTrelloBookingCreated_(data, recordId, bookingRow);
        } catch (trelloErr) {
          Logger.log('Trello通知（新規予約）の呼び出しでエラー: ' + trelloErr.toString());
        }

        // ★お客様への予約完了メールを自動送信する（失敗しても予約自体は成立させる）
        sendBookingConfirmationEmail_(data, hearingUrl, submissionId, accessToken);
      }

      if (NOTIFY_EMAIL) {
        sendNotification(data);
      }
    }

    return jsonOutput({ result: 'success' });
  } catch (err) {
    return jsonOutput({ result: 'error', error: err.toString() });
  }
}

/**
 * 動作確認用、および hearing.html が過去の回答を取得するためのエントリーポイント
 * ?id=◯◯◯ が付いている場合は、その紐付けIDの過去の回答をJSONで返す
 * ?action=busy&year=YYYY&month=M が付いている場合は、その月のkintone予約済み枠を返す
 */
function doGet(e) {
  try {
    const id = e && e.parameter && e.parameter.id;
    const action = e && e.parameter && e.parameter.action;
    const token = e && e.parameter && e.parameter.token;
    const proxySecret = e && e.parameter && e.parameter.proxySecret;
    assertLpProxyRequest_(proxySecret || '');

    if (action && ['busy', 'booking', 'advisory'].indexOf(action) === -1) {
      return jsonOutput({ result: 'error', error: 'INVALID_REQUEST:未対応のactionです。' });
    }

    if (action === 'busy') {
    return handleBusyRequest(e);
  }

  if (action === 'booking' && id) {
    return handleBookingLookupRequest_(id, token || '');
  }

  if (action === 'advisory' && id) {
    const record = findAdvisoryHearingRecordById_(id, token || '');
    if (record) {
      return jsonOutput({ result: 'success', data: record });
    }
    return jsonOutput({ result: 'not_found' });
  }

  if (id) {
    const record = findHearingRecordById(id, token || '');
    if (record) {
      return jsonOutput({ result: 'success', data: record });
    }
    return jsonOutput({ result: 'not_found' });
  }

    return ContentService
      .createTextOutput('この予約フォームAPIは正常に稼働しています。')
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    Logger.log('doGet認証/処理エラー: ' + err.toString());
    return jsonOutput({ result: 'error', error: String(err.message || err) });
  }
}

/* =========================================================================
   ★kintone連携：予約済み枠の問い合わせ（LP → GAS → kintone）
   ========================================================================= */

/**
 * booking.html からの ?action=busy&year=2026&month=7 を処理し、
 * その月にkintone上で埋まっている日付・時間帯をJSONで返す。
 *
 * レスポンス例:
 * {
 *   "result": "success",
 *   "busy": {
 *     "2026-07-28": { "allDay": false, "ranges": [{"start":"13:00","end":"14:00"}] },
 *     "2026-07-31": { "allDay": true,  "ranges": [] }
 *   }
 * }
 */
/* =========================================================================
   ★LP空き時間の調整設定
   ------------------------------------------------------------------------
   ここから下の値を調整すれば、LP予約カレンダーの「予約不可」条件を変更できます。
   ========================================================================= */
const MIN_LEAD_BUSINESS_DAYS = 3; // 予約日から3営業日後以降を予約可能にする（土日・日本の祝日は営業日に含めない）

// タイトルにこれらの文字列を含む予定は、LPの空き状況判定では「無視」する（＝その予定があっても予約可能扱いにする）
const BUSY_CHECK_EXCLUDED_TITLE_KEYWORDS = ['幹部会'];

// 担当者がA列に日付を書き足していくと、その日を終日予約不可にできるシート
const FULL_DAY_BLOCK_SHEET_NAME = '終日対応不可日';
// 「カレンダー_元データ」に見える化のため書き込む終日対応不可日の行は、この印をkintoneレコードID欄に入れておく
// （空欄ではないので「選択中の行をkintoneとLPに反映」ボタンの対象から自然に除外される＝誤送信を防げる）
const FULL_DAY_BLOCK_RECORD_ID_MARKER = '終日対応不可(手動)';

/**
 * イベントのタイトルが、空き状況判定から除外すべき予定（例：幹部会）かどうかを判定する。
 */
function isExcludedFromBusyCheck_(title) {
  if (!title) return false;
  const t = String(title);
  return BUSY_CHECK_EXCLUDED_TITLE_KEYWORDS.some(function (keyword) {
    return t.indexOf(keyword) !== -1;
  });
}
const JP_HOLIDAY_CALENDAR_ID = 'ja.japanese#holiday@group.v.calendar.google.com'; // Googleが提供する日本の祝日カレンダー

// API空き状況の短期キャッシュ。ポータル側で予定が変わる可能性があるため長時間は保持しない。
// LP予約・変更・取消時は該当月のキャッシュを即時削除し、二重予約はAPI側の409でも最終防止する。
const FDA_AVAILABILITY_CACHE_TTL_SECONDS = 45;

function fdaAvailabilityCacheKey_(year, month) {
  return 'fda_availability_' + year + '_' + String(month).padStart(2, '0');
}

function invalidateFdaAvailabilityCacheForDate_(dateStr) {
  if (!dateStr) return;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-/);
  if (!m) return;
  try { CacheService.getScriptCache().remove(fdaAvailabilityCacheKey_(Number(m[1]), Number(m[2]))); } catch (e) {}
}

function handleBusyRequest(e) {
  try {
    const year = parseInt(e.parameter.year, 10);
    const month = parseInt(e.parameter.month, 10); // 1-12
    if (!year || !month) return jsonOutput({ result: 'error', error: 'year, month は必須です' });

    const cache = CacheService.getScriptCache();
    const key = fdaAvailabilityCacheKey_(year, month);
    const cached = cache.get(key);
    if (cached) {
      try {
        const result = JSON.parse(cached);
        return jsonOutput({ result: 'success', busy: result.busy || {}, availableMembers: result.availableMembers || {}, cached: true });
      } catch (e) {}
    }

    const result = buildApiAvailabilityForMonth_(year, month);
    try { cache.put(key, JSON.stringify(result), FDA_AVAILABILITY_CACHE_TTL_SECONDS); } catch (e) {}
    return jsonOutput({ result: 'success', busy: result.busy, availableMembers: result.availableMembers, cached: false });
  } catch (err) {
    Logger.log('新予約APIからの空き状況取得に失敗: ' + err.toString());
    return jsonOutput({ result: 'error', error: err.toString() });
  }
}

/**
 * 新予約APIの生予定から、LP用の「予約不可スロット」と担当者候補を作る。
 * 応接室が重複する場合、または担当2名が両方埋まる場合のみ、そのスロットを不可にする。
 */
function buildApiAvailabilityForMonth_(year, month) {
  const first = year + '-' + String(month).padStart(2, '0') + '-01';
  const lastDay = new Date(year, month, 0).getDate();
  const last = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  const events = getFdaBookingEvents_(first, last);
  const busy = {};
  const availableMembers = {};
  const slots = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00'];

  for (let d = 1; d <= lastDay; d++) {
    const dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    busy[dateStr] = { allDay: false, ranges: [], takenSlots: {} };
    availableMembers[dateStr] = {};

    slots.forEach(function(start) {
      const members = findAvailableMembersForSlotFromEvents_(events, dateStr, start, BOOKING_DURATION_MIN);
      availableMembers[dateStr][start] = members;
      if (!members.length) busy[dateStr].takenSlots[start] = true;
    });
  }

  // 土日・祝日・直近3日以内・手動終日不可日は従来ルールを維持
  applyWeekendBlocks_(busy, year, month);
  applyHolidayBlocks_(busy, year, month);
  applyLeadTimeBlocks_(busy, year, month);
  applyFullDayBlockSheetBlocks_(busy, year, month);
  return { busy: busy, availableMembers: availableMembers };
}

function findAvailableMembersForSlotFromEvents_(events, dateStr, startTime, durationMin, ignoreId) {
  const slotStart = timeToMinutes_(startTime);
  const slotEnd = slotStart + durationMin;
  const blockedMembers = {};
  let roomBlocked = false;

  (events || []).forEach(function(ev) {
    if (!ev || String(ev.date || '') !== dateStr) return;
    if (ignoreId && String(ev.id || '') === String(ignoreId)) return;
    if (!ev.start || !ev.end) {
      if (ev.room === true) roomBlocked = true;
      (ev.members || []).forEach(function(m){ blockedMembers[String(m)] = true; });
      return;
    }
    // ★既存予定の前後30分を予約不可にする。
    // 例：15:30〜16:30の予定なら、15:00〜17:00を予約枠との重複判定対象にする。
    const evStart = timeToMinutes_(String(ev.start)) - FDA_BOOKING_BUFFER_AFTER_MIN;
    const evEnd = timeToMinutes_(String(ev.end)) + FDA_BOOKING_BUFFER_AFTER_MIN;
    const overlaps = slotStart < evEnd && evStart < slotEnd;
    if (!overlaps) return;
    if (ev.room === true) roomBlocked = true;
    (ev.members || []).forEach(function(m){ blockedMembers[String(m)] = true; });
  });

  if (roomBlocked && FDA_BOOKING_ROOM) return [];
  return FDA_BOOKING_MEMBERS.filter(function(m){ return !blockedMembers[m]; });
}

function getFreshAvailableMembersForSlot_(dateStr, startTime, ignoreId) {
  const events = getFdaBookingEvents_(dateStr, dateStr);
  return findAvailableMembersForSlotFromEvents_(events, dateStr, startTime, BOOKING_DURATION_MIN, ignoreId);
}

/**
 * 指定した年月の空き状況（busyMap）を、「カレンダー_元データ」＋土日／祝日／直近除外の
 * ルールから、その場で計算する（キャッシュを使わない生の計算）。
 */
function computeBusyMapForMonth_(year, month /* 1-12 */, precomputedHolidayDates) {
  const events = getEventsFromDataSheetForMonth_(year, month);
  const busyMap = buildBusyMap(events);

  applyWeekendBlocks_(busyMap, year, month);
  applyHolidayBlocks_(busyMap, year, month, precomputedHolidayDates);
  applyLeadTimeBlocks_(busyMap, year, month);
  applyFullDayBlockSheetBlocks_(busyMap, year, month);

  return busyMap;
}

/**
 * ★LP向け空き状況のキャッシュシートを取得（無ければ作成）する。非表示タブとして扱う。
 *   ※このシートは「CacheServiceが何らかの理由で使えない/期限切れの場合の保険」として
 *     残しているだけで、LPが実際に読みに行くのは基本的にCacheService側。
 */
function getOrCreateBusyCacheSheet_(ss) {
  let sheet = ss.getSheetByName(CAL_BUSY_CACHE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CAL_BUSY_CACHE_SHEET_NAME);
    try { sheet.hideSheet(); } catch (err) { /* 非表示に失敗しても致命的ではないので無視 */ }
  }
  return sheet;
}

/**
 * LPの予約可能範囲（今日から数か月分）の空き状況をまとめて計算し、
 * ★CacheService（スプレッドシートを開かない、高速な保存領域）に書き出す。
 *   pullKintoneToCalendarSheet（kintone同期）のたび＝スプレッドシート側に変更があった
 *   タイミングで、ここが即座に上書きされる。
 *   あわせて、CacheServiceの期限切れ（最大6時間）に備えてスプレッドシート側にも
 *   バックアップとして保存しておく。
 */
function rebuildBusyCache_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = getOrCreateBusyCacheSheet_(ss);
  const cache = CacheService.getScriptCache();

  const today = new Date();
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const rangeEndExclusive = new Date(today.getFullYear(), today.getMonth() + BUSY_CACHE_FORWARD_MONTHS + 1, 1);
  // ★高速化：祝日カレンダーへの問い合わせは、月ごとではなく対象期間全体で1回だけ行う
  const holidayDates = fetchHolidayDatesInRange_(rangeStart, rangeEndExclusive);

  const rows = [];

  for (let i = 0; i <= BUSY_CACHE_FORWARD_MONTHS; i++) {
    const targetDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = targetDate.getFullYear();
    const m = targetDate.getMonth() + 1; // 1-12
    const busyMap = computeBusyMapForMonth_(y, m, holidayDates);
    const json = JSON.stringify(busyMap);

    // ★LPが実際に読みに行くのはこちら（スプレッドシートを一切開かない、高速な経路）
    cache.put(busyCacheServiceKey_(y, m), json, BUSY_CACHE_TTL_SECONDS);

    rows.push([busyCacheKey_(y, m), json, new Date()]);
  }

  // バックアップ用（CacheServiceが期限切れ・利用不可の時のフォールバック先）
  sheet.clear();
  sheet.appendRow(['年月', 'busyJSON', '更新日時']);
  sheet.setFrozenRows(1);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

/**
 * ★高速化：1か月分だけキャッシュを作り直す軽量版。
 * 予約・キャンセル・変更の直後など「お客様を待たせたくない」場面ではこちらを使う
 * （4か月分まとめて計算するrebuildBusyCache_より速い）。
 * 定期的な完全版の作り直しは、引き続きpullKintoneToCalendarSheet経由のrebuildBusyCache_が担当する。
 */
function updateBusyCacheForMonth_(year, month /* 1-12 */) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getOrCreateBusyCacheSheet_(ss);
    const cache = CacheService.getScriptCache();

    const busyMap = computeBusyMapForMonth_(year, month);
    const json = JSON.stringify(busyMap);
    const key = busyCacheKey_(year, month);

    cache.put(busyCacheServiceKey_(year, month), json, BUSY_CACHE_TTL_SECONDS);

    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < keys.length; i++) {
        if (keys[i][0] === key) {
          sheet.getRange(i + 2, 2, 1, 2).setValues([[json, new Date()]]);
          return;
        }
      }
    }
    sheet.appendRow([key, json, new Date()]);
  } catch (err) {
    Logger.log('updateBusyCacheForMonth_ エラー: ' + err.toString());
  }
}

/**
 * 指定した年月のbusyMapを取得する。
 * ①CacheService（スプレッドシートを一切開かない、最速の経路）→
 * ②スプレッドシートのバックアップシート（CacheServiceが切れていた場合の保険）
 * の順に探し、見つからなければnullを返す（呼び出し元でその場計算にフォールバックする）。
 */
function getCachedBusyMap_(year, month /* 1-12 */) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(busyCacheServiceKey_(year, month));
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      // 壊れていた場合はスプレッドシート側にフォールバックする
    }
  }

  // ここに来るのは基本的に「CacheServiceの期限（最大6時間）が切れていた」場合のみのはず
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(CAL_BUSY_CACHE_SHEET_NAME);
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const key = busyCacheKey_(year, month);
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === key) {
      try {
        const json = values[i][1];
        // 見つかったのでCacheServiceにも書き戻しておく（次回以降は高速経路に乗る）
        cache.put(busyCacheServiceKey_(year, month), json, BUSY_CACHE_TTL_SECONDS);
        return JSON.parse(json);
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

/**
 * キャッシュシートのキー形式（例: "2026-07"）を作る。monthは1-12。
 */
function busyCacheKey_(year, month /* 1-12 */) {
  return year + '-' + String(month).padStart(2, '0');
}

/**
 * CacheService用のキー（スプレッドシートのキーと衝突しないよう接頭辞を付ける）。
 */
function busyCacheServiceKey_(year, month /* 1-12 */) {
  return 'busy_' + busyCacheKey_(year, month);
}

/**
 * 「カレンダー_元データ」シートから、指定した年月に該当する行だけを
 * buildBusyMap()に渡せる形（イベント配列）に変換して返す。
 */
function getEventsFromDataSheetForMonth_(year, month, applyTitleExclusion) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const dataSheet = ss.getSheetByName(CAL_DATA_SHEET_NAME);
  if (!dataSheet) return [];

  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) return [];

  const numCols = 8;
  const values = dataSheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const monthPrefix = year + '-' + String(month).padStart(2, '0');
  const shouldExclude = applyTitleExclusion !== false; // 省略時はtrue（従来通り＝空き状況判定用）
  const events = [];

  values.forEach(function (row) {
    const dateVal = row[0];
    const startTimeVal = row[1];
    const endTimeVal = row[2];
    const allDayVal = row[3];
    const titleVal = row[4];
    const categoryVal = row[5];
    if (!dateVal) return;

    const dateStr = formatDateValueForKintone_(dateVal);
    if (dateStr.indexOf(monthPrefix) !== 0) return; // 対象月以外はスキップ
    if (shouldExclude && isExcludedFromBusyCheck_(titleVal)) return; // ★予約不可扱いにしない予定（例：幹部会）はスキップ

    const isAllDay = (String(allDayVal).trim() === '終日');
    const startTime = isAllDay ? '' : formatTimeValueForKintone_(startTimeVal);
    const endTime = isAllDay ? '' : formatTimeValueForKintone_(endTimeVal);

    events.push({
      date: dateStr,
      startTime: startTime,
      endTime: endTime,
      allDay: isAllDay || !startTime || !endTime,
      title: titleVal || '',
      category: categoryVal || ''
    });
  });

  return events;
}

/**
 * その月の土曜・日曜を、busyMap上で終日ブロックとしてマークする。
 */
function applyWeekendBlocks_(busyMap, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) {
      markDateAllDayBusy_(busyMap, date);
    }
  }
}

/**
 * Googleが提供する「日本の祝日」カレンダーを参照し、その月の祝日を
 * busyMap上で終日ブロックとしてマークする。取得に失敗しても処理は継続する
 * （祝日情報が無くても、通常の予約判定自体は動くようにするため）。
 */
function applyHolidayBlocks_(busyMap, year, month, precomputedHolidayDates) {
  try {
    let holidayDates = precomputedHolidayDates;
    if (!holidayDates) {
      // 事前計算済みのリストが渡されなかった場合のみ、その場でGoogleの祝日カレンダーに問い合わせる
      const rangeStart = new Date(year, month - 1, 1);
      const rangeEndExclusive = new Date(year, month, 1);
      holidayDates = fetchHolidayDatesInRange_(rangeStart, rangeEndExclusive);
    }

    const monthPrefix = year + '-' + String(month).padStart(2, '0');
    holidayDates.forEach(function (dateStr) {
      if (dateStr.indexOf(monthPrefix) === 0) {
        markDateAllDayBusy_(busyMap, new Date(dateStr + 'T00:00:00'));
      }
    });
  } catch (err) {
    Logger.log('祝日カレンダーの取得に失敗しました（祝日の除外は行われません）: ' + err.toString());
  }
}

/**
 * ★高速化：指定した期間の祝日一覧を、Googleの祝日カレンダーへの問い合わせ1回だけで取得する。
 * 'YYYY-MM-DD' の配列を返す。複数月分をまとめて計算する時（rebuildBusyCache_など）に、
 * 月ごとに毎回カレンダーへ問い合わせずに済むようにするためのもの。
 */
function fetchHolidayDatesInRange_(rangeStart, rangeEndExclusive) {
  try {
    const holidayCal = CalendarApp.getCalendarById(JP_HOLIDAY_CALENDAR_ID);
    if (!holidayCal) return [];

    const holidayEvents = holidayCal.getEvents(rangeStart, rangeEndExclusive);
    return holidayEvents.map(function (ev) {
      const d = ev.isAllDayEvent() ? ev.getAllDayStartDate() : ev.getStartTime();
      return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
    });
  } catch (err) {
    Logger.log('祝日カレンダーの取得に失敗しました: ' + err.toString());
    return [];
  }
}

/**
 * 今日の翌日から営業日だけを数え、3営業日後の日付を返す。
 * 土日・日本の祝日は営業日に含めない。
 */
function getMinBookableBusinessDate_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 3営業日を求めるには通常1週間以内で足りるが、
  // 連休も考慮して余裕を持って30日分の祝日を取得する。
  const rangeEndExclusive = new Date(today);
  rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 30);

  const holidayDates = fetchHolidayDatesInRange_(today, rangeEndExclusive);
  const holidaySet = {};
  holidayDates.forEach(function (dateStr) {
    holidaySet[dateStr] = true;
  });

  let current = new Date(today);
  let businessDays = 0;

  while (businessDays < MIN_LEAD_BUSINESS_DAYS) {
    current.setDate(current.getDate() + 1);

    const weekday = current.getDay();
    const dateStr = Utilities.formatDate(current, 'Asia/Tokyo', 'yyyy-MM-dd');

    const isWeekend = weekday === 0 || weekday === 6;
    const isHoliday = !!holidaySet[dateStr];

    if (!isWeekend && !isHoliday) {
      businessDays++;
    }
  }

  current.setHours(0, 0, 0, 0);
  return current;
}

/**
 * 今日から3営業日後より前の日付を、busyMap上で終日ブロックとしてマークする。
 * 土日・日本の祝日は営業日に含めない。
 */
function applyLeadTimeBlocks_(busyMap, year, month) {
  const minBookableDate = getMinBookableBusinessDate_();

  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    date.setHours(0, 0, 0, 0);

    if (date < minBookableDate) {
      markDateAllDayBusy_(busyMap, date);
    }
  }
}

/**
 * ★予約・日程変更の確定時点でリードタイムを再確認する。
 * LPを数日間開きっぱなしにして表示が古くなっていても、
 * 送信時点の「今日」を基準に3営業日後以降の日付だけ受け付ける。
 */
function isBookingDateOutsideLeadTime_(dateStr) {
  if (!dateStr) return false;

  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;

  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  target.setHours(0, 0, 0, 0);

  const minBookableDate = getMinBookableBusinessDate_();

  return target >= minBookableDate;
}

/**
 * 「終日対応不可日」シートの内容を、カレンダー_元データ／カレンダータブに
 * 表示するためのイベントオブジェクトに変換する（見える化のみが目的。kintoneには送らない）。
 * recordIdに印を付けておくことで、誤って「kintoneに反映」ボタンで送信されるのを防いでいる。
 */
function getFullDayBlockSheetEvents_(rangeStart, rangeEnd) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(FULL_DAY_BLOCK_SHEET_NAME);
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return [];

    const startStr = Utilities.formatDate(rangeStart, 'Asia/Tokyo', 'yyyy-MM-dd');
    const endStr = Utilities.formatDate(rangeEnd, 'Asia/Tokyo', 'yyyy-MM-dd');
    const values = sheet.getRange(1, 1, lastRow, 1).getValues();
    const events = [];

    values.forEach(function (row) {
      const raw = row[0];
      if (!raw) return;

      const dateStr = parseFullDayBlockDate_(raw);
      if (!dateStr) return;
      if (dateStr < startStr || dateStr > endStr) return;

      events.push({
        date: dateStr,
        startTime: '',
        endTime: '',
        allDay: true,
        title: '終日対応不可',
        category: '',
        recordId: FULL_DAY_BLOCK_RECORD_ID_MARKER
      });
    });

    return events;
  } catch (err) {
    Logger.log('「' + FULL_DAY_BLOCK_SHEET_NAME + '」シートの読み込みに失敗しました: ' + err.toString());
    return [];
  }
}

/**
 * 複数のイベント配列を1つにまとめ、日付・開始時刻順に並べ替える。
 */
function mergeAndSortEvents_(/* ...eventArrays */) {
  const merged = [].concat.apply([], arguments);
  merged.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.startTime || '').localeCompare(b.startTime || '');
  });
  return merged;
}

// kintoneから取得できなかった行を「本当に削除された」とみなすまでの猶予時間（分）。
// この時間以内に同期された行なら、今回たまたま取得結果に無くても消さずに残す
// （kintone側の検索インデックス反映の遅延対策）。
const KINTONE_INDEXING_LAG_GRACE_MINUTES = 15;

/**
 * 「カレンダー_元データ」の既存の行のうち、
 * ・kintoneレコードIDを持っていて（＝終日対応不可日などの特殊行ではなく）
 * ・今回のkintone取得結果（freshEvents）には含まれておらず
 * ・最終同期日時がKINTONE_INDEXING_LAG_GRACE_MINUTES分以内
 * の行を、消さずに残すためのイベントとして返す。
 * （直近に作られた予約が、kintone側の検索インデックス反映の遅れで
 *   一時的に取得できないだけの可能性があるため）
 */
function getRecentlyMissingKintoneEvents_(dataSheet, freshEvents) {
  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) return [];

  const freshIds = {};
  freshEvents.forEach(function (ev) {
    if (ev.recordId) freshIds[String(ev.recordId)] = true;
  });

  const now = new Date();
  const values = dataSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const preserved = [];

  values.forEach(function (row) {
    const recordId = row[6]; // G列＝kintoneレコードID
    if (!recordId || recordId === FULL_DAY_BLOCK_RECORD_ID_MARKER) return; // 対象外の行はスキップ
    if (freshIds[String(recordId)]) return; // 今回ちゃんと取得できているので何もしなくてよい

    const lastSyncVal = row[7]; // H列＝最終同期日時
    if (!(lastSyncVal instanceof Date)) return;

    const minutesAgo = (now.getTime() - lastSyncVal.getTime()) / 60000;
    if (minutesAgo > KINTONE_INDEXING_LAG_GRACE_MINUTES) return; // 十分時間が経っている＝本当に削除された可能性が高いので残さない

    const isAllDay = (String(row[3]).trim() === '終日');
    preserved.push({
      date: formatDateValueForKintone_(row[0]),
      startTime: isAllDay ? '' : formatTimeValueForKintone_(row[1]),
      endTime: isAllDay ? '' : formatTimeValueForKintone_(row[2]),
      allDay: isAllDay,
      title: row[4] || '',
      category: row[5] || '',
      recordId: recordId,
      // ★重要：ここで「今」の時刻を入れてしまうと、猶予時間のカウントが毎回リセットされて
      //   しまい、本当にkintoneから削除された予定が永久に残り続けるバグになる。
      //   必ず「最後に実際にkintoneで確認できた時刻」のまま維持する。
      lastSyncOverride: lastSyncVal
    });
  });

  return preserved;
}

/**
 * 「終日対応不可日」シートのA列に記載されている日付を、busyMap上で終日ブロックとしてマークする。
 * 担当者がこのシートに直接日付を書き足していくだけで、LP上で予約不可にできる。
 */
function applyFullDayBlockSheetBlocks_(busyMap, year, month) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(FULL_DAY_BLOCK_SHEET_NAME);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return;

    const monthPrefix = year + '-' + String(month).padStart(2, '0');
    const values = sheet.getRange(1, 1, lastRow, 1).getValues();

    values.forEach(function (row) {
      const raw = row[0];
      if (!raw) return;

      const dateStr = parseFullDayBlockDate_(raw);
      if (!dateStr) return;
      if (dateStr.indexOf(monthPrefix) !== 0) return;

      markDateAllDayBusy_(busyMap, new Date(dateStr + 'T00:00:00'));
    });
  } catch (err) {
    // このシートの読み込みに失敗しても、他の判定は続行できるようにする
    Logger.log('「' + FULL_DAY_BLOCK_SHEET_NAME + '」シートの読み込みに失敗しました: ' + err.toString());
  }
}

/**
 * 「終日対応不可日」シートのセル値を 'YYYY-MM-DD' 形式に正規化する。
 * Date型（日付として入力された場合）と、"2026/07/29"や"2026-07-29"のような
 * 文字列入力の両方に対応する。認識できない場合はnullを返す。
 */
function parseFullDayBlockDate_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
}

/**
 * busyMapの指定日を終日ブロックにする共通ヘルパー（無ければ新規作成する）。
 */
function markDateAllDayBusy_(busyMap, dateObj) {
  const key = Utilities.formatDate(dateObj, 'Asia/Tokyo', 'yyyy-MM-dd');
  if (!busyMap[key]) busyMap[key] = { allDay: false, ranges: [] };
  busyMap[key].allDay = true;
}

/**
 * kintoneカレンダーアプリから、指定期間に重なるレコードを取得する。
 * 開始日 <= 期間の終了日 かつ 終了日 >= 期間の開始日、のレコードを取得。
 */
function fetchKintoneRecordsInRange(startDateStr, endDateStr) {
  assertKintoneConfigured_();

  const SCHED = KINTONE_FIELD.schedule;

  // ★方針：①スケジュール（予定）のみを対象にする。②経営本部スケジュール（予約）は無視する。
  // ★日時の比較はタイムゾーンのあいまいさを避けるため、必ず+09:00を明示する
  const query =
    '(' + SCHED.startDateTime + ' <= "' + endDateStr + 'T23:59:59+09:00") and (' + SCHED.endDateTime + ' >= "' + startDateStr + 'T00:00:00+09:00")'
    + ' limit 500';

  const url = 'https://' + KINTONE_SUBDOMAIN + '.cybozu.com/k/v1/records.json'
    + '?app=' + encodeURIComponent(KINTONE_APP_ID)
    + '&query=' + encodeURIComponent(query);

  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-Cybozu-API-Token': KINTONE_API_TOKEN },
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const bodyText = res.getContentText();

  let json;
  try {
    json = JSON.parse(bodyText);
  } catch (parseErr) {
    // kintoneからJSON以外（HTMLのエラー画面等）が返ってきた場合の切り分け用エラー
    throw new Error(
      'kintoneからJSON以外の応答が返りました（HTTPステータス: ' + status + '）。'
      + 'KINTONE_SUBDOMAIN / KINTONE_APP_ID の値、およびURLが正しいか確認してください。'
      + ' 応答本文の先頭200文字: ' + bodyText.substring(0, 200)
    );
  }

  if (status !== 200 || !json.records) {
    throw new Error(
      'kintoneからレコードを取得できませんでした（HTTPステータス: ' + status + '）: '
      + (json.message || bodyText)
    );
  }
  return json.records;
}

/**
 * KINTONE_SUBDOMAIN / KINTONE_APP_ID / KINTONE_API_TOKEN が
 * プレースホルダのまま（未設定）になっていないかを確認する。
 * 未設定の場合、分かりやすいエラーで早期に停止させる。
 */
function assertKintoneConfigured_() {
  if (!KINTONE_SUBDOMAIN) {
    throw new Error('KINTONE_SUBDOMAIN が未設定です。スクリプトのプロパティに実際のサブドメインを設定してください。');
  }
  if (!KINTONE_APP_ID) {
    throw new Error('KINTONE_APP_ID が未設定です。スクリプトのプロパティに実際のアプリIDを設定してください。');
  }
  if (!KINTONE_API_TOKEN) {
    throw new Error('KINTONE_API_TOKEN が未設定です。スクリプトのプロパティに実際のAPIトークンを設定してください。');
  }
  // サブドメインに ".cybozu.com" やURL全体を誤って貼ってしまっているケースを検出
  if (KINTONE_SUBDOMAIN.indexOf('.') !== -1 || KINTONE_SUBDOMAIN.indexOf('/') !== -1) {
    throw new Error(
      'KINTONE_SUBDOMAIN には "サブドメイン部分だけ" を入れてください（例: https://sample.cybozu.com なら "sample"）。'
      + '現在の値: ' + KINTONE_SUBDOMAIN
    );
  }
}

/**
 * kintoneレコード配列 → 日付ごとの「埋まっている枠」マップに変換する。
 * ・複数日にまたがる予定や終日予定は、その期間中の日を丸ごとブロック扱いにする
 * ・時刻情報がない/読み取れない場合も、安全側に倒してその日を丸ごとブロック扱いにする
 */
function buildBusyMap(events) {
  const map = {};

  events.forEach(function (ev) {
    if (!map[ev.date]) map[ev.date] = { allDay: false, ranges: [] };
    if (ev.allDay || !ev.startTime || !ev.endTime) {
      map[ev.date].allDay = true;
    } else {
      map[ev.date].ranges.push({ start: ev.startTime, end: ev.endTime });
    }
  });

  return map;
}

/**
 * kintoneのレコードから、指定フィールドコードの値を取り出す共通ヘルパー。
 * フィールドコードが未設定（''）の場合は null を返す。
 */
function getKintoneFieldValue(record, fieldCode) {
  if (!fieldCode) return null;
  return record[fieldCode] ? record[fieldCode].value : null;
}

/**
 * 「終日」フィールドが立っているレコードかどうかを判定する。
 * チェックボックス（配列）・ラジオボタン／ドロップダウン（文字列）どちらの形式にもある程度対応。
 */
/* =========================================================================
   ★kintone連携：予約確定時にレコードを追加（LP → GAS → kintone）
   ========================================================================= */

/**
 * 予約フォーム送信内容(data)から、kintoneカレンダーアプリに新規レコードを追加する。
 * ここで例外が発生しても呼び出し元(doPost)には伝播させず、ログに残すだけにする
 * （kintone登録に失敗しても、お客様への予約完了自体は成立させるため）
 */
/**
 * LPからの予約(data)を「カレンダー_元データ」に1行追加し、あわせてkintoneにも自動で
 * 反映する。手動入力＋「選択中の行をkintoneとLPに反映」ボタンの経路とは別に、
 * 予約フォーム経由の予約はここで自動的に両方（シート・kintone）へ反映される。
 *
 * ・「カレンダー_元データ」への追加は、kintone登録の成否に関わらず必ず行う
 *   （kintone側が万一失敗しても、LPの空き状況には即座に反映されるようにするため）
 * ・追加後、LPの空き状況キャッシュもその場で作り直し、次の予約者が同じ枠を
 *   選べないようにする
 */
function appendBookingToCalendarDataAndKintone_(data) {
  const dateStr = data.date || '';
  const startTime = data.time || '';
  if (!dateStr || !startTime) return { id: '', conflict: false };

  // ★送信時点の現在日で再判定し、古いLP表示からの直近日予約を防ぐ
  if (!isBookingDateOutsideLeadTime_(dateStr)) {
    return {
      id: '',
      conflict: true,
      message: 'この日付は予約受付期間外です。最新の空き状況を確認し、別の日付を選択してください。'
    };
  }

  const endTime = addMinutes(startTime, BOOKING_DURATION_MIN);
  const members = getFreshAvailableMembersForSlot_(dateStr, startTime);
  if (!members.length) {
    return { id: '', conflict: true, message: 'その枠は埋まりました。別の時間を選択してください。' };
  }

  const r = createFdaBooking_({
    date: dateStr,
    start: startTime,
    end: endTime,
    company: data.company || '',
    members: [members[0]],
    memo: [
      data.name ? 'お名前: ' + data.name : '',
      data.email ? 'メール: ' + data.email : '',
      data.phone ? '電話: ' + data.phone : '',
      data.category ? 'カテゴリ: ' + data.category : '',
      data.message ? '相談内容: ' + data.message : ''
    ].filter(Boolean).join('\n')
  });

  if (r && r.conflict) {
    return { id: '', conflict: true, message: (r.body && r.body.message) || 'その枠は埋まりました。別の時間を選択してください。' };
  }
  invalidateFdaAvailabilityCacheForDate_(dateStr);
  return { id: (r && r.id) ? String(r.id) : '', conflict: false, event: r && r.event };
}

/**
 * 「カレンダー_元データ」の内容（今しがた追記した分も含む）を読み直し、
 * 「カレンダー」タブの指定した年月のブロックだけを更新する（kintoneには問い合わせない）。
 * ★幹部会など「空き状況判定からは除外するが見た目には表示したい」予定も
 *   欠けないよう、getEventsFromDataSheetForMonth_の除外フィルタは無効にして呼び出す。
 */
function refreshCalendarBlockForMonth_(year, month /* 1-12 */) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const calSheet = getOrCreateCalendarSheet_(ss);
  const events = getEventsFromDataSheetForMonth_(year, month, false);
  const monthIndex0 = month - 1;

  const existingRow = findMonthBlockRow_(calSheet, year, monthIndex0);
  if (!existingRow) {
    appendMonthBlock_(calSheet, year, monthIndex0, events);
  } else {
    rewriteMonthBlock_(calSheet, existingRow, year, monthIndex0, events);
  }
}

/* =========================================================================
   ★予約の変更・キャンセル（manage.html）
   ------------------------------------------------------------------------
   ・manage.html が ?action=booking&id=<予約ID> で現在の予約内容を取得する
   ・キャンセル／変更は、予約日時のCHANGE_CANCEL_MIN_HOURS_BEFORE時間前まで
     （現在の設定：24時間前まで）受け付ける。それ以降はここでは対応不可とする
   ・キャンセル：kintoneレコード削除 → カレンダー_元データの該当行削除 →
     予約一覧の対応履歴をCANCELLED_STATUS_LABELに更新 → キャンセル完了メール送信
   ・変更：新しい日時の空き状況を再チェック → 古い予定を削除 → 新しい予定を作成 →
     予約一覧の該当行（希望日・希望時間・kintoneレコードID）を上書き → 変更完了メール送信
   ========================================================================= */

/**
 * manage.html向け：予約IDから現在の予約状況（日時・キャンセル済みか・変更キャンセル可否）を返す。
 */
function handleBookingLookupRequest_(submissionId, accessToken) {
  try {
    // ★個人情報を返す前に、予約ID＋トークンを検証する。
    // 既存予約はトークン列が空欄のため、移行互換設定に従って許可する。
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return jsonOutput({ result: 'not_found' });

    const row = findBookingRowBySubmissionId_(sheet, submissionId);
    if (!row) return jsonOutput({ result: 'not_found' });
    assertBookingAccessToken_(sheet, row, accessToken);

    // 認証後のみキャッシュを利用する。
    let info = getCachedBookingLookupInfo_(submissionId);

    if (!info) {
      const values = sheet.getRange(row, 1, 1, HEADER_ROW.length).getValues()[0];
      const status = values[1];   // B列 対応履歴
      const dateVal = values[6];  // G列 希望日
      const timeVal = values[7];  // H列 希望時間
      const company = values[8];  // I列 会社名
      const name = values[9];     // J列 お名前

      info = {
        cancelled: (status === CANCELLED_STATUS_LABEL),
        date: formatDateValueForKintone_(dateVal),
        time: formatTimeValueForKintone_(timeVal),
        company: company || '',
        name: name || ''
      };
      cacheBookingLookupInfo_(submissionId, info); // 次回のためにキャッシュしておく
    }

    if (info.cancelled) {
      return jsonOutput({ result: 'success', booking: { cancelled: true } });
    }

    // ★eligible（変更・キャンセル可否）は「今の時刻」に依存するため、キャッシュせず毎回計算する
    const eligible = isChangeCancelAllowed_(info.date, info.time);

    return jsonOutput({
      result: 'success',
      booking: {
        cancelled: false,
        date: info.date,
        time: info.time,
        company: info.company,
        name: info.name,
        eligible: eligible,
        minHoursBefore: CHANGE_CANCEL_MIN_HOURS_BEFORE
      }
    });
  } catch (err) {
    return jsonOutput({ result: 'error', error: err.toString() });
  }
}

/**
 * manage.html向けの予約情報キャッシュを保存する（date/time/company/name/cancelledのみ。
 * eligibleは「今の時刻」次第で変わるため含めない＝毎回その場で計算する）。
 */
function cacheBookingLookupInfo_(submissionId, info) {
  try {
    CacheService.getScriptCache().put(bookingLookupCacheKey_(submissionId), JSON.stringify(info), BUSY_CACHE_TTL_SECONDS);
  } catch (err) {
    Logger.log('予約情報キャッシュの更新に失敗しました: ' + err.toString());
  }
}

function getCachedBookingLookupInfo_(submissionId) {
  try {
    const cached = CacheService.getScriptCache().get(bookingLookupCacheKey_(submissionId));
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    return null;
  }
}

function bookingLookupCacheKey_(submissionId) {
  return 'booking_lookup_' + submissionId;
}

/**
 * 「カレンダー_元データ」への追加のみを見る予約日時が、CHANGE_CANCEL_MIN_HOURS_BEFORE時間
 * 以上先かどうかを判定する（この時間を切っていたら、お客様自身での変更・キャンセルは不可）。
 */
function isChangeCancelAllowed_(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const apptDateTime = new Date(dateStr + 'T' + timeStr + ':00+09:00');
  const now = new Date();
  const diffHours = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  return diffHours >= CHANGE_CANCEL_MIN_HOURS_BEFORE;
}

/**
 * 「予約一覧」シート内で、指定した予約ID（O列）を持つ行番号を探す。見つからなければnull。
 */
function findBookingRowBySubmissionId_(sheet, submissionId) {
  if (!submissionId) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, 17, lastRow - 1, 1).getValues(); // Q列＝予約ID
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === submissionId) return i + 2;
  }
  return null;
}


/** 新規URL用の十分長いランダムトークンを生成する。 */
function generateAccessToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/** 文字列比較。比較途中で即returnしないことで単純なタイミング差を抑える。 */
function safeTokenEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  }
  return diff === 0;
}

/**
 * 予約行に保存されたアクセストークンを検証する。
 * セキュリティ改修前の既存行はトークンが空欄なので、移行互換設定がfalseの間だけIDのみを許可する。
 */
function assertBookingAccessToken_(sheet, row, providedToken) {
  const storedToken = String(sheet.getRange(row, BOOKING_ACCESS_TOKEN_COLUMN).getDisplayValue() || '').trim();
  if (!storedToken) {
    if (REQUIRE_TOKEN_FOR_LEGACY_ROWS) throw new Error('AUTH_REQUIRED:このリンクは無効です。最新のご案内メールをご確認ください。');
    return true;
  }
  if (!providedToken || !safeTokenEquals_(storedToken, String(providedToken).trim())) {
    throw new Error('AUTH_REQUIRED:認証情報が正しくありません。予約完了メール記載の専用リンクからアクセスしてください。');
  }
  return true;
}

/** 予約IDから行を特定し、アクセストークンを検証する共通ヘルパー。 */
function assertBookingAccessById_(submissionId, providedToken) {
  if (!submissionId) throw new Error('AUTH_REQUIRED:予約IDがありません。');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('AUTH_REQUIRED:予約情報が見つかりません。');
  const row = findBookingRowBySubmissionId_(sheet, submissionId);
  if (!row) throw new Error('AUTH_REQUIRED:予約情報が見つかりません。');
  assertBookingAccessToken_(sheet, row, providedToken);
  return { sheet: sheet, row: row };
}

/**
 * キャンセル処理本体。data = { formType:'cancel', id: <予約ID> }
 * 失敗時はErrorをthrowする（doPostのcatchで拾われ、result:'error'として返る）。
 */
function handleCancelRequest_(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('予約一覧シートが見つかりません');
  const row = findBookingRowBySubmissionId_(sheet, data.id);
  if (!row) throw new Error('該当する予約が見つかりませんでした');
  assertBookingAccessToken_(sheet, row, data.token || '');

  const values = sheet.getRange(row, 1, 1, HEADER_ROW.length).getValues()[0];
  const assignee = values[0], status = values[1];
  const dateStr = formatDateValueForKintone_(values[6]);
  const timeStr = formatTimeValueForKintone_(values[7]);
  const bookingApiId = values[17];
  const email = values[10], company = values[8], name = values[9];

  if (status === CANCELLED_STATUS_LABEL) throw new Error('この予約は既にキャンセル済みです');
  if (!isChangeCancelAllowed_(dateStr, timeStr)) throw new Error('受付期間（ご予約日時の' + CHANGE_CANCEL_MIN_HOURS_BEFORE + '時間前まで）を過ぎているため、キャンセルできません');
  if (!bookingApiId) throw new Error('予約APIの予約IDが見つかりません');

  cancelFdaBooking_(bookingApiId);
  invalidateFdaAvailabilityCacheForDate_(dateStr);
  sheet.getRange(row, 2).setValue(CANCELLED_STATUS_LABEL);
  cacheBookingLookupInfo_(data.id, { cancelled: true, date: dateStr, time: timeStr, company: company, name: name });

  // ★画面応答を速くするため、Trello通知・キャンセル完了メールは非同期で処理する。
  scheduleDeferredSideEffect_({
    type: 'cancel',
    row: row, dateStr: dateStr, timeStr: timeStr, company: company,
    bookingApiId: bookingApiId, assignee: assignee,
    email: email, name: name
  });
}

/**
 * 変更（日程変更）処理本体。data = { formType:'reschedule', id, date, time, page }
 * 失敗時はErrorをthrowする。
 */
function handleRescheduleRequest_(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('予約一覧シートが見つかりません');
  const row = findBookingRowBySubmissionId_(sheet, data.id);
  if (!row) throw new Error('該当する予約が見つかりませんでした');
  assertBookingAccessToken_(sheet, row, data.token || '');

  const values = sheet.getRange(row, 1, 1, HEADER_ROW.length).getValues()[0];
  const assignee = values[0], status = values[1];
  const oldDateStr = formatDateValueForKintone_(values[6]);
  const oldTimeStr = formatTimeValueForKintone_(values[7]);
  const bookingApiId = values[17];
  const email = values[10], company = values[8], name = values[9];

  if (status === CANCELLED_STATUS_LABEL) throw new Error('この予約は既にキャンセルされています');
  if (!isChangeCancelAllowed_(oldDateStr, oldTimeStr)) throw new Error('受付期間（ご予約日時の' + CHANGE_CANCEL_MIN_HOURS_BEFORE + '時間前まで）を過ぎているため、変更できません');
  if (!bookingApiId) throw new Error('予約APIの予約IDが見つかりません');

  const newDateStr = data.date || '', newTimeStr = data.time || '';
  if (!newDateStr || !newTimeStr) throw new Error('新しい日時が指定されていません');

  // ★日程変更も確定時点の現在日で再判定する
  if (!isBookingDateOutsideLeadTime_(newDateStr)) {
    throw new Error('CONFLICT:この日付は予約受付期間外です。最新の空き状況を確認し、別の日付を選択してください。');
  }

  const members = getFreshAvailableMembersForSlot_(newDateStr, newTimeStr, bookingApiId);
  if (!members.length) throw new Error('CONFLICT:その枠は埋まりました。別の時間を選択してください。');

  const r = updateFdaBooking_(bookingApiId, {
    date: newDateStr,
    start: newTimeStr,
    end: addMinutes(newTimeStr, BOOKING_DURATION_MIN),
    company: company,
    members: [members[0]],
    room: FDA_BOOKING_ROOM
  });
  if (r && r.conflict) throw new Error('CONFLICT:' + ((r.body && r.body.message) || 'その枠は埋まりました。別の時間を選択してください。'));

  invalidateFdaAvailabilityCacheForDate_(oldDateStr);
  invalidateFdaAvailabilityCacheForDate_(newDateStr);
  sheet.getRange(row, 7).setValue(newDateStr);
  sheet.getRange(row, 8).setValue(newTimeStr);
  sheet.getRange(row, 18).setValue(bookingApiId);
  cacheBookingLookupInfo_(data.id, { cancelled: false, date: newDateStr, time: newTimeStr, company: company, name: name });

  const hearingUrl = buildHearingUrl(data.page || '', data.id || '', values[18] || '');
  // ★画面応答を速くするため、Trello通知・変更完了メールは非同期で処理する。
  scheduleDeferredSideEffect_({
    type: 'reschedule',
    row: row, oldDateStr: oldDateStr, oldTimeStr: oldTimeStr,
    newDateStr: newDateStr, newTimeStr: newTimeStr, company: company,
    bookingApiId: bookingApiId, assignee: assignee, email: email, name: name,
    hearingUrl: hearingUrl
  });
}

/**
 * kintoneのレコードを1件削除する。
 */
/**
 * 「予約一覧」にkintoneレコードIDが記録されていない場合の保険。
 * 「カレンダー_元データ」から同じ日付・開始時刻の行を探し、そのkintoneレコードIDを返す。
 * 見つからなければ空文字を返す。
 */
function findKintoneRecordIdByDateTimeFallback_(dateStr, timeStr) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(CAL_DATA_SHEET_NAME);
    if (!sheet) return '';

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return '';

    const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (let i = 0; i < values.length; i++) {
      const rowDate = formatDateValueForKintone_(values[i][0]);
      const rowStart = formatTimeValueForKintone_(values[i][1]);
      if (rowDate === dateStr && rowStart === timeStr) {
        return values[i][6] || ''; // G列＝kintoneレコードID
      }
    }
    return '';
  } catch (err) {
    Logger.log('findKintoneRecordIdByDateTimeFallback_ エラー: ' + err.toString());
    return '';
  }
}

/**
 * 「カレンダー_元データ」から、指定したkintoneレコードIDに一致する行を削除する。
 */
function removeDataSheetRowByRecordId_(recordId) {
  if (!recordId) return;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(CAL_DATA_SHEET_NAME);
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const ids = sheet.getRange(2, 7, lastRow - 1, 1).getValues(); // G列＝kintoneレコードID
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(recordId)) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * 'HH:MM' を分に変換する（サーバー側版。booking.html側と同じロジック）。
 */
function timeToMinutes_(hhmm) {
  const parts = String(hhmm).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/**
 * 「①スケジュール（予定）」形式（開始日時/終了日時のDATETIME＋a_memo＋カテゴリ）で
 * kintoneに新規レコードを追加する共通処理。
 * ev: { date:'YYYY-MM-DD', startTime:'HH:MM', endTime:'HH:MM', allDay:bool, title:string, categoryKey?:string }
 * 成功したらレコードIDを、失敗したらnullを返す。
 */
function createKintoneScheduleRecord_(ev) {
  assertKintoneConfigured_();
  const SCHED = KINTONE_FIELD.schedule;

  const record = {};
  record[SCHED.title] = { value: ev.title };

  if (ev.allDay) {
    record[SCHED.startDateTime] = { value: ev.date + 'T00:00:00+09:00' };
    record[SCHED.endDateTime] = { value: ev.date + 'T23:59:00+09:00' };
  } else {
    record[SCHED.startDateTime] = { value: ev.date + 'T' + ev.startTime + ':00+09:00' };
    record[SCHED.endDateTime] = { value: ev.date + 'T' + ev.endTime + ':00+09:00' };
  }

  const categoryKey = ev.categoryKey || KINTONE_DEFAULT_CATEGORY_KEY;
  if (categoryKey && KINTONE_CATEGORY_OPTIONS[categoryKey]) {
    record[SCHED.category] = { value: KINTONE_CATEGORY_OPTIONS[categoryKey] };
  }

  const url = 'https://' + KINTONE_SUBDOMAIN + '.cybozu.com/k/v1/record.json';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Cybozu-API-Token': KINTONE_API_TOKEN },
    payload: JSON.stringify({ app: KINTONE_APP_ID, record: record }),
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const body = res.getContentText();
  if (status !== 200) {
    let errMsg = body;
    try {
      const errJson = JSON.parse(body);
      if (errJson && errJson.message) errMsg = errJson.message;
    } catch (parseErr2) {
      // 応答がJSONでなければそのままbodyを使う
    }
    throw new Error('kintoneへのレコード追加に失敗しました（HTTPステータス: ' + status + '）: ' + errMsg);
  }
  const json = JSON.parse(body);
  return json.id || null;
}

/**
 * 'HH:MM' 形式の時刻に分数を加算して 'HH:MM' 形式で返す（日またぎは考慮しない前提）
 */
function addMinutes(hhmm, minutesToAdd) {
  const parts = hhmm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const total = h * 60 + m + minutesToAdd;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return String(nh).padStart(2, '0') + ':' + String(nm).padStart(2, '0');
}

/**
 * 「ヒアリング回答」シートから、紐付けIDに対応する過去の回答（JSON列）を取得する
 */
function findHearingRecordById(id, accessToken) {
  // ★過去回答（個人情報）を返す前に予約ID＋トークンを検証する。
  assertBookingAccessById_(id, accessToken || '');
  // ★高速化：まずCacheService（スプレッドシートを開かない、高速な保存領域）を確認する
  const cache = CacheService.getScriptCache();
  const cached = cache.get(hearingCacheKey_(id));
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      // キャッシュが壊れていた場合のみ、下のシート参照にフォールバックする
    }
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(HEARING_SHEET_NAME);
  if (!sheet) return null;

  const row = findRowBySubmissionId(sheet, id);
  if (!row) return null;

  const jsonColIndex = HEARING_HEADER_ROW.length; // 最終列（回答データJSON）
  const jsonStr = sheet.getRange(row, jsonColIndex).getValue();
  if (!jsonStr) return null;

  try {
    cache.put(hearingCacheKey_(id), jsonStr, BUSY_CACHE_TTL_SECONDS); // 次回のためにキャッシュしておく
    return JSON.parse(jsonStr);
  } catch (err) {
    return null;
  }
}

/**
 * スプレッドシートへ1行追加する（予約フォーム）
 * あわせて、C列（ヒアリングシート）にヒアリングシートへのリンクを自動で入れる
 */
/**
 * 予約フォームから送られた流入情報を、予約一覧X列に保存する表示用文字列へ整える。
 * 新しいLP/booking.htmlは trafficSource を送るため、通常はそれをそのまま使用する。
 * 旧ページ等から trafficSource が来ない場合のみUTM等から補完する。
 */
function buildBookingTrafficSource_(data) {
  data = data || {};

  const directValue = String(data.trafficSource || '').trim();
  if (directValue) return directValue;

  const utmSource = String(data.utm_source || '').trim();
  const utmMedium = String(data.utm_medium || '').trim();
  if (utmSource) {
    return [utmSource, utmMedium].filter(Boolean).join(' / ');
  }

  if (String(data.gclid || '').trim()) return 'Google広告';
  if (String(data.fbclid || '').trim()) return 'Meta広告';

  // 新しいフロントでは「直接流入」等まで判定して trafficSource を送る。
  // ここまで何も無い場合は、旧ページ等からの送信と区別するため「不明」とする。
  return '不明';
}

function appendToSheet(data, submissionId, recordId, accessToken) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    // シート名「予約一覧」が見つからない場合は、既にあるシートを使う
    // （新しいタブを勝手に作って気づかれないのを防ぐため）
    const existingSheets = ss.getSheets();
    if (existingSheets.length > 0) {
      sheet = existingSheets[0];
    } else {
      sheet = ss.insertSheet(SHEET_NAME);
    }
  }

  // シートが完全に空の場合のみ、ヘッダー行を自動作成する
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER_ROW);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADER_ROW.length).setFontWeight('bold');
  }

  // ★X列を流入元保存用として確保する。T〜W列は既存運用を壊さないよう一切触らない。
  if (sheet.getMaxColumns() < BOOKING_TRAFFIC_SOURCE_COLUMN) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      BOOKING_TRAFFIC_SOURCE_COLUMN - sheet.getMaxColumns()
    );
  }
  const trafficHeaderCell = sheet.getRange(1, BOOKING_TRAFFIC_SOURCE_COLUMN);
  if (!String(trafficHeaderCell.getValue() || '').trim()) {
    trafficHeaderCell.setValue(BOOKING_TRAFFIC_SOURCE_HEADER).setFontWeight('bold');
  }

  // A〜E列（担当者・対応履歴・ヒアリングシート・記入状況・更新日）は空欄／未記入のまま、
  // F列以降にデータを入れる
  const rowValues = [
    '', '', '', false, '',
    new Date(),
    data.date || '',
    data.time || '',
    data.company || '',
    data.name || '',
    data.email || '',
    data.phone || '',
    data.prefecture || '',
    data.category || '',
    data.message || '',
    data.page || '',
    submissionId || '',
    recordId || '',
    accessToken || ''
  ];

  // ★appendRow()は使わない：チェックボックス（未チェックでも内部的にはFALSEという値を
  //   持つ）がデータの無い行にも設定されていると、getLastRow()がその行まで
  //   「データがある」とみなしてしまい、実際のデータの下ではなくシートの
  //   ずっと下に追記されてしまう。そのため、F列（送信日時。必ず入る列）を基準に
  //   実際の最終データ行を自分で探し、その直後に書き込む。
  const targetRow = getLastDataRowByColumn_(sheet, 6) + 1; // F列＝送信日時
  sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);

  // ★X列に流入元を保存
  sheet.getRange(targetRow, BOOKING_TRAFFIC_SOURCE_COLUMN)
    .setValue(buildBookingTrafficSource_(data));

  const lastRow = targetRow;

  // D列（記入状況）をチェックボックスにしておく（未記入＝チェックなしの状態で作成）
  const statusCell = sheet.getRange(lastRow, 4);
  statusCell.insertCheckboxes();
  statusCell.setValue(false);

  // C列（ヒアリングシート）に、このお客様専用のヒアリングシートへのリンクを入れる
  const hearingUrl = buildHearingUrl(data.page || '', submissionId, accessToken || '');
  sheet.getRange(lastRow, 3).setFormula(
    '=HYPERLINK("' + hearingUrl + '","ヒアリングシートへ")'
  );

  // ★呼び出し元でTrello通知用に同じ行を再検索しなくて済むよう、
  // ヒアリングURLと書き込み行番号をまとめて返す。
  return { hearingUrl: hearingUrl, row: lastRow };
}

/**
 * 指定した列を基準に、実際にデータが入っている最終行を探す。
 * チェックボックス（未チェックでもFALSEという値を持つ）等が原因で
 * getLastRow()が実際のデータより下を指してしまうことがあるため、
 * 必ず値が入る列（送信日時など）を基準に判定する。
 * データが無ければヘッダー行（1）を返す。
 */
function getLastDataRowByColumn_(sheet, column) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;

  const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== '' && values[i][0] !== null) {
      return i + 2;
    }
  }
  return 1;
}

/**
 * data.page（送信元ページURL）から同じディレクトリのhearing.htmlのURLを組み立てる
 */
function buildHearingUrl(pageUrl, submissionId, accessToken) {
  const qs = 'id=' + encodeURIComponent(submissionId || '') + (accessToken ? '&token=' + encodeURIComponent(accessToken) : '');
  try {
    const base = pageUrl.replace(/[^\/]*$/, ''); // 末尾のファイル名・ハッシュを除去
    return base + 'hearing.html?' + qs;
  } catch (e) {
    return 'hearing.html?' + qs;
  }
}

/* =========================================================================
   ★ヒアリングシートの添付ファイル（Google Driveへの保存）
   ------------------------------------------------------------------------
   セットアップ：
   1. Googleドライブに、添付ファイル保存用のフォルダを作成する
   2. そのフォルダを開いた時のURLの末尾（folders/の後ろ）がフォルダIDです
   3. 「プロジェクトの設定」→「スクリプト プロパティ」に
      HEARING_UPLOAD_FOLDER_ID として登録する
   ※未設定の場合、添付ファイルの保存はスキップされます（フォーム自体は
     問題なく送信できます）。
   ========================================================================= */
const HEARING_UPLOAD_FOLDER_ID = getScriptProp_('HEARING_UPLOAD_FOLDER_ID');

/**
 * ★セットアップの近道：フォルダを手動で作らなくても、この関数を一度実行するだけで
 *   「ヒアリングシート添付ファイル」という名前のフォルダをGoogleドライブに自動作成し、
 *   そのIDをログに出力する。
 *   出力されたIDを「プロジェクトの設定」→「スクリプト プロパティ」の
 *   HEARING_UPLOAD_FOLDER_ID に貼り付ければ設定完了。
 *   （このスクリプトを実行しているGoogleアカウントのマイドライブ直下に作成されます）
 */
/**
 * ★動作確認用：新しいフォルダは作らず、すでにHEARING_UPLOAD_FOLDER_IDに設定した
 *   フォルダに実際にアクセスできるかどうかだけを確認する。
 *   これを一度実行すると、Googleドライブへのアクセス権限の承認画面が出る
 *  （これが目的です。承認済みなら何も出ずログだけ表示されます）。
 */
/**
 * ★上と全く同じ内容だが、関数名の末尾に「_」が無いバージョン。
 *   「_」で終わる関数名は、エディタ上で認証ダイアログがうまく出ないことがあるため、
 *   実行できない場合はこちらを試してください。
 */
function debugCheckDriveAccess() {
  debugCheckHearingUploadFolder_();
}

function debugCheckHearingUploadFolder_() {
  if (!HEARING_UPLOAD_FOLDER_ID) {
    Logger.log('HEARING_UPLOAD_FOLDER_ID が未設定です。スクリプトのプロパティに設定してください。');
    return;
  }
  try {
    const folder = DriveApp.getFolderById(HEARING_UPLOAD_FOLDER_ID);
    Logger.log('アクセスできました。フォルダ名: ' + folder.getName());
    Logger.log('フォルダURL: ' + folder.getUrl());
  } catch (err) {
    Logger.log('フォルダにアクセスできませんでした: ' + err.toString());
  }
}

/**
 * ★上と全く同じ内容だが、関数名の末尾に「_」が無いバージョン。
 *   まずはこちらを実行してください。
 */
function createDriveUploadFolder() {
  createHearingUploadFolder_();
}

function createHearingUploadFolder_() {
  const folder = DriveApp.createFolder('ヒアリングシート添付ファイル');
  Logger.log('フォルダを作成しました。');
  Logger.log('フォルダID: ' + folder.getId());
  Logger.log('フォルダURL: ' + folder.getUrl());
  Logger.log('↑このIDを「プロジェクトの設定」→「スクリプト プロパティ」の HEARING_UPLOAD_FOLDER_ID に貼り付けてください。');
}

/**
 * hearing.htmlから1ファイルずつ送られてくるアップロードリクエストを処理する。
 * data: { formType:'fileUpload', fileName, mimeType, base64 }
 * 戻り値: { result:'success', url } または { result:'error', error }
 */
function handleHearingFileUpload_(data) {
  try {
    assertBookingAccessById_(data.submissionId || '', data.token || '');
    if (!HEARING_UPLOAD_FOLDER_ID) {
      return { result: 'error', error: 'ファイル保存先フォルダが未設定です（HEARING_UPLOAD_FOLDER_ID）。管理者にご連絡ください。' };
    }
    if (!data.base64 || !data.fileName) {
      return { result: 'error', error: 'ファイルの内容が読み取れませんでした。' };
    }

    const companyFolder = getOrCreateCompanyUploadFolder_(data.company);
    const dateStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    const fileName = dateStr + '_' + data.fileName;

    const bytes = Utilities.base64Decode(data.base64);
    const blob = Utilities.newBlob(bytes, data.mimeType || 'application/octet-stream', fileName);
    const file = companyFolder.createFile(blob);

    // ★共有設定の変更に失敗しても（組織のGoogle Workspaceで「リンクを知っている人に公開」が
    //   禁止されている場合など）、ファイル自体はもう保存済みなので、送信自体は成功として扱う
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingErr) {
      Logger.log('添付ファイルの共有設定変更に失敗しました（保存自体は成功しています）: ' + sharingErr.toString());
    }

    return { result: 'success', url: file.getUrl(), name: fileName };
  } catch (err) {
    Logger.log('ヒアリングシート添付ファイルの保存に失敗しました: ' + err.toString());
    return { result: 'error', error: 'ファイルの保存に失敗しました。時間をおいて再度お試しください。' };
  }
}

/**
 * 保存先フォルダ（HEARING_UPLOAD_FOLDER_ID）の直下に、企業名と同じ名前のサブフォルダを
 * 探し、無ければ新規作成して返す。企業名が空の場合は「_未入力」フォルダにまとめる。
 */
function getOrCreateCompanyUploadFolder_(companyName) {
  const baseFolder = DriveApp.getFolderById(HEARING_UPLOAD_FOLDER_ID);
  const folderName = (companyName && companyName.trim()) ? companyName.trim() : '_未入力';

  const existing = baseFolder.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  return baseFolder.createFolder(folderName);
}

/**
 * ヒアリングシート（hearing.html）の回答を「ヒアリング回答」シートへ追記する
 */
function appendHearingToSheet(data) {
  // ★回答保存前に予約ID＋トークンを検証する。
  assertBookingAccessById_(data.submissionId || '', data.token || '');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(HEARING_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(HEARING_SHEET_NAME);
    sheet.appendRow(HEARING_HEADER_ROW);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEARING_HEADER_ROW.length).setFontWeight('bold');
  }

  const experienceLabel = { registered: '実際に認証・登録等の手続きを行ったことがある', researched: '情報収集をしたことがある', none: 'まだ特に対応していない' }[data.experience] || (data.experience || '');
  const howHandledMap = { self: '自社で対応した', outsource: '外部の会社や専門家に依頼した', both: '自社と外部の会社・専門家の両方で対応した', other: 'その他' };
  let howHandledLabel = data.howHandled ? (howHandledMap[data.howHandled] || data.howHandled) : '';
  if (data.howHandled === 'other' && data.howHandledOther) {
    howHandledLabel += '（' + data.howHandledOther + '）';
  }

  const afterStatusMap = { completed: '必要な認証・登録等を完了できた', failed: '課題があり、認証・登録等を完了できなかった', complex: '情報は集めたが、内容が複雑でよく分からなかった', unclear: '何から対応すべきか判断できなかった', costUnclear: '費用や期間が分からず、対応を進められなかった', other: 'その他' };
  const afterStatusLabels = (Array.isArray(data.afterStatus) ? data.afterStatus : []).map(function (v) { return afterStatusMap[v] || v; });
  const afterStatusText = [
    afterStatusLabels.join(' / '),
    data.afterStatusFailedDetail ? ('（課題の詳細：' + data.afterStatusFailedDetail + '）') : '',
    data.afterStatusOther ? ('（その他：' + data.afterStatusOther + '）') : ''
  ].filter(Boolean).join(' ');

  const supportMap = {
    consult: '必要なサポート内容を相談して決めたい',
    full_all: 'FDA対応から米国向け輸送まで、まとめて依頼したい',
    full_fda_only: 'FDAの認証・登録手続きのみ、まとめて依頼したい',
    spot_ingredient: '原材料・成分の調査', spot_facility_reg: 'FDA施設登録', spot_facility_renew: 'FDA施設登録の更新',
    spot_account: 'FDA関連アカウントの作成', spot_label: '商品ラベルの作成・確認', spot_nutrition: '栄養成分表示の作成',
    spot_prior_notice: '米国向け事前申告', spot_prop65: 'Proposition 65に関する調査', spot_list_reg: 'FDA関連リストへの登録・更新',
    spot_ongoing: 'FDA取得・登録後の継続管理', spot_other: 'その他のFDA関連サポート',
    amz_shipping: 'FDA対応完了後の米国向け輸送', amz_account: '米国Amazonアカウントの新規開設から初回出荷まで',
    amz_listing: '米国Amazonの商品ページ作成', amz_fba: '米国Amazon FBA向け物流代行', amz_other: 'その他の米国輸出・Amazon関連サポート'
  };
  const supportLabels = (Array.isArray(data.support) ? data.support : []).map(function (v) { return supportMap[v] || v; });
  const supportText = [
    supportLabels.join(' / '),
    data.supportSpotOther ? ('（FDA関連その他：' + data.supportSpotOther + '）') : '',
    data.supportAmzOther ? ('（Amazon関連その他：' + data.supportAmzOther + '）') : ''
  ].filter(Boolean).join(' ');

  const channelMap = { own_ec: '自社ECサイト', amazon: 'Amazon.com', other_ec: 'Amazon以外のECモール', wholesale: '米国の卸売会社・ディストリビューター', retail: '小売店・専門店', expo: '展示会・B2B商談会', undecided: 'まだ決まっていない', other: 'その他' };
  const channelLabels = (Array.isArray(data.channels) ? data.channels : []).map(function (v) { return channelMap[v] || v; });
  const channelsText = [
    channelLabels.join(' / '),
    data.otherEcName ? ('（ECモール名：' + data.otherEcName + '）') : '',
    data.otherChannelName ? ('（その他販路：' + data.otherChannelName + '）') : ''
  ].filter(Boolean).join(' ');

  const productCountLabel = data.productCount ? (data.productCount + '商品') : '';
  const productsText = formatProducts(data.products);

  const otherNotesText = data.otherNotes || '';

  // ★添付ファイルは別列にまとめ、クリックできるリンクとして記載する（後述のsetRichTextValueで反映）
  const allFiles = [];
  (Array.isArray(data.products) ? data.products : []).forEach(function (p, i) {
    (Array.isArray(p.ingredientsFiles) ? p.ingredientsFiles : []).forEach(function (f) {
      allFiles.push({ label: '商品' + (i + 1) + '：' + f.name, url: f.url });
    });
  });
  (Array.isArray(data.otherFiles) ? data.otherFiles : []).forEach(function (f) {
    allFiles.push({ label: 'その他：' + f.name, url: f.url });
  });

  const rowValues = [
    new Date(),
    data.submissionId || '',
    data.company || '',
    data.websiteUrl || '',
    data.contactName || '',
    data.phone || '',
    data.email || '',
    [data.prefecture, data.addressDetail].filter(Boolean).join(' '),
    experienceLabel,
    howHandledLabel,
    afterStatusText,
    supportText,
    productCountLabel,
    productsText,
    channelsText,
    otherNotesText,
    allFiles.length > 0 ? allFiles.map(function (f) { return f.label; }).join('\n') : '', // 添付ファイル列（すぐ後でリンク付きに置き換える）
    data.page || '',
    JSON.stringify(data)
  ];

  const FILE_LINKS_COLUMN = 17; // HEARING_HEADER_ROWの「添付ファイル」列（17列目）

  // 同じ紐付けID（submissionId）の回答が既にある場合は、新規追加ではなく上書きする
  // （お客様が入力し直して再送信した場合、担当者が確認する行を1つに保つため）
  const existingRow = findRowBySubmissionId(sheet, data.submissionId);
  const isFirstSubmission = !existingRow; // ★Zoomミーティング作成は初回送信の時だけ行う
  let targetRow;
  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
    targetRow = existingRow;
  } else {
    sheet.appendRow(rowValues);
    targetRow = sheet.getLastRow();
  }

  // ★添付ファイル列を、ファイル名がクリックできるリンクになるよう書き直す
  //   （setValuesでは書式付きリンクを設定できないため、この行だけ別途setRichTextValueで上書きする）
  if (allFiles.length > 0) {
    try {
      sheet.getRange(targetRow, FILE_LINKS_COLUMN).setRichTextValue(buildFileLinksRichText_(allFiles));
    } catch (richErr) {
      Logger.log('添付ファイル列のリンク設定に失敗しました（文字自体は入っています）: ' + richErr.toString());
    }
  }

  // ★保存直後にキャッシュも更新しておく（次にhearing.htmlを開いた時、即座に反映されるように）
  if (data.submissionId) {
    try {
      CacheService.getScriptCache().put(hearingCacheKey_(data.submissionId), JSON.stringify(data), BUSY_CACHE_TTL_SECONDS);
    } catch (err) {
      Logger.log('ヒアリング回答のキャッシュ更新に失敗しました: ' + err.toString());
    }
  }

  // ★「予約一覧」側の記入状況（D列）・更新日（E列）も反映する
  markHearingCompletedInBookingList_(data.submissionId);

  // ★画面応答を最優先。Trello通知とZoom作成・案内メールは保存完了後に非同期実行する。
  scheduleDeferredSideEffect_({
    type: 'hearing',
    submissionId: data.submissionId,
    isFirstSubmission: isFirstSubmission
  });

  return isFirstSubmission;
}

/**
 * ヒアリングシート初回送信時：対応する予約の日時でZoomミーティングを作成し、
 * 参加リンクをお客様にメールする。失敗しても、ヒアリング回答自体の保存は
 * 既に完了しているので、ここではログのみ残して処理を止めない。
 */
/**
 * ★Zoomミーティング作成をすぐには実行せず、1秒後に実行される使い捨てのトリガー経由で
 *   行う。お客様への応答（成功・失敗の表示）を、外部API呼び出し（Zoom・Gmail）の
 *   完了を待たずに即座に返せるようにするため。
 *   複数の送信が同時に来ても取りこぼさないよう、対象IDはキュー（配列）として
 *   PropertiesServiceに保存し、LockServiceで排他制御する。
 */
/**
 * 画面応答に不要な外部通知・メール処理をキューへ積み、Webリクエストとは分離して実行する。
 * 予約/ヒアリング本体の保存や予約API更新は同期で完了させた上で、
 * Trello・Gmail・Zoomのみを後段へ回すため、データ整合性は維持したまま体感速度を改善する。
 */
function scheduleDeferredSideEffect_(task) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('FDA_DEFERRED_TASK_QUEUE');
    const queue = raw ? JSON.parse(raw) : [];
    queue.push(task);
    props.setProperty('FDA_DEFERRED_TASK_QUEUE', JSON.stringify(queue));
  } catch (err) {
    Logger.log('非同期タスクのキュー登録に失敗: ' + err.toString());
    runDeferredSideEffectTask_(task);
    return;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }

  try {
    // 同一種類の使い捨てトリガーが既にあれば追加作成しない。
    const exists = ScriptApp.getProjectTriggers().some(function(t){
      return t.getHandlerFunction() === 'runDeferredSideEffects_';
    });
    if (!exists) {
      ScriptApp.newTrigger('runDeferredSideEffects_').timeBased().after(1000).create();
    }
  } catch (err) {
    Logger.log('非同期タスクのトリガー作成に失敗: ' + err.toString());
    flushDeferredSideEffects_();
  }
}

function runDeferredSideEffects_(e) {
  try {
    if (e && e.triggerUid) {
      ScriptApp.getProjectTriggers().forEach(function(t){
        if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t);
      });
    }
  } catch (err) {
    Logger.log('非同期タスクトリガー削除エラー: ' + err.toString());
  }
  flushDeferredSideEffects_();
}

function flushDeferredSideEffects_() {
  const lock = LockService.getScriptLock();
  let queue = [];
  try {
    lock.waitLock(3000);
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('FDA_DEFERRED_TASK_QUEUE');
    if (raw) {
      queue = JSON.parse(raw);
      props.deleteProperty('FDA_DEFERRED_TASK_QUEUE');
    }
  } catch (err) {
    Logger.log('非同期タスクキュー読み込みエラー: ' + err.toString());
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
  queue.forEach(function(task){
    try { runDeferredSideEffectTask_(task); }
    catch (err) { Logger.log('非同期タスク実行エラー: ' + err.toString()); }
  });
}

function runDeferredSideEffectTask_(task) {
  if (!task || !task.type) return;
  if (task.type === 'hearing') {
    try { notifyTrelloHearingSubmitted_(task.submissionId, !!task.isFirstSubmission); }
    catch (e) { Logger.log('Trello通知（ヒアリング）エラー: ' + e.toString()); }
    if (task.isFirstSubmission) {
      try { createAndSendZoomMeetingEmail_(task.submissionId); }
      catch (e) { Logger.log('Zoom作成・案内メールエラー: ' + e.toString()); }
    }
    return;
  }
  if (task.type === 'cancel') {
    try { notifyTrelloCancelled_(task.row, task.dateStr, task.timeStr, task.company, task.bookingApiId, task.assignee); }
    catch (e) { Logger.log('Trello通知（キャンセル）エラー: ' + e.toString()); }
    try { sendCancellationEmail_({ email: task.email, company: task.company, name: task.name, date: task.dateStr, time: task.timeStr }); }
    catch (e) { Logger.log('キャンセル完了メールエラー: ' + e.toString()); }
    return;
  }
  if (task.type === 'reschedule') {
    try { notifyTrelloRescheduled_(task.row, task.oldDateStr, task.oldTimeStr, task.newDateStr, task.newTimeStr, task.company, task.bookingApiId, task.assignee); }
    catch (e) { Logger.log('Trello通知（変更）エラー: ' + e.toString()); }
    try { sendRescheduleEmail_({ email: task.email, company: task.company, name: task.name, date: task.newDateStr, time: task.newTimeStr, hearingUrl: task.hearingUrl }); }
    catch (e) { Logger.log('変更完了メールエラー: ' + e.toString()); }
  }
}

// 手動復旧用。キューが残った場合にGASエディタから1回実行できる。
function flushDeferredSideEffects() {
  flushDeferredSideEffects_();
}

function scheduleZoomMeetingCreation_(submissionId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('PENDING_ZOOM_QUEUE');
    const queue = raw ? JSON.parse(raw) : [];
    queue.push(submissionId);
    props.setProperty('PENDING_ZOOM_QUEUE', JSON.stringify(queue));
  } catch (err) {
    // キューへの登録に失敗した場合は、遅くなってもお客様にメールが届く方を優先し、
    // その場で同期的に実行する
    Logger.log('Zoom作成の非同期スケジュールに失敗したため、同期的に実行します: ' + err.toString());
    createAndSendZoomMeetingEmail_(submissionId);
    return;
  } finally {
    lock.releaseLock();
  }

  try {
    ScriptApp.newTrigger('runScheduledZoomMeetingCreation_').timeBased().after(1000).create();
  } catch (err) {
    // ★トリガー作成に失敗した場合（権限未承認・上限到達など）、キューに積んだままだと
    //   誰も処理せず永久にメールが送られないため、その場で同期的に処理する
    Logger.log('Zoom作成トリガーの作成に失敗したため、同期的に実行します: ' + err.toString());
    removeFromZoomQueue_(submissionId);
    createAndSendZoomMeetingEmail_(submissionId);
  }
}

/**
 * キューから指定した予約IDを取り除く（トリガー作成失敗時、同期処理に切り替えた際の後始末用）。
 */
function removeFromZoomQueue_(submissionId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('PENDING_ZOOM_QUEUE');
    if (!raw) return;
    const queue = JSON.parse(raw).filter(function (id) { return id !== submissionId; });
    if (queue.length > 0) {
      props.setProperty('PENDING_ZOOM_QUEUE', JSON.stringify(queue));
    } else {
      props.deleteProperty('PENDING_ZOOM_QUEUE');
    }
  } catch (err) {
    Logger.log('Zoomキューからの削除でエラー: ' + err.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * scheduleZoomMeetingCreation_によって作られる、1回限りのトリガーから呼ばれる。
 * 実行後は自分自身のトリガーを削除し、キューに溜まっている分をまとめて処理する。
 */
function runScheduledZoomMeetingCreation_(e) {
  try {
    if (e && e.triggerUid) {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t);
      });
    }
  } catch (err) {
    Logger.log('Zoom作成トリガーの削除でエラー: ' + err.toString());
  }

  const lock = LockService.getScriptLock();
  let queue = [];
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('PENDING_ZOOM_QUEUE');
    if (raw) {
      queue = JSON.parse(raw);
      props.deleteProperty('PENDING_ZOOM_QUEUE');
    }
  } catch (err) {
    Logger.log('保留中Zoomキューの読み込みでエラー: ' + err.toString());
  } finally {
    lock.releaseLock();
  }

  queue.forEach(function (submissionId) {
    createAndSendZoomMeetingEmail_(submissionId);
  });
}

/**
 * ★復旧用：これまでの不具合でPENDING_ZOOM_QUEUEに溜まってしまい、
 *   処理されずに残っているものがあれば、まとめて今すぐ処理する。
 *   エディタ上部のプルダウンでflushPendingZoomQueueを選んで手動実行してください
 *  （直接実行することで、トリガー作成に必要な権限の承認画面が出る場合はここで承認できます）。
 */
function flushPendingZoomQueue() {
  const lock = LockService.getScriptLock();
  let queue = [];
  try {
    lock.waitLock(5000);
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('PENDING_ZOOM_QUEUE');
    if (raw) {
      queue = JSON.parse(raw);
      props.deleteProperty('PENDING_ZOOM_QUEUE');
    }
  } catch (err) {
    Logger.log('保留中Zoomキューの読み込みでエラー: ' + err.toString());
  } finally {
    lock.releaseLock();
  }

  Logger.log('保留中のZoom作成キュー: ' + queue.length + '件');
  queue.forEach(function (submissionId) {
    Logger.log('処理中: ' + submissionId);
    createAndSendZoomMeetingEmail_(submissionId);
  });
  Logger.log('flushPendingZoomQueue 完了');
}

function createAndSendZoomMeetingEmail_(submissionId) {
  try {
    if (!submissionId) return;
    if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      Logger.log('Zoom連携が未設定のため、Zoomミーティングの作成をスキップしました');
      return;
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return;

    const row = findBookingRowBySubmissionId_(sheet, submissionId);
    if (!row) return;

    const values = sheet.getRange(row, 1, 1, HEADER_ROW.length).getValues()[0];
    const dateStr = formatDateValueForKintone_(values[6]); // G列 希望日
    const timeStr = formatTimeValueForKintone_(values[7]); // H列 希望時間
    const company = values[8];  // I列 会社名
    const name = values[9];     // J列 お名前
    const email = values[10];   // K列 メールアドレス

    if (!dateStr || !timeStr || !email) {
      Logger.log('Zoomミーティング作成に必要な情報（日時・メールアドレス）が揃っていません');
      return;
    }

    const topic = 'FDA無料相談（' + (company || '') + ' ' + (name || '') + ' 様）';
    const meeting = createZoomMeeting_(topic, dateStr, timeStr, ZOOM_MEETING_DURATION_MIN);
    if (!meeting || !meeting.joinUrl) return;

    const zoomInfo = {
      email: email,
      company: company,
      name: name,
      topic: topic,
      date: dateStr,
      time: timeStr,
      joinUrl: meeting.joinUrl,
      chatUrl: meeting.chatUrl,
      meetingId: meeting.meetingId,
      password: meeting.password
    };
    saveZoomMeetingInfo_(submissionId, zoomInfo);
    sendZoomMeetingEmail_(zoomInfo);
  } catch (err) {
    Logger.log('Zoomミーティング作成・メール送信でエラー: ' + err.toString());
  }
}

/**
 * 「予約一覧」シートで、指定した予約IDの行の
 * D列（記入状況）をチェック済みに、E列（ヒアリングシート更新日）を今日の日付にする。
 * ヒアリングシートが送信されるたび（初回・再送信いずれも）に呼ばれる。
 */
function markHearingCompletedInBookingList_(submissionId) {
  if (!submissionId) return;
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return;

    const row = findBookingRowBySubmissionId_(sheet, submissionId);
    if (!row) return;

    const statusCell = sheet.getRange(row, 4); // D列 記入状況
    statusCell.insertCheckboxes();
    statusCell.setValue(true);

    sheet.getRange(row, 5).setValue(new Date()); // E列 ヒアリングシート更新日
  } catch (err) {
    Logger.log('markHearingCompletedInBookingList_ エラー: ' + err.toString());
  }
}

/**
 * ヒアリング回答キャッシュのCacheServiceキーを作る。
 */
function hearingCacheKey_(submissionId) {
  return 'hearing_' + submissionId;
}

/* =========================================================================
   ★Zoomミーティング自動作成（ヒアリングシート初回送信時）
   ------------------------------------------------------------------------
   セットアップ手順：
   1. https://marketplace.zoom.us/ にログイン →「Develop」→「Build App」
   2. 「Server-to-Server OAuth」を選んでアプリを作成
   3. 表示される Account ID / Client ID / Client Secret を、「プロジェクトの設定」→
      「スクリプト プロパティ」に ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET
      として登録する（kintoneの設定と同じ場所です）
   4. アプリの「Scopes」で以下を追加（ミーティング作成に必要）：
        meeting:write:meeting / meeting:write:admin （プランによって表示名が異なる場合あり）
   5. アプリを有効化（Activation）する
   ※Server-to-Server OAuthアプリの利用には、Zoom側でPro以上のプランが必要な場合があります。
   ※Zoomミーティング作成は、応答を速くするため使い捨てのトリガー経由で非同期実行しています。
     このため次回実行時、「トリガーを管理する」権限の承認画面が新たに出ることがあります。
   ========================================================================= */
const ZOOM_ACCOUNT_ID = getScriptProp_('ZOOM_ACCOUNT_ID');
const ZOOM_CLIENT_ID = getScriptProp_('ZOOM_CLIENT_ID');
const ZOOM_CLIENT_SECRET = getScriptProp_('ZOOM_CLIENT_SECRET');
// Zoomミーティング自体の長さ（分）。実際の相談時間(BOOKING_DURATION_MIN=60分)より
// 長めに確保しておく（延長した場合の保険として、念のため2時間）
const ZOOM_MEETING_DURATION_MIN = 120;


// 当日リマインドでZoom参加情報を再掲できるよう、作成済みZoom情報を専用シートに保存する。
const ZOOM_INFO_SHEET_NAME = 'Zoom情報';
const ZOOM_INFO_HEADER = ['予約ID','作成日時','トピック','参加URL','チャットURL','ミーティングID','パスコード'];

function getOrCreateZoomInfoSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(ZOOM_INFO_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ZOOM_INFO_SHEET_NAME);
    sheet.appendRow(ZOOM_INFO_HEADER);
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (e) {}
  }
  return sheet;
}

function saveZoomMeetingInfo_(submissionId, info) {
  if (!submissionId || !info) return;
  const sheet = getOrCreateZoomInfoSheet_();
  const lastRow = sheet.getLastRow();
  let row = 0;
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(submissionId)) { row = i + 2; break; }
    }
  }
  const values = [[submissionId, new Date(), info.topic || '', info.joinUrl || '', info.chatUrl || '', info.meetingId || '', info.password || '']];
  if (row) sheet.getRange(row, 1, 1, values[0].length).setValues(values);
  else sheet.getRange(sheet.getLastRow() + 1, 1, 1, values[0].length).setValues(values);
}

function getZoomMeetingInfo_(submissionId) {
  if (!submissionId) return null;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ZOOM_INFO_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, ZOOM_INFO_HEADER.length).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(submissionId)) {
      return { topic: values[i][2] || '', joinUrl: values[i][3] || '', chatUrl: values[i][4] || '', meetingId: values[i][5] || '', password: values[i][6] || '' };
    }
  }
  return null;
}

/**
 * ★セットアップ確認用：Zoomのアクセストークンが取得できるか確認する。
 *   エディタ上部のプルダウンで debugZoomToken を選んで実行し、ログを確認してください。
 */
function debugZoomToken() {
  try {
    const token = getZoomAccessToken_();
    Logger.log('Zoomアクセストークンを取得できました（先頭10文字）: ' + token.substring(0, 10) + '...');
  } catch (err) {
    Logger.log('Zoomアクセストークンの取得に失敗しました: ' + err.toString());
  }
}

/**
 * Zoomの Server-to-Server OAuth でアクセストークンを取得する。
 */
function getZoomAccessToken_() {
  const url = 'https://zoom.us/oauth/token?grant_type=account_credentials&account_id=' + encodeURIComponent(ZOOM_ACCOUNT_ID);
  const authHeader = 'Basic ' + Utilities.base64Encode(ZOOM_CLIENT_ID + ':' + ZOOM_CLIENT_SECRET);

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { 'Authorization': authHeader },
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const body = res.getContentText();
  if (status !== 200) {
    throw new Error('Zoomアクセストークンの取得に失敗しました（' + status + '）: ' + body);
  }
  return JSON.parse(body).access_token;
}

/**
 * Zoomミーティングを1件作成し、参加用URL（join_url）を返す。
 * dateStr: 'YYYY-MM-DD'、timeStr: 'HH:MM'（日本時間）
 */
function createZoomMeeting_(topic, dateStr, timeStr, durationMin) {
  const accessToken = getZoomAccessToken_();

  const payload = {
    topic: topic,
    type: 2, // 日時指定の予約制ミーティング
    start_time: dateStr + 'T' + timeStr + ':00',
    duration: durationMin,
    timezone: 'Asia/Tokyo',
    settings: {
      join_before_host: true,
      waiting_room: true // ★待機室を必ず有効にする
    }
  };

  const res = UrlFetchApp.fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = res.getResponseCode();
  const body = res.getContentText();
  Logger.log('Zoomミーティング作成結果: HTTPステータス ' + status + ' / ' + body);

  if (status !== 201) {
    throw new Error('Zoomミーティングの作成に失敗しました（' + status + '）: ' + body);
  }

  const json = JSON.parse(body);
  return {
    joinUrl: json.join_url || '',
    meetingId: json.id || '',
    password: json.password || '',
    chatUrl: json.id ? ('https://zoom.us/launch/jc/' + json.id) : ''
  };
}

/**
 * Zoomリンクのご案内メールを送る。
 */
function sendZoomMeetingEmail_(info) {
  try {
    if (!info.email) return;

    const subject = '【Zoomミーティングのご案内】FDA無料相談';
    const timeLabel = formatZoomTimeLabel_(info.date, info.time);
    const meetingIdLabel = formatZoomMeetingId_(info.meetingId);

    const plainBody =
      'ヒアリングシートのご記入をいただき、誠にありがとうございました。\n' +
      '当日のZoomミーティング情報を下記の通りご案内いたします。\n\n' +
      '────────────────────────\n' +
      'トピック：' + (info.topic || '') + '\n' +
      '時刻　　：' + timeLabel + '\n\n' +
      '▼Zoomミーティングに参加する\n' + info.joinUrl + '\n\n' +
      (info.chatUrl ? '▼ミーティングチャットへのリンク\n' + info.chatUrl + '\n\n' : '') +
      'ミーティングID：' + meetingIdLabel + '\n' +
      'パスコード　　：' + (info.password || '') + '\n' +
      '────────────────────────\n\n' +
      '当日はお時間になりましたら、上記リンクよりご参加ください。\n' +
      'ご不明点がございましたら、本メールへご返信ください。\n\n' +
      '何卒よろしくお願いいたします。';

    sendBrandedEmail_(info.email, subject, plainBody, plainTextToHtml_(plainBody));
    Logger.log('Zoomミーティングのご案内メールを送信しました: ' + info.email);
  } catch (err) {
    Logger.log('Zoomミーティングのご案内メールの送信に失敗しました: ' + err.toString());
  }
}

/**
 * 'YYYY-MM-DD' + 'HH:MM' から、Zoomの招待状にある形式
 * 「2026年8月7日 10:00 AM 大阪、札幌、東京」の文字列を作る。
 */
function formatZoomTimeLabel_(dateStr, timeStr) {
  if (!dateStr || !timeStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const parts = timeStr.split(':').map(Number);
  const h = parts[0];
  const min = parts[1];
  const ampm = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const minStr = String(min).padStart(2, '0');
  return y + '年' + m + '月' + day + '日 ' + h12 + ':' + minStr + ' ' + ampm + ' 大阪、札幌、東京';
}

/**
 * ZoomのミーティングID（数字）を「975 5745 8875」のような表示形式にする。
 */
function formatZoomMeetingId_(id) {
  if (!id) return '';
  const s = String(id);
  const rem = s.length % 4;
  const groups = [];
  let i = 0;
  if (rem > 0) {
    groups.push(s.substring(0, rem));
    i = rem;
  }
  for (; i < s.length; i += 4) {
    groups.push(s.substring(i, i + 4));
  }
  return groups.join(' ');
}

/**
 * 「ヒアリング回答」シート内で、指定したsubmissionId（B列）を持つ行番号を探す
 * 見つからなければ null を返す
 */
function findRowBySubmissionId(sheet, submissionId) {
  if (!submissionId) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // B列（紐付けID）、ヘッダー行を除く
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === submissionId) {
      return i + 2; // 実際のシート上の行番号（ヘッダー分+1）
    }
  }
  return null;
}

/**
 * チェックボックス配列＋その他入力を1つの文字列にまとめる
 */
function joinWithOther(arr, other) {
  const list = Array.isArray(arr) ? arr.slice() : [];
  let text = list.join(' / ');
  if (other) {
    text += (text ? ' / ' : '') + 'その他: ' + other;
  }
  return text;
}

/**
 * 商品情報の配列を読みやすいテキストブロックに整形する
 */
/**
 * 添付ファイルの一覧（{label, url}の配列）から、各ファイル名がそれぞれ
 * クリックできるリンクになった、1つのセル用のリッチテキストを作る。
 */
function buildFileLinksRichText_(files) {
  const text = files.map(function (f) { return f.label; }).join('\n');
  const builder = SpreadsheetApp.newRichTextValue().setText(text);

  let pos = 0;
  files.forEach(function (f) {
    const len = f.label.length;
    builder.setLinkUrl(pos, pos + len, f.url);
    pos += len + 1; // +1 は改行分
  });

  return builder.build();
}

function formatProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return '';
  return products.map(function (p, i) {
    const category = p.category === 'その他' ? ('その他: ' + (p.categoryOther || '')) : (p.category || '');
    const facilities = Array.isArray(p.facilities) && p.facilities.length > 0
      ? p.facilities.map(function (f) { return (f.type || '') + '：' + (f.name || ''); }).join(' / ')
      : '';
    const temperature = (p.temperature || '') + (p.temperatureDetail ? '（' + p.temperatureDetail + '）' : '');
    const ingredientsFiles = Array.isArray(p.ingredientsFiles) && p.ingredientsFiles.length > 0
      ? '\n添付ファイル：' + p.ingredientsFiles.map(function (f) { return f.url; }).join(' / ')
      : '';

    return (
      '【商品' + (i + 1) + '】\n' +
      '商品名：' + (p.name || '') + '\n' +
      '商品URL：' + (p.url || '') + '\n' +
      'カテゴリ：' + category + '\n' +
      '用途・対象：' + (p.usage || '') + '\n' +
      '原材料・成分：' + (p.ingredients || '') + ingredientsFiles + '\n' +
      '包装仕様：' + (p.packaging || '') + '\n' +
      '賞味期限・消費期限：' + (p.expiry || '') + '\n' +
      '製造・加工・包装・保管施設：' + facilities + '\n' +
      '温度管理：' + temperature
    );
  }).join('\n\n');
}

/**
 * ★お客様への予約完了メールを自動送信する。
 * fda@worldshift-inc.com から送信するため、実行アカウントのGmail送信エイリアス設定が
 * 必要（BOOKING_CONFIRMATION_FROM_EMAILのコメント参照）。失敗しても予約自体は
 * 成立させるため、エラーはログに残すだけにする。
 */
function sendBookingConfirmationEmail_(data, hearingUrl, submissionId, accessToken) {
  try {
    if (!data.email) {
      Logger.log('予約完了メール: メールアドレスが無いため送信をスキップしました');
      return;
    }

    const dateLabel = formatBookingDateTimeLabel_(data.date, data.time);
    const manageUrl = buildManageUrl_(data.page || '', submissionId || '', accessToken || '');
    const subject = '【ご予約完了】FDA無料相談のご案内';
    const bodies = buildBookingConfirmationBodies_(dateLabel, hearingUrl, manageUrl);

    sendBrandedEmail_(data.email, subject, bodies.plainBody, bodies.htmlBody);
    Logger.log('予約完了メールを送信しました: ' + data.email);
  } catch (err) {
    Logger.log('予約完了メールの送信に失敗しました: ' + err.toString());
  }
}

/**
 * 予約完了メールの本文（プレーンテキスト版・HTML版）を組み立てる。
 * 「こちら」の部分はHTML版のみ実際のリンクにする（プレーンテキストではURLをそのまま表記）。
 */
function buildBookingConfirmationBodies_(dateLabel, hearingUrl, manageUrl) {
  const head =
    'この度は、FDA無料相談をご予約いただき、誠にありがとうございます。\n' +
    '以下の内容にてご予約を承りましたので、ご案内いたします。\n\n' +
    '■ ご予約日時\n' + dateLabel + '\n\n' +
    '■ 実施方法\n' + 'Zoom（オンライン）\n\n' +
    '■ 所要時間\n' + '約60分\n\n' +
    '当日のご相談をよりスムーズに進めるため、事前にヒアリングシートへのご記入をお願いいたします。\n\n' +
    '▼ヒアリングシート\n' + (hearingUrl || '') + '\n\n' +
    '【重要】ヒアリングシートは、ミーティング日の2日前までにご提出をお願いいたします。\n\n' +
    '対象商品や現在のご状況について、分かる範囲でご入力ください。\n' +
    'すべての項目が確定していない場合は、現時点でお分かりになる内容のみで問題ございません。\n\n' +
    'ヒアリングシートへのご記入を確認後、当日のZoomミーティングURLをお送りいたします。\n\n';

  const plainBody = head +
    'なお、日程変更やキャンセルはこちら（' + manageUrl + '）からお願いいたします。\n\n' +
    '何卒よろしくお願いいたします。';

  let htmlHead = plainTextToHtml_(head);
  htmlHead = htmlHead.replace(
    '【重要】ヒアリングシートは、ミーティング日の2日前までにご提出をお願いいたします。',
    '<div style="margin:14px 0;padding:12px 14px;border:1px solid #dc2626;background:#fff5f5;color:#dc2626;font-weight:700;">【重要】ヒアリングシートは、ミーティング日の2日前までにご提出をお願いいたします。</div>'
  );
  const htmlBody = htmlHead +
    'なお、日程変更やキャンセルは<a href="' + manageUrl + '">こちら</a>からお願いいたします。<br><br>' +
    '何卒よろしくお願いいたします。';

  return { plainBody: plainBody, htmlBody: htmlBody };
}


/**
 * FDA無料相談の自動リマインド。
 * ・2日前：ヒアリング未提出（予約一覧D列がtrueでない）場合のみ催促
 * ・当日：保存済みZoom情報を再掲した参加リマインド
 * 同じ予約・同じ日についてはScriptPropertiesで送信済みを記録し、重複送信を防ぐ。
 */
function sendDailyFdaMeetingReminders() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return;

  const tz = 'Asia/Tokyo';
  const today = new Date();
  const todayStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');
  const twoDays = new Date(today.getTime());
  twoDays.setDate(twoDays.getDate() + 2);
  const twoDaysStr = Utilities.formatDate(twoDays, tz, 'yyyy-MM-dd');
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADER_ROW.length).getValues();

  values.forEach(function(v) {
    const status = v[1] || '';
    if (status === CANCELLED_STATUS_LABEL) return;
    const hearingCompleted = v[3] === true;
    const dateStr = formatDateValueForKintone_(v[6]);
    const timeStr = formatTimeValueForKintone_(v[7]);
    const company = v[8] || '';
    const name = v[9] || '';
    const email = v[10] || '';
    const pageUrl = v[15] || '';
    const submissionId = v[16] || '';
    const accessToken = v[18] || '';
    if (!dateStr || !timeStr || !email || !submissionId) return;

    if (dateStr === twoDaysStr && !hearingCompleted && !wasReminderSent_('hearing2d', submissionId, todayStr)) {
      const hearingUrl = buildHearingUrl(pageUrl, submissionId, accessToken);
      sendHearingSheetReminderEmail_({ email: email, company: company, name: name, date: dateStr, time: timeStr, hearingUrl: hearingUrl });
      markReminderSent_('hearing2d', submissionId, todayStr);
    }

    if (dateStr === todayStr && !wasReminderSent_('meetingday', submissionId, todayStr)) {
      const zoom = getZoomMeetingInfo_(submissionId);
      if (zoom && zoom.joinUrl) {
        sendMeetingDayReminderEmail_({
          email: email, company: company, name: name, date: dateStr, time: timeStr,
          topic: zoom.topic, joinUrl: zoom.joinUrl, chatUrl: zoom.chatUrl,
          meetingId: zoom.meetingId, password: zoom.password
        });
        markReminderSent_('meetingday', submissionId, todayStr);
      } else {
        Logger.log('当日リマインドをスキップ：保存済みZoom情報がありません（予約ID: ' + submissionId + '）');
      }
    }
  });
}

function reminderSentKey_(type, submissionId, dateStr) {
  return 'REMINDER_SENT_' + type + '_' + submissionId + '_' + dateStr;
}
function wasReminderSent_(type, submissionId, dateStr) {
  return PropertiesService.getScriptProperties().getProperty(reminderSentKey_(type, submissionId, dateStr)) === '1';
}
function markReminderSent_(type, submissionId, dateStr) {
  PropertiesService.getScriptProperties().setProperty(reminderSentKey_(type, submissionId, dateStr), '1');
}

function sendHearingSheetReminderEmail_(info) {
  const dateLabel = formatBookingDateTimeLabel_(info.date, info.time);
  const subject = '【ご提出のお願い】FDA無料相談 ヒアリングシート';
  const plainBody =
    (info.name ? info.name + ' 様\n\n' : '') +
    'FDA無料相談のご予約日が2日後となりました。\n\n' +
    '■ ご予約日時\n' + dateLabel + '\n\n' +
    '当日のご相談をスムーズに進めるため、ヒアリングシートのご提出をお願いいたします。\n' +
    '【重要】本日中を目安にご提出ください。\n\n' +
    '▼ヒアリングシート\n' + (info.hearingUrl || '') + '\n\n' +
    'すでにご提出済みの場合は、行き違いとなりましたことをご容赦ください。\n\n何卒よろしくお願いいたします。';
  let htmlBody = plainTextToHtml_(plainBody);
  htmlBody = htmlBody.replace('【重要】本日中を目安にご提出ください。', '<div style="margin:14px 0;padding:12px 14px;border:1px solid #dc2626;background:#fff5f5;color:#dc2626;font-weight:700;">【重要】本日中を目安にご提出ください。</div>');
  sendBrandedEmail_(info.email, subject, plainBody, htmlBody);
}

function sendMeetingDayReminderEmail_(info) {
  const subject = '【本日のご案内】FDA無料相談 Zoomミーティング';
  const timeLabel = formatZoomTimeLabel_(info.date, info.time);
  const meetingIdLabel = formatZoomMeetingId_(info.meetingId);
  const plainBody =
    (info.name ? info.name + ' 様\n\n' : '') +
    '本日はFDA無料相談のご予約日です。\n' +
    '以前お送りしたZoom参加情報を、改めてご案内いたします。\n\n' +
    '────────────────────────\n' +
    'トピック：' + (info.topic || '') + '\n' +
    '時刻　　：' + timeLabel + '\n\n' +
    '▼Zoomミーティングに参加する\n' + (info.joinUrl || '') + '\n\n' +
    (info.chatUrl ? '▼ミーティングチャットへのリンク\n' + info.chatUrl + '\n\n' : '') +
    'ミーティングID：' + meetingIdLabel + '\n' +
    'パスコード　　：' + (info.password || '') + '\n' +
    '────────────────────────\n\n' +
    'お時間になりましたら、上記リンクよりご参加ください。\n\n何卒よろしくお願いいたします。';
  sendBrandedEmail_(info.email, subject, plainBody, plainTextToHtml_(plainBody));
}

/** 一度だけ手動実行し、毎朝8時台のリマインドトリガーを作成する。 */
function setupFdaReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyFdaMeetingReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyFdaMeetingReminders')
    .timeBased().atHour(8).everyDays(1).inTimezone('Asia/Tokyo').create();
  Logger.log('FDA無料相談リマインド：毎日8時台のトリガーを設定しました');
}

/**
 * キャンセル完了メール（manage.htmlからのキャンセル成功時に送信）。
 */
function sendCancellationEmail_(info) {
  try {
    if (!info.email) return;

    const dateLabel = formatBookingDateTimeLabel_(info.date, info.time);
    const subject = '【ご予約キャンセル】FDA無料相談のご案内';
    const plainBody =
      '以下のご予約について、キャンセルを承りました。\n\n' +
      '■ キャンセルされたご予約日時\n' + dateLabel + '\n\n' +
      '改めてご相談をご希望の際は、お手数ですが再度ご予約ページよりお申し込みください。\n\n' +
      '何卒よろしくお願いいたします。';

    sendBrandedEmail_(info.email, subject, plainBody, plainTextToHtml_(plainBody));
    Logger.log('キャンセル完了メールを送信しました: ' + info.email);
  } catch (err) {
    Logger.log('キャンセル完了メールの送信に失敗しました: ' + err.toString());
  }
}

/**
 * 変更完了メール（manage.htmlからの日程変更成功時に送信）。
 */
function sendRescheduleEmail_(info) {
  try {
    if (!info.email) return;

    const dateLabel = formatBookingDateTimeLabel_(info.date, info.time);
    const subject = '【ご予約変更完了】FDA無料相談のご案内';
    const head =
      'ご予約日時の変更を承りました。以下の内容にてご案内いたします。\n\n' +
      '■ 変更後のご予約日時\n' + dateLabel + '\n\n' +
      '■ 実施方法\n' + 'Zoom（オンライン）\n\n' +
      '■ 所要時間\n' + '約60分\n\n';

    const tail =
      'ヒアリングシートをまだご記入でない場合は、下記より引き続きご記入をお願いいたします。\n\n' +
      '▼ヒアリングシート\n' + (info.hearingUrl || '') + '\n\n' +
      '何卒よろしくお願いいたします。';

    const plainBody = head + tail;
    const htmlBody = plainTextToHtml_(plainBody);

    sendBrandedEmail_(info.email, subject, plainBody, htmlBody);
    Logger.log('変更完了メールを送信しました: ' + info.email);
  } catch (err) {
    Logger.log('変更完了メールの送信に失敗しました: ' + err.toString());
  }
}

/**
 * fda@worldshift-inc.com（送信エイリアス）から、署名付きでメールを送る共通処理。
 */
/**
 * 「まずはメールで確認したい方はこちら」等、日時未選択の問い合わせに対する受付メール。
 */
function sendInquiryConfirmationEmail_(data) {
  try {
    if (!data.email) {
      Logger.log('問い合わせ受付メール: メールアドレスが無いため送信をスキップしました');
      return;
    }

    const subject = '【お問い合わせ受付】FDA Compliance Partner';
    const plainBody =
      'この度は、FDA Compliance Partnerへお問い合わせいただき、誠にありがとうございます。\n\n' +
      '内容を確認のうえ、担当者より改めてご連絡させていただきますので、\n' +
      '今しばらくお待ちくださいませ。\n\n' +
      '何卒よろしくお願いいたします。';

    sendBrandedEmail_(data.email, subject, plainBody, plainTextToHtml_(plainBody));
    Logger.log('問い合わせ受付メールを送信しました: ' + data.email);
  } catch (err) {
    Logger.log('問い合わせ受付メールの送信に失敗しました: ' + err.toString());
  }
}

function sendBrandedEmail_(to, subject, plainBody, htmlBody) {
  const sendAsInfo = getGmailSendAsInfo_(BOOKING_CONFIRMATION_FROM_EMAIL);
  const finalHtmlBody = htmlBody + (sendAsInfo.signature ? '<br><br>' + sendAsInfo.signature : '');
  const senderName = sendAsInfo.displayName || BOOKING_CONFIRMATION_SENDER_NAME;

  GmailApp.sendEmail(to, subject, plainBody, {
    from: BOOKING_CONFIRMATION_FROM_EMAIL,
    name: senderName,
    htmlBody: finalHtmlBody
  });
}

/**
 * data.page（送信元ページURL）から同じディレクトリのmanage.htmlのURLを組み立てる。
 */
function buildManageUrl_(pageUrl, submissionId, accessToken) {
  const qs = 'id=' + encodeURIComponent(submissionId || '') + (accessToken ? '&token=' + encodeURIComponent(accessToken) : '');
  try {
    const base = pageUrl.replace(/[^\/]*$/, '');
    return base + 'manage.html?' + qs;
  } catch (e) {
    return 'manage.html?' + qs;
  }
}

/**
 * ★送信元アドレス（Gmailの送信エイリアス）に設定されている署名（HTML）を取得する。
 * これには「拡張機能サービス」でGmail APIを有効化しておく必要がある
 * （エディタ左メニュー「サービス」→「+」→ Gmail API を追加）。
 * 未設定・取得失敗時は空文字を返す（署名なしで送信されるだけで、メール自体は送れる）。
 */
/**
 * ★セットアップ確認用：署名がちゃんと取得できるかをその場で確認する。
 *   エディタ上部のプルダウンで debugGmailSignature を選んで実行し、
 *   「実行数」→「ログを表示」で結果を確認してください。
 */
function debugGmailSignature() {
  const info = getGmailSendAsInfo_(BOOKING_CONFIRMATION_FROM_EMAIL);
  Logger.log('BOOKING_CONFIRMATION_FROM_EMAIL: ' + BOOKING_CONFIRMATION_FROM_EMAIL);
  Logger.log('取得した差出人名: ' + (info.displayName || '(空 — フォールバックの' + BOOKING_CONFIRMATION_SENDER_NAME + 'が使われます)'));
  Logger.log('取得した署名: ' + (info.signature || '(空 — 上のログの送信エイリアス一覧と見比べてください)'));
}

function getGmailSendAsInfo_(emailAddress) {
  // ★予約送信のたびにGmail APIへ問い合わせると完了表示が遅くなるため、
  // 署名・差出人名だけ短時間キャッシュする。メール送信処理自体は従来どおり。
  const cache = CacheService.getScriptCache();
  const cacheKey = 'gmail_send_as_' + String(emailAddress || '').toLowerCase();
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // 壊れている場合は通常取得へフォールバックする。
      }
    }

    const sendAsList = Gmail.Users.Settings.SendAs.list('me').sendAs || [];
    Logger.log('Gmail送信エイリアス一覧: ' + sendAsList.map(function (s) { return s.sendAsEmail; }).join(', '));

    // ★Gmail APIはメールアドレスを小文字で返すため、大文字小文字を区別せずに比較する
    const target = String(emailAddress).toLowerCase();
    const match = sendAsList.filter(function (s) {
      return String(s.sendAsEmail).toLowerCase() === target;
    })[0];

    if (!match) {
      Logger.log('「' + emailAddress + '」に一致する送信エイリアスが見つかりませんでした');
      return { signature: '', displayName: '' };
    }
    if (!match.signature) {
      Logger.log('「' + emailAddress + '」の送信エイリアスは見つかりましたが、署名が設定されていません');
    }
    const info = {
      signature: match.signature || '',
      displayName: match.displayName || ''
    };
    // 10分だけ保持。署名や差出人名を変更した場合も長時間古い内容が残らない。
    cache.put(cacheKey, JSON.stringify(info), 600);
    return info;
  } catch (err) {
    Logger.log('Gmail送信エイリアス情報の取得に失敗しました（Gmail APIサービスが未追加、または権限未承認の可能性があります）: ' + err.toString());
    return { signature: '', displayName: '' };
  }
}

/**
 * プレーンテキストの本文を、簡易的にHTML（改行を<br>に変換、特殊文字をエスケープ）にする。
 */
function plainTextToHtml_(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br>');
}

/**
 * 'YYYY-MM-DD' と 'HH:MM'（開始時刻）から
 * 「〇月〇日（〇）〇:〇〇～〇:〇〇」の表示用文字列を作る。終了時刻はBOOKING_DURATION_MIN分後。
 */
function formatBookingDateTimeLabel_(dateStr, startTime) {
  if (!dateStr || !startTime) return '';
  const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const d = new Date(dateStr + 'T00:00:00');
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekday = weekdayLabels[d.getDay()];
  const endTime = addMinutes(startTime, BOOKING_DURATION_MIN);
  return month + '月' + day + '日（' + weekday + '）' + startTime + '～' + endTime;
}

/**
 * 担当者への通知メール（NOTIFY_EMAILを設定した場合のみ送信）
 */
function sendNotification(data) {
  const subject = `【新規予約】${data.company || ''} ${data.name || ''} 様（${data.date || ''} ${data.time || ''}）`;
  const body =
    `新しい無料相談の予約が入りました。\n\n` +
    `希望日時：${data.date || ''} ${data.time || ''}\n` +
    `会社名　：${data.company || ''}\n` +
    `お名前　：${data.name || ''}\n` +
    `メール　：${data.email || ''}\n` +
    `電話番号：${data.phone || ''}\n` +
    `都道府県：${data.prefecture || ''}\n` +
    `カテゴリ：${data.category || ''}\n` +
    `相談内容：${data.message || ''}\n`;

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

/**
 * ★セキュリティ改修の初回セットアップ用。
 * 既存データには触れず、予約一覧のS列ヘッダーだけ「アクセストークン」に整える。
 * 既存行のS列は空欄のままなので、既存メールのIDのみリンクは引き続き利用できます。
 */
function setupBookingAccessTokenColumn() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('予約一覧シートが見つかりません');
  sheet.getRange(1, BOOKING_ACCESS_TOKEN_COLUMN).setValue('アクセストークン').setFontWeight('bold');
  Logger.log('予約一覧 S列のアクセストークン列を設定しました。既存行は変更していません。');
}

/**
 * JSON形式のレスポンスを生成するヘルパー
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}