/**
 * Migrate the agent's previous posts: copy Original URL → Source URL,
 * then clear Original URL — only for posts whose Original URL looks like
 * a source article (not a geo-traveller.com URL).
 */
import { Client, isFullPage } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DB = process.env.NOTION_DATABASE_ID!;

async function main() {
  let cursor: string | undefined;
  let moved = 0;
  do {
    const res = await notion.databases.query({
      database_id: DB,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const props = p.properties as any;
      const original = props['Original URL']?.url;
      const source = props['Source URL']?.url;
      // Only move if Original URL is set, Source URL is empty, AND the URL
      // is NOT a geo-traveller.com link (those are real WP-migration URLs).
      if (!original || source) continue;
      if (/(?:^|\/\/)(?:www\.)?geo-traveller\.com/i.test(original)) continue;

      await notion.pages.update({
        page_id: p.id,
        properties: {
          'Source URL': { url: original },
          'Original URL': { url: null },
        },
      });
      moved++;
      const title = (props.Title?.title ?? []).map((t: any) => t.plain_text).join('');
      console.log(`  moved: ${title}`);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  console.log(`Done. ${moved} posts migrated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
