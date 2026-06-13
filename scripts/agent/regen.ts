/**
 * Regenerate a single existing draft using the v2 pipeline.
 * Takes the Notion page ID, pulls its Title + Source URL, rebuilds a
 * candidate, runs generate → inline images → cover → replaces the
 * blocks + properties on the same Notion page.
 *
 * Usage: tsx --env-file-if-exists=.env scripts/agent/regen.ts <page-id>
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type { Candidate } from './discover.js';
import { generatePost, type ExistingPost } from './generate.js';
import { resolveInlineImages, resolveCover } from './images.js';

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DB = process.env.NOTION_DATABASE_ID!;

function plain(rich: any[] | undefined): string {
  return (rich ?? []).map((r: any) => r.plain_text ?? '').join('');
}

async function fetchExistingPosts(): Promise<ExistingPost[]> {
  const out: ExistingPost[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion.databases.query({
      database_id: DB,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: 'Status', select: { equals: 'Published' } },
    });
    for (const p of r.results) {
      if (!isFullPage(p)) continue;
      const props = p.properties as any;
      const title = plain(props.Title?.title);
      const slug = plain(props.Slug?.rich_text);
      if (title && slug) {
        out.push({
          title,
          slug,
          tags: (props.Tags?.multi_select ?? []).map((t: any) => t.name),
          excerpt: plain(props.Excerpt?.rich_text) || undefined,
        });
      }
    }
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function deleteAllBlocks(pageId: string): Promise<void> {
  let cursor: string | undefined;
  const ids: string[] = [];
  do {
    const r = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 });
    for (const b of r.results) if (isFullBlock(b)) ids.push(b.id);
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
  for (const id of ids) {
    await notion.blocks.delete({ block_id: id });
  }
}

// Local copy of the same markdown→Notion converter the publish step uses.
import { publishToNotion } from './publish.js';

async function main() {
  const pageId = process.argv[2];
  if (!pageId) {
    console.error('Usage: tsx scripts/agent/regen.ts <page-id>');
    process.exit(1);
  }
  const page = await notion.pages.retrieve({ page_id: pageId });
  if (!isFullPage(page)) throw new Error('Not a full page');
  const props = page.properties as any;
  const sourceUrl = props['Source URL']?.url ?? props['Original URL']?.url;
  const title = plain(props.Title?.title);
  if (!sourceUrl) throw new Error('Page has no Source URL or Original URL — cannot regen');

  console.log(`Regenerating: ${title}`);
  console.log(`Source: ${sourceUrl}`);

  const candidate: Candidate = {
    title,
    summary: plain(props.Excerpt?.rich_text) || title,
    url: sourceUrl,
    source: new URL(sourceUrl).hostname,
    publishedAt: new Date().toISOString(),
  };

  const existing = await fetchExistingPosts();
  console.log(`Context: ${existing.length} published posts available for backlinking`);

  const post = await generatePost(candidate, existing);
  console.log(`Generated: "${post.title}"`);

  const body = await resolveInlineImages(post.body);
  const inlineImageCount = (body.match(/!\[[^\]]*\]\(https?:/g) ?? []).length;
  console.log(`Inline images: ${inlineImageCount}`);

  const coverPick = await resolveCover({
    type: 'news',
    candidateUrl: sourceUrl,
    unsplashQuery: post.coverQuery,
    fallbackQueries: [
      (post.locationName as string | undefined) ?? '',
      post.tags?.[0] ?? '',
    ].filter(Boolean),
  });
  console.log(`Cover: ${coverPick.source}`);

  // Wipe existing blocks
  await deleteAllBlocks(pageId);
  console.log('Old blocks deleted.');

  // Re-archive the existing page (archive=true), then re-create via publishToNotion?
  // Simpler: append new blocks directly + update properties on the existing page.
  // Use the same mdToBlocks logic by importing it. We'll just call publishToNotion
  // with a new page (it does pages.create), then delete the original. Cleaner.
  await notion.pages.update({ page_id: pageId, archived: true });
  console.log('Old page archived.');

  const created = await publishToNotion({ ...post, body }, coverPick.url);
  console.log(`Created replacement: ${created.url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
