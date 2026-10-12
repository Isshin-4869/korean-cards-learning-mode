// 外部サービスの設定。空のままなら、その機能は使わない（端末内だけで動く）。
// Firebase の apiKey はアプリに書いて公開する前提の値。データはセキュリティルールで守る。

export const FIREBASE = {
  apiKey: 'AIzaSyBBc_Ik8ewWcC4qZWDK21Rd9OvR_97rm00',
  projectId: 'korean-cards-c2e8e',
};

// 通知（Cloudflare Workers）の URL。例: https://korean-cards-push.<アカウント>.workers.dev
export const PUSH_WORKER_URL = '';
