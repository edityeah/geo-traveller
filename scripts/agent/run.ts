/**
 * Orchestrator: discover trending news → pick fresh items → generate posts
 * → push to Notion as drafts.
 *
 * Run: tsx --env-file-if-exists=.env scripts/agent/run.ts [count]
 * Defaults to 2 posts per run. Cron should fire 2-3 times a day.
 */
import { discover } from './discover.js';
import { generatePost } from './generate.js';
import { pickCover } from './cover.js';
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

async function main() {
  console.log(`[agent] Target: ${TARGET} posts this run`);

  console.log('[agent] Discovering candidates…');
  const candidates = await discover();
  console.log(`[agent] ${candidates.length} candidates found`);

  console.log('[agent] Loading existing source URLs from Notion…');
  const seen = await existingSourceUrls();
  console.log(`[agent] ${seen.size} URLs already in Notion`);

  const fresh = candidates.filter((c) => !seen.has(c.url));
  console.log(`[agent] ${fresh.length} fresh candidates after de-dup`);

  let made = 0;
  let i = 0;
  while (made < TARGET && i < fresh.length) {
    const candidate = fresh[i++];
    console.log(`\n[agent] (${made + 1}/${TARGET}) ${candidate.title}`);
    try {
      const post = await generatePost(candidate);
      console.log(`        → "${post.title}" (${post.body.length} chars, ${post.tags.length} tags)`);

      // Slug collision check — if duplicate, append a short hash.
      let slug = post.slug || slugifyTitle(post.title);
      slug = slug.replace(/[^a-z0-9-]/g, '');

      const cover = await pickCover({
        candidateImageUrl: candidate.imageUrl,
        unsplashQuery: post.coverQuery,
      });
      if (cover) console.log(`        cover: ${cover.slice(0, 80)}`);

      const { url: notionUrl } = await publishToNotion({ ...post, slug }, cover);
      console.log(`        published to Notion: ${notionUrl}`);
      made++;
    } catch (err: any) {
      console.warn(`        FAILED: ${err?.message ?? err}`);
    }
  }

  console.log(`\n[agent] Done. ${made} posts created.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
