/**
 * Post-migration cleanup. Walks every Archived page in the Posts DB; for each
 * code block with embedded HTML, decides what proper Notion block(s) it
 * should become, and rewrites the page in place.
 *
 * Replacement strategy:
 * - WP table HTML            → Notion table block
 * - YouTube/Twitter embed    → Notion embed block (URL extracted)
 * - WP pull-quote            → Notion quote block
 * - Anything else            → leave the code block alone, log for review
 *
 * Notion's API doesn't have an "update block type" operation, so the strategy
 * is: append the replacement(s) after the code block, then delete the code
 * block. The order is preserved because Notion's blocks.children.append
 * inserts at the END; instead we use `blocks.children.append` with `after`
 * parameter so replacements land right after the target.
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { writeFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID required');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

type Replacement =
  | { kind: 'embed'; url: string }
  | { kind: 'quote'; text: string; cite?: string }
  | { kind: 'table'; rows: string[][]; hasHeader: boolean }
  | { kind: 'keep'; reason: string };

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

function decideReplacement(html: string): Replacement {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  const root = $('#r').children().first().get(0);
  if (!root) return { kind: 'keep', reason: 'empty html' };

  // Embedded tweet / YouTube
  if ($(root).hasClass('wp-block-embed')) {
    const wrapperText = $(root).find('.wp-block-embed__wrapper').text().trim();
    const url = extractEmbedUrl(wrapperText);
    if (url) return { kind: 'embed', url };
    return { kind: 'keep', reason: 'embed with no extractable URL' };
  }

  // Pull-quote
  if ($(root).hasClass('wp-block-pullquote')) {
    const $bq = $(root).find('blockquote');
    const cite = $bq.find('cite').text().trim() || undefined;
    $bq.find('cite').remove();
    const text = $bq.text().trim();
    if (!text && !cite) return { kind: 'keep', reason: 'empty pullquote' };
    return { kind: 'quote', text: text || cite || '', cite: text ? cite : undefined };
  }

  // Table (with or without figure wrapper)
  const $table = $(root).is('table') ? $(root) : $(root).find('table').first();
  if ($table.length > 0) {
    const rows: string[][] = [];
    let hasHeader = false;
    const $rows = $table.find('tr');
    $rows.each((i, tr) => {
      const cells: string[] = [];
      $(tr).find('th,td').each((_j, c) => {
        cells.push($(c).text().replace(/\s+/g, ' ').trim());
      });
      if (i === 0 && $(tr).find('th').length > 0) hasHeader = true;
      if (i === 0 && !hasHeader && $rows.length > 1) {
        // Heuristic: if every first-row cell is wrapped in <strong>, treat as header.
        const allStrong = cells.length > 0 && $(tr).find('td > strong, td > b').length === cells.length;
        if (allStrong) hasHeader = true;
      }
      rows.push(cells);
    });
    if (rows.length === 0) return { kind: 'keep', reason: 'table with no rows' };
    return { kind: 'table', rows, hasHeader };
  }

  return { kind: 'keep', reason: 'unrecognized HTML' };
}

function extractEmbedUrl(text: string): string | null {
  // YouTube short
  let m = text.match(/https?:\/\/youtu\.be\/[\w-]+/);
  if (m) return m[0];
  // YouTube long
  m = text.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:watch|embed)[^\s"']*/);
  if (m) return m[0];
  // Twitter / X
  m = text.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/\d+/);
  if (m) return m[0];
  // Instagram
  m = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel)\/[\w-]+/);
  if (m) return m[0];
  // Vimeo
  m = text.match(/https?:\/\/(?:www\.)?vimeo\.com\/\d+/);
  if (m) return m[0];
  // Generic fallback — first absolute URL
  m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m?.[0] ?? null;
}

function buildBlocks(rep: Replacement): any[] {
  switch (rep.kind) {
    case 'embed':
      return [{ object: 'block', type: 'embed', embed: { url: rep.url } }];
    case 'quote': {
      const q: any = {
        object: 'block',
        type: 'quote',
        quote: { rich_text: [{ type: 'text', text: { content: rep.text.slice(0, 1900) } }] },
      };
      const blocks = [q];
      if (rep.cite) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: '— ' + rep.cite }, annotations: { italic: true } },
            ],
          },
        });
      }
      return blocks;
    }
    case 'table': {
      const width = Math.max(...rep.rows.map((r) => r.length));
      const padded = rep.rows.map((r) => {
        const cells = [...r];
        while (cells.length < width) cells.push('');
        return cells;
      });
      return [
        {
          object: 'block',
          type: 'table',
          table: {
            table_width: width,
            has_column_header: rep.hasHeader,
            has_row_header: false,
            children: padded.map((row) => ({
              object: 'block',
              type: 'table_row',
              table_row: {
                cells: row.map((c) => [
                  { type: 'text', text: { content: c.slice(0, 1900) } },
                ]),
              },
            })),
          },
        },
      ];
    }
    case 'keep':
      return [];
  }
}

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status ?? err?.code;
    const retriable = status === 429 || status === 502 || status === 503 || status === 504;
    if (!retriable || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 16000)));
    return backoff(fn, attempt + 1);
  }
}

async function fetchBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    for (const b of res.results) if (isFullBlock(b)) out.push(b);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function processPage(page: PageObjectResponse, report: string[]): Promise<void> {
  const props = page.properties as any;
  const title = plain(props.Title?.title) || '(untitled)';
  const blocks = await fetchBlocks(page.id);

  let touched = 0;
  let kept = 0;

  for (const b of blocks) {
    if (b.type !== 'code') continue;
    const data = (b as any).code;
    if (data.language !== 'html') continue;
    const html = plain(data.rich_text);
    const rep = decideReplacement(html);
    if (rep.kind === 'keep') {
      kept++;
      report.push(`KEEP  ${title}: ${rep.reason}`);
      continue;
    }
    const replacementBlocks = buildBlocks(rep);
    if (replacementBlocks.length === 0) {
      kept++;
      continue;
    }
    // Insert replacement blocks AFTER the code block.
    await backoff(() =>
      notion.blocks.children.append({
        block_id: page.id,
        children: replacementBlocks,
        after: b.id,
      })
    );
    // Then delete the code block.
    await backoff(() => notion.blocks.delete({ block_id: b.id }));
    touched++;
    report.push(`FIX   ${title}: ${rep.kind} (${replacementBlocks.length} block${replacementBlocks.length === 1 ? '' : 's'})`);
  }

  if (touched + kept > 0) {
    console.log(`  ${title}: fixed ${touched}, kept ${kept}`);
  }
}

async function main() {
  const report: string[] = [];
  // Optional CLI args: list of slugs to limit cleanup to. Empty = all posts.
  const onlySlugs = new Set(process.argv.slice(2));
  console.log(`Fetching posts (${onlySlugs.size > 0 ? `filtering to ${onlySlugs.size} slugs` : 'all'})...`);
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
      })
    );
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
  console.log(`${pages.length} pages to scan`);

  for (const page of pages) {
    await processPage(page, report);
  }

  await writeFile('cleanup-report.txt', report.join('\n') + '\n');
  console.log(`\nWrote cleanup-report.txt (${report.length} lines)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
