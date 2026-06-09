/**
 * Find trending travel/tourism stories from across the web.
 *
 * Sources:
 *  - NewsAPI (worldwide travel + tourism headlines)
 *  - Travel RSS feeds (Skift, Travel + Leisure, Lonely Planet, etc.)
 *
 * Returns deduplicated candidates with title, summary, source URL, and
 * a publish timestamp. The orchestrator filters these against what's
 * already in Notion and picks the freshest few to generate posts from.
 */
import { XMLParser } from 'fast-xml-parser';

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

export interface Candidate {
  title: string;
  summary: string;
  url: string;
  source: string;
  imageUrl?: string;
  publishedAt: string; // ISO
}

const RSS_FEEDS = [
  { name: 'Skift', url: 'https://skift.com/feed/' },
  { name: 'Travel + Leisure', url: 'https://www.travelandleisure.com/feeds/all.rss' },
  { name: 'Lonely Planet', url: 'https://www.lonelyplanet.com/news/feed' },
  { name: 'Travel Daily News', url: 'https://www.traveldailynews.com/feed/' },
  { name: 'TTG Asia', url: 'https://www.ttgasia.com/feed/' },
  { name: 'Hindustan Times Travel', url: 'https://www.hindustantimes.com/feeds/rss/lifestyle/travel/rssfeed.xml' },
];

// Keywords that mark a story as travel/tourism (broad; covers India + global).
const TRAVEL_KEYWORDS = [
  'travel', 'tourism', 'tourist', 'flight', 'airline', 'airport', 'visa',
  'hotel', 'resort', 'destination', 'cruise', 'rail', 'railway', 'trek',
  'beach', 'mountain', 'expedition', 'itinerary', 'passport', 'border',
  'festival', 'heritage', 'pilgrim', 'safari', 'wildlife', 'national park',
];

function isTravelRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return TRAVEL_KEYWORDS.some((kw) => lower.includes(kw));
}

async function fromNewsApi(): Promise<Candidate[]> {
  if (!NEWSAPI_KEY) {
    console.log('[discover] no NEWSAPI_KEY — skipping NewsAPI');
    return [];
  }
  // Worldwide travel headlines via everything endpoint (better coverage than top-headlines).
  const q = '(travel OR tourism) AND (visa OR airline OR destination OR festival OR flight OR airport)';
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=30`;
  const r = await fetch(url, { headers: { 'X-Api-Key': NEWSAPI_KEY } });
  if (!r.ok) {
    console.warn(`[discover] NewsAPI ${r.status}`);
    return [];
  }
  const data = (await r.json()) as any;
  return (data.articles ?? []).map((a: any) => ({
    title: (a.title ?? '').replace(/\s+\-\s+[^-]+$/, '').trim(),
    summary: a.description ?? '',
    url: a.url,
    source: a.source?.name ?? 'NewsAPI',
    imageUrl: a.urlToImage ?? undefined,
    publishedAt: a.publishedAt,
  })).filter((c: Candidate) => c.title && c.url);
}

async function fetchRss(feedUrl: string, sourceName: string): Promise<Candidate[]> {
  const r = await fetch(feedUrl, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
  if (!r.ok) return [];
  const xml = await r.text();
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed: any;
  try { parsed = parser.parse(xml); } catch { return []; }
  const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list.map((it: any) => {
    const title = String(it.title?.['#text'] ?? it.title ?? '').trim();
    const link = String(it.link?.['@_href'] ?? it.link ?? '').trim();
    const description = String(it.description ?? it.summary ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 400);
    const date = String(it.pubDate ?? it.published ?? it.updated ?? new Date().toISOString());
    return {
      title,
      summary: description,
      url: link,
      source: sourceName,
      publishedAt: new Date(date).toISOString(),
    } as Candidate;
  }).filter((c: Candidate) => c.title && c.url);
}

export async function discover(): Promise<Candidate[]> {
  const buckets = await Promise.all([
    fromNewsApi().catch(() => []),
    ...RSS_FEEDS.map((f) => fetchRss(f.url, f.name).catch(() => [])),
  ]);
  const flat = buckets.flat();
  // De-dupe by URL
  const seen = new Map<string, Candidate>();
  for (const c of flat) {
    if (!c.url) continue;
    if (!seen.has(c.url)) seen.set(c.url, c);
  }
  // Keep only travel-relevant (NewsAPI may include noise; RSS already filtered)
  const filtered = [...seen.values()].filter((c) =>
    isTravelRelevant(c.title + ' ' + c.summary)
  );
  // Newest first
  filtered.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return filtered;
}

if (process.argv[1]?.endsWith('discover.ts')) {
  discover().then((list) => {
    console.log(`Found ${list.length} candidates`);
    for (const c of list.slice(0, 10)) {
      console.log(`  [${c.source}] ${c.title}`);
      console.log(`     ${c.url}`);
    }
  });
}
