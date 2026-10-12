// アプリの更新: 新しい Service Worker が有効になったら知らせる（勝手に再読み込みはしない）

let ready = false;
const listeners = new Set();
export const updateReady = () => ready;
export const onUpdateReady = (fn) => listeners.add(fn);

export async function watchUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller; // 初回インストールでは知らせない
  const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
  if (!reg) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || ready) return;
    ready = true;
    for (const fn of listeners) fn();
  });
  // iPhone のホーム画面アプリは、裏から戻っただけでは更新を確認しないので、戻ったときにも確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}
