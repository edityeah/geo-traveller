import { getCollection } from 'astro:content';

/** Shown until an "Author Photo" is uploaded to the About page in Notion. */
export const AUTHOR_PHOTO_FALLBACK = '/img/brand/logo-square.png';

let cached: string | null | undefined;

/**
 * The author headshot, managed via the Notion About page's "Author Photo"
 * property (mirrored to R2 at build time and stored in the page frontmatter).
 * Falls back to the square logo when no photo is set.
 */
export async function getAuthorPhoto(): Promise<string> {
  if (cached === undefined) {
    const pages = await getCollection('pages');
    const about = pages.find((p) => p.data.slug === 'about');
    cached = about?.data.authorPhoto ?? null;
  }
  return cached ?? AUTHOR_PHOTO_FALLBACK;
}
