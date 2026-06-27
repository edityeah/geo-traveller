import type { Post } from './posts';

/**
 * Type-led categories that drive the magazine homepage, nav, card badges, and
 * the /category/<key>/ landing pages.
 *
 * A post's category is derived purely from its tags (the post frontmatter has
 * no Content Type field). First match wins, in declaration order — so the more
 * specific buckets (News, Events, Guides) are checked before the catch-all
 * Destinations.
 */
export interface Category {
  key: string;
  label: string;
  /** Badge colours — solid background + readable foreground. */
  badge: { bg: string; fg: string };
  /** Lower-cased tag tokens that put a post in this category. */
  match: string[];
}

// Order matters: specific → general. Destinations is the default catch-all.
export const CATEGORIES: Category[] = [
  {
    key: 'news',
    label: 'News',
    badge: { bg: '#2B6E4F', fg: '#ffffff' },
    match: ['geo daily', 'geo-daily', 'news'],
  },
  {
    key: 'events',
    label: 'Events',
    badge: { bg: '#5A3E8A', fg: '#ffffff' },
    match: ['event', 'events'],
  },
  {
    key: 'guides',
    label: 'Guides',
    badge: { bg: '#8A5A1E', fg: '#ffffff' },
    match: [
      'visa', 'e-visa', 'evisa', 'passport', 'flight', 'flights', 'airport',
      'irctc', 'rail', 'railway', 'train', 'booking', 'itinerary', 'how-to',
      'how to', 'guide',
    ],
  },
  {
    key: 'festivals-food',
    label: 'Festivals & Food',
    badge: { bg: '#A33A63', fg: '#ffffff' },
    match: ['festival', 'festivals', 'food', 'cuisine', 'restaurant', 'cafe'],
  },
  {
    key: 'destinations',
    label: 'Destinations',
    badge: { bg: '#B5482B', fg: '#ffffff' },
    match: [], // catch-all
  },
];

const DEFAULT_CATEGORY = CATEGORIES[CATEGORIES.length - 1]; // Destinations

export function categoryByKey(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

/** The single primary category for a post (first match; Destinations by default). */
export function categoryOf(post: Post): Category {
  const tags = (post.data.tags ?? []).map((t) => t.toLowerCase());
  for (const cat of CATEGORIES) {
    if (cat.match.length === 0) continue; // skip the catch-all in the scan
    if (tags.some((t) => cat.match.includes(t))) return cat;
  }
  return DEFAULT_CATEGORY;
}

/** All posts whose primary category is `key`, preserving input order. */
export function postsInCategory(posts: Post[], key: string): Post[] {
  return posts.filter((p) => categoryOf(p).key === key);
}
