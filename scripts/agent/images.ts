/**
 * Multi-source image resolver. Priority by post type; Unsplash stays as the
 * universal fallback. Folds the old cover.ts + inline-images.ts.
 *
 * Sources (free): Wikimedia Commons / Wikipedia (no key), Pexels (PEXELS_API_KEY,
 * optional), Pixabay (PIXABAY_API_KEY, optional), Unsplash (UNSPLASH_ACCESS_KEY),
 * plus the source article's image / OG image for news.
 */
const UNSPLASH = process.env.UNSPLASH_ACCESS_KEY;
const PEXELS = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;

export interface ImageSource { name: string; get: () => Promise<string | undefined>; }

/** Walk sources in order; return the first that yields a usable url. */
export async function firstHit(sources: ImageSource[]): Promise<{ url?: string; source: string }> {
  for (const s of sources) {
    try {
      const url = await s.get();
      if (url) return { url, source: s.name };
    } catch { /* skip and continue */ }
  }
  return { url: undefined, source: 'none' };
}

async function imageLoads(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch { return false; }
}

// ---- individual sources ----

/** Wikipedia REST: lead image (thumbnail) for a page title. */
export async function wikipediaImage(entity: string): Promise<string | undefined> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.originalimage?.source ?? data?.thumbnail?.source ?? undefined;
  } catch { return undefined; }
}

/** Wikimedia Commons search → first image file URL. */
export async function wikimediaImage(query: string): Promise<string | undefined> {
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url&iiurlwidth=1200&origin=*`;
    const r = await fetch(api, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    const pages = data?.query?.pages ?? {};
    const first: any = Object.values(pages)[0];
    const info = first?.imageinfo?.[0];
    return info?.thumburl ?? info?.url ?? undefined;
  } catch { return undefined; }
}

export async function pexelsImage(query: string): Promise<string | undefined> {
  if (!PEXELS || !query) return undefined;
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`,
      { headers: { Authorization: PEXELS } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.photos?.[0]?.src?.large ?? undefined;
  } catch { return undefined; }
}

export async function pixabayImage(query: string): Promise<string | undefined> {
  if (!PIXABAY || !query) return undefined;
  try {
    const r = await fetch(`https://pixabay.com/api/?key=${PIXABAY}&image_type=photo&orientation=horizontal&per_page=3&q=${encodeURIComponent(query)}`);
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.hits?.[0]?.largeImageURL ?? undefined;
  } catch { return undefined; }
}

export async function unsplashImage(query: string): Promise<string | undefined> {
  if (!UNSPLASH || !query) return undefined;
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=5&content_filter=high`,
      { headers: { Authorization: `Client-ID ${UNSPLASH}` } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.results?.[0]?.urls?.regular ?? undefined;
  } catch { return undefined; }
}

export async function ogImage(articleUrl: string): Promise<string | undefined> {
  try {
    const r = await fetch(articleUrl, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const html = await r.text();
    const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ??
              html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    return m?.[1];
  } catch { return undefined; }
}

// ---- public resolvers ----

export interface CoverOpts {
  type: 'evergreen' | 'news';
  imageEntity?: string;       // evergreen: Wikipedia/Wikimedia subject
  unsplashQuery: string;      // model-supplied specific query
  fallbackQueries?: string[];
  candidateImageUrl?: string; // news: RSS image
  candidateUrl?: string;      // news: article for OG scrape
}

/** Build the ordered source chain for a cover and return the first hit. */
export async function resolveCover(o: CoverOpts): Promise<{ url?: string; source: string }> {
  const queries = [o.unsplashQuery, ...(o.fallbackQueries ?? []), 'travel photography'].filter(Boolean);
  const wikimediaQ = o.imageEntity ?? o.unsplashQuery;
  const chain: ImageSource[] = [];

  if (o.type === 'news') {
    if (o.candidateImageUrl) chain.push({ name: 'rss-image', get: async () => (await imageLoads(o.candidateImageUrl!)) ? o.candidateImageUrl : undefined });
    if (o.candidateUrl) chain.push({ name: 'og-image', get: async () => { const u = await ogImage(o.candidateUrl!); return u && (await imageLoads(u)) ? u : undefined; } });
    if (o.imageEntity) chain.push({ name: 'wikipedia', get: () => wikipediaImage(o.imageEntity!) });
    chain.push({ name: 'pexels', get: () => pexelsImage(queries[0]) });
    chain.push({ name: 'unsplash', get: () => unsplashFirst(queries) });
  } else {
    if (o.imageEntity) {
      chain.push({ name: 'wikipedia', get: () => wikipediaImage(o.imageEntity!) });
      chain.push({ name: 'wikimedia', get: () => wikimediaImage(wikimediaQ) });
    }
    chain.push({ name: 'pexels', get: () => pexelsImage(queries[0]) });
    chain.push({ name: 'pixabay', get: () => pixabayImage(queries[0]) });
    chain.push({ name: 'unsplash', get: () => unsplashFirst(queries) });
  }
  return firstHit(chain);
}

async function unsplashFirst(queries: string[]): Promise<string | undefined> {
  for (const q of queries) { const u = await unsplashImage(q); if (u) return u; }
  return undefined;
}

/**
 * Replace ![alt](query:...) inline placeholders. For each, try Wikimedia by the
 * query first (named entities), then Unsplash. Leaves the placeholder removed if
 * nothing resolves (build pipeline also drops dead images).
 */
export async function resolveInlineImages(body: string): Promise<string> {
  const re = /!\[([^\]]*)\]\(query:([^)]+)\)/g;
  const jobs: { full: string; alt: string; query: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) jobs.push({ full: m[0], alt: m[1], query: m[2].trim() });

  let out = body;
  for (const j of jobs) {
    const url = (await wikimediaImage(j.query)) ?? (await unsplashImage(j.query));
    out = url ? out.replace(j.full, `![${j.alt}](${url})`) : out.replace(j.full, '');
  }
  return out;
}
