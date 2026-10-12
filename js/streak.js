// 連続学習の記録。days は日付（日本時間）→ { a: その日に答えた数, r: その日に復習した枚数 }

import { jstDate, DAY } from './memory.js';

export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];

const prevDate = (date) => jstDate(Date.parse(date + 'T00:00:00+09:00') - DAY / 2);
const studied = (days, date) => (days[date]?.a ?? 0) > 0;

/**
 * 連続日数。今日まだ学習していなければ、昨日までの連続（今日やれば +1）を返す。
 * best は記録全体での最長
 */
export function streakOf(days, now = Date.now()) {
  const today = jstDate(now);
  const todayDone = studied(days, today);
  let d = todayDone ? today : prevDate(today);
  let n = 0;
  while (studied(days, d)) {
    n++;
    d = prevDate(d);
  }
  let best = 0;
  let run = 0;
  let last = null;
  for (const date of Object.keys(days).filter((x) => studied(days, x)).sort()) {
    run = last && prevDate(date) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = date;
  }
  return { days: n, best: Math.max(best, n), todayDone };
}

/** 今週（月曜はじまり）の 7 日 */
export function weekOf(days, now = Date.now()) {
  const today = jstDate(now);
  const dow = (new Date(Date.parse(today + 'T00:00:00Z')).getUTCDay() + 6) % 7; // 月=0
  return WEEKDAYS.map((label, i) => {
    const date = jstDate(Date.parse(today + 'T12:00:00+09:00') + (i - dow) * DAY);
    return { label, date, done: studied(days, date), today: date === today, future: date > today };
  });
}

/** 答えたら呼ぶ（その日の回答数を 1 増やす）。review: 復習の単語を初めて答えたとき */
export function recordAnswer(days, now = Date.now(), { review = false } = {}) {
  const d = jstDate(now);
  const cur = days[d] ?? { a: 0, r: 0 };
  days[d] = { a: cur.a + 1, r: cur.r + (review ? 1 : 0) };
  return days;
}

export const reviewedToday = (days, now = Date.now()) => days[jstDate(now)]?.r ?? 0;

/** 今日の復習で単語を 1 枚答えたとき（回答数は app.js で別に数える） */
export function addReview(days, now = Date.now()) {
  const d = jstDate(now);
  const cur = days[d] ?? { a: 0, r: 0 };
  days[d] = { a: cur.a, r: cur.r + 1 };
  return days;
}
