/**
 * Framework-agnostic category definitions + tag→category matching.
 *
 * Pure data/logic with NO Astro imports, so it can be used by both the site
 * (src/lib/categories.ts wraps it) and the Node digest script
 * (scripts/digest/send.ts) without pulling in astro:content.
 */
export interface Category {
  key: string;
  label: string;
  /** Badge colours — solid background + readable foreground. */
  badge: { bg: string; fg: string };
  /** Lower-cased tag tokens that put a post in this category. */
  match: string[];
}

// Order matters: specific verticals first, Travel is the catch-all.
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

export const DEFAULT_CATEGORY = CATEGORIES[CATEGORIES.length - 1]; // Travel

export function categoryByKey(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

/** The primary category KEY for a set of tags (first match; 'travel' default). */
export function categoryKeyForTags(tags: string[]): string {
  const lower = tags.map((t) => t.toLowerCase());
  for (const cat of CATEGORIES) {
    if (cat.match.length === 0) continue; // skip the catch-all in the scan
    if (lower.some((t) => cat.match.includes(t))) return cat.key;
  }
  return DEFAULT_CATEGORY.key;
}
