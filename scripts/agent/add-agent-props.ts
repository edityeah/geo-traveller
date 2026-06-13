/**
 * One-shot (idempotent): add the v3 agent properties to the Posts database.
 *   npx tsx --env-file-if-exists=.env scripts/agent/add-agent-props.ts
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_DATABASE_ID;
if (!TOKEN || !DB) {
  console.error('NOTION_TOKEN / NOTION_DATABASE_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });

async function main() {
  await notion.databases.update({
    database_id: DB!,
    properties: {
      'Topic Key': { rich_text: {} },
      'Content Type': {
        select: {
          options: [
            { name: 'Evergreen', color: 'green' },
            { name: 'News', color: 'blue' },
          ],
        },
      },
      QA: {
        select: {
          options: [
            { name: 'Passed', color: 'green' },
            { name: 'Flagged', color: 'orange' },
          ],
        },
      },
      'QA Notes': { rich_text: {} },
      'Last Updated': { date: {} },
    } as any,
  });
  console.log('✅ v3 agent properties present on the Posts database.');
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
