/**
 * Fetch every post from the Notion Posts database (Status = Archived) and
 * write each one as a readable Markdown file under review/<slug>.md.
 *
 * The Markdown encodes block IDs as HTML comments so a later "apply fixes"
 * pass can map edits back to Notion blocks.
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID required');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const OUT_DIR = join(process.cwd(), 'review');

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

async function fetchBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const b of res.results) if (isFullBlock(b)) out.push(b);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

function renderBlock(b: BlockObjectResponse, depth = 0): string {
  const indent = '  '.repeat(depth);
  const mark = `<!-- block:${b.id} type:${b.type} -->`;
  const data = (b as any)[b.type];
  switch (b.type) {
    case 'paragraph':
      return `${mark}\n${indent}${plain(data.rich_text)}`;
    case 'heading_1':
      return `${mark}\n# ${plain(data.rich_text)}`;
    case 'heading_2':
      return `${mark}\n## ${plain(data.rich_text)}`;
    case 'heading_3':
      return `${mark}\n### ${plain(data.rich_text)}`;
    case 'bulleted_list_item':
      return `${mark}\n${indent}- ${plain(data.rich_text)}`;
    case 'numbered_list_item':
      return `${mark}\n${indent}1. ${plain(data.rich_text)}`;
    case 'quote':
      return `${mark}\n> ${plain(data.rich_text).replace(/\n/g, '\n> ')}`;
    case 'code':
      return `${mark}\n\`\`\`${data.language ?? ''}\n${plain(data.rich_text)}\n\`\`\``;
    case 'image': {
      const src = data.type === 'external' ? data.external.url : data.file.url;
      const cap = plain(data.caption);
      return `${mark}\n![${cap || 'image'}](${src})`;
    }
    case 'embed':
      return `${mark}\n[embed: ${data.url}](${data.url})`;
    case 'video': {
      const src = data.type === 'external' ? data.external.url : data.file.url;
      return `${mark}\n[video: ${src}](${src})`;
    }
    case 'divider':
      return `${mark}\n---`;
    case 'callout':
      return `${mark}\n> ${plain(data.rich_text)}`;
    case 'bookmark':
      return `${mark}\n[${data.url}](${data.url})`;
    case 'table': {
      // Fetch children synchronously is awkward here; mark for later inspection.
      return `${mark}\n[table block — see Notion for content]`;
    }
    default:
      return `${mark}\n[unsupported block: ${b.type}]`;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: 'Status', select: { equals: 'Archived' } },
      sorts: [{ property: 'Publish Date', direction: 'ascending' }],
    });
    for (const p of res.results) if (isFullPage(p)) pages.push(p);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`Found ${pages.length} archived posts`);

  const index: string[] = ['# Review index', ''];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const props = p.properties as any;
    const title = plain(props.Title?.title) || '(untitled)';
    const slug = plain(props.Slug?.rich_text) || `post-${i}`;
    const date = props['Publish Date']?.date?.start ?? '';
    const excerpt = plain(props.Excerpt?.rich_text);
    const origUrl = props['Original URL']?.url ?? '';

    const blocks = await fetchBlocks(p.id);
    const body = blocks.map((b) => renderBlock(b)).join('\n\n');

    const md = [
      `<!-- page:${p.id} slug:${slug} -->`,
      '',
      `# ${title}`,
      '',
      `**Date:** ${date}  `,
      `**Slug:** ${slug}  `,
      `**Original:** ${origUrl}  `,
      `**Excerpt:** ${excerpt}  `,
      `**Blocks:** ${blocks.length}`,
      '',
      '---',
      '',
      body,
      '',
    ].join('\n');

    const file = join(OUT_DIR, `${String(i + 1).padStart(2, '0')}-${slug}.md`);
    await writeFile(file, md);
    console.log(`  wrote ${file} (${blocks.length} blocks)`);
    index.push(`- [${title}](./${String(i + 1).padStart(2, '0')}-${slug}.md) — ${blocks.length} blocks${excerpt ? ` — _${excerpt}_` : ''}`);
  }

  await writeFile(join(OUT_DIR, 'index.md'), index.join('\n'));
  console.log(`Wrote ${OUT_DIR}/index.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
