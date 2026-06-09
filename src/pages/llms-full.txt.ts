/**
 * llms-full.txt — full text of every post, concatenated. Lets an LLM crawler
 * ingest all the site content in one request without having to follow links
 * and parse HTML. Reduces hallucination, improves attribution.
 */
import type { APIContext } from 'astro';
import { getAllPosts, postPath, formatDateShort } from '../lib/posts';
import { SITE } from '../lib/seo';

export async function GET(context: APIContext) {
  const posts = await getAllPosts();

  const lines: string[] = [];
  lines.push(`# ${SITE.name} — Full Content`);
  lines.push('');
  lines.push(`> ${SITE.description}`);
  lines.push('');
  lines.push(`Author: ${SITE.author.name}`);
  lines.push(`Site: ${SITE.url}`);
  lines.push('');

  for (const post of posts) {
    const url = SITE.url + postPath(post);
    lines.push('---');
    lines.push('');
    lines.push(`# ${post.data.title}`);
    lines.push('');
    lines.push(`URL: ${url}`);
    lines.push(`Date: ${formatDateShort(post.data.publishDate)}`);
    if (post.data.locationName) lines.push(`Location: ${post.data.locationName}`);
    if (post.data.tags?.length) lines.push(`Tags: ${post.data.tags.join(', ')}`);
    if (post.data.excerpt) {
      lines.push('');
      lines.push(`Summary: ${post.data.excerpt}`);
    }
    lines.push('');
    // Use body as-is (MDX); strip the MDX-y stuff lightly.
    const body = (post.body ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
      .replace(/\s+\n/g, '\n')
      .trim();
    lines.push(body);
    lines.push('');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
