/**
 * Replace ![alt](query:search terms) placeholders in the body with real
 * Unsplash image URLs. If Unsplash is unset or returns nothing, the
 * placeholder is removed (so the post doesn't show broken markup).
 */
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;

const cache = new Map<string, string | null>();

async function searchUnsplash(query: string): Promise<string | null> {
  if (!UNSPLASH_ACCESS_KEY) return null;
  if (cache.has(query)) return cache.get(query)!;
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=3&content_filter=high`;
    const r = await fetch(url, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
    if (!r.ok) {
      cache.set(query, null);
      return null;
    }
    const data = (await r.json()) as any;
    const pick = data.results?.[0]?.urls?.regular ?? null;
    cache.set(query, pick);
    return pick;
  } catch {
    cache.set(query, null);
    return null;
  }
}

export async function resolveInlineImages(body: string): Promise<string> {
  // Match ![alt text](query:short query here) — capture alt + query
  const re = /!\[([^\]]*)\]\(query:([^)]+)\)/g;
  const placeholders: { match: string; alt: string; query: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    placeholders.push({ match: m[0], alt: m[1], query: m[2].trim() });
  }
  if (placeholders.length === 0) return body;

  // Resolve in parallel
  const resolutions = await Promise.all(
    placeholders.map((p) => searchUnsplash(p.query).then((url) => ({ ...p, url })))
  );

  let out = body;
  for (const r of resolutions) {
    const replacement = r.url ? `![${r.alt}](${r.url})` : '';
    out = out.split(r.match).join(replacement);
  }
  // Clean up consecutive blank lines from removed placeholders
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
