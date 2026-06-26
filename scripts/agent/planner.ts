import type { SeedTopic } from './topics.ts';

export type Category = 'evergreen' | 'news' | 'events';
export interface DayCounts { evergreen: number; news: number; events: number; }
export interface Quota { evergreen: number; news: number; events: number; }

// Tie-break priority: evergreen (SEO compounding) > news > events.
const PRIORITY: Category[] = ['evergreen', 'news', 'events'];

/**
 * Pick the category for this run: whichever is furthest behind its quota
 * (largest remaining count). Ties resolve by PRIORITY order. Returns null when
 * every category has met its quota today.
 */
export function chooseCategory(counts: DayCounts, quota: Quota): Category | null {
  const ranked = PRIORITY
    .map((c) => ({ c, remaining: quota[c] - counts[c] }))
    .filter((x) => x.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining || PRIORITY.indexOf(a.c) - PRIORITY.indexOf(b.c));
  return ranked.length ? ranked[0].c : null;
}

/** First seed topic (already signal-ranked) whose key is not in Notion. */
export function pickEvergreenTopic(ranked: SeedTopic[], coveredKeys: Set<string>): SeedTopic | null {
  return ranked.find((t) => !coveredKeys.has(t.key)) ?? null;
}
