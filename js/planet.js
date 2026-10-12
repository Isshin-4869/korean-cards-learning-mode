// ドット絵の惑星。習得率で段階が育つ（進捗の見える化。飾りではない）。
// 模様は名前から決まる seed で固定し、データが変わっても同じ星は同じ形のまま。

export const STAGES = ['ちり', '岩の星', 'マグマの星', '海のある星', '緑と雲の星', '環のある星（完成）'];
// 段階が上がったときの一言（index = 上がった後の段階）
export const STAGE_UP = ['', '岩ができた！', 'マグマが動きだした！', '海ができた！', '緑と雲ができた！', '環ができた！'];

/** 習得率・学習中の率（0〜100、丸めない値）→ 段階 0〜5 */
export function stageOf(mastered, learning = 0) {
  if (mastered >= 100) return 5;
  if (mastered >= 75) return 4;
  if (mastered >= 50) return 3;
  if (mastered >= 25) return 2;
  return mastered > 0 || learning > 0 ? 1 : 0;
}

/** summarize() の結果 → 段階 */
export const stageOfSummary = (s) => (s.total ? stageOf((s.mastered / s.total) * 100, (s.learning / s.total) * 100) : 0);

/**
 * 範囲の惑星の名前（seed 用）。課の組み合わせで模様が決まり、種別を切り替えても形は変わらない。
 * 1課だけなら課のタイルと同じ星にする
 */
export function rangePlanetName(rangeKey) {
  const lessons = rangeKey.split('|')[0];
  return lessons.includes(',') ? 'range:' + lessons : lessons;
}

export const seedOf = (name) => [...name].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % 1000 + 1;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 格子の値をなめらかにつないだノイズ（端はつながる）
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
  dust: ['#2A2C3A', '#3D4052', '#55596E', '#6E7389'],
  rock: ['#3A2A24', '#5A4034', '#7D5A45', '#A07A5C'],
  dark: ['#24181A', '#3A2426', '#4E3032', '#643E3E'],
  magma: ['#B8361E', '#E8642A', '#F7A53A', '#FFE07A'],
  sea: ['#14305E', '#1D4A86', '#2A68AE', '#4A8ED0'],
  land: ['#4B3A26', '#6E5534', '#93743F', '#B8955A'],
  green: ['#1E4A2E', '#2E6B3C', '#459150', '#6DB868'],
  cloud: ['#9AA6BC', '#C4CCDA', '#E6EAF2', '#FFFFFF'],
  ring: ['#7A6A4A', '#A8915F', '#D6BD7E', '#F2DCA0'],
};
const BAYER = [[0, 0.5], [0.75, 0.25]]; // 2×2 のディザで陰影を段にする

/** canvas に px×px のドットで惑星を描く */
export function drawPlanet(canvas, seed, stage, px = 32) {
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(px, px);
  const c = px / 2, R = px * (stage === 5 ? 0.27 : 0.36) * (stage === 0 ? 0.75 : 1);
  const n1 = noise(seed), n2 = noise(seed * 7 + 13);
  const set = (x, y, hex) => {
    const i = (y * px + x) * 4;
    img.data[i] = parseInt(hex.slice(1, 3), 16);
    img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i + 3] = 255;
  };
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
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x * x + y * y <= 1) set(mx + x, my + y, x + y < 0 ? '#D8DCE6' : '#8E94A6');
  }
  ctx.putImageData(img, 0, 0);
}

/** 惑星の <canvas>。size は CSS px（絵なので文字サイズには追従させない） */
export function planetCanvas(name, stage, size, px = 32) {
  const el = document.createElement('canvas');
  el.className = 'planet';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', STAGES[stage]);
  el.style.width = el.style.height = `${size}px`;
  drawPlanet(el, seedOf(name), stage, px);
  return el;
}
