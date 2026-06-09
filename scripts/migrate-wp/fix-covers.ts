/**
 * The migration set each page's "page cover" (the banner image at the top of
 * a Notion page) but did NOT set the Cover *database property* that our build
 * script reads from. This script copies the page cover's URL into the Cover
 * property so the cover surfaces on the site.
 */
import { Client, isFullPage } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID required');
  process.exit(1);
}
const notion = new Client({ auth: NOTION_TOKEN });

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

async function main() {
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
    for (const p of res.results) if (isFullPage(p)) pages.push(p);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`${pages.length} pages, checking covers...`);

  let updated = 0, skipped = 0;
  for (const p of pages) {
    const props = p.properties as any;
    const existingCover = props.Cover?.files?.[0];
    if (existingCover) {
      skipped++;
      continue;
    }

    // Read page-level cover (banner).
    const pageCover = p.cover;
    if (!pageCover || pageCover.type !== 'external') {
      skipped++;
      continue;
    }

    const url = pageCover.external.url;
    await backoff(() =>
      notion.pages.update({
        page_id: p.id,
        properties: {
          Cover: {
            files: [{ type: 'external', name: 'cover', external: { url } }],
          },
        },
      })
    );
    updated++;
    if (updated % 10 === 0) console.log(`  ${updated} updated...`);
  }
  console.log(`Done: ${updated} pages updated, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
