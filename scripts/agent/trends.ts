/**
 * Google Trends signal for the agent.
 *
 * Uses the public Google Trends "trending now" RSS feed (no API key, no
 * scraping) for India + the US (global proxy). Each trend carries a real
 * related news article (title + url + source) and an approx traffic figure —
 * so a trend becomes a *grounded* candidate, not a bare keyword.
 *
 * Most daily trends are NOT travel (finance, cricket, politics…), so we filter
 * hard to our beats. Two outputs:
 *   - discoverTrending(): travel-relevant trends as grounded Candidates.
 *   - trendMix(): a guardrailed daily quota tilted toward what's trending.
 *
 * Best-effort: any network/parse failure returns empty, and the agent falls
 * back to its static behaviour.
 */
import { XMLParser } from 'fast-xml-parser';
import type { Candidate } from './discover.js';

const GEOS = ['IN', 'US'];

export interface RawTrend {
  term: string;
  traffic: number;
  imageUrl?: string;
  news: { title: string; url: string; source: string }[];
}

/** "50,000+" → 50000, "1K+" → 1000. */
export function trafficToNumber(s: string): number {
  if (!s) return 0;
  const m = s.replace(/,/g, '').match(/([\d.]+)\s*([KkMm]?)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = /k/i.test(m[2]) ? 1_000 : /m/i.test(m[2]) ? 1_000_000 : 1;
  return Math.round(n * mult);
}

// Travel-beat keyword families. A trend is relevant if its term or its news
// headline hits one of these; the family also assigns the content stream.
const FOOD = ['food', 'restaurant', 'restaurants', 'cuisine', 'dish', 'recipe', 'street food', 'cafe', 'biryani', 'chef', 'michelin'];
const EXPERIENCE = ['festival', 'concert', 'event', 'expo', 'fair', 'carnival', 'tour', 'live show', 'lineup', 'fest', 'mela', 'exhibition'];
const TRAVEL = [
  'travel', 'tourism', 'tourist', 'trip', 'holiday', 'vacation', 'visa', 'passport',
  'flight', 'flights', 'airline', 'airlines', 'airport', 'airfare', 'aviation',
  'hotel', 'resort', 'beach', 'trek', 'trekking', 'hill station', 'destination',
  'itinerary', 'cruise', 'railway', 'train', 'irctc', 'expressway', 'metro',
];

export type TrendStream = 'news' | 'events';

/** Is this text travel-relevant, and which stream does it belong to? */
export function classifyTrend(text: string): { relevant: boolean; stream: TrendStream; kind?: 'food' | 'experience' } {
  const t = ` ${text.toLowerCase()} `;
  const hit = (words: string[]) => words.some((w) => t.includes(` ${w} `) || t.includes(`${w} `) || t.includes(` ${w}`));
  if (hit(FOOD)) return { relevant: true, stream: 'events', kind: 'food' };
  if (hit(EXPERIENCE)) return { relevant: true, stream: 'events', kind: 'experience' };
  if (hit(TRAVEL)) return { relevant: true, stream: 'news' };
  return { relevant: false, stream: 'news' };
}

/** Parse the Trends RSS XML into raw trends. Pure (testable). */
export function parseTrendsXml(xml: string): RawTrend[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: any;
  try { parsed = parser.parse(xml); } catch { return []; }
  const items = parsed?.rss?.channel?.item ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list.map((it: any) => {
    const rawNews = it['ht:news_item'];
    const newsArr = rawNews ? (Array.isArray(rawNews) ? rawNews : [rawNews]) : [];
    return {
      term: String(it.title ?? '').trim(),
      traffic: trafficToNumber(String(it['ht:approx_traffic'] ?? '')),
      imageUrl: it['ht:picture'] ? String(it['ht:picture']) : undefined,
      news: newsArr.map((n: any) => ({
        title: String(n['ht:news_item_title'] ?? '').trim(),
        url: String(n['ht:news_item_url'] ?? '').trim(),
        source: String(n['ht:news_item_source'] ?? '').trim(),
      })).filter((n: any) => n.title && n.url),
    } as RawTrend;
  }).filter((t) => t.term);
}

async function fetchTrends(geo: string): Promise<RawTrend[]> {
  try {
    const r = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (geo-traveller-agent)' },
    });
    if (!r.ok) return [];
    return parseTrendsXml(await r.text());
  } catch {
    return [];
  }
}

/**
 * Travel-relevant trending stories as grounded Candidates, newest/hottest
 * first. `kind` routes food/experience trends to the experiences stream;
 * undefined stays in news. Grounded in each trend's top related article.
 */
export async function discoverTrending(): Promise<Candidate[]> {
  const buckets = await Promise.all(GEOS.map((g) => fetchTrends(g)));
  const seenTerm = new Set<string>();
  const out: Candidate[] = [];
  for (const raw of buckets.flat().sort((a, b) => b.traffic - a.traffic)) {
    const key = raw.term.toLowerCase();
    if (seenTerm.has(key)) continue;
    seenTerm.add(key);
    const top = raw.news[0];
    const cls = classifyTrend(`${raw.term} ${top?.title ?? ''}`);
    if (!cls.relevant || !top) continue; // need a groundable source article
    out.push({
      title: top.title,
      summary: `Trending now (${raw.traffic.toLocaleString()}+ searches): ${raw.term}. ${top.title}`,
      url: top.url,
      source: top.source || 'Google Trends',
      imageUrl: raw.imageUrl,
      publishedAt: new Date().toISOString(),
      kind: cls.kind,
    });
  }
  return out;
}

export interface Quota { evergreen: number; news: number; events: number }

/**
 * Guardrailed daily mix: keep evergreen at its floor, split the rest between
 * news and experiences tilted by how many travel trends fall in each stream —
 * but never drop either below `floor`. No trends → the static fallback.
 */
export function trendMix(trending: Candidate[], fallback: Quota, floor = 2): Quota {
  const total = fallback.evergreen + fallback.news + fallback.events;
  const evergreen = fallback.evergreen;
  const remaining = total - evergreen;
  const expCount = trending.filter((c) => c.kind === 'food' || c.kind === 'experience').length;
  const newsCount = trending.length - expCount;
  if (newsCount + expCount === 0) return fallback;
  const maxSlot = remaining - floor;
  let news = Math.round((remaining * newsCount) / (newsCount + expCount));
  news = Math.max(floor, Math.min(maxSlot, news));
  const events = remaining - news;
  return { evergreen, news, events };
}

if (process.argv[1]?.endsWith('trends.ts')) {
  discoverTrending().then((list) => {
    console.log(`Found ${list.length} travel-relevant trends`);
    for (const c of list.slice(0, 12)) console.log(`  [${c.kind ?? 'news'}] ${c.title}  <${c.source}>`);
  });
}
