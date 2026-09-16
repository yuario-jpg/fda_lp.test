// ポータル相談ウィジェット（顧客フロント）— Phase 1
// 役割：モーダル内の3入口を「営業時間×在席」で出し分け、
//   ① チャットで相談（在席時のみ・匿名認証で realtime スレッド）
//   ② AIに聞く（その場で要点回答・公開）
//   ③ 問い合わせる（フォーム→メール折り返し・常時の受け皿）
// 戦略：AIは漏斗／人はエスカレーション先／フォームはオフライン受け皿。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, addDoc, updateDoc, collection,
  query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, VERTICAL, AI_ASK_ENDPOINT } from "./firebase-config.js";
import { GLOSSARY } from "./glossary.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const esc = (s) => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 軽量フィルタ：顧客入力の前段ガード（空/短すぎ/長すぎ/URL過多）。LLM不使用＝軽量。
// チャット送信・AI質問の前に通す。スパム・誤投稿・公開AI悪用の一次抑止。差し替え容易なよう独立化。
function lightFilter(text) {
  const t = (text || "").trim();
  if (t.length < 2) return { ok: false, msg: "もう少し詳しくご記入ください。" };
  if (t.length > 1000) return { ok: false, msg: "長すぎます。要点を1000字以内でお願いします。" };
  if ((t.match(/https?:\/\//gi) || []).length >= 2) return { ok: false, msg: "URLを多く含む内容はお控えください。" };
  return { ok: true };
}

// 用語ツールチップ：用語辞書の語句を本文中で見つけ、マウスオーバー説明付きの span に包む
const GLOSSARY_KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const GLOSSARY_LC = {}; for (const k of GLOSSARY_KEYS) GLOSSARY_LC[k.toLowerCase()] = GLOSSARY[k];
const TERM_RE = GLOSSARY_KEYS.length
  ? new RegExp("(" + GLOSSARY_KEYS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi")
  : null;
function annotateTerms(text) {
  if (!TERM_RE) return esc(text);
  let out = "", last = 0, m; TERM_RE.lastIndex = 0;
  while ((m = TERM_RE.exec(text)) !== null) {
    const term = m[0];
    const def = GLOSSARY[term] || GLOSSARY_LC[term.toLowerCase()];
    out += esc(text.slice(last, m.index));
    out += def ? `<span class="cw-term" data-def="${esc(def)}">${esc(term)}</span>` : esc(term);
    last = m.index + term.length;
    if (m.index === TERM_RE.lastIndex) TERM_RE.lastIndex++;
  }
  return out + esc(text.slice(last));
}

// ---------- AI回答の Markdown を吹き出し向けHTMLに変換 ----------
// エンジンは Markdown で返すため、素で出すと ** や ## が生のまま見える。
// 手順：①インライン記法を制御文字の目印に置換 → ②annotateTerms（＝エスケープ＋用語注釈）
// → ③目印をタグへ戻す。エスケープ後にタグを入れるので HTML 注入は起きない。
const MD = { bo: "", bc: "", co: "", cc: "" };
function inlineHtml(s) {
  const marked = String(s)
    .replace(/\*\*([^*\n]+)\*\*/g, MD.bo + "$1" + MD.bc)
    .replace(/`([^`\n]+)`/g, MD.co + "$1" + MD.cc);
  return annotateTerms(marked)
    .split(MD.bo).join("<strong>").split(MD.bc).join("</strong>")
    .split(MD.co).join("<code>").split(MD.cc).join("</code>");
}
const isTableRow = (s) => /^\s*\|.*\|\s*$/.test(s);
const isTableSep = (s) => /^\s*\|[\s:|-]+\|\s*$/.test(s) && s.includes("-");
const tableCells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
function renderRich(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const out = []; let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push("<p>" + inlineHtml(para.join("\n")).split("\n").join("<br>") + "</p>"); para = []; } };
  const flushList = () => { if (list) { out.push("</" + list + ">"); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd(); let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    // 表：|見出し|…| と |---|---| の2行が揃っていれば表として組む（狭い吹き出し内は横スクロール）
    if (isTableRow(line) && isTableSep(lines[i + 1] || "")) {
      flushPara(); flushList();
      const head = tableCells(line);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) { rows.push(tableCells(lines[j])); j++; }
      out.push('<div class="cw-md-tw"><table>' +
        "<thead><tr>" + head.map(c => "<th>" + inlineHtml(c) + "</th>").join("") + "</tr></thead>" +
        "<tbody>" + rows.map(r => "<tr>" + r.map(c => "<td>" + inlineHtml(c) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div>");
      i = j - 1; continue;
    }
    if (/^\s*(-{3,}|_{3,})\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); continue; }
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) {                 // 見出し。吹き出し内なので h4〜h6 に寄せる
      flushPara(); flushList();
      const lv = Math.min(6, m[1].length + 3);
      out.push("<h" + lv + ">" + inlineHtml(m[2]) + "</h" + lv + ">"); continue;
    }
    if ((m = line.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); out.push("<blockquote>" + inlineHtml(m[1]) + "</blockquote>"); continue; }
    if ((m = line.match(/^\s*[-*・]\s+(.*)$/))) {
      flushPara(); if (list !== "ul") { flushList(); out.push("<ul>"); list = "ul"; }
      out.push("<li>" + inlineHtml(m[1]) + "</li>"); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); if (list !== "ol") { flushList(); out.push("<ol>"); list = "ol"; }
      out.push("<li>" + inlineHtml(m[1]) + "</li>"); continue;
    }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return out.join("");
}

/**
 * モーダル内のコンテナに相談ウィジェットを描画する。
 * @param {HTMLElement} mount  描画先要素
 * @param {Object} opts
 *   - context: {品目, 論点名, モーダル} など、いま見ている躓きの文脈（会話に添付）
 *   - vertical: 既定は config の VERTICAL
 *   - consultUrl: 「個別相談へ進む」の遷移先。省略時は Firestore の垂直設定を使う。
 *                 LPのように自ページ内に予約フォームがある場合はここで上書きする。
 */
export async function mountConsultWidget(mount, opts = {}) {
  const vertical = opts.vertical || VERTICAL;
  const context = opts.context || {};

  const root = el("div", "cw");
  root.innerHTML = `
    <div class="cw-head">
      <span class="cw-chip"><span class="dot"></span><span class="cw-chip-t"></span></span>
      <p class="cw-title">この内容について相談する</p>
      <p class="cw-status"><span class="led"></span><span class="cw-status-t">受付状況を確認中…</span></p>
    </div>
    <div class="cw-body"></div>`;
  mount.innerHTML = "";
  mount.appendChild(root);

  // 用語ツールチップ（root直下に浮かせてスクロール領域のクリップを回避）
  const tip = el("div", "cw-tip hidden");
  root.appendChild(tip);
  function showTip(t) {
    tip.textContent = t.dataset.def || "";
    tip.classList.remove("hidden");
    const rr = root.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const tw = Math.min(260, rr.width - 16);
    tip.style.maxWidth = tw + "px";
    let left = Math.max(8, Math.min(tr.left - rr.left, rr.width - tw - 8));
    let top = tr.top - rr.top - tip.offsetHeight - 8;
    if (top < 4) top = tr.bottom - rr.top + 8;   // 上に余白がなければ下に出す
    tip.style.left = left + "px"; tip.style.top = top + "px";
  }
  const hideTip = () => tip.classList.add("hidden");
  root.addEventListener("mouseover", (e) => { const t = e.target.closest(".cw-term"); if (t) showTip(t); });
  root.addEventListener("mouseout", (e) => { if (e.target.closest(".cw-term")) hideTip(); });
  root.addEventListener("click", (e) => { const t = e.target.closest(".cw-term"); if (t) showTip(t); else hideTip(); });

  const body = root.querySelector(".cw-body");
  const chipT = root.querySelector(".cw-chip-t");
  const statusEl = root.querySelector(".cw-status");
  const statusT = root.querySelector(".cw-status-t");
  const ctxLabel = (context["品目"] || context.item || "") + (context["論点名"] || context.topic ? " ／ " + (context["論点名"] || context.topic) : "");
  chipT.textContent = ctxLabel || (vertical === "food-cosmetics" ? "食品・化粧品輸出" : vertical);

  // 設定（営業時間・CTA・フォーム・免責）を読む。誰でも read 可。
  let cfg = {};
  try { const s = await getDoc(doc(db, "verticals", vertical)); if (s.exists()) cfg = s.data(); } catch (_) {}
  const hours = cfg.hours || { open: 10, close: 17, tz: "Asia/Tokyo" };

  // 在席集約（presence/{vertical}）。公開read。当番PWAが在席中に維持する。
  // 「online===true かつ updatedAt が鮮度内」を在席とみなす（クラッシュ時は鮮度切れで自動オフライン化）。
  const staleSec = (cfg.sla && cfg.sla.presenceStaleSec) || 30;
  const withinHours = isWithinHours(hours);
  const forced = (opts.forceOnline === true || opts.forceOnline === false);
  function presenceFresh(data) {
    if (!data || data.online !== true) return false;
    const u = data.updatedAt;
    const ms = u && u.toMillis ? u.toMillis() : (u && u.seconds ? u.seconds * 1000 : 0);
    return ms > 0 && (Date.now() - ms) < staleSec * 1000;
  }
  let lastPresence = null;
  try { const ps = await getDoc(doc(db, "presence", vertical)); lastPresence = ps.exists() ? ps.data() : null; } catch (_) {}

  // 在席(presence)が真。営業時間は表示の目安のみ＝在席中なら時間に関係なくチャット可
  let chatOnline = forced ? (opts.forceOnline === true) : presenceFresh(lastPresence);
  let onHome = true;   // ホーム表示中のみ在席変化で自動再描画する（チャット中などは触らない）

  // 匿名サインイン（チャット／フォーム送信に必要）。失敗してもAIは使える。
  let uid = null;
  try {
    await new Promise((resolve) => {
      onAuthStateChanged(auth, (u) => { if (u) { uid = u.uid; resolve(); } });
      signInAnonymously(auth).catch(() => resolve());
    });
  } catch (_) {}

  // ステータス表示
  function renderStatus() {
    if (chatOnline) { statusEl.classList.add("online"); statusT.textContent = "ただ今オンライン・担当者が対応しています"; }
    else { statusEl.classList.remove("online"); statusT.textContent = "ただ今担当者が不在です・メールで折り返します（受付時間 " + hours.open + "–" + hours.close + "時）"; }
  }
  renderStatus();
  renderHome();
  // 直接入口を開く（モーダルの「AIに聞く」「担当者とチャット」から）。chatは在席時のみ直行、不在ならホーム
  if (opts.open === "ai") startAI();
  else if (opts.open === "chat" && chatOnline) startChat();

  // 在席のライブ追従（本番のみ）。当番のON/OFFやクラッシュ鮮度切れで入口の出し分けが自動更新される。
  function applyPresence() {
    const next = presenceFresh(lastPresence);
    if (next === chatOnline) return;
    chatOnline = next;
    renderStatus();
    if (onHome) renderHome();
  }
  if (!forced) {
    onSnapshot(doc(db, "presence", vertical), (snap) => { lastPresence = snap.exists() ? snap.data() : null; applyPresence(); });
    setInterval(applyPresence, 10000);  // 更新が止まった（クラッシュ）場合のオフライン化
  }

  // ---------- 入口（ホーム） ----------
  function renderHome() {
    onHome = true;
    body.innerHTML = "";
    const cards = el("div", "cw-cards");

    if (!chatOnline) {
      const ban = el("div", "cw-banner", `ただ今担当者が不在のため、チャットをお休みしています。下の「問い合わせる」からお送りいただければ、担当者がメールで折り返します。`);
      body.appendChild(ban);
    }

    // 順序：オンライン時はチャットを最上位に、オフライン時は問い合わせを最上位に。
    const chatCard = makeCard({
      icon: "💬", primary: chatOnline, disabled: !chatOnline,
      title: chatOnline ? "チャットで今すぐ相談" : "チャットで相談（担当者の在席時）",
      sub: chatOnline ? "担当者がその場でお答えします" : "担当者が在席しているとき利用できます",
      onClick: chatOnline ? startChat : null
    });
    const aiCard = makeCard({
      icon: "🤖", primary: false,
      title: "AIに聞く",
      sub: "要点をその場で回答します（一般的な情報のご案内）",
      onClick: startAI
    });
    const formCard = makeCard({
      icon: "✉️", primary: !chatOnline,
      title: (cfg.form && cfg.form.label) || "問い合わせる",
      sub: "メールで折り返します（個別の可否は担当者が確認）",
      onClick: startForm
    });

    if (chatOnline) { cards.append(chatCard, aiCard, formCard); }
    else { cards.append(formCard, aiCard, chatCard); }
    body.appendChild(cards);

    if (cfg.disclaimer) { const d = el("p", "cw-disc", cfg.disclaimer); body.appendChild(d); }
  }

  function makeCard({ icon, title, sub, primary, disabled, onClick }) {
    const c = el("button", "cw-card" + (primary ? " primary" : ""));
    if (disabled) c.setAttribute("disabled", "disabled");
    c.innerHTML = `<span class="cw-ico">${icon}</span>
      <span class="cw-card-main"><span class="cw-card-t">${esc(title)}</span><span class="cw-card-s">${esc(sub)}</span></span>
      <span class="cw-card-go">›</span>`;
    if (onClick && !disabled) c.onclick = onClick;
    return c;
  }

  function screenHeader(title) {
    const h = el("div", "cw-shead");
    h.innerHTML = `<button class="cw-back" aria-label="戻る">‹</button><span class="cw-shead-t">${esc(title)}</span>`;
    h.querySelector(".cw-back").onclick = renderHome;
    return h;
  }

  // ---------- ① チャット ----------
  let convId = null, unsub = null, unsubConv = null, lastCustTyping = 0;
  async function startChat() {
    onHome = false;
    body.innerHTML = "";
    const chatHead = screenHeader("担当者とチャット");
    const endBtn = el("button", "cw-end", "終了する");
    chatHead.appendChild(endBtn);
    body.appendChild(chatHead);

    // 折り返し用メール（必須）を最初に一度だけ聞く軽量フォーム
    const wrap = el("div");
    wrap.innerHTML = `
      <div class="cw-field">
        <label>メールアドレス<span style="color:#c0392b;font-size:12px;margin-left:4px">必須</span></label>
        <input class="cw-input" id="cw-chat-email" type="email" placeholder="例：tanaka@example.com" />
      </div>
      <p class="cw-err" id="cw-chat-err"></p>
      <p class="cw-note">折り返しのためメールアドレスが必要です。送信ボタンで相談を開始します。</p>`;
    body.appendChild(wrap);

    const thread = el("div", "cw-thread hidden");
    body.appendChild(thread);
    const agentTypingEl = el("div", "cw-typing hidden", "担当者が入力中…");
    body.appendChild(agentTypingEl);
    const consultCard = el("div", "cw-consult hidden");   // 担当者からの個別相談CTA
    body.appendChild(consultCard);
    const hintEl = el("div", "cw-hint hidden", "用語にマウスオーバー（スマホはタップ）で説明が出ます");
    body.appendChild(hintEl);

    // 下部送信バー
    const foot = el("div", "cw-foot");
    foot.innerHTML = `<textarea class="cw-area" id="cw-chat-input" placeholder="相談内容を入力…" rows="1"></textarea><button class="cw-send" id="cw-chat-send">送信</button>`;
    root.appendChild(foot);

    const input = foot.querySelector("#cw-chat-input");
    const send = foot.querySelector("#cw-chat-send");
    const emailField = wrap.querySelector("#cw-chat-email");

    const cleanup = () => { if (unsub) { unsub(); unsub = null; } if (unsubConv) { unsubConv(); unsubConv = null; } foot.remove(); };

    // 入力中を担当者へ伝える（スロットリング）
    input.addEventListener("input", () => {
      if (!convId) return;
      const now = Date.now();
      if (now - lastCustTyping < 3000) return;
      lastCustTyping = now;
      updateDoc(doc(db, "conversations", convId), { customerTyping: serverTimestamp() }).catch(() => {});
    });
    // 戻るでフッターも片付け
    body.querySelector(".cw-back").onclick = () => { cleanup(); renderHome(); };

    // チャットを終了（会話をクローズ＝受付の待ち行列から外れる）
    endBtn.onclick = async () => {
      if (convId) await updateDoc(doc(db, "conversations", convId),
        { status: "closed", closedBy: "customer", closedAt: serverTimestamp() }).catch(() => {});
      cleanup();
      body.innerHTML = "";
      const d = el("div", "cw-done");
      d.innerHTML = `<div class="ok">✓</div><h4>チャットを終了しました</h4><p>ご相談ありがとうございました。<br>続けてご相談がある場合は、もう一度「相談」からお願いします。</p>`;
      body.appendChild(d);
    };

    send.onclick = async () => {
      const text = input.value.trim();
      if (!text || !uid) return;
      const errEl = wrap.querySelector("#cw-chat-err");
      const lf = lightFilter(text);
      if (!lf.ok) { if (errEl) errEl.textContent = lf.msg; return; }
      if (!convId) {                                   // 初回送信はメール必須（折り返し用）
        const em = (emailField.value || "").trim();
        if (!em || !/.+@.+\..+/.test(em)) { if (errEl) errEl.textContent = "メールアドレスをご記入ください（折り返し用）。"; emailField.focus(); return; }
        if (errEl) errEl.textContent = "";
      }
      input.value = "";
      send.disabled = true; input.disabled = true;
      try {
        if (!convId) {
          // 初回送信で会話を作成（status:waiting で待ち行列へ）
          const email = (emailField.value || "").trim();
          const ref = await addDoc(collection(db, "conversations"), {
            customerUid: uid, customerEmail: email, vertical, channel: "chat",
            status: "waiting", contextModal: context, source: "portal-modal",
            lastPreview: text.slice(0, 40), lastSender: "customer", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          });
          convId = ref.id;
          wrap.remove();
          thread.classList.remove("hidden");
          subscribeThread(thread, agentTypingEl, consultCard, hintEl);
        } else {
          await updateDoc(doc(db, "conversations", convId), { lastPreview: text.slice(0, 40), lastSender: "customer", updatedAt: serverTimestamp() }).catch(() => {});
        }
        await addDoc(collection(db, "conversations", convId, "messages"), { sender: "customer", text, createdAt: serverTimestamp() });
      } catch (e) { input.value = text; /* 失敗時は文面を戻して再送可能に */ }
      finally { send.disabled = false; input.disabled = false; input.focus(); }
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send.onclick(); } });
  }

  function subscribeThread(thread, agentTypingEl, consultCard, hintEl) {
    const mq = query(collection(db, "conversations", convId, "messages"), orderBy("createdAt", "asc"));
    unsub = onSnapshot(mq, (snap) => {
      thread.innerHTML = "";
      snap.docs.forEach(d => {
        const m = d.data();
        if (m.sender === "ai-draft") return;            // 担当者の内部下書きは顧客に出さない
        const div = el("div", "cw-msg " + (m.sender === "agent" ? "in" : "out"));
        if (m.sender === "agent") div.innerHTML = annotateTerms(m.text);   // 用語に説明を付与
        else div.textContent = m.text;
        thread.appendChild(div);
      });
      const meta = el("div", "cw-meta", "担当者が確認しています");
      thread.appendChild(meta);
      if (hintEl) hintEl.classList.toggle("hidden", !thread.querySelector(".cw-term"));  // 用語があればヒント表示
      body.scrollTop = body.scrollHeight;
    });
    // 会話ドキュメント購読：担当者の入力中＋個別相談CTA
    let hideTimer = null;
    unsubConv = onSnapshot(doc(db, "conversations", convId), (s) => {
      const data = s.exists() ? s.data() : {};
      // 入力中
      const at = data.agentTyping;
      const ms = at && at.toMillis ? at.toMillis() : (at && at.seconds ? at.seconds * 1000 : 0);
      if (ms && Date.now() - ms < 6000) {
        agentTypingEl.classList.remove("hidden");
        body.scrollTop = body.scrollHeight;
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => agentTypingEl.classList.add("hidden"), 6000);
      }
      // 個別相談の案内（担当者が案内を出したらCTA表示）。クリック済みなら出さない
      if (data.consultOffer && !data.consultClicked) renderConsultCTA(consultCard, data);
      else consultCard.classList.add("hidden");
    });
  }

  function renderConsultCTA(consultCard, data) {
    if (!consultCard.classList.contains("hidden")) return;   // 既に表示済みなら据え置き
    const url = (data.consultOffer && data.consultOffer.url) || opts.consultUrl || cfg.consultUrl || cfg.consult_url || "";
    consultCard.innerHTML = `
      <div class="cw-consult-t">担当者から個別相談のご案内です</div>
      <p class="cw-consult-s">具体的なケースは、個別相談で詳しくご対応します。下のボタンからお進みください。</p>
      <button class="cw-consult-btn">個別相談へ進む →</button>`;
    consultCard.classList.remove("hidden");
    body.scrollTop = body.scrollHeight;
    consultCard.querySelector(".cw-consult-btn").onclick = async () => {
      await updateDoc(doc(db, "conversations", convId),
        { consultClicked: serverTimestamp(), status: "escalated", conversion: { via: "consult-cta", at: serverTimestamp() } }).catch(() => {});
      if (url) window.open(url, "_blank", "noopener");
    };
  }

  // ---------- ② AIに聞く（操作は人チャットと同じ・色だけAI用・個別相談CTAと用語は共通） ----------
  async function startAI() {
    onHome = false;
    body.innerHTML = "";
    root.classList.add("cw-ai-mode");                      // AI用の配色（人チャットと区別）
    body.appendChild(screenHeader("AIに聞く"));
    body.appendChild(el("div", "cw-ai-intro", "FDA輸出について、その場でお答えします（一般的な情報のご案内です）。"));
    const thread = el("div", "cw-thread");
    body.appendChild(thread);
    const consultCard = el("div", "cw-consult hidden");    // 個別相談CTA（回答後に提示）
    body.appendChild(consultCard);
    const hintEl = el("div", "cw-hint hidden", "用語にマウスオーバー（スマホはタップ）で説明が出ます");
    body.appendChild(hintEl);

    const foot = el("div", "cw-foot");
    foot.innerHTML = `<textarea class="cw-area" id="cw-ai-input" placeholder="質問を入力…" rows="1"></textarea><button class="cw-send" id="cw-ai-send">送信</button>`;
    root.appendChild(foot);
    const input = foot.querySelector("#cw-ai-input");
    const send = foot.querySelector("#cw-ai-send");

    const aiMsgs = [];                                     // AI会話の履歴
    body.querySelector(".cw-back").onclick = () => { foot.remove(); root.classList.remove("cw-ai-mode"); renderHome(); };

    const push = (sender, text) => {
      const d = el("div", "cw-msg " + (sender === "ai" ? "in" : "out"));
      if (sender === "ai") { d.classList.add("cw-md"); d.innerHTML = renderRich(text); } else d.textContent = text;   // AI回答はMarkdown整形＋用語に説明
      thread.appendChild(d); body.scrollTop = body.scrollHeight;
      if (sender === "ai") { hintEl.classList.toggle("hidden", !thread.querySelector(".cw-term")); showAIConsultCTA(consultCard); }
    };

    send.onclick = async () => {
      const q = input.value.trim();
      if (!q) return;
      const lf = lightFilter(q);
      if (!lf.ok) { push("customer", q); push("ai", lf.msg); input.value = ""; return; }
      input.value = ""; push("customer", q); aiMsgs.push({ role: "user", content: q });
      send.disabled = true; input.disabled = true;
      const typing = el("div", "cw-typing", "AIが回答を作成中…"); thread.appendChild(typing); body.scrollTop = body.scrollHeight;
      const ans = await askAI(aiMsgs);
      typing.remove();
      push("ai", ans); aiMsgs.push({ role: "assistant", content: ans });
      send.disabled = false; input.disabled = false; input.focus();
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send.onclick(); } });
  }

  // AIに聞く内の個別相談CTA（人チャットと同じ遷移先＝モーダルの問い合わせ先）
  function showAIConsultCTA(consultCard) {
    if (!consultCard.classList.contains("hidden")) return;
    const url = opts.consultUrl || cfg.consultUrl || cfg.consult_url || "";   // ページ側で個別指定できる（LPは自ページの予約フォームへ）
    consultCard.innerHTML = `
      <div class="cw-consult-t">担当者への個別相談もできます</div>
      <p class="cw-consult-s">御社のケースに踏み込んだ相談は、担当者が個別にご対応します。</p>
      <button class="cw-consult-btn">個別相談へ進む →</button>`;
    consultCard.classList.remove("hidden");
    body.scrollTop = body.scrollHeight;
    consultCard.querySelector(".cw-consult-btn").onclick = () => { if (url) window.open(url, "_blank", "noopener"); };
  }

  async function askAI(messages) {
    if (!AI_ASK_ENDPOINT) {
      return "AIによる即時回答は現在準備中です。お急ぎの場合は「問い合わせる」からお送りいただくか、受付時間（" + hours.open + "–" + hours.close + "時）にチャットをご利用ください。";
    }
    try {
      const r = await fetch(AI_ASK_ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, vertical, context })
      });
      if (!r.ok) throw new Error("bad status");
      const d = await r.json();
      return d.answer || d.text || "うまく回答を取得できませんでした。お手数ですが「問い合わせる」からお送りください。";
    } catch (_) {
      return "ただ今AIが混み合っています。「問い合わせる」からお送りいただければ担当者がご回答します。";
    }
  }

  // ---------- ③ 問い合わせる（フォーム） ----------
  function startForm() {
    onHome = false;
    body.innerHTML = "";
    body.appendChild(screenHeader("問い合わせ"));
    const wrap = el("div");
    wrap.innerHTML = `
      <div class="cw-field">
        <label>メールアドレス（必須・折り返し用）</label>
        <input class="cw-input" id="cw-f-email" type="email" placeholder="例：tanaka@example.com" />
      </div>
      <div class="cw-field">
        <label>ご相談内容</label>
        <textarea class="cw-area" id="cw-f-msg" placeholder="${esc((cfg.form && cfg.form.note) || "ご相談内容をご記入ください")}"></textarea>
      </div>
      <p class="cw-err" id="cw-f-err"></p>
      <button class="cw-btn" id="cw-f-send">送信する</button>
      <p class="cw-note">いただいた内容に、担当者がメールで折り返します。${cfg.disclaimer ? "<br>" + esc(cfg.disclaimer) : ""}</p>`;
    body.appendChild(wrap);

    const emailEl = wrap.querySelector("#cw-f-email");
    const msgEl = wrap.querySelector("#cw-f-msg");
    const errEl = wrap.querySelector("#cw-f-err");
    const btn = wrap.querySelector("#cw-f-send");

    btn.onclick = async () => {
      const email = emailEl.value.trim(), msg = msgEl.value.trim();
      errEl.textContent = "";
      if (!email || !/.+@.+\..+/.test(email)) { errEl.textContent = "メールアドレスをご確認ください。"; return; }
      if (!msg) { errEl.textContent = "ご相談内容をご記入ください。"; return; }
      if (!uid) { errEl.textContent = "送信の準備中です。数秒後にもう一度お試しください。"; return; }
      btn.disabled = true; btn.textContent = "送信中…";
      try {
        const ref = await addDoc(collection(db, "conversations"), {
          customerUid: uid, customerEmail: email, vertical, channel: "form",
          status: "waiting", contextModal: context, source: "portal-modal",
          lastPreview: msg.slice(0, 40), lastSender: "customer", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        await addDoc(collection(db, "conversations", ref.id, "messages"), { sender: "customer", text: msg, createdAt: serverTimestamp() });
        renderDone();
      } catch (e) {
        btn.disabled = false; btn.textContent = "送信する";
        errEl.textContent = "送信に失敗しました。時間をおいて再度お試しください。";
      }
    };
  }

  function renderDone() {
    body.innerHTML = `
      <div class="cw-done">
        <div class="ok">✓</div>
        <h4>送信しました</h4>
        <p>ご記入のメールアドレス宛に、担当者が折り返しご連絡します。<br>受付時間は ${hours.open}–${hours.close} 時です。</p>
      </div>`;
  }
}

// 営業時間判定（tz は Asia/Tokyo 固定運用。簡易に JST 換算）
function isWithinHours(hours) {
  try {
    const now = new Date();
    const jst = new Date(now.toLocaleString("en-US", { timeZone: hours.tz || "Asia/Tokyo" }));
    const h = jst.getHours();
    const day = jst.getDay(); // 0=日,6=土
    if (day === 0 || day === 6) return false; // 平日のみ（暫定）
    return h >= (hours.open ?? 10) && h < (hours.close ?? 17);
  } catch (_) { return false; }
}

// グローバル自動マウント（ポータル側が window.__CONSULT__ を置く運用）
if (typeof window !== "undefined" && window.__CONSULT__ && window.__CONSULT__.mount) {
  mountConsultWidget(window.__CONSULT__.mount, window.__CONSULT__);
}
