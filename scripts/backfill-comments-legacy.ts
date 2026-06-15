/**
 * One-shot: backfill the migrated WordPress comments (src/data/wp-comments.json)
 * into the Notion Comments database. Idempotent via the "Comment ID" column.
 *
 *   NOTION_COMMENTS_DB_ID=<id> npx tsx --env-file-if-exists=.env scripts/backfill-comments-legacy.ts
 */
import { readFileSync } from 'node:fs';
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_COMMENTS_DB_ID;
if (!TOKEN || !DB) {
  console.error('NOTION_TOKEN / NOTION_COMMENTS_DB_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });

type LegacyComment = { id: string; author: string; date: string; content: string };
const rt = (s: string) => (s ? [{ type: 'text' as const, text: { content: String(s).slice(0, 2000) } }] : []);
const slugFromUrl = (url: string) => url.replace(/\/$/, '').split('/').pop() || url;

async function existingIds(): Promise<Set<string>> {
  const set = new Set<string>();
  let cursor: string | undefined;
  do {
    const r = await notion.databases.query({ database_id: DB!, start_cursor: cursor, page_size: 100 });
    for (const p of r.results as any[]) {
      const cid = p.properties['Comment ID']?.rich_text?.[0]?.plain_text;
      if (cid) set.add(cid);
    }
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return set;
}

async function main() {
  const data = JSON.parse(readFileSync('src/data/wp-comments.json', 'utf8')) as Record<string, LegacyComment[]>;
  const seen = await existingIds();
  let added = 0;
  for (const [url, comments] of Object.entries(data)) {
    const slug = slugFromUrl(url);
    for (const c of comments) {
      const commentId = `legacy:${slug}:${c.id}`;
      if (seen.has(commentId)) continue;
      const iso = /\d{4}-\d{2}-\d{2} /.test(c.date) ? c.date.replace(' ', 'T') + 'Z' : c.date;
      await notion.pages.create({
        parent: { database_id: DB! },
        properties: {
          Name: { title: rt(c.author) },
          Comment: { rich_text: rt(c.content) },
          Post: { rich_text: rt(slug) },
          Posted: { date: { start: iso } },
          Status: { select: { name: 'Approved' } }, // migrated = already approved
          'Comment ID': { rich_text: rt(commentId) },
        },
      });
      seen.add(commentId);
      added++;
    }
  }
  console.log(`✅ Backfilled ${added} legacy comment(s) into Notion.`);
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
