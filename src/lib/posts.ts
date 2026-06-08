import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

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
