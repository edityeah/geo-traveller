import { getCollection, type CollectionEntry } from 'astro:content';
import readingTime from 'reading-time';

export type Post = CollectionEntry<'posts'>;

export function readMinutes(p: Post): number {
  const body = p.body ?? '';
  return Math.max(1, Math.round(readingTime(body).minutes));
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export async function getAllPosts(): Promise<Post[]> {
  const all = await getCollection('posts');
  const visible = all.filter((p) => !p.data.draft);
  visible.sort(
    (a, b) => b.data.publishDate.getTime() - a.data.publishDate.getTime()
  );
  return visible;
}

export function postSlug(p: Post): string {
  // Strip optional `notion/` subdir prefix in the id, keep just the basename.
  const base = p.id.replace(/\.(mdx?|md)$/, '');
  return p.data.slug ?? base.split('/').pop()!;
}

export function postPath(p: Post): string {
  return `/posts/${postSlug(p)}/`;
}

export function postsByTag(posts: Post[]): Map<string, Post[]> {
  const map = new Map<string, Post[]>();
  for (const p of posts) {
    for (const t of p.data.tags ?? []) {
      const arr = map.get(t) ?? [];
      arr.push(p);
      map.set(t, arr);
    }
  }
  return map;
}

export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
