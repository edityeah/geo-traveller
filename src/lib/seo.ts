/**
 * Shared SEO helpers — JSON-LD builders, description fallbacks, canonical URL
 * normalization. Keep all of this here so any page (post, page, archive)
 * builds metadata the same way.
 */
import type { CollectionEntry } from 'astro:content';

export const SITE = {
  name: 'The Geo-Traveller',
  shortName: 'Geo-Traveller',
  url: 'https://geo-traveller.com',
  description:
    'A travel journal — places, people, and the long way around. Stories from India and beyond.',
  language: 'en-US',
  author: {
    name: 'Aditya Chaudhari',
    url: 'https://www.linkedin.com/in/adityacbcc/',
    email: 'hi@geo-traveller.com',
    sameAs: [
      'https://www.instagram.com/thegeotraveller/',
      'https://www.linkedin.com/in/adityacbcc/',
      'http://facebook.com/thegeotraveller',
    ],
    twitterHandle: '@thegeotraveller',
  },
  logo: '/img/brand/logo.png',
  logoSquare: '/img/brand/logo-square.png',
} as const;

export function absoluteUrl(pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return SITE.url + (pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl);
}

/**
 * If a post has no excerpt, derive one from the first ~30 words of the MDX body.
 */
export function deriveDescription(body: string | undefined, limit = 180): string {
  if (!body) return SITE.description;
  // Strip frontmatter just in case, strip MDX/HTML tags + markdown syntax.
  const cleaned = body
    .replace(/^---[\s\S]*?---/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= limit) return cleaned || SITE.description;
  // Trim at word boundary.
  return cleaned.slice(0, limit).replace(/\s+\S*$/, '') + '…';
}

/** WebSite + SearchAction — gets you the sitelinks search box on Google. */
export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    alternateName: SITE.shortName,
    url: SITE.url,
    description: SITE.description,
    inLanguage: SITE.language,
    publisher: {
      '@type': 'Person',
      name: SITE.author.name,
      url: SITE.author.url,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.url}/search/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Person — E-E-A-T signal. Goes on the About page. */
export function personLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: SITE.author.name,
    url: SITE.url + '/about/',
    image: absoluteUrl(SITE.logoSquare),
    email: SITE.author.email,
    sameAs: SITE.author.sameAs,
    jobTitle: 'Travel writer',
    description:
      "Travel writer and photographer documenting India and beyond. Writing about trips, food, festivals, and the slow road.",
  };
}

/** BlogPosting — the big one. Goes on every post. */
export function blogPostingLd(args: {
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  publishDate: Date;
  modifiedDate?: Date;
  tags: string[];
  wordCount?: number;
  readingMinutes?: number;
}) {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: args.title,
    description: args.description,
    url: args.url,
    datePublished: args.publishDate.toISOString(),
    dateModified: (args.modifiedDate ?? args.publishDate).toISOString(),
    inLanguage: SITE.language,
    keywords: args.tags.join(', '),
    author: {
      '@type': 'Person',
      name: SITE.author.name,
      url: SITE.author.url,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      logo: { '@type': 'ImageObject', url: absoluteUrl(SITE.logo) },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': args.url },
  };
  if (args.imageUrl) {
    ld.image = absoluteUrl(args.imageUrl);
  }
  if (args.wordCount) ld.wordCount = args.wordCount;
  if (args.readingMinutes) ld.timeRequired = `PT${args.readingMinutes}M`;
  return ld;
}

/** BreadcrumbList — Google shows these on search results. */
export function breadcrumbLd(crumbs: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.url),
    })),
  };
}

/** Words in a body string (used for wordCount). */
export function countWords(body: string | undefined): number {
  if (!body) return 0;
  return body.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}
