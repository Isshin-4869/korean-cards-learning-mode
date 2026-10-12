// 設定・データ（カードデータの読み込み、バックアップ）

import { h, iconButton } from '../ui.js';
import { state, save, APP_VERSION, makeBackup, restoreBackup, resetProgress, importCardsMarkdown, useBundledCards } from '../state.js';
import { speak, speechAvailable, hasKoreanVoice } from '../speech.js';
import { go, rerender, onLeave } from '../router.js';
import { applyTheme } from '../theme.js';
import { firebaseConfigured, currentUser, signIn, signOut } from '../firebase.js';
import { syncNow, syncStatus, onSyncStatus } from '../sync.js';

const DIRECTIONS = { auto: 'おまかせ（4択は韓→日・記述は日→韓）', ko: '韓国語を見て答える', ja: '日本語を見て答える', mix: 'ミックス' };
let message = '';

export function settingsScreen() {
  const s = state.settings;
  const set = (k, v) => { s[k] = v; save.settings(); };

  const seg = (k, opts) => h('div', { class: 'seg-ctl', style: 'margin-top:8px' }, opts.map(([v, label]) =>
    h('button', { class: 'btn', 'aria-pressed': String(s[k] === v), onClick: () => { set(k, v); if (k === 'theme') applyTheme(); rerender(); } }, label)));
  const toggle = (k, label, note, on = true, off = false) => {
    const id = 'sw-' + k;
    return h('div', { class: 'lrow' },
      h('label', { class: 'grow', for: id }, h('div', null, label), note ? h('div', { class: 'muted small' }, note) : null),
      h('input', { id, type: 'checkbox', class: 'switch', role: 'switch', checked: s[k] === on, onChange: (e) => set(k, e.target.checked ? on : off) }));
  };
  const block = (label, ...kids) => h('div', { style: 'padding:10px 0' }, h('div', null, label), ...kids);
  const fileButton = (label, accept, onFile) => {
    const input = h('input', { type: 'file', accept, class: 'hidden-input', onChange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) await onFile(await f.text());
    } });
    return h('label', { class: 'lrow', style: 'cursor:pointer;color:var(--accent)' }, label, input);
  };
  const action = (label, fn, danger) => h('button', { class: 'lrow btn text', style: `width:100%;text-align:left;padding:0;border-radius:0;${danger ? 'color:var(--ng)' : ''}`, onClick: fn }, label);
  const notify = (m) => { message = m; rerender(); };
  const acceptedCount = Object.values(state.accepted).reduce((n, r) => n + Object.values(r).flat().length, 0);

  const el = h('div', null,
    h('div', { class: 'top' }, iconButton('back', '戻る', () => { message = ''; go('home'); }), h('h1', { class: 'grow' }, '設定')),
    h('div', { class: 'scroll' },
      message ? h('p', { class: 'notice', role: 'status' }, message) : null,
      h('div', { class: 'section-title' }, '学習'),
      h('div', { class: 'list' },
        block('1ラウンドの語数', seg('roundSize', [[5, '5'], [7, '7'], [10, '10'], [15, '15']])),
        h('div', { style: 'padding:10px 0' }, h('label', { for: 'dir' }, '出題方向'),
          h('select', { id: 'dir', class: 'field', style: 'display:block;width:100%;margin-top:8px', onChange: (e) => set('direction', e.target.value) },
            Object.entries(DIRECTIONS).map(([v, label]) => h('option', { value: v, selected: s.direction === v ? '' : null }, label)))),
        toggle('needWritten', '2回正解で習得', '記述（文型は逆向きの4択）を2回正解したら習得にする', 2, 1)),
      h('div', { class: 'section-title' }, '読み上げ'),
      h('div', { class: 'list' },
        toggle('autoSpeak', '自動読み上げ', '韓国語が出たとき・答えが韓国語のときに読み上げる'),
        action('読み上げを試す（안녕하세요）', () => speak('안녕하세요')),
        !speechAvailable() ? h('div', { class: 'lrow muted small' }, 'この端末では読み上げが使えません') : !hasKoreanVoice() ? h('div', { class: 'lrow muted small' }, '韓国語の音声が見つかりません。iPhone の設定 → アクセシビリティ → 読み上げコンテンツ → 声 で韓国語を追加してください') : null),
      h('div', { class: 'section-title' }, '答え合わせ（記述・スペル）'),
      h('div', { class: 'list' },
        toggle('allowTypo', '1文字ミスを許容', '語ごとに字母1つ（長い語は2つ）までの打ち間違いを正解にする。別の単語になる打ち間違いは不正解'),
        toggle('strictSpacing', '分かち書きも判定する', 'オフのときは、分かち書きだけ違えば「正解（分かち書きに注意）」'),
        acceptedCount ? action(`「正解にする」で覚えた答えを消す（${acceptedCount}件）`, () => {
          if (!confirm('「正解にする」で覚えた答えをすべて消しますか？')) return;
          state.accepted = {};
          save.accepted();
          notify('覚えた答えを消しました');
        }) : null),
      h('div', { class: 'section-title' }, '表示'),
      h('div', { class: 'list' }, block('テーマ', seg('theme', [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']]))),
      firebaseConfigured() ? syncSection(action, notify) : null,
      h('div', { class: 'section-title' }, 'データ'),
      h('div', { class: 'list' },
        h('div', { class: 'lrow muted small' }, `カード ${state.cards.length}枚（${state.cardsSource === 'custom' ? '読み込んだデータ' : '同梱のデータ'}）`),
        fileButton('カードデータ（md）を読み込む', '.md,.txt,text/markdown,text/plain', async (text) => {
          try {
            const r = await importCardsMarkdown(text);
            notify(`${r.total}枚を読み込みました（追加 ${r.added}・削除 ${r.removed}・進捗を引き継いだカード ${r.kept}）${r.issues.length ? `。読み飛ばした行 ${r.issues.length}` : ''}`);
          } catch (e) {
            notify('読み込めませんでした: ' + e.message);
          }
        }),
        state.cardsSource === 'custom' ? action('同梱のカードデータに戻す', async () => { await useBundledCards(); notify('同梱のデータに戻しました'); }) : null,
        action('バックアップを書き出す（進捗と設定）', exportBackup),
        fileButton('バックアップから復元', '.json,application/json', async (text) => {
          try {
            const obj = JSON.parse(text);
            if (!confirm('今の進捗と設定を、バックアップの内容で置き換えますか？')) return;
            await restoreBackup(obj);
            applyTheme();
            notify('復元しました');
          } catch (e) {
            notify('復元できませんでした: ' + e.message);
          }
        }),
        action('進捗をリセット', async () => {
          if (!confirm('すべての進捗・単語カードの印・マッチの記録を消します。元に戻せません。よろしいですか？')) return;
          await resetProgress();
          notify('進捗をリセットしました');
        }, true)),
      h('p', { class: 'muted small', style: 'margin:24px 0' }, `韓国語カード ${APP_VERSION}`)));
  return el;
}

// 同期（Firebase）: ログインすると、進捗と設定をほかの端末と共有する
function syncSection(action, notify) {
  const user = currentUser();
  if (!user) {
    const field = (type, autocomplete, label) => h('input', { class: 'field', type, autocomplete, placeholder: label, 'aria-label': label, style: 'margin-top:8px' });
    const email = field('email', 'username', 'メールアドレス');
    const password = field('password', 'current-password', 'パスワード');
    const err = h('div', { class: 'small', style: 'color:var(--ng);min-height:1.2em;margin-top:6px', role: 'alert' });
    const btn = h('button', { class: 'btn primary', style: 'margin-top:8px', onClick: async () => {
      if (!email.value.trim() || !password.value) {
        err.textContent = 'メールアドレスとパスワードを入れてください';
        return;
      }
      btn.disabled = true;
      err.textContent = '';
      try {
        await signIn(email.value.trim(), password.value);
        await syncNow();
        notify(syncStatus.state === 'error' ? 'ログインしましたが、同期に失敗しました: ' + syncStatus.error : 'ログインして同期しました');
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
      }
    } }, 'ログイン');
    password.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && btn.click());
    return [
      h('div', { class: 'section-title' }, '同期'),
      h('p', { class: 'muted small', style: 'margin:0' }, 'ログインすると、進捗と設定をほかの端末と共有し、クラウドにも保存します。'),
      email, password, err, btn,
    ];
  }
  const time = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const statusText = () => ({
    syncing: '同期中…',
    offline: 'オフライン（つながったら同期します）',
    error: '同期できませんでした: ' + syncStatus.error,
    idle: syncStatus.last ? '最終同期 ' + time(syncStatus.last) : '待機中',
    off: '同期していません',
  })[syncStatus.state] ?? '';
  const status = h('div', { class: 'lrow muted small', role: 'status' }, statusText());
  onLeave(onSyncStatus(() => (status.textContent = statusText())));
  return [
    h('div', { class: 'section-title' }, '同期'),
    h('div', { class: 'list' },
      h('div', { class: 'lrow' }, h('span', { class: 'grow' }, 'ログイン中'), h('span', { class: 'muted small' }, user.email)),
      status,
      action('今すぐ同期', () => syncNow()),
      action('ログアウト', async () => {
        if (!confirm('ログアウトしますか？この端末のデータは残ります。')) return;
        await signOut();
        notify('ログアウトしました');
      })),
  ];
}

async function exportBackup() {
  const d = new Date();
  const name = `korean-cards-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  const json = JSON.stringify(makeBackup());
  const file = new File([json], name, { type: 'application/json' });
  // iOS は共有シートから「ファイルに保存」できる
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
