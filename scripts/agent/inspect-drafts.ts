/**
 * Inspect every draft post: block count, image blocks, presence of
 * 'Source:' footer, internal-link count. Used to decide which drafts
 * need regenerating.
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DB = process.env.NOTION_DATABASE_ID!;

function plain(rich: any[] | undefined): string {
  return (rich ?? []).map((r: any) => r.plain_text ?? '').join('');
}

async function main() {
  const res = await notion.databases.query({
    database_id: DB,
    filter: { property: 'Status', select: { equals: 'Draft' } },
  });
  for (const p of res.results) {
    if (!isFullPage(p)) continue;
    const props = p.properties as any;
    const title = plain(props.Title?.title);
    console.log(`\n=== ${title}`);

    const blocks: any[] = [];
    let cursor: string | undefined;
    do {
      const r = await notion.blocks.children.list({ block_id: p.id, start_cursor: cursor, page_size: 100 });
      for (const b of r.results) if (isFullBlock(b)) blocks.push(b);
      cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
    } while (cursor);

    const types: Record<string, number> = {};
    let internalLinks = 0;
    let externalLinks = 0;
    let hasSourceLine = false;
    for (const b of blocks) {
      types[b.type] = (types[b.type] ?? 0) + 1;
      const data = (b as any)[b.type];
      const rich = data?.rich_text ?? [];
      const text = plain(rich);
      if (text && /^source\s*:/i.test(text.trim())) hasSourceLine = true;
      for (const r of rich) {
        const url = r.text?.link?.url;
        if (!url) continue;
        if (url.includes('geo-traveller.com')) internalLinks++;
        else externalLinks++;
      }
    }
    console.log('  blocks:', blocks.length, types);
    console.log('  external links:', externalLinks);
    console.log('  internal backlinks:', internalLinks);
    console.log('  has Source line:', hasSourceLine);
    console.log('  image blocks:', types.image ?? 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
