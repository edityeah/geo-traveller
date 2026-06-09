/**
 * Pull approved comments from the WXR export and write them out keyed by the
 * post's original URL. The site reads this JSON at build time and renders an
 * 'Earlier conversations' section under each post.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { dirname } from 'node:path';

type Comment = {
  id: string;
  author: string;
  authorUrl?: string;
  date: string;
  content: string;
  parentId?: string;
};

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function pickText(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('__cdata' in v) return String(v.__cdata);
    if ('#text' in v) return String(v['#text']);
  }
  return String(v);
}

function looksLikeSpam(c: Comment): boolean {
  const body = c.content;
  if (!body || body.length < 5) return true;
  if (body.length > 1500) return true;
  // Too many URLs
  const urls = (body.match(/https?:\/\//g) ?? []).length;
  if (urls >= 3) return true;
  // Author URL has spammy TLDs
  if (c.authorUrl) {
    if (/\.(tk|ru|cn|biz|info|click)\//i.test(c.authorUrl)) return true;
    if (/repuchnamas|porn|casino|viagra|crypto/i.test(c.authorUrl)) return true;
  }
  // Cyrillic-look-alike characters (common spam tactic)
  if (/[А-Яа-я]/.test(body) && !/[A-Za-z]/.test(body.slice(0, 20))) return true;
  return false;
}

async function main() {
  const xml = await readFile('WordPress.2026-06-09.xml', 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    cdataPropName: '__cdata',
    trimValues: false,
    processEntities: true,
    isArray: (name) => ['item', 'category', 'wp:postmeta', 'wp:comment'].includes(name),
  });
  const tree = parser.parse(xml);
  const items = arr(tree.rss.channel.item);

  const byLink = new Map<string, Comment[]>();
  let total = 0, kept = 0;

  for (const item of items) {
    const type = pickText(item['wp:post_type']);
    if (type !== 'post') continue;
    const link = pickText(item.link);
    if (!link) continue;

    const comments = arr(item['wp:comment']);
    for (const c of comments) {
      total++;
      const approved = pickText(c['wp:comment_approved']);
      const ctype = pickText(c['wp:comment_type']);
      if (approved !== '1') continue;
      if (ctype && ctype !== 'comment') continue; // skip pingback/trackback

      const obj: Comment = {
        id: pickText(c['wp:comment_id']),
        author: pickText(c['wp:comment_author']) || 'Anonymous',
        authorUrl: pickText(c['wp:comment_author_url']) || undefined,
        date: pickText(c['wp:comment_date_gmt']) || pickText(c['wp:comment_date']),
        content: pickText(c['wp:comment_content']),
        parentId: pickText(c['wp:comment_parent']) || undefined,
      };

      if (looksLikeSpam(obj)) continue;

      const existing = byLink.get(link) ?? [];
      existing.push(obj);
      byLink.set(link, existing);
      kept++;
    }
  }

  // Sort comments per post by date.
  for (const arr of byLink.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
  }

  const out = Object.fromEntries(byLink);
  const file = 'src/data/wp-comments.json';
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(out, null, 2));
  console.log(`Scanned ${total} comments, kept ${kept} across ${byLink.size} posts.`);
  console.log(`Wrote ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
