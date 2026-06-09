/**
 * One-shot seed: populate the Notion Pages database with About, Privacy,
 * and Contact entries that match what was hardcoded in src/pages/.
 * Idempotent — checks Slug before creating so re-running is safe.
 */
import { Client, isFullPage } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_PAGES_DATABASE_ID = process.env.NOTION_PAGES_DATABASE_ID!;
if (!NOTION_TOKEN || !NOTION_PAGES_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_PAGES_DATABASE_ID required');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

function rt(s: string, ann: any = {}): any {
  return { type: 'text', text: { content: s }, annotations: ann };
}
function link(s: string, url: string, ann: any = {}): any {
  return { type: 'text', text: { content: s, link: { url } }, annotations: ann };
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

const pages: Array<{
  title: string;
  slug: string;
  description: string;
  showInFooter: boolean;
  blocks: any[];
}> = [
  {
    title: 'About',
    slug: 'about',
    description: "Hello! I am Aditya. This is my travel journal.",
    showInFooter: true,
    blocks: [
      para([rt('Hello! I am '), rt('Aditya', { bold: true }), rt(', all the way from India.')]),
      para([
        rt('I began with short stories, travels, and other itsy-bitsy works on this blog, and eventually funneled down to the niches I write best about — '),
        rt('travel', { italic: true }),
        rt(' and '),
        rt('writing', { italic: true }),
        rt('.'),
      ]),
      para([
        rt('This site is the second home of '),
        rt('Geo-Traveller', { bold: true }),
        rt('. It started life on WordPress and is now a quieter, faster setup — content lives in Notion, pages get generated and pushed to a CDN automatically. The writing is the same; the plumbing got out of the way.'),
      ]),
      h2('Connect'),
      bullet([link('Instagram — @thegeotraveller', 'https://www.instagram.com/thegeotraveller/')]),
      bullet([link('LinkedIn — Aditya Chaudhari', 'https://www.linkedin.com/in/adityacbcc/')]),
      bullet([link('Facebook', 'http://facebook.com/thegeotraveller')]),
      bullet([link('hi@geo-traveller.com', 'mailto:hi@geo-traveller.com')]),
      para([
        rt('Want to work together, share a story, or just say hi? The contact page is over '),
        link('here', 'https://geo-traveller.com/contact/'),
        rt('.'),
      ]),
    ],
  },
  {
    title: 'Privacy Policy',
    slug: 'privacy',
    description: 'What data the site collects, and what it doesn\'t.',
    showInFooter: true,
    blocks: [
      para([rt('Geo-Traveller is a personal travel journal. This page describes what data the site collects.')]),
      h2('What we collect'),
      para([rt("The site is a static site served from Cloudflare's CDN. We do not run a server-side database, set tracking cookies, or collect personal information from visitors.")]),
      h2('Analytics'),
      para([rt('If analytics is enabled, we use privacy-friendly analytics that collect aggregate visit counts only — no IP addresses, no fingerprinting, no cookies.')]),
      h2('Comments and newsletter'),
      para([rt('If you choose to leave a comment (via Giscus, backed by GitHub Discussions) or subscribe to the email newsletter, the respective third party — GitHub or the newsletter provider — handles your data per their own privacy policies.')]),
      h2('Contact'),
      para([rt('Questions? Use the '), link('contact page', 'https://geo-traveller.com/contact/'), rt('.')]),
    ],
  },
  {
    title: 'Contact',
    slug: 'contact',
    description: 'How to get in touch.',
    showInFooter: true,
    blocks: [
      para([rt("If you'd like to get in touch — about a story, a collaboration, or anything else — the easiest paths are:")]),
      bullet([rt('Email: '), link('hi@geo-traveller.com', 'mailto:hi@geo-traveller.com')]),
      bullet([rt('Instagram: '), link('@thegeotraveller', 'https://instagram.com/thegeotraveller')]),
      bullet([rt('LinkedIn: '), link('Aditya Chaudhari', 'https://www.linkedin.com/in/adityacbcc/')]),
      bullet([rt('Facebook: '), link('@thegeotraveller', 'http://facebook.com/thegeotraveller')]),
    ],
  },
  {
    title: 'Terms of Service',
    slug: 'terms',
    description: 'Boring legal stuff. Use at your own risk.',
    showInFooter: true,
    blocks: [
      para([rt('Geo-Traveller is a personal blog. The content here represents the author\'s own experiences and opinions and is shared freely without warranty.')]),
      h2('Content'),
      para([rt('All written content and original photographs on this site are © Aditya Chaudhari unless otherwise noted. You\'re welcome to quote brief excerpts with attribution and a link back to the original post. For reuse beyond that, please ')]),
      para([rt('reach out via the '), link('contact page', 'https://geo-traveller.com/contact/'), rt('.')]),
      h2('Accuracy'),
      para([rt('I try to keep travel information current, but visa rules, prices, routes, and on-the-ground conditions change. Verify anything important before you plan around it.')]),
      h2('Affiliate links'),
      para([rt('If a post contains affiliate links, it\'ll be disclosed in that post. The site does not currently use programmatic ad networks.')]),
    ],
  },
];

async function main() {
  // Fetch existing slugs to avoid duplicates.
  const existingSlugs = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: NOTION_PAGES_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const slug = (p.properties as any).Slug?.rich_text?.[0]?.plain_text;
      if (slug) existingSlugs.add(slug);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  for (const page of pages) {
    if (existingSlugs.has(page.slug)) {
      console.log(`SKIP ${page.slug} — already exists`);
      continue;
    }
    await notion.pages.create({
      parent: { database_id: NOTION_PAGES_DATABASE_ID },
      properties: {
        Title: { title: [{ text: { content: page.title } }] },
        Slug: { rich_text: [{ text: { content: page.slug } }] },
        Status: { select: { name: 'Published' } },
        Description: { rich_text: [{ text: { content: page.description } }] },
        'Show in footer': { checkbox: page.showInFooter },
      },
      children: page.blocks,
    });
    console.log(`OK   ${page.slug}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
