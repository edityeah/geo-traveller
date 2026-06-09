/**
 * Re-import the body content of specific Notion posts from the WXR, using
 * the (fixed) html-to-blocks converter. For each target slug:
 *   1. Find the Notion page by Original URL or Slug
 *   2. Delete every existing child block
 *   3. Regenerate blocks from the WXR body
 *   4. Append the new blocks to the page (batched at 90/req)
 *
 * Loses any manual block edits on those pages — properties (title, tags,
 * cover, status, excerpt) are preserved.
 *
 * Usage: tsx scripts/migrate-wp/reimport-bodies.ts slug1 slug2 ...
 *   or:  tsx scripts/migrate-wp/reimport-bodies.ts --all-with-missing-images
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type { PageObjectResponse, BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { htmlToBlocks } from './html-to-blocks.js';
import { normalizeUrl } from './create-page.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const DB = process.env.NOTION_DATABASE_ID!;
const WXR = process.env.WXR_PATH ?? 'WordPress.2026-06-09.xml';
const BATCH = 90;

const notion = new Client({ auth: NOTION_TOKEN });

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const s = err?.status ?? err?.code;
    if (![409, 429, 502, 503, 504].includes(s) || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 16000)));
    return backoff(fn, attempt + 1);
  }
}

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}
function pickText(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('__cdata' in v) return String(v.__cdata);
    if ('#text' in v) return String(v['#text']);
  }
  return String(v);
}
function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

async function loadWxr() {
  const xml = await readFile(WXR, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    cdataPropName: '__cdata',
    trimValues: false,
    processEntities: true,
    isArray: (name) => ['item', 'category', 'wp:postmeta', 'wp:comment'].includes(name),
  });
  const tree = parser.parse(xml);
  const items = arr(tree.rss.channel.item);
  const bySlug = new Map<string, { body: string; link: string }>();
  for (const it of items) {
    if (pickText(it['wp:post_type']) !== 'post') continue;
    if (pickText(it['wp:status']) !== 'publish') continue;
    const slug = pickText(it['wp:post_name']);
    const link = pickText(it.link);
    const body = pickText(it['content:encoded']);
    bySlug.set(slug, { body, link });
  }
  return bySlug;
}

async function findPageBySlug(slug: string): Promise<PageObjectResponse | null> {
  // Try Original URL match first
  let res = await notion.databases.query({
    database_id: DB,
    filter: { property: 'Slug', rich_text: { equals: slug } },
    page_size: 1,
  });
  if (res.results.length && isFullPage(res.results[0])) return res.results[0];
  // Try truncated slug (we limit to 80 chars during slugify)
  res = await notion.databases.query({
    database_id: DB,
    filter: { property: 'Slug', rich_text: { starts_with: slug.slice(0, 80) } },
    page_size: 1,
  });
  if (res.results.length && isFullPage(res.results[0])) return res.results[0];
  return null;
}

async function fetchAllBlocks(pageId: string): Promise<BlockObjectResponse[]> {
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 })
    );
    for (const b of res.results) if (isFullBlock(b)) out.push(b);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function main() {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (slugs.length === 0) {
    console.error('Usage: tsx reimport-bodies.ts <slug> [<slug> ...]');
    process.exit(1);
  }
  if (!NOTION_TOKEN || !DB) {
    console.error('NOTION_TOKEN and NOTION_DATABASE_ID required.');
    process.exit(1);
  }

  console.log(`Loading WXR...`);
  const wxr = await loadWxr();

  for (const slug of slugs) {
    console.log(`\n=== ${slug} ===`);
    const wp = wxr.get(slug);
    if (!wp) {
      console.log(`  WXR: not found (skipping)`);
      continue;
    }
    const page = await findPageBySlug(slug);
    if (!page) {
      console.log(`  Notion: page not found (skipping)`);
      continue;
    }

    // Convert HTML body fresh.
    const warnings: string[] = [];
    const { blocks } = htmlToBlocks(wp.body);
    // Normalize URLs in image/embed blocks (same as create-page.ts).
    const cleaned = blocks
      .map((b) => {
        if (b?.type === 'image' && b.image?.type === 'external') {
          const u = normalizeUrl(b.image.external.url);
          if (!u) return null;
          b.image.external.url = u;
        }
        if (b?.type === 'embed' && b.embed?.url) {
          const u = normalizeUrl(b.embed.url);
          if (!u) return null;
          b.embed.url = u;
        }
        return b;
      })
      .filter(Boolean);

    const existing = await fetchAllBlocks(page.id);
    console.log(`  Notion: ${existing.length} existing blocks, regenerating with ${cleaned.length} new`);

    // Delete every existing top-level child.
    for (let i = 0; i < existing.length; i++) {
      await backoff(() => notion.blocks.delete({ block_id: existing[i].id }));
      if ((i + 1) % 25 === 0) console.log(`    deleted ${i + 1}/${existing.length}`);
    }

    // Append new blocks in batches.
    for (let i = 0; i < cleaned.length; i += BATCH) {
      const chunk = cleaned.slice(i, i + BATCH);
      await backoff(() =>
        notion.blocks.children.append({ block_id: page.id, children: chunk as any })
      );
      console.log(`    appended ${Math.min(i + BATCH, cleaned.length)}/${cleaned.length}`);
    }

    if (warnings.length) {
      console.log(`  Warnings:`);
      for (const w of warnings.slice(0, 5)) console.log(`    - ${w}`);
    }
  }
  console.log(`\nDone.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
