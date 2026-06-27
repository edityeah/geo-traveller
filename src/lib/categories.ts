import type { Post } from './posts';
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  categoryByKey,
  categoryKeyForTags,
  type Category,
} from './category-data';

/**
 * The site's focus categories drive the magazine homepage sections, the nav,
 * card badges, and the /category/<key>/ landing pages. Definitions + matching
 * live in the framework-agnostic ./category-data so the digest script can reuse
 * them; this module adds the Astro-post wrappers.
 */
export { CATEGORIES, categoryByKey };
export type { Category };

/** The single primary category for a post (first match; Travel by default). */
export function categoryOf(post: Post): Category {
  const key = categoryKeyForTags(post.data.tags ?? []);
  return categoryByKey(key) ?? DEFAULT_CATEGORY;
}

/** All posts whose primary category is `key`, preserving input order. */
export function postsInCategory(posts: Post[], key: string): Post[] {
  return posts.filter((p) => categoryOf(p).key === key);
}
