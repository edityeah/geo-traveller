/**
 * Dump every published post's title, current excerpt, and first ~800 chars
 * of body to a JSON file. Used to feed into excerpt generation.
 */
import { writeFile } from 'node:fs/promises';
import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const DB = process.env.NOTION_DATABASE_ID!;
const notion = new Client({ auth: NOTION_TOKEN });

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const s = err?.status ?? err?.code;
    if (![429, 502, 503, 504].includes(s) || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 16000)));
    return backoff(fn, attempt + 1);
  }
}

async function fetchBlockText(blockId: string, maxChars = 800): Promise<string> {
  const parts: string[] = [];
  let cursor: string | undefined;
  let total = 0;
  do {
    const res = await backoff(() => notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 50 }));
    for (const b of res.results) {
      if (!isFullBlock(b)) continue;
      const data = (b as any)[b.type];
      let text = '';
      if (['paragraph', 'heading_1', 'heading_2', 'heading_3', 'quote', 'callout', 'bulleted_list_item', 'numbered_list_item'].includes(b.type)) {
        text = plain(data?.rich_text);
      }
      if (text) {
        parts.push(text);
        total += text.length;
        if (total >= maxChars) return parts.join(' ').slice(0, maxChars);
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return parts.join(' ').slice(0, maxChars);
}

async function main() {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.databases.query({
        database_id: DB,
        start_cursor: cursor,
        page_size: 100,
      })
    );
    for (const p of res.results) if (isFullPage(p)) pages.push(p);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  const out: any[] = [];
  for (const page of pages) {
    const props = page.properties as any;
    const title = plain(props.Title?.title);
    const excerpt = plain(props.Excerpt?.rich_text);
    const slug = plain(props.Slug?.rich_text);
    const tags = (props.Tags?.multi_select ?? []).map((t: any) => t.name);
    const location = plain(props['Location Name']?.rich_text);
    const body = await fetchBlockText(page.id, 800);
    out.push({ id: page.id, title, slug, excerpt, tags, location, body });
    console.log(`  ${excerpt ? 'HAS  ' : 'NEED '}${title}`);
  }

  await writeFile('posts-for-excerpt.json', JSON.stringify(out, null, 2));
  const needs = out.filter((p) => !p.excerpt.trim());
  console.log(`\nTotal: ${out.length}, needs excerpt: ${needs.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
