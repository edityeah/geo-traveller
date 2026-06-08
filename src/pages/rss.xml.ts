import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getAllPosts, postPath } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = await getAllPosts();
  return rss({
    title: 'Geo-Traveller',
    description: 'A travel journal: places, people, and the long way around.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.publishDate,
      description: post.data.excerpt ?? '',
      link: postPath(post),
    })),
  });
}
