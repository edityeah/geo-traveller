/**
 * v3 orchestrator — one post per run, category chosen from Notion state.
 *
 *   Evergreen: pick next uncovered seed topic (signal-ranked) → generate guide.
 *   News:      discover → dedup by URL; if it matches a live guide's Topic Key,
 *              refresh that guide in place AND create a backlinked news draft;
 *              else create a news draft.
 *   All drafts pass QA → QA / QA Notes columns. Nothing auto-publishes.
 *
 * Env: AGENT_EVERGREEN_PER_DAY (1), AGENT_NEWS_PER_DAY (4),
 *      AGENT_EVENTS_PER_DAY (5 — food/experiences/events), AGENT_DRY_RUN.
 */
import { Client, isFullPage } from '@notionhq/client';
import { discover, discoverExperiences, type Candidate } from './discover.js';
import { discoverTrending, trendMix } from './trends.js';
import { generatePost, generateEvergreen, generateEvent, rewriteForSeo, type ExistingPost, type GeneratedPost } from './generate.js';
import { seoScore } from './seo.js';
import { resolveCover, resolveInlineImages } from './images.js';
import { existingSourceUrls, publishToNotion, mdToBlocks } from './publish.js';
import { seedTopics } from './topics.js';
import { topicSignals, rankTopicsBySignal } from './keywords.js';
import { chooseCategory, pickEvergreenTopic, type DayCounts } from './planner.js';
import { withRetry } from '../lib/notion.js';
import { matchGuide, refreshGuide, type GuideRef } from './refresh.js';
import { runQa, deterministicChecks } from './qa.js';

// Daily mix: 1 evergreen guide / 4 travel news / 5 food+experiences (10/day),
// weighted toward the food/experiences/events stream (Curly Tales + event feeds).
const EVERGREEN_PER_DAY = Number(process.env.AGENT_EVERGREEN_PER_DAY ?? 1);
const NEWS_PER_DAY = Number(process.env.AGENT_NEWS_PER_DAY ?? 4);
const EVENTS_PER_DAY = Number(process.env.AGENT_EVENTS_PER_DAY ?? 5);
const DRY = !!process.env.AGENT_DRY_RUN;
// Drafts scoring below this get one automatic SEO rewrite before saving.
const SEO_MIN = Number(process.env.AGENT_SEO_MIN ?? 70);

const notion = new Client({ auth: process.env.NOTION_TOKEN!, fetch: globalThis.fetch });
const DB = process.env.NOTION_DATABASE_ID!;

/**
 * Score a freshly-generated draft for on-page SEO; if it's below SEO_MIN, ask
 * the creator agent to rewrite it once (kept only if the score improves). Then
 * resolve inline images on the final version. Returns the post to publish, its
 * image-resolved body, and a short note for the QA column.
 */
async function seoRefine(
  raw: GeneratedPost,
  existing: ExistingPost[],
  minWords: number
): Promise<{ post: GeneratedPost; body: string; seoNote: string }> {
  let cur = raw;
  let s = seoScore({ title: cur.title, body: cur.body, excerpt: cur.excerpt, focusKeyword: cur.focusKeyword, tags: cur.tags, minWords });
  console.log(`[agent] SEO ${s.score}/100 (kw: ${s.focusKeyword})${s.issues.length ? ' — ' + s.issues.join('; ') : ''}`);
  if (s.score < SEO_MIN) {
    try {
      const rw = await rewriteForSeo(cur, s.issues, s.focusKeyword, existing);
      const rs = seoScore({ title: rw.title, body: rw.body, excerpt: rw.excerpt, focusKeyword: rw.focusKeyword ?? s.focusKeyword, tags: rw.tags, minWords });
      if (rs.score > s.score) { cur = rw; s = rs; console.log(`[agent] SEO rewrite → ${rs.score}/100`); }
      else console.log(`[agent] SEO rewrite not better (${rs.score}/100) — keeping original`);
    } catch (e: any) {
      console.warn(`[agent] SEO rewrite failed: ${e?.message ?? e}`);
    }
  }
  const requested = (cur.body.match(/\]\(query:/g) ?? []).length;
  const body = await resolveInlineImages(cur.body);
  const kept = (body.match(/!\[[^\]]*\]\(https?:\/\//g) ?? []).length;
  console.log(`[agent] inline images: ${requested} requested → ${kept} kept`);
  return { post: cur, body, seoNote: `SEO ${s.score}/100` };
}

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
    const res = await withRetry(() => notion.databases.query({ database_id: DB, start_cursor: cursor, page_size: 100 }));
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
  let evergreen = 0, news = 0, events = 0;
  for (const p of posts) {
    if (p.createdDate?.slice(0, 10) !== today) continue;
    if (p.contentType === 'Evergreen') evergreen++;
    else if (p.contentType === 'News') news++;
    else if (p.contentType === 'Events') events++;
  }
  return { evergreen, news, events };
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of tags) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

async function main() {
  const posts = await loadPosts();
  const counts = dayCounts(posts);

  const ALL: ('evergreen' | 'news' | 'events')[] = ['evergreen', 'news', 'events'];

  // Google Trends signal (best-effort): travel-relevant trending stories,
  // grounded in a real source article. Drives BOTH the daily mix (trendMix)
  // and which story gets written (prioritised in doNews/doExperiences).
  const trending = await discoverTrending().catch(() => [] as Candidate[]);
  const fallback = { evergreen: EVERGREEN_PER_DAY, news: NEWS_PER_DAY, events: EVENTS_PER_DAY };
  const quota = trendMix(trending, fallback);
  const tExp = trending.filter((c) => c.kind === 'food' || c.kind === 'experience').length;
  console.log(`[agent] today: ${counts.evergreen} evergreen / ${counts.news} news / ${counts.events} events`);
  console.log(`[agent] trends: ${trending.length} travel-relevant (news ${trending.length - tExp} / food+exp ${tExp}) → mix ${quota.evergreen}/${quota.news}/${quota.events}`);

  const existingForLinks: ExistingPost[] = posts
    .filter((p) => p.status === 'Published' && p.title && p.slug)
    .map((p) => ({ title: p.title, slug: p.slug, tags: p.tags, excerpt: p.excerpt }));

  // Manual override: AGENT_FORCE_CATEGORY=news|events|evergreen produces exactly
  // one post of that category, ignoring quotas/daily cap. For one-off requests.
  const forced = (process.env.AGENT_FORCE_CATEGORY ?? '').toLowerCase();
  const FORCE = (ALL as string[]).includes(forced) ? (forced as typeof ALL[number]) : null;

  const TOTAL_PER_DAY = quota.evergreen + quota.news + quota.events;
  if (!FORCE && counts.evergreen + counts.news + counts.events >= TOTAL_PER_DAY) {
    console.log(`[agent] daily total (${TOTAL_PER_DAY}) reached — nothing to do.`);
    return;
  }

  // Prefer the under-quota category, but if it can't produce (e.g. evergreen
  // backlog exhausted, or no fresh news/events), fall back to the others so the
  // slot isn't wasted — keeps daily output near TOTAL_PER_DAY when a stream is dry.
  const preferred = FORCE ?? chooseCategory(counts, quota) ?? 'news';
  const order = FORCE ? [FORCE] : [preferred, ...ALL.filter((c) => c !== preferred)];
  console.log(`[agent]${FORCE ? ' FORCED' : ' preferred'}: ${preferred} (order: ${order.join(' → ')})`);

  // Split trending into the streams that consume them.
  const trendNews = trending.filter((c) => !c.kind);
  const trendExp = trending.filter((c) => c.kind === 'food' || c.kind === 'experience');

  const run = {
    evergreen: () => doEvergreen(posts, existingForLinks),
    news: () => doNews(posts, existingForLinks, trendNews),
    events: () => doExperiences(posts, existingForLinks, trendExp),
  };
  for (const cat of order) {
    if (await run[cat]()) return;
    console.log(`[agent] ${cat} produced nothing — trying fallback.`);
  }
  console.log('[agent] nothing to produce this run (all streams dry).');
}

async function doEvergreen(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[]): Promise<boolean> {
  const covered = new Set(posts.map((p) => p.topicKey).filter(Boolean) as string[]);
  const signal = await topicSignals(seedTopics()).catch(() => new Map<string, number>());
  const ranked = rankTopicsBySignal(seedTopics(), signal);
  const topic = pickEvergreenTopic(ranked, covered);
  if (!topic) { console.log('[agent] no uncovered evergreen topics left.'); return false; }
  console.log(`[agent] evergreen topic: ${topic.key} — ${topic.title}`);

  const { post, body, seoNote } = await seoRefine(await generateEvergreen(topic, existing), existing, 800);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  // Drive evergreen covers from the curated scenic subjects (landmark/skyline/
  // flag) rather than the model's coverQuery, which skews to document close-ups.
  const cover = await resolveCover({
    type: 'evergreen', title: post.title,
    unsplashQuery: topic.coverQueries[0] ?? post.coverQuery,
    fallbackQueries: [...topic.coverQueries.slice(1), post.coverQuery, post.locationName].filter(Boolean) as string[],
  });
  console.log(`[agent] cover: ${cover.source}`);
  const qa = await runQa({ title: post.title, body });
  console.log(`[agent] QA: ${qa.status} — ${qa.notes}`);

  if (DRY) { console.log(`[DRY] would publish evergreen "${post.title}" (${body.length} chars)`); return true; }
  await publishToNotion(
    { ...post, slug, body, tags: dedupeTags([...post.tags]) },
    cover.url,
    { contentType: 'Evergreen', topicKey: topic.key, lastUpdated: todayUtc(), qa: qa.status, qaNotes: `${qa.notes} | ${seoNote}` }
  );
  console.log('[agent] evergreen draft created.');
  return true;
}

function mergeByUrl(...lists: Candidate[][]): Candidate[] {
  const seen = new Set<string>(); const out: Candidate[] = [];
  for (const c of lists.flat()) { if (c.url && !seen.has(c.url)) { seen.add(c.url); out.push(c); } }
  return out;
}

async function doNews(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[], trending: Candidate[] = []): Promise<boolean> {
  const seen = await existingSourceUrls();
  // Trending stories first (grounded in a real source), then the RSS feeds.
  const candidates = mergeByUrl(trending, await discover()).filter((c) => !seen.has(c.url));
  if (candidates.length && candidates[0] === trending[0]) console.log(`[agent] news: trending story prioritised`);
  if (!candidates.length) { console.log('[agent] no fresh news candidates.'); return false; }

  const guides: GuideRef[] = posts
    .filter((p) => p.contentType === 'Evergreen' && p.topicKey && p.status === 'Published')
    .map((p) => ({ pageId: p.pageId, key: p.topicKey!, title: p.title, slug: p.slug }));

  const candidate = candidates[0];
  console.log(`[agent] news: ${candidate.title}`);

  const { post, body, seoNote } = await seoRefine(await generatePost(candidate, existing), existing, 500);
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
    return true;
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
    { contentType: 'News', topicKey: guide?.key, lastUpdated: todayUtc(), qa: qa.status, qaNotes: `${qa.notes} | ${seoNote}` }
  );
  console.log('[agent] news draft created.');
  return true;
}

// Food / experiences / events stream. The candidate's `kind` (set in discovery)
// decides the writing template and the tag that lands it in the right site
// category: food → Food, experience → Experiences, event → Events.
async function doExperiences(posts: Awaited<ReturnType<typeof loadPosts>>, existing: ExistingPost[], trending: Candidate[] = []): Promise<boolean> {
  const seen = await existingSourceUrls();
  // Trending food/experience stories first, then the RSS feeds.
  const candidates = mergeByUrl(trending, await discoverExperiences()).filter((c) => !seen.has(c.url));
  if (!candidates.length) { console.log('[agent] no fresh food/experience/event candidates.'); return false; }

  const candidate = candidates[0];
  const kind = candidate.kind ?? 'experience';
  console.log(`[agent] ${kind}: ${candidate.title}`);

  // Events get the booking/how-to-watch template; food + experiences are
  // written as flexible features (the general news writer adapts well).
  const raw = kind === 'event'
    ? await generateEvent(candidate, existing)
    : await generatePost(candidate, existing);
  const { post, body, seoNote } = await seoRefine(raw, existing, 500);
  const slug = (post.slug || slugify(post.title)).replace(/[^a-z0-9-]/g, '');
  const cover = await resolveCover({
    type: 'news', title: post.title, unsplashQuery: post.coverQuery, candidateImageUrl: candidate.imageUrl,
    candidateUrl: candidate.url, fallbackQueries: [post.locationName, post.tags[0]].filter(Boolean) as string[],
  });
  console.log(`[agent] cover: ${cover.source}`);
  const qa = await runQa({ title: post.title, body, sourceSummary: candidate.summary });
  console.log(`[agent] QA: ${qa.status} — ${qa.notes}`);

  const kindTag = kind === 'food' ? 'Food' : kind === 'experience' ? 'Experiences' : 'Events';
  if (DRY) { console.log(`[DRY] would publish ${kind} "${post.title}" (tag: ${kindTag})`); return true; }
  await publishToNotion(
    { ...post, slug, body, tags: dedupeTags([...post.tags, kindTag]) },
    cover.url,
    { contentType: 'Events', lastUpdated: todayUtc(), qa: qa.status, qaNotes: `${qa.notes} | ${seoNote}` }
  );
  console.log(`[agent] ${kind} draft created.`);
  return true;
}

main().catch((e) => { console.error(e); process.exit(1); });
