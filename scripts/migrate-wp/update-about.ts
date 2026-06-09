/**
 * Replace the About page body in Notion with a version that doesn't
 * mention WordPress or "second home" or any 'site upgrade' framing.
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const PAGES_DB = process.env.NOTION_PAGES_DATABASE_ID!;
const notion = new Client({ auth: NOTION_TOKEN });

function rt(s: string, ann: any = {}): any {
  return { type: 'text', text: { content: s }, annotations: ann };
}
function link(s: string, url: string): any {
  return { type: 'text', text: { content: s, link: { url } } };
}
function para(children: any[]): any {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: children } };
}
function h2(text: string): any {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [rt(text)] } };
}
function bullet(children: any[]): any {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: children } };
}

const newBlocks: any[] = [
  para([rt('Hello! I am '), rt('Aditya', { bold: true }), rt(', all the way from India.')]),
  para([
    rt('I write about travel — the obvious trips and the obscure ones — and about anything else that catches me on the road. Mostly India, sometimes farther.'),
  ]),
  para([rt('If you find something you enjoy, sign up for the newsletter or leave a comment. Or just send a note via the contact page — I read every email.')]),
  h2('Connect'),
  bullet([link('Instagram — @thegeotraveller', 'https://www.instagram.com/thegeotraveller/')]),
  bullet([link('LinkedIn — Aditya Chaudhari', 'https://www.linkedin.com/in/adityacbcc/')]),
  bullet([link('Facebook', 'http://facebook.com/thegeotraveller')]),
  bullet([link('hi@geo-traveller.com', 'mailto:hi@geo-traveller.com')]),
];

async function main() {
  const res = await notion.databases.query({
    database_id: PAGES_DB,
    filter: { property: 'Slug', rich_text: { equals: 'about' } },
    page_size: 1,
  });
  const page = res.results[0];
  if (!page || !isFullPage(page)) throw new Error('About page not found');

  // Delete existing blocks
  const blocks = await notion.blocks.children.list({ block_id: page.id, page_size: 100 });
  for (const b of blocks.results) {
    if (!isFullBlock(b)) continue;
    await notion.blocks.delete({ block_id: b.id });
  }
  // Append new blocks
  await notion.blocks.children.append({ block_id: page.id, children: newBlocks });
  // Also clean the description
  await notion.pages.update({
    page_id: page.id,
    properties: {
      Description: { rich_text: [{ text: { content: "Hello! I am Aditya. This is my travel journal." } }] },
    },
  });
  console.log('About page updated.');
}

main().catch((e) => { console.error(e); process.exit(1); });
