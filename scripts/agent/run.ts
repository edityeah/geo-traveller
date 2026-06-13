/**
 * v3 orchestrator — one post per run, category chosen from Notion state.
 *
 *   Evergreen: pick next uncovered seed topic (signal-ranked) → generate guide.
 *   News:      discover → dedup by URL; if it matches a live guide's Topic Key,
 *              refresh that guide in place AND create a backlinked news draft;
 *              else create a news draft.
 *   All drafts pass QA → QA / QA Notes columns. Nothing auto-publishes.
 *
 * Env: AGENT_EVERGREEN_PER_DAY (5), AGENT_NEWS_PER_DAY (7), AGENT_DRY_RUN.
 */
import { Client, isFullPage } from '@notionhq/client';
import { discover } from './discover.js';
import { generatePost, generateEvergreen, type ExistingPost } from './generate.js';
import { resolveCover, resolveInlineImages } from './images.js';
import { existingSourceUrls, publishToNotion, mdToBlocks } from './publish.js';
import { seedTopics } from './topics.js';
import { topicSignals, rankTopicsBySignal } from './keywords.js';
import { chooseCategory, pickEvergreenTopic, type DayCounts } from './planner.js';
import { matchGuide, refreshGuide, type GuideRef } from './refresh.js';
import { runQa, deterministicChecks } from './qa.js';

const EVERGREEN_PER_DAY = Number(process.env.AGENT_EVERGREEN_PER_DAY ?? 5);
const NEWS_PER_DAY = Number(process.env.AGENT_NEWS_PER_DAY ?? 7);
const DRY = !!process.env.AGENT_DRY_RUN;

const notion = new Client({ auth: process.env.NOTION_TOKEN! });
const DB = process.env.NOTION_DATABASE_ID!;

function plain(rich: any[] | undefined): string {
  return (rich ?? []).map((r) => r.plain_text ?? '').join('');
}
function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

/** All posts, with type/key/date, for counting + dedup + backlinks. */
async function loadPosts() {
  const out: { title: string; slug: string; tags: string[]; excerpt?: string;
    contentType?: string; topicKey?: string; createdDate?: string; pageId: string; status?: string; }[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({ database_id: DB, start_cursor: cursor, page_size: 100 });
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const pr = p.properties as any;
      out.push({
        pageId: p.id,
        title: plain(pr.Title?.title),
        slug: plain(pr.Slug?.rich_text),
        tags: (pr.Tags?.multi_select ?? []).map((t: any) => t.name),
        excerpt: plain(pr.Excerpt?.rich_text) || undefined,
        contentType: pr['Content Type']?.select?.name,
        topicKey: plain(pr['Topic Key']?.rich_text) || undefined,
        status: pr.Status?.select?.name,
        createdDate: pr['Publish Date']?.date?.start,
      });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

function dayCounts(posts: Awaited<ReturnType<typeof loadPosts>>): DayCounts {
  const today = todayUtc();
  let evergreen = 0, news = 0;
  for (const p of posts) {
    if (p.createdDate?.slice(0, 10) !== today) continue;
    if (p.contentType === 'Evergreen') evergreen++;
    else if (p.contentType === 'News') news++;
  }
  return { evergreen, news };
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of tags) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

async function main() {
  const posts = await loadPosts();
  const counts = dayCounts(posts);
  console.log(`[agent] today: ${counts.evergreen} evergreen / ${counts.news} news`);

  const category = chooseCategory(counts, { evergreen: EVERGREEN_PER_DAY, news: NEWS_PER_DAY });
  if (!category) { console.log('[agent] daily quotas met — nothing to do.'); return; }
  console.log(`[agent] category this run: ${category}`);

  const existingForLinks: ExistingPost[] = posts
    .filter((p) => p.status === 'Published' && p.title && p.slug)
    .map((p) => ({ title: p.title, slug: p.slug, tags: p.tags, excerpt: p.excerpt }));

  if (category === 'evergreen') {
    await doEvergreen(posts, existingForLinks);
  } else {
    await doNews(posts, existingForLinks);
  }
}

async function doEvergreen(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[]) {
  const covered = new Set(posts.map((p) => p.topicKey).filter(Boolean) as string[]);
  const signal = await topicSignals(seedTopics()).catch(() => new Map<string, number>());
  const ranked = rankTopicsBySignal(seedTopics(), signal);
  const topic = pickEvergreenTopic(ranked, covered);
  if (!topic) { console.log('[agent] no uncovered evergreen topics left.'); return; }
  console.log(`[agent] evergreen topic: ${topic.key} — ${topic.title}`);

  const post = await generateEvergreen(topic, existing);
  const body = await resolveInlineImages(post.body);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({
    type: 'evergreen', title: post.title, imageEntity: topic.imageEntity, unsplashQuery: post.coverQuery,
    fallbackQueries: [topic.tags[0], post.locationName].filter(Boolean) as string[],
  });
  console.log(`[agent] cover: ${cover.source}`);
  const qa = await runQa({ title: post.title, body });
  console.log(`[agent] QA: ${qa.status} — ${qa.notes}`);

  if (DRY) { console.log(`[DRY] would publish evergreen "${post.title}" (${body.length} chars)`); return; }
  await publishToNotion(
    { ...post, slug, body, tags: dedupeTags([...post.tags]) },
    cover.url,
    { contentType: 'Evergreen', topicKey: topic.key, lastUpdated: todayUtc(), qa: qa.status, qaNotes: qa.notes }
  );
  console.log('[agent] evergreen draft created.');
}

async function doNews(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[]) {
  const seen = await existingSourceUrls();
  const candidates = (await discover()).filter((c) => !seen.has(c.url));
  if (!candidates.length) { console.log('[agent] no fresh news candidates.'); return; }

  const guides: GuideRef[] = posts
    .filter((p) => p.contentType === 'Evergreen' && p.topicKey && p.status === 'Published')
    .map((p) => ({ pageId: p.pageId, key: p.topicKey!, title: p.title, slug: p.slug }));

  const candidate = candidates[0];
  console.log(`[agent] news: ${candidate.title}`);

  const post = await generatePost(candidate, existing);
  const body = await resolveInlineImages(post.body);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({
    type: 'news', title: post.title, unsplashQuery: post.coverQuery, candidateImageUrl: candidate.imageUrl,
    candidateUrl: candidate.url, fallbackQueries: [post.locationName, post.tags[0]].filter(Boolean) as string[],
  });
  console.log(`[agent] cover: ${cover.source}`);
  const qa = await runQa({ title: post.title, body, sourceSummary: candidate.summary });
  console.log(`[agent] QA: ${qa.status} — ${qa.notes}`);

  // Does this news update an existing guide?
  const guide = matchGuide(candidate.title, candidate.summary, guides);
  if (guide) console.log(`[agent] matches guide ${guide.key} → will refresh in place`);

  if (DRY) {
    console.log(`[DRY] would publish news "${post.title}"${guide ? ` + refresh ${guide.key}` : ''}`);
    return;
  }

  if (guide) {
    try {
      const refreshed = await generateEvergreen(
        { key: guide.key, title: guide.title, brief:
          `Update the existing guide to reflect this development: ${candidate.title}. ${candidate.summary}. ` +
          `Keep it a complete standalone guide; fold the change in naturally and note it under "Last updated".`,
          imageEntity: '', tags: [], searchHints: [] },
        existing
      );
      const refreshedBody = await resolveInlineImages(refreshed.body);
      // QA the refreshed body before overwriting the LIVE guide. The guide is
      // intentionally left QA=Flagged after a refresh so you re-glance at the
      // auto-changed live page; any deterministic issues are surfaced in the note.
      const refreshIssues = deterministicChecks({ title: guide.title, body: refreshedBody });
      const note = [`folded in: ${candidate.title}`, ...refreshIssues].join(' | ');
      await refreshGuide({
        guide, newBodyMarkdown: refreshedBody, isoDate: todayUtc(),
        qaNote: note.slice(0, 200), buildBlocks: mdToBlocks,
      });
      console.log(`[agent] refreshed guide ${guide.slug} in place${refreshIssues.length ? ' (QA issues noted)' : ''}.`);
    } catch (e: any) {
      console.warn(`[agent] guide refresh failed (guide untouched): ${e?.message ?? e}`);
    }
  }

  await publishToNotion(
    { ...post, slug, body, tags: dedupeTags([...post.tags, 'Geo Daily']) },
    cover.url,
    { contentType: 'News', topicKey: guide?.key, lastUpdated: todayUtc(), qa: qa.status, qaNotes: qa.notes }
  );
  console.log('[agent] news draft created.');
}

main().catch((e) => { console.error(e); process.exit(1); });
