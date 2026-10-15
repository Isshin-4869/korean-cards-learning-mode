// 設定・データ（カードデータの読み込み、バックアップ）

import { h, iconButton } from '../ui.js';
import { state, save, APP_VERSION, makeBackup, restoreBackup, resetProgress, importCardsMarkdown, useBundledCards } from '../state.js';
import { speak, speechAvailable, hasKoreanVoice, koreanVoices, voiceQuality, QUALITY_LABEL, RATES, speechPrefs, setSpeechPrefs } from '../speech.js';
import { go, rerender, onLeave } from '../router.js';
import { applyTheme } from '../theme.js';
import { firebaseConfigured, currentUser, signIn, signOut } from '../firebase.js';
import { syncNow, syncStatus, onSyncStatus } from '../sync.js';
import { pushConfigured, pushSupported, isStandalone, loadPushSettings, enablePush, disablePush, setPushHour, sendTestPush } from '../push.js';
import { widgetConfigured, loadWidgetToken, postSummary, rotateWidgetToken } from '../widget.js';

const WIDGET_HELP = 'https://github.com/Isshin-4869/korean-cards-learning-mode#ウィジェット';

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
        block('1日の復習の上限', seg('reviewLimit', [[30, '30枚'], [50, '50枚'], [100, '100枚']]), h('div', { class: 'muted small', style: 'margin-top:6px' }, '表紙の「今日の復習」で、忘れかけている単語から自動で選ぶ枚数')),
        h('div', { style: 'padding:10px 0' }, h('label', { for: 'dir' }, '出題方向'),
          h('select', { id: 'dir', class: 'field', style: 'display:block;width:100%;margin-top:8px', onChange: (e) => set('direction', e.target.value) },
            Object.entries(DIRECTIONS).map(([v, label]) => h('option', { value: v, selected: s.direction === v ? '' : null }, label)))),
        toggle('needWritten', '2回正解で習得', '記述（文型は逆向きの4択）を2回正解したら習得にする', 2, 1)),
      h('div', { class: 'section-title' }, '読み上げ'),
      h('div', { class: 'list' },
        toggle('autoSpeak', '自動読み上げ', '韓国語が出たとき・答えが韓国語のときに読み上げる'),
        ...voiceRows(rerender)),
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
      pushConfigured() ? pushSection(action) : null,
      widgetConfigured() ? widgetSection(action) : null,
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

// 通知: その日にまだ学習していなければ、決めた時刻に知らせる
function pushSection(action) {
  const title = h('div', { class: 'section-title' }, '通知');
  if (!currentUser()) return [title, h('p', { class: 'muted small', style: 'margin:0' }, '通知を使うには、上の「同期」でログインしてください。')];
  if (!pushSupported()) {
    return [title, h('p', { class: 'muted small', style: 'margin:0' }, isStandalone()
      ? 'この端末では通知を使えません（iPhone は iOS 16.4 以降が必要です）。'
      : '通知は、ホーム画面に追加したアプリから使えます（iPhone は iOS 16.4 以降）。')];
  }
  const msg = h('div', { class: 'lrow muted small', role: 'status' });
  const say = (t, ng) => {
    msg.textContent = t;
    msg.style.color = ng ? 'var(--ng)' : '';
  };
  const sw = h('input', { id: 'sw-push', type: 'checkbox', class: 'switch', role: 'switch' });
  const hour = h('select', { id: 'push-hour', class: 'field' },
    Array.from({ length: 18 }, (_, i) => i + 6).map((n) => h('option', { value: n }, `${n}:00`)));
  const test = action('テスト通知を送る', async () => {
    say('送っています…');
    try {
      const r = await sendTestPush();
      say(r.ok ? '送りました。数秒で届きます' : '送れませんでした（通知をオフにしてから、もう一度オンにしてください）', !r.ok);
    } catch (e) {
      say(e.message, true);
    }
  });
  const reflect = (on) => {
    sw.checked = on;
    hour.disabled = !on;
    test.disabled = !on;
    test.style.opacity = on ? '' : '0.4';
  };
  sw.addEventListener('change', async () => {
    const on = sw.checked;
    sw.disabled = true;
    try {
      // 通知の許可はタップの処理の中で求める必要があるので、待たずにすぐ呼ぶ
      if (on) await enablePush(Number(hour.value));
      else await disablePush();
      reflect(on);
      say(on ? `毎日 ${hour.value}:00 に、その日まだ学習していなければ知らせます` : '通知をオフにしました');
    } catch (e) {
      reflect(!on);
      say(e.message, true);
    } finally {
      sw.disabled = false;
    }
  });
  hour.addEventListener('change', async () => {
    try {
      await setPushHour(Number(hour.value));
      say(`${hour.value}:00 に変えました`);
    } catch (e) {
      say(e.message, true);
    }
  });
  loadPushSettings().then((s) => {
    hour.value = String(s.hour);
    reflect(s.enabled && Notification.permission === 'granted');
    if (Notification.permission === 'denied') say('通知が拒否されています。iPhone の設定 → 通知 → 韓国語カード で許可してください', true);
  });
  return [
    title,
    h('div', { class: 'list' },
      h('div', { class: 'lrow' },
        h('label', { class: 'grow', for: 'sw-push' }, h('div', null, '毎日のリマインダー'), h('div', { class: 'muted small' }, 'その日にまだ学習していなければ、決めた時刻に知らせます')),
        sw),
      h('div', { class: 'lrow' }, h('label', { class: 'grow', for: 'push-hour' }, '時刻'), hour),
      test,
      msg),
  ];
}

// ウィジェット（Scriptable）: 範囲の惑星と習得率をホーム画面・ロック画面に出す
function widgetSection(action) {
  const title = h('div', { class: 'section-title' }, 'ウィジェット');
  const badge = h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'アイコンの数字（学習中の枚数）は、通知を許可すると表示されます');
  if (!currentUser()) return [title, h('p', { class: 'muted small', style: 'margin:0' }, 'ウィジェットを使うには、上の「同期」でログインしてください。'), badge];
  const msg = h('div', { class: 'lrow muted small', role: 'status' });
  const say = (t, ng) => {
    msg.textContent = t;
    msg.style.color = ng ? 'var(--ng)' : '';
  };
  const body = h('div', { class: 'list' });
  const help = h('a', { class: 'lrow', href: WIDGET_HELP, target: '_blank', rel: 'noopener', style: 'color:var(--accent);text-decoration:none' }, '設定のしかた（Scriptable）');
  const fill = (url) => {
    if (!url) {
      body.replaceChildren(
        action('ウィジェットの URL を作る', async () => {
          say('作っています…');
          try {
            fill(await postSummary({ force: true }));
            say('作りました。この URL を Scriptable のスクリプトに貼ります');
          } catch (e) {
            say(e.message, true);
          }
        }),
        help, msg);
      return;
    }
    const field = h('input', { class: 'field', type: 'text', readonly: true, value: url, 'aria-label': 'ウィジェットの URL', style: 'margin-top:8px;font-size:max(16px,1rem)', onFocus: (e) => e.target.select() });
    const copy = h('button', { class: 'btn', style: 'margin-top:8px', onClick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        say('コピーしました');
      } catch {
        field.focus();
        field.select();
        field.setSelectionRange(0, url.length);
        say('選択しました。長押しでコピーしてください');
      }
    } }, 'コピー');
    body.replaceChildren(
      h('div', { style: 'padding:10px 0' }, h('div', null, 'ウィジェットに貼る URL'), field, copy),
      help,
      action('URL を作り直す', async () => {
        if (!confirm('URL を作り直しますか？今の URL を貼ったウィジェットは、新しい URL を貼り直すまで表示されなくなります。')) return;
        try {
          fill(await rotateWidgetToken());
          say('作り直しました。Scriptable の STATS_URL も貼り替えてください');
        } catch (e) {
          say(e.message, true);
        }
      }),
      msg);
  };
  loadWidgetToken().then(fill, () => fill(null));
  return [
    title,
    h('p', { class: 'muted small', style: 'margin:0 0 8px' }, '無料アプリ「Scriptable」で、選んでいる範囲の惑星と習得率をホーム画面やロック画面に出せます。'),
    body,
    badge,
  ];
}

// 読み上げの声と速さ（端末ごとに保存）。iPhone の設定で追加した「拡張」「プレミアム」の声ほど自然
const SAMPLE = '안녕하세요. 만나서 반갑습니다.';
function voiceRows(refresh) {
  if (!speechAvailable()) return [h('div', { class: 'lrow muted small' }, 'この端末では読み上げが使えません')];
  const how = 'iPhone の設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 韓国語 で「Yuna（拡張）」や「（プレミアム）」をダウンロードし、このアプリを開き直すと選べるようになります。';
  if (!hasKoreanVoice()) return [h('div', { class: 'lrow muted small' }, '韓国語の声が見つかりません。' + how)];
  const p = speechPrefs();
  const vs = koreanVoices();
  const best = Math.max(...vs.map(voiceQuality));
  return [
    h('div', { style: 'padding:10px 0' }, h('label', { for: 'voice' }, '声'),
      h('select', { id: 'voice', class: 'field', style: 'display:block;width:100%;margin-top:8px', onChange: async (e) => { await setSpeechPrefs({ voiceURI: e.target.value }); speak(SAMPLE); } },
        vs.map((v) => { const q = QUALITY_LABEL[voiceQuality(v)]; return h('option', { value: v.voiceURI, selected: v.voiceURI === p.voiceURI ? '' : null }, `${v.name}${q && !v.name.includes(q) ? `（${q}）` : ''}`); })),
      // この端末でアプリから見えている声（ダウンロードした声が出てこないときの確認用）
      h('details', { style: 'margin-top:8px' }, h('summary', { class: 'small muted', style: 'min-height:44px;display:flex;align-items:center;cursor:pointer' }, `この端末で使える韓国語の声（${vs.length}）`),
        h('div', { class: 'small muted', style: 'overflow-wrap:anywhere' }, vs.map((v) => h('div', null, `${v.name} — ${v.voiceURI}`))))),
    h('div', { style: 'padding:10px 0' }, h('div', null, '速さ'),
      h('div', { class: 'seg-ctl', style: 'margin-top:8px' }, RATES.map(([r, label]) => h('button', {
        class: 'btn', 'aria-pressed': String(Math.abs(p.rate - r) < 0.01),
        onClick: async () => { await setSpeechPrefs({ rate: r }); refresh(); speak(SAMPLE); },
      }, label)))),
    h('button', { class: 'lrow btn text', style: 'width:100%;text-align:left;padding:0;border-radius:0', onClick: () => speak(SAMPLE) }, `試す（${SAMPLE}）`),
    best < 2 ? h('div', { class: 'lrow muted small' }, 'もっと自然な声にするには：' + how) : null,
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
