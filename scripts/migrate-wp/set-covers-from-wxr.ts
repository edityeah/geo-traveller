/**
 * Re-parse the WXR file, map each post's Original URL → featured image URL,
 * then set the Cover database property on each matching Notion page.
 *
 * Uses the database property (Files & media) instead of the page cover —
 * Notion's page-cover validation is stricter and rejected many of our URLs
 * during initial migration; database file properties accept them fine.
 */
import { Client, isFullPage } from '@notionhq/client';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { parseWxr } from './parse-wxr.js';
import { normalizeUrl } from './create-page.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID required');
  process.exit(1);
}

const WXR_PATH = process.argv[2];
if (!WXR_PATH) {
  console.error('Usage: tsx set-covers-from-wxr.ts <wxr.xml>');
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
  console.log(`Parsing ${WXR_PATH}...`);
  const wp = await parseWxr(WXR_PATH);

  // Build URL → cover URL map
  const coverByOriginalUrl = new Map<string, string>();
  for (const p of wp) {
    if (!p.featuredImageUrl) continue;
    const normalized = normalizeUrl(p.featuredImageUrl);
    if (!normalized) continue;
    coverByOriginalUrl.set(p.link, normalized);
    // Also try alternative URL formats (with/without trailing slash, http variants).
    coverByOriginalUrl.set(p.link.replace(/\/$/, ''), normalized);
    coverByOriginalUrl.set(p.link.replace('http://', 'https://'), normalized);
  }
  console.log(`Built map of ${coverByOriginalUrl.size} URL → cover entries`);

  // Fetch all Notion pages
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.databases.query({ database_id: NOTION_DATABASE_ID, start_cursor: cursor, page_size: 100 })
    );
    for (const p of res.results) if (isFullPage(p)) pages.push(p);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`Found ${pages.length} pages in Notion. Matching against WXR...`);

  let matched = 0, set = 0, missing = 0;
  for (const p of pages) {
    const props = p.properties as any;
    const originalUrl = props['Original URL']?.url;
    if (!originalUrl) continue;
    matched++;
    const cover =
      coverByOriginalUrl.get(originalUrl) ??
      coverByOriginalUrl.get(originalUrl.replace(/\/$/, '')) ??
      coverByOriginalUrl.get(originalUrl.replace('http://', 'https://'));
    if (!cover) {
      missing++;
      const title = props.Title?.title?.[0]?.plain_text ?? '(no title)';
      console.log(`  no cover in WXR: ${title}`);
      continue;
    }
    await backoff(() =>
      notion.pages.update({
        page_id: p.id,
        properties: {
          Cover: {
            files: [{ type: 'external', name: 'cover', external: { url: cover } }],
          },
        },
      })
    );
    set++;
    if (set % 10 === 0) console.log(`  ${set} covers set...`);
  }
  console.log(`\nDone: ${matched} pages had Original URL, ${set} covers set, ${missing} had no featured image in WXR.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
