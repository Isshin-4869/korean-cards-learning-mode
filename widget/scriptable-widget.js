// 韓国語カード — ホーム画面・ロック画面のウィジェット（Scriptable 用）
//
// 使い方
//  1. App Store で「Scriptable」（無料）を入れる
//  2. Scriptable を開いて右上の「+」→ このファイルの中身を全部貼る
//  3. 下の STATS_URL を、アプリの 設定 ▸ ウィジェット に出ている URL に書き換える（「コピー」で取れる）
//  4. 上の題名をタップして名前を「韓国語カード」にし、「完了」で保存
//  5. ホーム画面を長押し →「編集」→「ウィジェットを追加」→ Scriptable → 小 か 中 を追加
//     （ロック画面は、ロック画面を長押し →「カスタマイズ」→ ウィジェットの枠 → Scriptable）
//  6. 追加したウィジェットを長押し →「ウィジェットを編集」→ Script に「韓国語カード」を選ぶ
//
// 表示するのは、連続記録・今週学習した日・今日の復習の残り枚数・記憶の予測（7 日分）。
// アプリで学習してから数分後に届き、ウィジェットの更新は iOS の都合で 15 分〜1 時間ほどおきになる。

const STATS_URL = "ここにアプリの『ウィジェットに貼る URL』を入れる";
const APP_URL = "https://isshin-4869.github.io/korean-cards-learning-mode/";

// タップしたときの動き
//   "none"   … 何も開かない（既定）。iOS はホーム画面の Web アプリを外から起動できないため、
//              リンクにすると必ず Safari で開いてしまう
//   "app"    … ショートカット経由でホーム画面のアプリとして開く
//              ショートカットアプリで「App を開く」→「韓国語カード」が選べる場合のみ。
//              SHORTCUT_NAME の名前でショートカットを作ってから、ここを "app" にする
//   "safari" … Safari で開く
const TAP = "none";
const SHORTCUT_NAME = "韓国語カード";

// ---- 配色（アプリのライト・ダークと同じ。アクセントは 1 色） ----
const LIGHT = { bg: "#F4F3EF", text: "#1C1D1F", sub: "#66676B", fill: "#E7E5E0", accent: "#2F57C9" };
const DARK = { bg: "#161719", text: "#ECECEE", sub: "#9C9DA2", fill: "#25262A", accent: "#87A2FF" };
const color = (k) => Color.dynamic(new Color(LIGHT[k]), new Color(DARK[k]));
const BG = color("bg"), TEXT = color("text"), SUB = color("sub"), FILL = color("fill"), ACCENT = color("accent");
// グラフは画像なので、描くときの外観で色を決める
let isDark = false;
try { isDark = Device.isUsingDarkAppearance(); } catch (e) {}
const PAL = isDark ? DARK : LIGHT;

const FORGET_AT = 60; // 「忘れかけ」の線（%）。アプリの js/memory.js と同じ

// ---- データ取得（失敗したら前回の値を使う） ----
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.cacheDirectory(), "korean-cards-widget.json");

async function loadStats() {
  if (/^https:\/\//.test(STATS_URL)) {
    try {
      const req = new Request(STATS_URL);
      req.timeoutInterval = 8;
      const data = await req.loadJSON();
      if (data && data.v === 1 && data.summary) {
        fm.writeString(cachePath, JSON.stringify(data));
        return { data, stale: false };
      }
    } catch (e) { /* 圏外などは前回の値へ */ }
  }
  try {
    if (fm.fileExists(cachePath)) return { data: JSON.parse(fm.readString(cachePath)), stale: true };
  } catch (e) {}
  return { data: null, stale: false };
}

// ---- 表示用の値 ----
const DAY = 864e5;
const jstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY); // "YYYY-MM-DD" どうし
const dowOf = (date) => (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7; // 月=0
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

/** 送られた日から日付が変わっていたら、分かる範囲で今日の値に直す。v2 でなければ null */
function view(data) {
  const s = data.summary;
  if (!s || s.v !== 2) return null;
  const today = jstDate(Date.now());
  const sent = jstDate(s.updatedAt ?? data.updatedAt ?? 0);
  const gap = Math.max(0, daysBetween(sent, today));
  const st = s.streak || {};
  const rv = s.review || {};
  // 連続: 昨日に送られた値なら、昨日やっていれば続いている（今日はまだ）。2 日以上あいたら途切れ
  let streak = st.days | 0;
  if (gap === 1 && !st.todayDone) streak = 0;
  else if (gap >= 2) streak = 0;
  // 今週: 同じ週の値だけ使う。「今日」は今の曜日
  const sameWeek = daysBetween(sent, today) + dowOf(sent) < 7;
  const week = WEEKDAYS.map((l, i) => {
    const w = (s.week || [])[i] || {};
    return { l, done: sameWeek && !!w.d, today: i === dowOf(today) };
  });
  // 今日の復習: 日付が変われば今日の分は 0 から。復習どきは減らないので、送られた時点の数を目安にする
  const limit = rv.limit | 0, due = rv.due | 0;
  const done = gap ? 0 : rv.done | 0;
  const remaining = gap ? Math.min(limit, due) : rv.remaining | 0;
  // 記憶の予測: 経った日数ぶん先に進める
  const recall = (s.recall || []).slice(Math.min(gap, 7));
  return { streak, todayDone: gap === 0 && !!st.todayDone, week, remaining, done, recall, studied: s.studied | 0 };
}

const reviewText = (v, short) => {
  if (v.remaining > 0) return short ? `復習 ${v.remaining}枚` : `今日の復習 ${v.remaining}枚`;
  if (v.done > 0) return short ? "復習 おわり" : "今日の復習 おわり";
  return "復習はありません";
};

// ---- 記憶の予測のグラフ（今日〜7 日後。点は日ごと、縦は 0〜100%） ----
function recallChart(values, w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const top = 4, bottom = h - 4;
  const y = (v) => bottom - (Math.max(0, Math.min(100, v)) / 100) * (bottom - top);
  const x = (i) => 2 + (i / 7) * (w - 4);
  // 忘れかけの線（点線）とラベル
  ctx.setStrokeColor(new Color(PAL.sub, 0.6));
  ctx.setLineWidth(1);
  const yf = y(FORGET_AT);
  for (let px = 2; px < w - 2; px += 7) {
    const p = new Path();
    p.move(new Point(px, yf));
    p.addLine(new Point(Math.min(px + 3.5, w - 2), yf));
    ctx.addPath(p);
    ctx.strokePath();
  }
  ctx.setFont(Font.systemFont(12));
  ctx.setTextColor(new Color(PAL.sub));
  ctx.setTextAlignedRight();
  ctx.drawTextInRect("忘れかけ", new Rect(0, yf + 2, w - 2, 16));
  // 予測の線
  if (values.length >= 2) {
    const p = new Path();
    p.move(new Point(x(0), y(values[0])));
    for (let i = 1; i < values.length; i++) p.addLine(new Point(x(i), y(values[i])));
    ctx.setStrokeColor(new Color(PAL.accent));
    ctx.setLineWidth(2.5);
    ctx.addPath(p);
    ctx.strokePath();
  }
  return ctx.getImage();
}

// ---- 組み立て ----
const family = config.widgetFamily ?? "medium";
const { data, stale } = await loadStats();
const v = data ? view(data) : null;
const w = new ListWidget();
if (TAP === "app") w.url = "shortcuts://run-shortcut?name=" + encodeURIComponent(SHORTCUT_NAME);
else if (TAP === "safari") w.url = APP_URL;
w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);

const text = (stack, str, font, color) => {
  const t = stack.addText(str);
  t.font = font;
  if (color) t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.8;
  return t;
};
const num = (size) => Font.boldRoundedSystemFont(size);
const staleNote = (stack) => text(stack, "前回の値", Font.systemFont(12), SUB);
const streakRow = (stack, size) => {
  const row = stack.addStack();
  row.bottomAlignContent();
  text(row, String(v.streak), num(size), ACCENT);
  row.addSpacer(3);
  text(row, "日連続", Font.semiboldSystemFont(15), ACCENT);
};
// 今週の 7 日（学習した日 = アクセント、今日でまだ = 枠だけ、ほか = 薄い四角）
const weekRow = (stack) => {
  const row = stack.addStack();
  v.week.forEach((d, i) => {
    if (i) row.addSpacer(4);
    const col = row.addStack();
    col.layoutVertically();
    col.size = new Size(15, 34);
    const l = col.addStack();
    l.addSpacer();
    text(l, d.l, Font.systemFont(12), d.today ? TEXT : SUB);
    l.addSpacer();
    col.addSpacer(3);
    const box = col.addStack();
    box.size = new Size(15, 15);
    box.cornerRadius = 4;
    if (d.done) box.backgroundColor = ACCENT;
    else if (d.today) {
      box.borderColor = ACCENT;
      box.borderWidth = 1.5;
    } else box.backgroundColor = FILL;
  });
};

if (family.startsWith("accessory")) {
  // ロック画面: 色は iOS が付けるので指定しない
  if (family === "accessoryCircular") w.addAccessoryWidgetBackground = true;
  if (!v) {
    const msg = data ? "アプリを開いて更新" : "URL 未設定";
    text(w, family === "accessoryInline" ? `韓国語カード: ${msg}` : msg, Font.systemFont(12));
  } else if (family === "accessoryInline") {
    text(w, `${v.streak}日連続・${reviewText(v, true)}${stale ? "（前回）" : ""}`, Font.systemFont(12));
  } else if (family === "accessoryCircular") {
    const t = text(w, String(v.streak), num(20));
    t.centerAlignText();
    const l = text(w, "日", Font.systemFont(12));
    l.centerAlignText();
  } else {
    text(w, `${v.streak}日連続`, Font.boldSystemFont(16));
    text(w, reviewText(v, true) + (stale ? " · 前回" : ""), Font.systemFont(13));
  }
} else {
  w.backgroundColor = BG;
  w.setPadding(14, 16, 14, 16);
  if (!v) {
    text(w, "韓国語カード", Font.boldSystemFont(14), TEXT);
    w.addSpacer(6);
    const m = w.addText(data
      ? "アプリを開いて更新してください。"
      : "アプリの 設定 ▸ ウィジェット の URL を、このスクリプトの STATS_URL に貼ってください。");
    m.font = Font.systemFont(12);
    m.textColor = SUB;
  } else if (family === "small") {
    streakRow(w, 44);
    w.addSpacer();
    text(w, reviewText(v), Font.semiboldSystemFont(15), TEXT);
    if (stale) staleNote(w);
  } else {
    // 中（大きいサイズも同じ並び）
    const row = w.addStack();
    const left = row.addStack();
    left.layoutVertically();
    streakRow(left, 36);
    left.addSpacer();
    weekRow(left);
    if (stale) {
      left.addSpacer(4);
      staleNote(left);
    }
    row.addSpacer(16);
    const right = row.addStack();
    right.layoutVertically();
    text(right, reviewText(v), Font.semiboldSystemFont(15), TEXT);
    right.addSpacer();
    if (v.studied && v.recall.length >= 2) {
      const img = right.addImage(recallChart(v.recall, 150, 64));
      img.imageSize = new Size(150, 64);
      const axis = right.addStack();
      axis.size = new Size(150, 0);
      text(axis, "今日", Font.systemFont(12), SUB);
      axis.addSpacer();
      text(axis, "7日後", Font.systemFont(12), SUB);
    } else {
      const m = right.addText("学習すると記憶の予測が出ます");
      m.font = Font.systemFont(12);
      m.textColor = SUB;
    }
    row.addSpacer();
  }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
