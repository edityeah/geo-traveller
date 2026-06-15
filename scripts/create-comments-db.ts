/**
 * One-shot: create a "Comments" database in Notion to mirror visitor comments
 * (which live in Cloudflare KV). Created as an unpublished holder row in the
 * Pages DB, so it shows up in Notion but never renders on the site.
 *
 *   npx tsx --env-file-if-exists=.env scripts/create-comments-db.ts
 *
 * Prints NOTION_COMMENTS_DB_ID. Reuses an existing "Comments" DB if present.
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const PAGES_DB = process.env.NOTION_PAGES_DATABASE_ID;
if (!TOKEN || !PAGES_DB) {
  console.error('NOTION_TOKEN / NOTION_PAGES_DATABASE_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });
const DB_TITLE = 'Comments';

async function main() {
  const search = await notion.search({ query: DB_TITLE, filter: { property: 'object', value: 'database' } });
  const existing = (search.results as any[]).find((d) => d.title?.[0]?.plain_text === DB_TITLE);
  if (existing) {
    console.log(`Reusing existing DB: ${existing.id}`);
    console.log(`NOTION_COMMENTS_DB_ID=${existing.id}`);
    return;
  }

  const holder: any = await notion.pages.create({
    parent: { type: 'database_id', database_id: PAGES_DB! },
    properties: {
      Title: { title: [{ type: 'text', text: { content: '💬 Comments (inbox)' } }] },
    },
  });
  console.log(`Created holder page in Pages DB: ${holder.id}`);

  const db: any = await notion.databases.create({
    parent: { type: 'page_id', page_id: holder.id },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    properties: {
      Name: { title: {} },
      Comment: { rich_text: {} },
      Post: { rich_text: {} },
      Posted: { date: {} },
      Status: {
        select: {
          options: [
            { name: 'New', color: 'blue' },
            { name: 'Approved', color: 'green' },
            { name: 'Spam', color: 'red' },
          ],
        },
      },
      'Comment ID': { rich_text: {} },
    },
  });

  console.log(`✅ Created "${DB_TITLE}" database.`);
  console.log(`NOTION_COMMENTS_DB_ID=${db.id}`);
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
