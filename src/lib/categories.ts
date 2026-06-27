import type { Post } from './posts';

/**
 * The site's focus categories. They drive the magazine homepage sections, the
 * nav, card badges, and the /category/<key>/ landing pages.
 *
 * A post's category is derived purely from its tags (the post frontmatter has
 * no Content Type field). First match wins, in declaration order — so the more
 * specific verticals (Flights, Food, Experiences, Travel News, Guides) are
 * checked before the catch-all Travel.
 *
 * Why this order:
 *  - Flights & Airlines / Food / Experiences are dedicated verticals — a flight
 *    or food story belongs there even if it's also "news".
 *  - Travel News catches the remaining Geo-Daily news.
 *  - Guides catches evergreen how-tos (they carry no "Geo Daily" tag).
 *  - Travel is the default for destination/place stories.
 */
export interface Category {
  key: string;
  label: string;
  /** Badge colours — solid background + readable foreground. */
  badge: { bg: string; fg: string };
  /** Lower-cased tag tokens that put a post in this category. */
  match: string[];
}

export const CATEGORIES: Category[] = [
  {
    key: 'flights-airlines',
    label: 'Flights & Airlines',
    badge: { bg: '#1E5F8A', fg: '#ffffff' },
    match: ['flight', 'flights', 'airline', 'airlines', 'airport', 'airports', 'aviation'],
  },
  {
    key: 'food',
    label: 'Food',
    badge: { bg: '#A33A63', fg: '#ffffff' },
    match: ['food', 'foodie', 'restaurant', 'restaurants', 'cuisine', 'dining', 'cafe', 'street food'],
  },
  {
    key: 'experiences',
    label: 'Experiences',
    badge: { bg: '#5A3E8A', fg: '#ffffff' },
    match: ['experience', 'experiences', 'event', 'events', 'festival', 'festivals', 'concert', 'expo', 'fair', 'carnival'],
  },
  {
    key: 'travel-news',
    label: 'Travel News',
    badge: { bg: '#2B6E4F', fg: '#ffffff' },
    match: ['geo daily', 'geo-daily', 'news', 'travel news'],
  },
  {
    key: 'guides',
    label: 'Guides',
    badge: { bg: '#8A5A1E', fg: '#ffffff' },
    match: [
      'visa', 'e-visa', 'evisa', 'passport', 'irctc', 'rail', 'railway', 'train',
      'booking', 'itinerary', 'how-to', 'how to', 'guide',
    ],
  },
  {
    key: 'travel',
    label: 'Travel',
    badge: { bg: '#B5482B', fg: '#ffffff' },
    match: [], // catch-all (destinations / places)
  },
];

const DEFAULT_CATEGORY = CATEGORIES[CATEGORIES.length - 1]; // Travel

export function categoryByKey(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

/** The single primary category for a post (first match; Travel by default). */
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
