/**
 * Free keyword signals. Best-effort — every network call falls back to empty
 * so the planner always works offline (it then uses the static seed order).
 */
import type { SeedTopic } from './topics.ts';

/** Parse the Google Suggest JSON: [query, [suggestions...], ...]. */
export function parseAutocomplete(raw: string): string[] {
  try {
    const data = JSON.parse(raw);
    const arr = data?.[1];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Fetch autocomplete suggestions for a seed phrase (India market). */
export async function autocomplete(phrase: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&gl=in&hl=en&q=${encodeURIComponent(phrase)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return [];
    return parseAutocomplete(await r.text());
  } catch {
    return [];
  }
}

/**
 * Build a per-topic signal score from autocomplete breadth: a topic whose seed
 * phrases yield more/longer suggestion lists is in more active demand. This is
 * a relative heuristic, not real volume (that's the future paid upgrade).
 */
export async function topicSignals(topics: SeedTopic[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const t of topics) {
    const lists = await Promise.all(t.searchHints.map((h) => autocomplete(h)));
    out.set(t.key, lists.reduce((sum, s) => sum + s.length, 0));
  }
  return out;
}

/** Sort topics by signal desc; ties keep original order (stable). */
export function rankTopicsBySignal(topics: SeedTopic[], signal: Map<string, number>): SeedTopic[] {
  return topics
    .map((t, i) => ({ t, i, s: signal.get(t.key) ?? 0 }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.t);
}
