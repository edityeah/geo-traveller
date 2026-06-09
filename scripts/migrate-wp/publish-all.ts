/**
 * Flip every Archived post in the Posts DB to Published. One-shot for the
 * initial migration. After this, the user manages Status by hand in Notion.
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
        filter: { property: 'Status', select: { equals: 'Archived' } },
      })
    );
    for (const p of res.results) if (isFullPage(p)) pages.push(p);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  console.log(`Publishing ${pages.length} posts...`);

  let done = 0;
  for (const p of pages) {
    await backoff(() =>
      notion.pages.update({
        page_id: p.id,
        properties: { Status: { select: { name: 'Published' } } },
      })
    );
    done++;
    if (done % 10 === 0) console.log(`  ${done}/${pages.length}`);
  }
  console.log(`Done. ${done} posts now Published.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
