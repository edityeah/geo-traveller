/**
 * Pick a cover image with a multi-stage fallback. Logs which path won so
 * we can debug a missing cover later.
 *
 * 1. Source article's image (RSS media:content / enclosure / first <img>).
 * 2. Source article's OG image — fetched live (slower; bigger network hit).
 * 3. Unsplash with the LLM-supplied specific query.
 * 4. Unsplash with the post's primary tag or location, broader query.
 * 5. Unsplash generic "travel photography" as last resort.
 */
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

async function imageLoads(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) return false;
    const ct = r.headers.get('content-type') ?? '';
    return ct.startsWith('image/');
  } catch {
    return false;
  }
}

async function unsplashSearch(query: string): Promise<string | undefined> {
  if (!UNSPLASH_ACCESS_KEY || !query) return undefined;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=5&content_filter=high`;
    const r = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data.results?.[0]?.urls?.regular ?? undefined;
  } catch {
    return undefined;
  }
}

async function fetchOgImage(articleUrl: string): Promise<string | undefined> {
  try {
    const r = await fetch(articleUrl, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const html = await r.text();
    const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ??
              html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export async function pickCover(opts: {
  candidateImageUrl?: string;
  candidateUrl?: string;
  unsplashQuery: string;
  fallbackQueries?: string[];
}): Promise<{ url?: string; source: string }> {
  if (opts.candidateImageUrl && (await imageLoads(opts.candidateImageUrl))) {
    return { url: opts.candidateImageUrl, source: 'rss-image' };
  }

  if (opts.candidateUrl) {
    const og = await fetchOgImage(opts.candidateUrl);
    if (og && (await imageLoads(og))) return { url: og, source: 'og-image' };
  }

  for (const q of [opts.unsplashQuery, ...(opts.fallbackQueries ?? []), 'travel photography', 'landscape travel']) {
    if (!q) continue;
    const u = await unsplashSearch(q);
    if (u) return { url: u, source: `unsplash:${q}` };
  }

  return { url: undefined, source: 'none' };
}
