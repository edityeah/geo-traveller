/**
 * llms.txt — emerging standard for letting LLM crawlers (ChatGPT, Perplexity,
 * Claude search, etc.) understand the site structure quickly. Lists every
 * published post + page with a short summary, in plain markdown.
 *
 * Spec: https://llmstxt.org/
 */
import type { APIContext } from 'astro';
import { getAllPosts, postPath, formatDateShort } from '../lib/posts';
import { getCollection } from 'astro:content';
import { SITE } from '../lib/seo';

export async function GET(context: APIContext) {
  const posts = await getAllPosts();
  const pages = await getCollection('pages');

  const lines: string[] = [];
  lines.push(`# ${SITE.name}`);
  lines.push('');
  lines.push(`> ${SITE.description}`);
  lines.push('');
  lines.push(`Author: ${SITE.author.name} (${SITE.author.url})`);
  lines.push(`Contact: ${SITE.author.email}`);
  lines.push('');

  lines.push('## Posts');
  lines.push('');
  for (const post of posts) {
    const url = SITE.url + postPath(post);
    const date = formatDateShort(post.data.publishDate);
    const excerpt = post.data.excerpt ?? '';
    lines.push(`- [${post.data.title}](${url}) — ${date}${excerpt ? ` — ${excerpt}` : ''}`);
  }
  lines.push('');

  if (pages.length > 0) {
    lines.push('## Pages');
    lines.push('');
    for (const page of pages) {
      const url = `${SITE.url}/${page.data.slug}/`;
      lines.push(`- [${page.data.title}](${url})${page.data.description ? ` — ${page.data.description}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Sitemap');
  lines.push(`${SITE.url}/sitemap-index.xml`);
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
