/**
 * One-shot (run in CI): backfill native visitor comments from Cloudflare KV
 * into the Notion Comments database. Idempotent via the "Comment ID" column.
 * Requires wrangler auth (CLOUDFLARE_API_TOKEN/ACCOUNT_ID) + NOTION_TOKEN +
 * NOTION_COMMENTS_DB_ID in the environment.
 */
import { execFileSync } from 'node:child_process';
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN!;
const DB = process.env.NOTION_COMMENTS_DB_ID!;
const notion = new Client({ auth: TOKEN });

function wrangler(args: string[]): string {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024,
  });
}
const rt = (s: string) => (s ? [{ type: 'text' as const, text: { content: String(s).slice(0, 2000) } }] : []);

async function existingIds(): Promise<Set<string>> {
  const set = new Set<string>();
  let cursor: string | undefined;
  do {
    const r = await notion.databases.query({ database_id: DB, start_cursor: cursor, page_size: 100 });
    for (const p of r.results as any[]) {
      const cid = p.properties['Comment ID']?.rich_text?.[0]?.plain_text;
      if (cid) set.add(cid);
    }
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return set;
}

async function main() {
  const namespaces = JSON.parse(wrangler(['kv', 'namespace', 'list'])) as { id: string; title: string }[];
  console.log('Namespaces:', namespaces.map((n) => n.title).join(', '));
  const ns = namespaces.find((n) => /comment/i.test(n.title));
  if (!ns) { console.error('Could not find a COMMENTS namespace by title.'); process.exit(1); }
  console.log(`Using namespace: ${ns.title} (${ns.id})`);

  const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--namespace-id', ns.id, '--prefix', 'thread:', '--remote'])) as { name: string }[];
  console.log(`Found ${keys.length} comment thread(s).`);

  const seen = await existingIds();
  let added = 0;
  for (const k of keys) {
    const slug = k.name.replace(/^thread:/, '');
    let arr: any[] = [];
    try { arr = JSON.parse(wrangler(['kv', 'key', 'get', k.name, '--namespace-id', ns.id, '--remote'])); } catch { continue; }
    for (const c of arr) {
      const cid = c.id || ''; // raw id — matches what the live Function writes
      if (!cid || seen.has(cid)) continue;
      await notion.pages.create({
        parent: { database_id: DB },
        properties: {
          Name: { title: rt(c.name) },
          Comment: { rich_text: rt(c.body) },
          Post: { rich_text: rt(slug) },
          Posted: { date: { start: c.date } },
          Status: { select: { name: 'Approved' } },
          'Comment ID': { rich_text: rt(cid) },
        },
      });
      seen.add(cid);
      added++;
    }
  }
  console.log(`✅ Backfilled ${added} KV comment(s) into Notion.`);
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
