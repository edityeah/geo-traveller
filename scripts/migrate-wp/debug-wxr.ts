import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';

const xml = await readFile('WordPress.2026-06-09.xml', 'utf8');
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
const items = tree.rss.channel.item;

let postCount = 0, attachCount = 0;
const sample: any[] = [];
for (const it of items) {
  const type = it['wp:post_type']?.__cdata ?? it['wp:post_type'];
  if (type === 'attachment') {
    attachCount++;
    if (sample.length < 2) sample.push({ id: it['wp:post_id'], url: it['wp:attachment_url'], type });
  } else if (type === 'post') {
    postCount++;
  }
}
console.log(`Total items: ${items.length}, posts: ${postCount}, attachments: ${attachCount}`);
console.log('Sample attachments:', JSON.stringify(sample, null, 2));

// Check one post's postmeta
const firstPost = items.find((it: any) => (it['wp:post_type']?.__cdata ?? it['wp:post_type']) === 'post');
console.log('\nFirst post postmeta:', JSON.stringify(firstPost['wp:postmeta'], null, 2));
