// Service Worker: アプリ本体とカードデータをキャッシュして、オフラインで起動・学習できるようにする。
// アプリを更新したら VERSION を上げること（上げないと iPhone に古いファイルが残る）。

const VERSION = 'v1.0.2';
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
  'js/progress.js',
  'js/quiz.js',
  'js/router.js',
  'js/speech.js',
  'js/state.js',
  'js/store.js',
  'js/sync.js',
  'js/theme.js',
  'js/ui.js',
  'js/screens/common.js',
  'js/screens/flash.js',
  'js/screens/home.js',
  'js/screens/learn.js',
  'js/screens/match.js',
  'js/screens/settings.js',
  'js/screens/spell.js',
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
