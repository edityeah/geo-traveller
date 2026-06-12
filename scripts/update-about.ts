/**
 * One-shot: rewrite the Notion "About" page body with the expanded
 * punchy/professional copy, and refresh its Description property.
 *
 * Production regenerates src/content/pages/ from Notion on every deploy, so
 * Notion — not the committed about.mdx — is the source of truth. Run once:
 *   npx tsx --env-file-if-exists=.env scripts/update-about.ts
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const PAGES_DB = process.env.NOTION_PAGES_DATABASE_ID;
if (!TOKEN || !PAGES_DB) {
  console.error('NOTION_TOKEN / NOTION_PAGES_DATABASE_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });

const DESCRIPTION = 'Travel writer and photographer documenting India and beyond.';

const txt = (s: string) => [{ type: 'text' as const, text: { content: s } }];

/** Rich text with mixed bold + links. parts: [content, {bold?, link?}] */
function rich(parts: Array<[string, { bold?: boolean; link?: string }?]>) {
  return parts.map(([content, opts]) => ({
    type: 'text' as const,
    text: { content, link: opts?.link ? { url: opts.link } : undefined },
    annotations: opts?.bold ? { bold: true } : undefined,
  }));
}

const para = (rt: any) => ({ object: 'block' as const, type: 'paragraph' as const, paragraph: { rich_text: rt } });
const h3 = (s: string) => ({ object: 'block' as const, type: 'heading_3' as const, heading_3: { rich_text: txt(s) } });
const bullet = (rt: any) => ({
  object: 'block' as const,
  type: 'bulleted_list_item' as const,
  bulleted_list_item: { rich_text: rt },
});

const blocks: any[] = [
  para(rich([['Aditya Chaudhari', { bold: true }], [' is a travel writer and photographer based in India.']])),
  para(txt(
    "The Geo Traveller is where I publish what I learn on the road — destination guides, travel news, and field notes from the places I actually go. The focus is India and the regions around it, written for people who'd rather plan from first-hand reporting than from a press release."
  )),
  para(txt(
    "I cover the well-trodden routes and the ones that don't make most itineraries: hill stations and high passes, old cities and new festivals, the food, the trains, and the detours worth taking. Mostly India — sometimes farther, like Bhutan."
  )),
  h3("What you'll find here"),
  bullet(rich([['Destination guides', { bold: true }], [' — researched on the ground, not rewritten from a brochure.']])),
  bullet(rich([['Geo Daily', { bold: true }], [' — short, timely dispatches on the travel news worth knowing.']])),
  bullet(rich([['Field notes', { bold: true }], [' — food, festivals, and the slow road.']])),
  h3('Work with me'),
  para(rich([
    ["I'm open to collaborations, destination features, and partnerships with brands and tourism boards. The fastest way to reach me is the "],
    // Notion's link validator requires absolute URLs (no relative paths,
    // no mailto). The email below stays plain text — remark-gfm auto-links
    // it to a mailto: on the rendered site.
    ['contact page', { link: 'https://geo-traveller.com/contact/' }],
    [' or by email at hi@geo-traveller.com.'],
  ])),
  h3('Connect'),
  bullet(rich([['Instagram — @thegeotraveller', { link: 'https://www.instagram.com/thegeotraveller/' }]])),
  bullet(rich([['LinkedIn — Aditya Chaudhari', { link: 'https://www.linkedin.com/in/adityacbcc/' }]])),
  bullet(rich([['Facebook', { link: 'http://facebook.com/thegeotraveller' }]])),
];

async function main() {
  // Find the About page.
  const res = await notion.databases.query({
    database_id: PAGES_DB!,
    filter: { property: 'Status', select: { equals: 'Published' } },
    page_size: 100,
  });
  const about = res.results.find((p: any) => {
    const t = p.properties?.Title?.title?.[0]?.plain_text?.toLowerCase() ?? '';
    const slug = p.properties?.Slug?.rich_text?.[0]?.plain_text?.toLowerCase() ?? '';
    return slug === 'about' || t === 'about';
  }) as any;
  if (!about) {
    console.error('Could not find an "About" page in the pages database.');
    process.exit(1);
  }
  console.log(`Found About page: ${about.id}`);

  // Delete existing child blocks.
  const existing = await notion.blocks.children.list({ block_id: about.id, page_size: 100 });
  for (const b of existing.results) {
    await notion.blocks.delete({ block_id: (b as any).id });
  }
  console.log(`Cleared ${existing.results.length} existing blocks.`);

  // Append new blocks (cap 100 per call; we're well under).
  await notion.blocks.children.append({ block_id: about.id, children: blocks });
  console.log(`Appended ${blocks.length} new blocks.`);

  // Refresh the Description property if present.
  try {
    await notion.pages.update({
      page_id: about.id,
      properties: { Description: { rich_text: txt(DESCRIPTION) } } as any,
    });
    console.log('Updated Description property.');
  } catch (e: any) {
    console.warn('Could not update Description property (non-fatal):', e?.message);
  }

  console.log('✅ About page updated in Notion.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
