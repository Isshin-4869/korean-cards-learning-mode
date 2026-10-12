// 今日の復習: 記憶の見込みが下がった単語を、全部の課から自動で選ぶ。1日の上限は設定（30 / 50 / 100）

import { dueCards } from './memory.js';
import { reviewedToday } from './streak.js';

export const REVIEW_LIMITS = [30, 50, 100];

/**
 * @returns {{ due: number, done: number, limit: number, remaining: number, cards: Card[] }}
 *   due: いま復習どきの枚数 / done: 今日もう復習した枚数 / remaining: 今日あと何枚やるか（上限まで）
 */
export function todayReview(s, now = Date.now()) {
  const limit = s.settings.reviewLimit ?? 50;
  const done = reviewedToday(s.days, now);
  const all = dueCards(s.cards, s.progress, now);
  const remaining = Math.max(0, Math.min(all.length, limit - done));
  return { due: all.length, done, limit, remaining, cards: all.slice(0, remaining) };
}
