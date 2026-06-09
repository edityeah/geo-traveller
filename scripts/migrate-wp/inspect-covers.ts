import { Client, isFullPage } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const dbid = process.env.NOTION_DATABASE_ID!;

const res = await notion.databases.query({ database_id: dbid, page_size: 5 });
for (const p of res.results) {
  if (!isFullPage(p)) continue;
  const props = p.properties as any;
  const title = props.Title?.title?.[0]?.plain_text ?? '(none)';
  const coverProp = props.Cover;
  const pageCover = p.cover;
  console.log(`\n--- ${title}`);
  console.log('  page.cover:', JSON.stringify(pageCover, null, 2));
  console.log('  properties.Cover:', JSON.stringify(coverProp, null, 2));
}
