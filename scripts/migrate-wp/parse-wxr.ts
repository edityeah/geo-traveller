import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

export type WpPost = {
  title: string;
  slug: string;
  link: string;
  publishDate: string; // ISO
  status: 'publish' | 'draft' | 'private' | 'pending' | string;
  bodyHtml: string;
  excerpt: string;
  categories: string[];
  tags: string[];
  featuredImageUrl?: string;
  attachments: { id: string; url: string }[];
};

type RawItem = Record<string, any>;

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function pickText(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '#text' in v) return String(v['#text']);
  return String(v);
}

export async function parseWxr(filePath: string): Promise<WpPost[]> {
  const xml = await readFile(filePath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    cdataPropName: '__cdata',
    trimValues: false,
    processEntities: true,
    isArray: (name) => ['item', 'category', 'wp:postmeta'].includes(name),
  });
  const tree = parser.parse(xml);
  const channel = tree?.rss?.channel;
  if (!channel) throw new Error('Invalid WXR: missing rss > channel');

  const items: RawItem[] = arr(channel.item);

  // First pass: collect all attachments, indexed by post_id.
  const attachmentsById = new Map<string, { id: string; url: string }>();
  for (const it of items) {
    if (it['wp:post_type']?.__cdata === 'attachment' || it['wp:post_type'] === 'attachment') {
      const id = String(it['wp:post_id'] ?? '');
      const url = pickText(it['wp:attachment_url']);
      if (id && url) attachmentsById.set(id, { id, url });
    }
  }

  // Featured image: stored as postmeta `_thumbnail_id` -> attachment post id.
  const posts: WpPost[] = [];
  for (const it of items) {
    const type = pickText(it['wp:post_type']?.__cdata ?? it['wp:post_type']);
    if (type !== 'post') continue;

    const status = pickText(it['wp:status']?.__cdata ?? it['wp:status']) as WpPost['status'];

    const title = pickText(it.title?.__cdata ?? it.title);
    const link = pickText(it.link);
    const slug = pickText(it['wp:post_name']?.__cdata ?? it['wp:post_name']);
    const bodyHtml = pickText(
      it['content:encoded']?.__cdata ?? it['content:encoded'] ?? ''
    );
    const excerpt = pickText(
      it['excerpt:encoded']?.__cdata ?? it['excerpt:encoded'] ?? ''
    );

    // pubDate is RFC822; wp:post_date_gmt is ISO-ish. Prefer the GMT one.
    const dateGmt = pickText(
      it['wp:post_date_gmt']?.__cdata ?? it['wp:post_date_gmt']
    );
    const dateLocal = pickText(
      it['wp:post_date']?.__cdata ?? it['wp:post_date']
    );
    const pub = pickText(it.pubDate);
    const publishDate = dateGmt && dateGmt !== '0000-00-00 00:00:00'
      ? new Date(dateGmt + 'Z').toISOString()
      : dateLocal && dateLocal !== '0000-00-00 00:00:00'
      ? new Date(dateLocal).toISOString()
      : pub
      ? new Date(pub).toISOString()
      : new Date().toISOString();

    // Categories vs tags: both come through as <category domain="category|post_tag" nicename="...">
    const categories: string[] = [];
    const tags: string[] = [];
    for (const c of arr(it.category)) {
      const domain = c['@_domain'];
      const name = pickText(c.__cdata ?? c['#text'] ?? c);
      if (!name) continue;
      if (domain === 'category') categories.push(name);
      else if (domain === 'post_tag') tags.push(name);
    }

    // Featured image
    let featuredImageUrl: string | undefined;
    for (const meta of arr(it['wp:postmeta'])) {
      const key = pickText(meta['wp:meta_key']?.__cdata ?? meta['wp:meta_key']);
      if (key === '_thumbnail_id') {
        const thumbId = pickText(meta['wp:meta_value']?.__cdata ?? meta['wp:meta_value']);
        const att = attachmentsById.get(thumbId);
        if (att) featuredImageUrl = att.url;
      }
    }

    // Inline attachments referenced in body (rough heuristic: extracted later in html-to-blocks).
    const attachments: { id: string; url: string }[] = [];

    posts.push({
      title,
      slug,
      link,
      publishDate,
      status,
      bodyHtml,
      excerpt,
      categories,
      tags,
      featuredImageUrl,
      attachments,
    });
  }

  return posts;
}
