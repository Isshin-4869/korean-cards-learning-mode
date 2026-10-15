// Service Worker: アプリ本体とカードデータをキャッシュして、オフラインで起動・学習できるようにする。
// アプリを更新したら VERSION を上げること（上げないと iPhone に古いファイルが残る）。

const VERSION = 'v1.0.8';
const APP_CACHE = `korean-cards-${VERSION}`;
const FONT_CACHE = 'korean-cards-fonts';

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'data/cards.md',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/app.js',
  'js/answer.js',
  'js/cards.js',
  'js/config.js',
  'js/deck.js',
  'js/firebase.js',
  'js/learn.js',
  'js/memory.js',
  'js/progress.js',
  'js/push.js',
  'js/quiz.js',
  'js/review.js',
  'js/search.js',
  'js/router.js',
  'js/speech.js',
  'js/state.js',
  'js/streak.js',
  'js/store.js',
  'js/sync.js',
  'js/theme.js',
  'js/ui.js',
  'js/update.js',
  'js/widget.js',
  'js/screens/common.js',
  'js/screens/flash.js',
  'js/screens/home.js',
  'js/screens/learn.js',
  'js/screens/search.js',
  'js/screens/match.js',
  'js/screens/settings.js',
  'js/screens/spell.js',
  'js/screens/start.js',
  'js/screens/test.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== APP_CACHE && key !== FONT_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: キャッシュを先に返し、裏で更新する
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      const fresh = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit ?? fresh;
    })());
    return;
  }

  if (url.origin !== location.origin) return;

  // アプリ本体: キャッシュ優先（オフラインで動く）
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) ?? Response.error();
      throw e;
    }
  })());
});

// ---- 毎日の復習リマインダー（中身なしの push を受け、文面は端末内の進捗から作る） ----
function readKv(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open('korean-cards', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(undefined);
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('kv', 'readonly').objectStore('kv').get(key);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    };
  });
}

async function reminderText() {
  const progress = (await readKv('progress')) ?? {};
  const learning = Object.values(progress).filter((r) => r && r.s === 1).length;
  return learning
    ? `今日はまだ学習していません。学習中の単語が ${learning} 枚あります`
    : '今日はまだ学習していません。1ラウンドだけやってみませんか';
}

self.addEventListener('push', (event) => {
  // iPhone では push を受けたら必ず通知を出す決まりがある
  event.waitUntil((async () => {
    await self.registration.showNotification('韓国語カード', {
      body: await reminderText(),
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'daily-reminder',
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
