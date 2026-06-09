/**
 * Orchestrator: discover trending news → pick fresh items → generate posts
 * → resolve inline images → push to Notion as drafts.
 *
 * Run: tsx --env-file-if-exists=.env scripts/agent/run.ts [count]
 */
import { Client, isFullPage } from '@notionhq/client';
import { discover } from './discover.js';
import { generatePost, type ExistingPost } from './generate.js';
import { pickCover } from './cover.js';
import { resolveInlineImages } from './inline-images.js';
import { existingSourceUrls, publishToNotion } from './publish.js';

const TARGET = Number(process.argv[2] ?? process.env.AGENT_COUNT ?? 2);

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

async function fetchExistingPosts(): Promise<ExistingPost[]> {
  const notion = new Client({ auth: process.env.NOTION_TOKEN! });
  const dbId = process.env.NOTION_DATABASE_ID!;
  const out: ExistingPost[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: 'Status', select: { equals: 'Published' } },
    });
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const props = p.properties as any;
      const title = plain(props.Title?.title);
      const slug = plain(props.Slug?.rich_text);
      if (!title || !slug) continue;
      out.push({
        title,
        slug,
        tags: (props.Tags?.multi_select ?? []).map((t: any) => t.name),
        excerpt: plain(props.Excerpt?.rich_text) || undefined,
      });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function main() {
  console.log(`[agent] Target: ${TARGET} posts this run`);

  console.log('[agent] Discovering candidates…');
  const candidates = await discover();
  console.log(`[agent] ${candidates.length} candidates found`);

  console.log('[agent] Loading existing source URLs from Notion…');
  const seen = await existingSourceUrls();
  console.log(`[agent] ${seen.size} URLs already in Notion`);

  console.log('[agent] Loading published posts for internal-link context…');
  const existingPosts = await fetchExistingPosts();
  console.log(`[agent] ${existingPosts.length} published posts available for backlinking`);

  const fresh = candidates.filter((c) => !seen.has(c.url));
  console.log(`[agent] ${fresh.length} fresh candidates after de-dup`);

  let made = 0;
  let i = 0;
  while (made < TARGET && i < fresh.length) {
    const candidate = fresh[i++];
    console.log(`\n[agent] (${made + 1}/${TARGET}) ${candidate.title}`);
    try {
      const post = await generatePost(candidate, existingPosts);
      console.log(`        → "${post.title}" (${post.body.length} chars, ${post.tags.length} tags)`);

      // Resolve inline image placeholders → real Unsplash URLs
      const bodyWithImages = await resolveInlineImages(post.body);
      const imgCount = (bodyWithImages.match(/!\[[^\]]*\]\(https?:/g) ?? []).length;
      console.log(`        inline images resolved: ${imgCount}`);

      let slug = post.slug || slugifyTitle(post.title);
      slug = slug.replace(/[^a-z0-9-]/g, '');

      const cover = await pickCover({
        candidateImageUrl: candidate.imageUrl,
        unsplashQuery: post.coverQuery,
      });
      if (cover) console.log(`        cover: ${cover.slice(0, 80)}`);

      const { url: notionUrl } = await publishToNotion(
        { ...post, slug, body: bodyWithImages },
        cover
      );
      console.log(`        published to Notion: ${notionUrl}`);
      made++;
    } catch (err: any) {
      console.warn(`        FAILED: ${err?.message ?? err}`);
    }
  }

  console.log(`\n[agent] Done. ${made} posts created.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
