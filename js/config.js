// 外部サービスの設定。空のままなら、その機能は使わない（端末内だけで動く）。
// Firebase の apiKey はアプリに書いて公開する前提の値。データはセキュリティルールで守る。

export const FIREBASE = {
  apiKey: 'AIzaSyBBc_Ik8ewWcC4qZWDK21Rd9OvR_97rm00',
  projectId: 'korean-cards-c2e8e',
};

// 通知（Cloudflare Workers）。URL と VAPID 公開鍵の両方がそろうと設定画面に「通知」が出る
export const PUSH = {
  workerUrl: 'https://korean-cards-push.isshinryu4869.workers.dev',
  vapidPublicKey: 'BMyUn6Y-kIHu4sk7aaX1tn8tYILWb-0c_7R0fEPhDcDSdIkhp0rZqFDdBxlob9d2gtTVu24qSHx2c1MlesIfOIo',
};
