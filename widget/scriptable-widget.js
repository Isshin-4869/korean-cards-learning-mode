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
// 表示するのは、アプリで選んでいる範囲の惑星・習得率・学習中の枚数・今日学習した枚数。
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

// ---- 配色（アプリのダークテーマと同じ） ----
const BG = new Color("#0E1020");
const TEXT = new Color("#ECEAF4");
const SUB = new Color("#9A98AE");
const ACCENT = new Color("#F2C94C");

const STAGES = ["ちり", "岩の星", "マグマの星", "海のある星", "緑と雲の星", "環のある星（完成）"];
const NEXT_AT = [1, 25, 50, 75, 100]; // 次の段階になる習得率（段階 0 → 1 は 1 枚でも学習すれば）

// ---- ドット絵の惑星（js/planet.js の drawPlanet をそのまま移したもの。変えるときは両方） ----
const seedOf = (name) => [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 1000 + 1;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(seed, n = 9) {
  const r = rng(seed);
  const g = Array.from({ length: n * n }, () => r());
  const v = (i, j) => g[((j % n) + n) % n * n + ((i % n) + n) % n];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

const PAL = {
  dust: ["#2A2C3A", "#3D4052", "#55596E", "#6E7389"],
  rock: ["#3A2A24", "#5A4034", "#7D5A45", "#A07A5C"],
  dark: ["#24181A", "#3A2426", "#4E3032", "#643E3E"],
  magma: ["#B8361E", "#E8642A", "#F7A53A", "#FFE07A"],
  sea: ["#14305E", "#1D4A86", "#2A68AE", "#4A8ED0"],
  land: ["#4B3A26", "#6E5534", "#93743F", "#B8955A"],
  green: ["#1E4A2E", "#2E6B3C", "#459150", "#6DB868"],
  cloud: ["#9AA6BC", "#C4CCDA", "#E6EAF2", "#FFFFFF"],
  ring: ["#7A6A4A", "#A8915F", "#D6BD7E", "#F2DCA0"],
};
const BAYER = [[0, 0.5], [0.75, 0.25]];

/** px×px の各ドットの色（"#RRGGBB"、何もないところは null） */
function planetPixels(seed, stage, px = 32) {
  const out = Array.from({ length: px * px }, () => null);
  const c = px / 2, R = px * (stage === 5 ? 0.27 : 0.36) * (stage === 0 ? 0.75 : 1);
  const n1 = noise(seed), n2 = noise(seed * 7 + 13);
  const set = (x, y, hex) => { out[y * px + x] = hex; };
  const ring = (x, y) => {
    const rx = (x + 0.5 - c) / (R * 1.8), ry = (y + 0.5 - c) / (R * 0.55);
    const d = rx * rx + ry * ry;
    return d > 0.62 && d < 1.0;
  };
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const dx = (x + 0.5 - c) / R, dy = (y + 0.5 - c) / R, d2 = dx * dx + dy * dy;
    const inPlanet = d2 <= 1;
    if (stage === 5 && ring(x, y) && (!inPlanet || y + 0.5 > c)) {
      const sh = Math.min(3, Math.max(0, Math.floor(((x + 0.5) / px) * 3 + BAYER[y % 2][x % 2])));
      set(x, y, PAL.ring[3 - sh]);
      continue;
    }
    if (!inPlanet) continue;
    const nz = Math.sqrt(1 - d2);
    const light = -0.55 * dx - 0.55 * dy + 0.65 * nz; // 左上から光
    const shade = Math.max(0, Math.min(3, Math.floor((light + 0.35) * 3 + BAYER[y % 2][x % 2])));
    const h = n1((dx + 1) * 3.2 + seed % 5, (dy + 1) * 3.2) * 0.7 + n2((dx + 1) * 6.5, (dy + 1) * 6.5) * 0.3;
    const h2 = n2((dx + 1) * 5 + 3, (dy + 1) * 4);
    let pal = PAL.dust;
    if (stage === 1) pal = h2 > 0.72 ? PAL.dark : PAL.rock;
    else if (stage === 2) pal = Math.abs(h - 0.5) < 0.06 ? PAL.magma : PAL.dark;
    else if (stage === 3) pal = h < 0.52 ? PAL.sea : PAL.land;
    else if (stage >= 4) pal = h2 > 0.7 ? PAL.cloud : h < 0.48 ? PAL.sea : PAL.green;
    set(x, y, pal[pal === PAL.magma ? 3 - Math.min(3, Math.floor(Math.abs(h - 0.5) * 50)) : shade]);
  }
  if (stage === 5) { // 小さな月
    const mx = Math.round(px * 0.84), my = Math.round(px * 0.18);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x * x + y * y <= 1) set(mx + x, my + y, x + y < 0 ? "#D8DCE6" : "#8E94A6");
  }
  return out;
}

/** 表示する大きさ（pt）に合わせて、1 ドットを整数ピクセルの四角で描く（ぼやけないように） */
function planetImage(seed, stage, sizePt) {
  const px = 32;
  const cell = Math.max(1, Math.ceil((sizePt * 3) / px));
  const ctx = new DrawContext();
  ctx.size = new Size(px * cell, px * cell);
  ctx.opaque = false;
  ctx.respectScreenScale = false;
  const pixels = planetPixels(seed, stage, px);
  const colors = {};
  for (let i = 0; i < pixels.length; i++) {
    const hex = pixels[i];
    if (!hex) continue;
    ctx.setFillColor(colors[hex] ?? (colors[hex] = new Color(hex)));
    ctx.fillRect(new Rect((i % px) * cell, Math.floor(i / px) * cell, cell, cell));
  }
  return ctx.getImage();
}

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
const jstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

function view(data) {
  const s = data.summary;
  // 「今日」は送られた日の値。日付が変われば 0 に戻す
  const today = jstDate(s.updatedAt ?? data.updatedAt ?? 0) === jstDate(Date.now()) ? s.today ?? 0 : 0;
  const stage = Math.max(0, Math.min(5, s.stage | 0));
  let next = "";
  if (!s.total) next = "範囲にカードがありません";
  else if (stage === 5) next = "この範囲の星は完成！";
  else {
    const need = Math.max(1, Math.ceil((NEXT_AT[stage] / 100) * s.total) - (stage === 0 ? 0 : s.mastered));
    next = stage === 0 ? "1枚学習すると星が生まれる" : `あと${need}枚の習得で${STAGES[stage + 1]}`;
  }
  return { range: s.range || "", pct: s.pct ?? 0, learning: s.learning ?? 0, today, stage, seed: seedOf(String(s.seed ?? "range")), next };
}

// ---- 組み立て ----
const family = config.widgetFamily ?? "medium";
const { data, stale } = await loadStats();
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
const num = (size) => Font.boldMonospacedSystemFont(size);
const staleNote = (stack) => text(stack, "前回の値", Font.systemFont(12), SUB);

if (family.startsWith("accessory")) {
  // ロック画面: 色は iOS が付けるので指定しない
  if (family === "accessoryCircular") w.addAccessoryWidgetBackground = true;
  if (!data) {
    text(w, family === "accessoryInline" ? "韓国語カード: URL 未設定" : "未設定", Font.systemFont(12));
  } else {
    const v = view(data);
    if (family === "accessoryInline") {
      text(w, `習得 ${v.pct}% · 今日 ${v.today}枚${stale ? "（前回）" : ""}`, Font.systemFont(12));
    } else if (family === "accessoryCircular") {
      const t = text(w, `${v.pct}%`, num(16));
      t.centerAlignText();
      const l = text(w, "習得", Font.systemFont(12));
      l.centerAlignText();
    } else {
      const row = w.addStack();
      row.centerAlignContent();
      text(row, String(v.today), num(26));
      row.addSpacer(8);
      const col = row.addStack();
      col.layoutVertically();
      text(col, "今日の学習", Font.systemFont(12));
      text(col, `学習中 ${v.learning}${stale ? " · 前回" : ""}`, Font.systemFont(12));
    }
  }
} else {
  w.backgroundColor = BG;
  if (!data) {
    w.setPadding(14, 14, 14, 14);
    text(w, "韓国語カード", Font.boldSystemFont(13), ACCENT);
    w.addSpacer(6);
    const m = w.addText("アプリの 設定 ▸ ウィジェット の URL を、このスクリプトの STATS_URL に貼ってください。");
    m.font = Font.systemFont(12);
    m.textColor = SUB;
  } else {
    const v = view(data);
    if (family === "small") {
      w.setPadding(10, 10, 10, 10);
      const top = w.addStack();
      top.addSpacer();
      const img = top.addImage(planetImage(v.seed, v.stage, 84));
      img.imageSize = new Size(84, 84);
      top.addSpacer();
      w.addSpacer(2);
      const row = w.addStack();
      row.addSpacer();
      text(row, `${v.pct}%`, num(20), ACCENT);
      row.addSpacer();
      if (stale) {
        const r2 = w.addStack();
        r2.addSpacer();
        staleNote(r2);
        r2.addSpacer();
      }
    } else {
      // 中（大きいサイズも同じ並び）
      w.setPadding(12, 14, 12, 14);
      const row = w.addStack();
      row.centerAlignContent();
      const img = row.addImage(planetImage(v.seed, v.stage, 120));
      img.imageSize = new Size(120, 120);
      row.addSpacer(12);
      const col = row.addStack();
      col.layoutVertically();
      text(col, `${v.range}の星`, Font.systemFont(13), SUB);
      text(col, `${v.pct}%`, num(28), ACCENT);
      text(col, `学習中 ${v.learning} · 今日 ${v.today}枚`, Font.systemFont(12), SUB);
      col.addSpacer(4);
      const n = col.addText(v.next);
      n.font = Font.systemFont(12);
      n.textColor = TEXT;
      n.lineLimit = 2;
      if (stale) {
        col.addSpacer(4);
        staleNote(col);
      }
      row.addSpacer();
    }
  }
}

if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
