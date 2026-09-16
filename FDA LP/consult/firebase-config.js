// 顧客フロントの Firebase 設定（受付PWAと同一プロジェクト・同一垂直）。
// .gitignore 対象・コミットしない。本番ポータルへ埋め込む際も同じ値を置く。
export const firebaseConfig = {
  "apiKey": "AIzaSyAUMhpmZTa9LcEvjf9FuquuCM9DSfy1OPA",
  "authDomain": "worldshift-ai-agent.firebaseapp.com",
  "projectId": "worldshift-ai-agent",
  "storageBucket": "worldshift-ai-agent.firebasestorage.app",
  "messagingSenderId": "992673251869",
  "appId": "1:992673251869:web:efa79f77c4edaed979bcf4"
};
export const VERTICAL = "food-cosmetics";

// 顧客向け「AIに聞く」の問い合わせ先（公開エンドポイント）。
// 未デプロイ時は null のままでよい（UIは自動でフォールバック表示になる）。
export const AI_ASK_ENDPOINT = "https://aiask-rgyesromoa-an.a.run.app";
