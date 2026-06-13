/**
 * One-shot: create a "Contact Submissions" database in Notion as a sibling of
 * the Pages database, so contact-form submissions land in Notion.
 *
 *   npx tsx --env-file-if-exists=.env scripts/create-contact-db.ts
 *
 * Prints the new database id. If a Contact Submissions DB already exists under
 * the same parent, it reuses it instead of creating a duplicate.
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const PAGES_DB = process.env.NOTION_PAGES_DATABASE_ID;
if (!TOKEN || !PAGES_DB) {
  console.error('NOTION_TOKEN / NOTION_PAGES_DATABASE_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });

const DB_TITLE = 'Contact Submissions';

async function main() {
  // Reuse if a Contact Submissions DB already exists anywhere accessible.
  const search = await notion.search({
    query: DB_TITLE,
    filter: { property: 'object', value: 'database' },
  });
  const existing = (search.results as any[]).find(
    (d) => d.title?.[0]?.plain_text === DB_TITLE
  );
  if (existing) {
    console.log(`Reusing existing DB: ${existing.id}`);
    console.log(`NOTION_CONTACT_DB_ID=${existing.id}`);
    return;
  }

  // The integration can't reach the workspace parent, but it CAN create rows in
  // the Pages database. Create an unpublished holder page there (Status left
  // blank → buildPages skips it, so it never renders on the site) and nest the
  // Contact Submissions database inside it. It shows up as a row in your Pages
  // DB that you can open to read submissions, or drag elsewhere in Notion.
  const holder: any = await notion.pages.create({
    parent: { type: 'database_id', database_id: PAGES_DB! },
    properties: {
      Title: { title: [{ type: 'text', text: { content: '📥 Contact Submissions (inbox)' } }] },
    },
  });
  const parentPageId = holder.id;
  console.log(`Created holder page in Pages DB: ${parentPageId}`);

  const db: any = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    properties: {
      Name: { title: {} },
      Email: { email: {} },
      Subject: { rich_text: {} },
      Message: { rich_text: {} },
      Submitted: { date: {} },
      Status: {
        select: {
          options: [
            { name: 'New', color: 'red' },
            { name: 'Read', color: 'yellow' },
            { name: 'Replied', color: 'green' },
          ],
        },
      },
    },
  });

  console.log(`✅ Created "${DB_TITLE}" database.`);
  console.log(`NOTION_CONTACT_DB_ID=${db.id}`);
}

main().catch((e) => {
  console.error(e?.body ?? e);
  process.exit(1);
});
