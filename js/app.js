import { state, loadState } from './state.js';
import { register, go, currentScreen, rerender } from './router.js';
import { initSync } from './sync.js';
import { homeScreen } from './screens/home.js';
import { learnScreen } from './screens/learn.js';
import { flashScreen } from './screens/flash.js';
import { testScreen } from './screens/test.js';
import { spellScreen } from './screens/spell.js';
import { matchScreen } from './screens/match.js';
import { settingsScreen } from './screens/settings.js';
import { applyTheme } from './theme.js';

register('home', homeScreen);
register('learn', learnScreen);
register('flash', flashScreen);
register('test', testScreen);
register('spell', spellScreen);
register('match', matchScreen);
register('settings', settingsScreen);

// キーボードが出ても入力欄と回答ボタンが隠れないよう、表示領域の高さに合わせる
function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  const update = () => {
    root.setProperty('--app-h', `${vv.height}px`);
    root.setProperty('--vv-top', `${vv.offsetTop}px`);
    document.body.classList.toggle('kb', window.innerHeight - vv.height > 120);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

async function main() {
  trackViewport();
  try {
    await loadState();
  } catch (e) {
    document.getElementById('app').textContent = 'データを読み込めませんでした: ' + e.message;
    throw e;
  }
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  go('home');
  // 別の端末の変更が届いたら、ホームにいるときだけ表示を更新する（出題中の画面は入れ替えない）
  initSync({
    onRemoteApplied: (keys) => {
      if (keys.includes('settings')) applyTheme();
      if (currentScreen().name === 'home') rerender();
    },
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
