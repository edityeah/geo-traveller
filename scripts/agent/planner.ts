import type { SeedTopic } from './topics.ts';

export type Category = 'evergreen' | 'news';
export interface DayCounts { evergreen: number; news: number; }
export interface Quota { evergreen: number; news: number; }

/**
 * Pick the category for this run: whichever is furthest behind its quota
 * (by remaining count). Ties → evergreen first (SEO compounding priority).
 * Returns null when both quotas are already met today.
 */
export function chooseCategory(counts: DayCounts, quota: Quota): Category | null {
  const evRemain = quota.evergreen - counts.evergreen;
  const newsRemain = quota.news - counts.news;
  if (evRemain <= 0 && newsRemain <= 0) return null;
  if (evRemain <= 0) return 'news';
  if (newsRemain <= 0) return 'evergreen';
  return evRemain >= newsRemain ? 'evergreen' : 'news';
}

/** First seed topic (already signal-ranked) whose key is not in Notion. */
export function pickEvergreenTopic(ranked: SeedTopic[], coveredKeys: Set<string>): SeedTopic | null {
  return ranked.find((t) => !coveredKeys.has(t.key)) ?? null;
}
