/**
 * Idempotent pass that walks every post (any status) and strips remaining
 * WordPress shortcode/text residue from text-bearing blocks:
 *   [caption id="..." align="..." width="..."]   →  removed
 *   [/caption]                                    →  removed
 *   [fvplayer id="N"]                             →  removed
 *   !#title!# etc. WP plugin placeholders         →  removed
 *   "View this post on Instagram" stranded blocks →  deleted
 * Blocks that become empty are deleted entirely.
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const DB = process.env.NOTION_DATABASE_ID!;
const notion = new Client({ auth: NOTION_TOKEN });

const TEXT_BLOCKS = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'quote', 'callout', 'bulleted_list_item', 'numbered_list_item',
]);

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

function clean(text: string): { newText: string; shouldDelete: boolean } {
  let t = text;
  t = t.replace(/\[caption\s+[^\]]*\]/gi, '');
  t = t.replace(/\[\/caption\]/gi, '');
  t = t.replace(/\[fvplayer[^\]]*\]/gi, '');
  t = t.replace(/!#\w+!#/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return { newText: '', shouldDelete: true };
  if (/^>?\s*View this post on Instagram/i.test(t)) return { newText: '', shouldDelete: true };
  return { newText: t, shouldDelete: false };
}

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try { return await fn(); }
  catch (err: any) {
    const s = err?.status ?? err?.code;
    if (![409, 429, 502, 503, 504].includes(s) || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 16000)));
    return backoff(fn, attempt + 1);
  }
}

async function main() {
  const onlySlugs = new Set(process.argv.slice(2));
  console.log(`Filter: ${onlySlugs.size > 0 ? [...onlySlugs].join(', ') : 'all posts'}`);
  let cursor: string | undefined;
  const pages: any[] = [];
  do {
    const res = await backoff(() => notion.databases.query({ database_id: DB, start_cursor: cursor, page_size: 100 }));
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      if (onlySlugs.size > 0) {
        const slug = (p.properties as any).Slug?.rich_text?.[0]?.plain_text;
        if (!slug || !onlySlugs.has(slug)) continue;
      }
      pages.push(p);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  let updates = 0, deletes = 0;
  for (const page of pages) {
    const title = plain((page.properties as any).Title?.title);
    let bcursor: string | undefined;
    do {
      const res = await backoff(() => notion.blocks.children.list({ block_id: page.id, start_cursor: bcursor, page_size: 100 }));
      for (const b of res.results) {
        if (!isFullBlock(b)) continue;
        if (!TEXT_BLOCKS.has(b.type)) continue;
        const data = (b as any)[b.type];
        const text = plain(data?.rich_text);
        if (!text) continue;
        const { newText, shouldDelete } = clean(text);
        if (shouldDelete) {
          await backoff(() => notion.blocks.delete({ block_id: b.id }));
          deletes++;
        } else if (newText !== text) {
          await backoff(() =>
            notion.blocks.update({
              block_id: b.id,
              [b.type]: { rich_text: [{ type: 'text', text: { content: newText.slice(0, 1900) } }] },
            } as any)
          );
          updates++;
        }
      }
      bcursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (bcursor);
    process.stdout.write(`  ${title.slice(0, 60)}: ${updates} updates, ${deletes} deletes\r`);
  }
  console.log(`\nDone: ${updates} updates, ${deletes} deletes across ${pages.length} pages.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
