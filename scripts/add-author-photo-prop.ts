/**
 * One-shot: add an "Author Photo" (Files & media) property to the Notion
 * Pages database, so the headshot can be managed from Notion. Idempotent —
 * if the property already exists, Notion leaves it as-is.
 *
 *   npx tsx --env-file-if-exists=.env scripts/add-author-photo-prop.ts
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const PAGES_DB = process.env.NOTION_PAGES_DATABASE_ID;
if (!TOKEN || !PAGES_DB) {
  console.error('NOTION_TOKEN / NOTION_PAGES_DATABASE_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });

async function main() {
  await notion.databases.update({
    database_id: PAGES_DB!,
    properties: {
      'Author Photo': { files: {} },
    } as any,
  });
  console.log('✅ "Author Photo" property is present on the Pages database.');
  console.log('   Open the About row in Notion → Author Photo → upload your headshot.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
