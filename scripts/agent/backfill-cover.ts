/**
 * For any post in the Posts DB that has no Cover but has a Source URL,
 * try to fetch the OG image from the source article and set it as Cover.
 * Falls back to Unsplash query using the post's tags / location.
 */
import { Client, isFullPage } from '@notionhq/client';
import { pickCover } from './cover.js';

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DB = process.env.NOTION_DATABASE_ID!;

function plain(rich: any[] | undefined): string {
  return (rich ?? []).map((r) => r.plain_text ?? '').join('');
}

async function main() {
  let cursor: string | undefined;
  let fixed = 0;
  do {
    const res = await notion.databases.query({
      database_id: DB,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const props = p.properties as any;
      const hasCover = (props.Cover?.files ?? []).length > 0;
      if (hasCover) continue;
      const sourceUrl = props['Source URL']?.url;
      if (!sourceUrl) continue;

      const title = plain(props.Title?.title);
      const tags: string[] = (props.Tags?.multi_select ?? []).map((t: any) => t.name);
      const locationName = plain(props['Location Name']?.rich_text);
      console.log(`Fixing: ${title}`);

      const pick = await pickCover({
        candidateUrl: sourceUrl,
        unsplashQuery: title.split(/\W+/).slice(0, 3).join(' '),
        fallbackQueries: [locationName, tags[0], tags.slice(0, 2).join(' ')].filter(Boolean) as string[],
      });
      console.log(`  → ${pick.source}${pick.url ? ': ' + pick.url.slice(0, 80) : ' (none)'}`);
      if (!pick.url) continue;

      await notion.pages.update({
        page_id: p.id,
        properties: {
          Cover: { files: [{ type: 'external', name: 'cover', external: { url: pick.url } }] },
        },
      });
      fixed++;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  console.log(`Done. ${fixed} covers backfilled.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
