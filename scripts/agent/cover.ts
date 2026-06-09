/**
 * Pick a cover image. Prefer the source article's OG image (more relevant);
 * fall back to Unsplash for a generic-but-pretty travel photo.
 */
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

export async function pickCover(opts: {
  candidateImageUrl?: string;
  unsplashQuery: string;
}): Promise<string | undefined> {
  // 1. Source article's OG image, if it loads.
  if (opts.candidateImageUrl) {
    try {
      const r = await fetch(opts.candidateImageUrl, { method: 'HEAD' });
      if (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/')) {
        return opts.candidateImageUrl;
      }
    } catch {}
  }

  // 2. Unsplash search.
  if (UNSPLASH_ACCESS_KEY && opts.unsplashQuery) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(opts.unsplashQuery)}&orientation=landscape&per_page=5&content_filter=high`;
      const r = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
      if (r.ok) {
        const data = (await r.json()) as any;
        const pick = data.results?.[0]?.urls?.regular;
        if (pick) return pick;
      }
    } catch {}
  }

  return undefined;
}
