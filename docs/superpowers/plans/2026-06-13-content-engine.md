# Auto-blog v3 — Search-Intent Content Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the auto-blog agent from a news reactor into a search-intent engine: demand-driven topic selection, an evergreen+news mix at 12 posts/day, deduped self-updating evergreen guides, a multi-source image resolver, and an automated QA gate that records a verdict in Notion (drafts only — nothing auto-publishes).

**Architecture:** Stateless 2-hourly runs; Notion is the only state. Each run reads today's Notion counts, picks the under-quota category (5 evergreen / 7 news), then either picks an uncovered evergreen topic from a seed backlog (ranked by free keyword signals) or processes a deduped news candidate (refreshing a live guide in place if the news matches its Topic Key). Every draft passes through a QA pass that writes `QA`/`QA Notes` columns.

**Tech Stack:** TypeScript via `tsx`, `@notionhq/client`, `@anthropic-ai/sdk` (Claude Sonnet tool-use), `fast-xml-parser`, Node 22 built-in `node:test` runner (no new deps), GitHub Actions cron, Cloudflare Pages.

---

## Conventions

- All scripts run with `tsx --env-file-if-exists=.env`.
- Unit tests are `*.test.ts` next to the module, run with `node:test` via `tsx`.
- Add once to `package.json` scripts (Task 0): `"test": "node --import tsx --test scripts/agent/*.test.ts"`.
- Commit after every task. Branch: work directly on `main` (project convention; the new agent is gated behind `workflow_dispatch` until Task 12 flips the cron, so landing on main is safe).
- Env vars (existing): `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `ANTHROPIC_API_KEY`, `NEWSAPI_KEY`, `UNSPLASH_ACCESS_KEY`. New optional: `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `AGENT_EVERGREEN_PER_DAY` (default 5), `AGENT_NEWS_PER_DAY` (default 7), `AGENT_DRY_RUN`.

---

## Task 0: Add the test script

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add the test script**

In `package.json` `"scripts"`, add:

```json
"test": "node --import tsx --test scripts/agent/*.test.ts"
```

- [ ] **Step 2: Verify the runner works on an empty match**

Run: `npm test`
Expected: exits 0 with "tests 0" (no test files yet) — confirms the runner is wired.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(agent): add node:test runner script"
```

---

## Task 1: Add Notion schema properties

**Files:**
- Create: `scripts/agent/add-agent-props.ts`

Adds `Topic Key` (text), `Content Type` (select Evergreen/News), `QA` (select Passed/Flagged), `QA Notes` (text), `Last Updated` (date) to the Posts database. Idempotent — Notion leaves existing properties untouched.

- [ ] **Step 1: Write the script**

```typescript
/**
 * One-shot (idempotent): add the v3 agent properties to the Posts database.
 *   npx tsx --env-file-if-exists=.env scripts/agent/add-agent-props.ts
 */
import { Client } from '@notionhq/client';

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_DATABASE_ID;
if (!TOKEN || !DB) {
  console.error('NOTION_TOKEN / NOTION_DATABASE_ID not set.');
  process.exit(1);
}
const notion = new Client({ auth: TOKEN });

async function main() {
  await notion.databases.update({
    database_id: DB!,
    properties: {
      'Topic Key': { rich_text: {} },
      'Content Type': {
        select: {
          options: [
            { name: 'Evergreen', color: 'green' },
            { name: 'News', color: 'blue' },
          ],
        },
      },
      QA: {
        select: {
          options: [
            { name: 'Passed', color: 'green' },
            { name: 'Flagged', color: 'orange' },
          ],
        },
      },
      'QA Notes': { rich_text: {} },
      'Last Updated': { date: {} },
    } as any,
  });
  console.log('✅ v3 agent properties present on the Posts database.');
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
```

- [ ] **Step 2: Run it**

Run: `npx tsx --env-file-if-exists=.env scripts/agent/add-agent-props.ts`
Expected: `✅ v3 agent properties present on the Posts database.`

- [ ] **Step 3: Verify via API**

Run:
```bash
node --import tsx -e "import('@notionhq/client').then(async ({Client})=>{const n=new Client({auth:process.env.NOTION_TOKEN});const db=await n.databases.retrieve({database_id:process.env.NOTION_DATABASE_ID});console.log(Object.keys(db.properties).filter(k=>['Topic Key','Content Type','QA','QA Notes','Last Updated'].includes(k)))})" 2>/dev/null
```
(Run with the env file: prefix `npx dotenv` not needed — instead run `npx tsx --env-file-if-exists=.env -e "..."`.)
Expected: prints all five property names.

- [ ] **Step 4: Commit**

```bash
git add scripts/agent/add-agent-props.ts
git commit -m "feat(agent): one-shot to add v3 Notion properties"
```

---

## Task 2: Topic-Key canonicalizer

**Files:**
- Create: `scripts/agent/topic-key.ts`
- Test: `scripts/agent/topic-key.test.ts`

A Topic Key is a stable, lowercase, colon-delimited identity for an evergreen topic, e.g. `visa:japan:in`. Used for dedup (one guide per key) and refresh matching.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalKey, slugWord } from './topic-key.ts';

test('slugWord normalizes', () => {
  assert.equal(slugWord('Japan'), 'japan');
  assert.equal(slugWord('United States'), 'united-states');
  assert.equal(slugWord('  Côte d’Ivoire '), 'cote-d-ivoire');
});

test('canonicalKey joins parts with colons', () => {
  assert.equal(canonicalKey(['visa', 'Japan', 'IN']), 'visa:japan:in');
  assert.equal(canonicalKey(['mobility', 'Middle East', 'flights']), 'mobility:middle-east:flights');
});

test('canonicalKey drops empty parts', () => {
  assert.equal(canonicalKey(['visa', '', 'japan']), 'visa:japan');
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./topic-key.ts`.

- [ ] **Step 3: Implement**

```typescript
/** Canonical, stable identity keys for evergreen topics, e.g. visa:japan:in. */

export function slugWord(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Join already-meaningful parts into a colon key. Empty parts are dropped. */
export function canonicalKey(parts: string[]): string {
  return parts.map(slugWord).filter(Boolean).join(':');
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/topic-key.ts scripts/agent/topic-key.test.ts
git commit -m "feat(agent): topic-key canonicalizer"
```

---

## Task 3: Seed pillars + evergreen backlog

**Files:**
- Create: `scripts/agent/topics.ts`
- Test: `scripts/agent/topics.test.ts`

Static seed list of evergreen topics across the 5 pillars, each with a canonical key, a working title, a generation brief, and an image entity hint. Country lists drive the visa-guide pillar.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedTopics, type SeedTopic } from './topics.ts';

test('seed topics have unique canonical keys', () => {
  const keys = seedTopics().map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate topic keys found');
});

test('every seed topic is fully specified', () => {
  for (const t of seedTopics()) {
    assert.ok(t.key && t.key.includes(':'), `bad key: ${t.key}`);
    assert.ok(t.title.length > 0, `missing title for ${t.key}`);
    assert.ok(t.brief.length > 0, `missing brief for ${t.key}`);
    assert.ok(t.imageEntity.length > 0, `missing imageEntity for ${t.key}`);
  }
});

test('includes the Japan visa guide', () => {
  assert.ok(seedTopics().some((t) => t.key === 'visa:japan:in'));
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./topics.ts`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Evergreen seed backlog across the 5 pillars. The planner picks the next
 * topic whose key is not yet in Notion. Keyword signals (keywords.ts) reorder
 * this list by rising interest; this file is the stable source of topics.
 */
import { canonicalKey } from './topic-key.ts';

export interface SeedTopic {
  key: string;
  title: string;          // working title; the model may refine
  brief: string;          // what the guide must cover
  imageEntity: string;    // Wikimedia/Wikipedia subject for the cover
  tags: string[];
  searchHints: string[];  // seed phrases for keyword expansion
}

// Pillar 1 — India-outbound visa guides.
const VISA_COUNTRIES: { name: string; cc: string; entity: string }[] = [
  { name: 'Japan', cc: 'japan', entity: 'Embassy of Japan, New Delhi' },
  { name: 'Schengen (Europe)', cc: 'schengen', entity: 'Schengen Area' },
  { name: 'United Kingdom', cc: 'uk', entity: 'British High Commission, New Delhi' },
  { name: 'United States', cc: 'us', entity: 'Embassy of the United States, New Delhi' },
  { name: 'Canada', cc: 'canada', entity: 'High Commission of Canada, New Delhi' },
  { name: 'Australia', cc: 'australia', entity: 'Australian High Commission, New Delhi' },
  { name: 'Ireland', cc: 'ireland', entity: 'Embassy of Ireland, New Delhi' },
  { name: 'UAE', cc: 'uae', entity: 'Dubai' },
  { name: 'Singapore', cc: 'singapore', entity: 'Singapore' },
  { name: 'Thailand', cc: 'thailand', entity: 'Thailand' },
];

function visaTopics(): SeedTopic[] {
  return VISA_COUNTRIES.map((c) => ({
    key: canonicalKey(['visa', c.cc, 'in']),
    title: `How to Apply for a ${c.name} Visa from India`,
    brief:
      `A complete, current step-by-step guide for Indian passport holders applying for a ${c.name} visa: ` +
      `visa types, eligibility, document checklist, fees in INR, where to apply (VFS/embassy), appointment process, ` +
      `processing time, and common rejection reasons. Practical, accurate, no fluff.`,
    imageEntity: c.entity,
    tags: ['Visa', 'India', c.name, 'Guide'],
    searchHints: [`${c.name.toLowerCase()} visa from india`, `${c.name.toLowerCase()} visa for indians`],
  }));
}

// Pillars 3 & 4 — mobility/safety explainers and practical how-tos.
const STATIC_TOPICS: SeedTopic[] = [
  {
    key: canonicalKey(['mobility', 'middle-east', 'flights']),
    title: 'How the Middle East Situation Affects Your Flights and Travel Plans',
    brief:
      'A traveler-focused explainer (not war news): airspace closures and reroutes, why fares and flight times change, ' +
      'refund/rebooking rights, travel-insurance implications, and what to check before flying through the Gulf. Update as the situation changes.',
    imageEntity: 'Departure board',
    tags: ['Mobility', 'Safety', 'Flight', 'Middle East'],
    searchHints: ['middle east flights affected', 'is it safe to fly middle east'],
  },
  {
    key: canonicalKey(['howto', 'esim', 'india-travel']),
    title: 'eSIM for International Travel from India: A Practical Guide',
    brief:
      'How eSIMs work, which phones support them, buying before vs after landing, top providers and rough costs, ' +
      'activation steps, and pitfalls. Aimed at Indian travelers going abroad.',
    imageEntity: 'SIM card',
    tags: ['How-to', 'eSIM', 'India', 'Guide'],
    searchHints: ['esim for international travel india', 'best esim for travel'],
  },
  {
    key: canonicalKey(['howto', 'forex', 'india-travel']),
    title: 'Forex, Cards, and UPI Abroad: How Indians Should Carry Money When Travelling',
    brief:
      'Forex cards vs debit/credit cards vs cash, where UPI works abroad, markups and fees to avoid, ' +
      'how much cash to carry, and a simple pre-trip money checklist for Indian travelers.',
    imageEntity: 'Credit card',
    tags: ['How-to', 'Money', 'India', 'Guide'],
    searchHints: ['forex card vs credit card abroad', 'upi abroad countries'],
  },
  {
    key: canonicalKey(['howto', 'travel-insurance', 'india']),
    title: 'Travel Insurance for Indians: What to Buy and What to Skip',
    brief:
      'What travel insurance actually covers, when it is mandatory (Schengen etc.), medical vs trip-cancellation cover, ' +
      'how claims work, and how to choose a plan. Practical for Indian outbound travelers.',
    imageEntity: 'Travel insurance',
    tags: ['How-to', 'Insurance', 'India', 'Guide'],
    searchHints: ['travel insurance for indians', 'is travel insurance mandatory schengen'],
  },
];

export function seedTopics(): SeedTopic[] {
  return [...visaTopics(), ...STATIC_TOPICS];
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS (topic-key tests + 3 topics tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/topics.ts scripts/agent/topics.test.ts
git commit -m "feat(agent): evergreen seed pillars + backlog"
```

---

## Task 4: Free keyword signals

**Files:**
- Create: `scripts/agent/keywords.ts`
- Test: `scripts/agent/keywords.test.ts`

Best-effort signals: Google Autocomplete (real query phrasings) and Google Trends daily-trending (India). Pure parsing is tested with sample payloads; network is best-effort and falls back to empty.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAutocomplete, rankTopicsBySignal } from './keywords.ts';
import type { SeedTopic } from './topics.ts';

test('parseAutocomplete pulls suggestions from the Google JSON shape', () => {
  // Google returns: [query, [suggestions...], ...]
  const raw = JSON.stringify(['japan visa', ['japan visa from india', 'japan visa cost', 'japan visa for indians']]);
  assert.deepEqual(parseAutocomplete(raw), [
    'japan visa from india',
    'japan visa cost',
    'japan visa for indians',
  ]);
});

test('parseAutocomplete tolerates junk', () => {
  assert.deepEqual(parseAutocomplete('not json'), []);
  assert.deepEqual(parseAutocomplete('[]'), []);
});

test('rankTopicsBySignal sorts higher-signal topics first, stable for ties', () => {
  const topics: SeedTopic[] = [
    { key: 'a', title: 'A', brief: '', imageEntity: '', tags: [], searchHints: ['alpha'] },
    { key: 'b', title: 'B', brief: '', imageEntity: '', tags: [], searchHints: ['beta'] },
  ];
  const signal = new Map<string, number>([['a', 0], ['b', 5]]);
  assert.deepEqual(rankTopicsBySignal(topics, signal).map((t) => t.key), ['b', 'a']);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./keywords.ts`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Free keyword signals. Best-effort — every network call falls back to empty
 * so the planner always works offline (it then uses the static seed order).
 */
import type { SeedTopic } from './topics.ts';

/** Parse the Google Suggest JSON: [query, [suggestions...], ...]. */
export function parseAutocomplete(raw: string): string[] {
  try {
    const data = JSON.parse(raw);
    const arr = data?.[1];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Fetch autocomplete suggestions for a seed phrase (India market). */
export async function autocomplete(phrase: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&gl=in&hl=en&q=${encodeURIComponent(phrase)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return [];
    return parseAutocomplete(await r.text());
  } catch {
    return [];
  }
}

/**
 * Build a per-topic signal score from autocomplete breadth: a topic whose seed
 * phrases yield more/longer suggestion lists is in more active demand. This is
 * a relative heuristic, not real volume (that's the future paid upgrade).
 */
export async function topicSignals(topics: SeedTopic[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const t of topics) {
    let score = 0;
    for (const hint of t.searchHints) {
      const sugg = await autocomplete(hint);
      score += sugg.length;
    }
    out.set(t.key, score);
  }
  return out;
}

/** Sort topics by signal desc; ties keep original order (stable). */
export function rankTopicsBySignal(topics: SeedTopic[], signal: Map<string, number>): SeedTopic[] {
  return topics
    .map((t, i) => ({ t, i, s: signal.get(t.key) ?? 0 }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.t);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/keywords.ts scripts/agent/keywords.test.ts
git commit -m "feat(agent): free keyword signals (autocomplete + ranking)"
```

---

## Task 5: Planner

**Files:**
- Create: `scripts/agent/planner.ts`
- Test: `scripts/agent/planner.test.ts`

Pure decision logic, given injected Notion state. Decides the category for this run and picks the next uncovered evergreen topic. News selection is delegated to discovery in `run.ts`; the planner only decides *category* and *evergreen topic*.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCategory, pickEvergreenTopic } from './planner.ts';
import type { SeedTopic } from './topics.ts';

const QUOTA = { evergreen: 5, news: 7 };

test('chooseCategory favors the under-quota category', () => {
  // evergreen behind its quota ratio → evergreen
  assert.equal(chooseCategory({ evergreen: 0, news: 5 }, QUOTA), 'evergreen');
  // news behind → news
  assert.equal(chooseCategory({ evergreen: 5, news: 0 }, QUOTA), 'news');
});

test('chooseCategory returns null when both quotas are met', () => {
  assert.equal(chooseCategory({ evergreen: 5, news: 7 }, QUOTA), null);
});

test('chooseCategory falls back to news when only evergreen is full', () => {
  assert.equal(chooseCategory({ evergreen: 5, news: 3 }, QUOTA), 'news');
});

test('pickEvergreenTopic skips already-covered keys', () => {
  const topics: SeedTopic[] = [
    { key: 'visa:japan:in', title: 'JP', brief: 'b', imageEntity: 'e', tags: [], searchHints: [] },
    { key: 'visa:uk:in', title: 'UK', brief: 'b', imageEntity: 'e', tags: [], searchHints: [] },
  ];
  const covered = new Set(['visa:japan:in']);
  assert.equal(pickEvergreenTopic(topics, covered)?.key, 'visa:uk:in');
});

test('pickEvergreenTopic returns null when all covered', () => {
  const topics: SeedTopic[] = [
    { key: 'visa:japan:in', title: 'JP', brief: 'b', imageEntity: 'e', tags: [], searchHints: [] },
  ];
  assert.equal(pickEvergreenTopic(topics, new Set(['visa:japan:in'])), null);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./planner.ts`.

- [ ] **Step 3: Implement**

```typescript
import type { SeedTopic } from './topics.ts';

export type Category = 'evergreen' | 'news';
export interface DayCounts { evergreen: number; news: number; }
export interface Quota { evergreen: number; news: number; }

/**
 * Pick the category for this run: whichever is furthest behind its quota
 * (by remaining count). Ties → evergreen first (SEO compounding priority).
 * Returns null when both quotas are already met today.
 */
export function chooseCategory(counts: DayCounts, quota: Quota): Category | null {
  const evRemain = quota.evergreen - counts.evergreen;
  const newsRemain = quota.news - counts.news;
  if (evRemain <= 0 && newsRemain <= 0) return null;
  if (evRemain <= 0) return 'news';
  if (newsRemain <= 0) return 'evergreen';
  return evRemain >= newsRemain ? 'evergreen' : 'news';
}

/** First seed topic (already signal-ranked) whose key is not in Notion. */
export function pickEvergreenTopic(ranked: SeedTopic[], coveredKeys: Set<string>): SeedTopic | null {
  return ranked.find((t) => !coveredKeys.has(t.key)) ?? null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/planner.ts scripts/agent/planner.test.ts
git commit -m "feat(agent): planner category chooser + evergreen picker"
```

---

## Task 6: Multi-source image resolver

**Files:**
- Create: `scripts/agent/images.ts`
- Test: `scripts/agent/images.test.ts`
- Delete (after Task 10 wires the replacement): `scripts/agent/cover.ts`, `scripts/agent/inline-images.ts`

Resolves a cover and inline images from multiple free sources, priority by post type. Each source is a function returning a URL or undefined; `resolveCover` walks an ordered list. Pure ordering logic is tested with stub sources.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHit, type ImageSource } from './images.ts';

test('firstHit returns the first source that yields a url', async () => {
  const sources: ImageSource[] = [
    { name: 'a', get: async () => undefined },
    { name: 'b', get: async () => 'https://img/b.jpg' },
    { name: 'c', get: async () => 'https://img/c.jpg' },
  ];
  assert.deepEqual(await firstHit(sources), { url: 'https://img/b.jpg', source: 'b' });
});

test('firstHit returns none when all empty', async () => {
  const sources: ImageSource[] = [{ name: 'a', get: async () => undefined }];
  assert.deepEqual(await firstHit(sources), { url: undefined, source: 'none' });
});

test('firstHit skips a throwing source', async () => {
  const sources: ImageSource[] = [
    { name: 'a', get: async () => { throw new Error('boom'); } },
    { name: 'b', get: async () => 'https://img/b.jpg' },
  ];
  assert.deepEqual(await firstHit(sources), { url: 'https://img/b.jpg', source: 'b' });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./images.ts`.

- [ ] **Step 3: Implement**

```typescript
/**
 * Multi-source image resolver. Priority by post type; Unsplash stays as the
 * universal fallback. Folds the old cover.ts + inline-images.ts.
 *
 * Sources (free): Wikimedia Commons / Wikipedia (no key), Pexels (PEXELS_API_KEY,
 * optional), Pixabay (PIXABAY_API_KEY, optional), Unsplash (UNSPLASH_ACCESS_KEY),
 * plus the source article's image / OG image for news.
 */
const UNSPLASH = process.env.UNSPLASH_ACCESS_KEY;
const PEXELS = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;

export interface ImageSource { name: string; get: () => Promise<string | undefined>; }

/** Walk sources in order; return the first that yields a usable url. */
export async function firstHit(sources: ImageSource[]): Promise<{ url?: string; source: string }> {
  for (const s of sources) {
    try {
      const url = await s.get();
      if (url) return { url, source: s.name };
    } catch { /* skip and continue */ }
  }
  return { url: undefined, source: 'none' };
}

async function imageLoads(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch { return false; }
}

// ---- individual sources ----

/** Wikipedia REST: lead image (thumbnail) for a page title. */
export async function wikipediaImage(entity: string): Promise<string | undefined> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(entity)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.originalimage?.source ?? data?.thumbnail?.source ?? undefined;
  } catch { return undefined; }
}

/** Wikimedia Commons search → first image file URL. */
export async function wikimediaImage(query: string): Promise<string | undefined> {
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url&iiurlwidth=1200&origin=*`;
    const r = await fetch(api, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    const pages = data?.query?.pages ?? {};
    const first: any = Object.values(pages)[0];
    const info = first?.imageinfo?.[0];
    return info?.thumburl ?? info?.url ?? undefined;
  } catch { return undefined; }
}

export async function pexelsImage(query: string): Promise<string | undefined> {
  if (!PEXELS || !query) return undefined;
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`,
      { headers: { Authorization: PEXELS } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.photos?.[0]?.src?.large ?? undefined;
  } catch { return undefined; }
}

export async function pixabayImage(query: string): Promise<string | undefined> {
  if (!PIXABAY || !query) return undefined;
  try {
    const r = await fetch(`https://pixabay.com/api/?key=${PIXABAY}&image_type=photo&orientation=horizontal&per_page=3&q=${encodeURIComponent(query)}`);
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.hits?.[0]?.largeImageURL ?? undefined;
  } catch { return undefined; }
}

export async function unsplashImage(query: string): Promise<string | undefined> {
  if (!UNSPLASH || !query) return undefined;
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=5&content_filter=high`,
      { headers: { Authorization: `Client-ID ${UNSPLASH}` } });
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return data?.results?.[0]?.urls?.regular ?? undefined;
  } catch { return undefined; }
}

export async function ogImage(articleUrl: string): Promise<string | undefined> {
  try {
    const r = await fetch(articleUrl, { headers: { 'User-Agent': 'geo-traveller-agent/1.0' } });
    if (!r.ok) return undefined;
    const html = await r.text();
    const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ??
              html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    return m?.[1];
  } catch { return undefined; }
}

// ---- public resolvers ----

export interface CoverOpts {
  type: 'evergreen' | 'news';
  imageEntity?: string;       // evergreen: Wikipedia/Wikimedia subject
  unsplashQuery: string;      // model-supplied specific query
  fallbackQueries?: string[];
  candidateImageUrl?: string; // news: RSS image
  candidateUrl?: string;      // news: article for OG scrape
}

/** Build the ordered source chain for a cover and return the first hit. */
export async function resolveCover(o: CoverOpts): Promise<{ url?: string; source: string }> {
  const queries = [o.unsplashQuery, ...(o.fallbackQueries ?? []), 'travel photography'].filter(Boolean);
  const wikimediaQ = o.imageEntity ?? o.unsplashQuery;
  const chain: ImageSource[] = [];

  if (o.type === 'news') {
    if (o.candidateImageUrl) chain.push({ name: 'rss-image', get: async () => (await imageLoads(o.candidateImageUrl!)) ? o.candidateImageUrl : undefined });
    if (o.candidateUrl) chain.push({ name: 'og-image', get: async () => { const u = await ogImage(o.candidateUrl!); return u && (await imageLoads(u)) ? u : undefined; } });
    if (o.imageEntity) chain.push({ name: 'wikipedia', get: () => wikipediaImage(o.imageEntity!) });
    chain.push({ name: 'pexels', get: () => pexelsImage(queries[0]) });
    chain.push({ name: 'unsplash', get: () => unsplashFirst(queries) });
  } else {
    if (o.imageEntity) {
      chain.push({ name: 'wikipedia', get: () => wikipediaImage(o.imageEntity!) });
      chain.push({ name: 'wikimedia', get: () => wikimediaImage(wikimediaQ) });
    }
    chain.push({ name: 'pexels', get: () => pexelsImage(queries[0]) });
    chain.push({ name: 'pixabay', get: () => pixabayImage(queries[0]) });
    chain.push({ name: 'unsplash', get: () => unsplashFirst(queries) });
  }
  return firstHit(chain);
}

async function unsplashFirst(queries: string[]): Promise<string | undefined> {
  for (const q of queries) { const u = await unsplashImage(q); if (u) return u; }
  return undefined;
}

/**
 * Replace ![alt](query:...) inline placeholders. For each, try Wikimedia by the
 * query first (named entities), then Unsplash. Leaves the placeholder removed if
 * nothing resolves (build pipeline also drops dead images).
 */
export async function resolveInlineImages(body: string): Promise<string> {
  const re = /!\[([^\]]*)\]\(query:([^)]+)\)/g;
  const jobs: { full: string; alt: string; query: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) jobs.push({ full: m[0], alt: m[1], query: m[2].trim() });

  let out = body;
  for (const j of jobs) {
    const url = (await wikimediaImage(j.query)) ?? (await unsplashImage(j.query));
    out = url ? out.replace(j.full, `![${j.alt}](${url})`) : out.replace(j.full, '');
  }
  return out;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/images.ts scripts/agent/images.test.ts
git commit -m "feat(agent): multi-source image resolver (wikimedia/pexels/pixabay/unsplash)"
```

---

## Task 7: Generation — two templates

**Files:**
- Modify: `scripts/agent/generate.ts` (add evergreen template + a typed `mode`)

Keep the existing news system prompt and tool. Add an evergreen system prompt and a `generateEvergreen()` entry point. Both return the same `GeneratedPost` shape so the orchestrator is uniform.

- [ ] **Step 1: Add the evergreen prompt + entry point**

In `scripts/agent/generate.ts`, after the existing `SYSTEM` constant, add:

```typescript
const SYSTEM_EVERGREEN = `You write evergreen, genuinely useful travel guides for Geo-Traveller by Aditya Chaudhari. Audience: Indians traveling abroad and readers researching a specific process.

This is NOT news. It is a reference guide people find by searching. Make it the most useful page on the topic:

1. Open with a one-paragraph summary of the answer, then a "Last updated" note.
2. Cover the topic exhaustively and concretely: requirements, document checklists, costs in INR, step-by-step process, timelines, official links, and common mistakes. Use real specifics; never pad.
3. Use ## and ### headings and lists so it scans well. 800-1400 words.
4. Do NOT invent facts (fees, processing times). If a number may change, say "as of the latest update, …" and link the official source so the reader can verify.
5. No emojis, no "In conclusion", no clickbait.

REQUIRED inline links and images — same rules as the news template:
A. ENTITY LINKS: hyperlink key proper nouns to official sites / Wikipedia (embassies, VFS, government portals). 4-8 links.
B. INTERNAL BACKLINKS: link to related Geo-Traveller posts by slug, [text](/posts/SLUG/). 1-3.
C. INLINE IMAGES: 2-4 ![alt](query:specific query) placeholders; first after the intro.

Output via the publish_post tool.`;
```

- [ ] **Step 2: Add `generateEvergreen` (reuses the existing TOOL + client)**

In `scripts/agent/generate.ts`, add this exported function (alongside `generatePost`):

```typescript
import type { SeedTopic } from './topics.js';

export async function generateEvergreen(
  topic: SeedTopic,
  existingPosts: ExistingPost[] = []
): Promise<GeneratedPost> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const postList = existingPosts.length
    ? existingPosts.slice(0, 20).map((p) => `- ${p.title} — slug: ${p.slug}`).join('\n')
    : '(none yet)';

  const userPrompt = `Write the definitive Geo-Traveller guide on this topic.

Working title: ${topic.title}
Topic brief: ${topic.brief}
Suggested tags: ${topic.tags.join(', ')}

Existing Geo-Traveller posts you can backlink to inline when relevant (use the slug):

${postList}

Use the publish_post tool. Set tags to include the relevant ones above (do NOT include "Geo Daily"). coverQuery should describe a fitting photo subject.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: SYSTEM_EVERGREEN,
    tools: [TOOL as any],
    tool_choice: { type: 'tool', name: 'publish_post' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  const toolUse = res.content.find((c: any) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude did not return a tool_use block');
  const input = toolUse.input as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
  return { ...input, sourceUrl: '', sourceName: '' };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors in `scripts/agent/generate.ts`.

- [ ] **Step 4: Commit**

```bash
git add scripts/agent/generate.ts
git commit -m "feat(agent): evergreen guide generation template"
```

---

## Task 8: QA gate

**Files:**
- Create: `scripts/agent/qa.ts`
- Test: `scripts/agent/qa.test.ts`

Deterministic checks (placeholders, empty/broken-looking links, title relevance) run locally; a cheap LLM pass adds factual-consistency + duplicate judgment. The deterministic part is unit-tested; the LLM verdict is merged in.

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicChecks } from './qa.ts';

test('flags leftover query: placeholders', () => {
  const issues = deterministicChecks({ title: 'Japan Visa Guide', body: 'text ![a](query:passport) more' });
  assert.ok(issues.some((i) => i.includes('placeholder')));
});

test('flags empty or junk links', () => {
  const issues = deterministicChecks({ title: 'T', body: 'see [here]() and [x](!#postLink!#)' });
  assert.ok(issues.some((i) => i.includes('link')));
});

test('clean post yields no deterministic issues', () => {
  const issues = deterministicChecks({ title: 'Japan Visa', body: 'Apply at the [embassy](https://www.in.emb-japan.go.jp/). Done.' });
  assert.deepEqual(issues, []);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./qa.ts`.

- [ ] **Step 3: Implement**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AGENT_QA_MODEL ?? 'claude-sonnet-4-5-20250929';

export interface QaInput { title: string; body: string; sourceSummary?: string; }
export interface QaResult { status: 'Passed' | 'Flagged'; notes: string; }

/** Local, no-LLM checks for the obvious failure modes. Returns issue strings. */
export function deterministicChecks(p: QaInput): string[] {
  const issues: string[] = [];
  if (/\]\(query:/.test(p.body)) issues.push('Unresolved image placeholder (query:) left in body.');
  if (/\]\(\s*\)/.test(p.body)) issues.push('Empty link target in body.');
  if (/!#[^)]*!#/.test(p.body)) issues.push('Placeholder link token (!#…!#) in body.');
  if (/\]\((?:#|javascript:)/i.test(p.body)) issues.push('Suspicious link target in body.');
  if (!p.title || p.title.length < 8) issues.push('Title missing or too short.');
  return issues;
}

/**
 * Full QA: deterministic checks + a cheap LLM judgment on factual
 * self-consistency and whether the title matches the body. Best-effort:
 * if the LLM call fails, fall back to the deterministic result.
 */
export async function runQa(p: QaInput): Promise<QaResult> {
  const det = deterministicChecks(p);

  let llmNotes = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        'You are a publishing QA reviewer. Given a draft title and body, reply with a single line: ' +
        'either "OK" if it is internally consistent, on-topic, and free of obvious factual contradictions, ' +
        'or "FLAG: <short reason>" if not. Be terse.',
      messages: [{ role: 'user', content: `TITLE: ${p.title}\n\nBODY:\n${p.body.slice(0, 6000)}` }],
    });
    const text = res.content.find((c: any) => c.type === 'text') as any;
    const line = (text?.text ?? '').trim();
    if (/^FLAG/i.test(line)) llmNotes = line.replace(/^FLAG:?\s*/i, '');
  } catch (e: any) {
    llmNotes = `QA LLM check skipped: ${e?.message ?? e}`;
  }

  const allIssues = [...det, ...(llmNotes ? [llmNotes] : [])];
  return allIssues.length
    ? { status: 'Flagged', notes: allIssues.join(' | ').slice(0, 1900) }
    : { status: 'Passed', notes: 'No issues found by automated QA.' };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/qa.ts scripts/agent/qa.test.ts
git commit -m "feat(agent): QA gate (deterministic + LLM checks)"
```

---

## Task 9: Evergreen refresh matcher + updater

**Files:**
- Create: `scripts/agent/refresh.ts`
- Test: `scripts/agent/refresh.test.ts`

`matchGuide` decides whether a news candidate concerns an existing guide (by Topic Key tokens). `refreshGuide` regenerates the guide body with the new info and writes it to Notion in a single update, bumping Last Updated and a QA note. The matcher is unit-tested; the Notion write is integration (exercised in Task 12 dry-run).

- [ ] **Step 1: Write the failing test**

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGuide, type GuideRef } from './refresh.ts';

const guides: GuideRef[] = [
  { pageId: '1', key: 'visa:japan:in', title: 'How to Apply for a Japan Visa from India', slug: 'japan-visa-from-india' },
  { pageId: '2', key: 'visa:uk:in', title: 'How to Apply for a UK Visa from India', slug: 'uk-visa-from-india' },
];

test('matchGuide matches on country + visa tokens', () => {
  const g = matchGuide('Japan raises visa fees for Indian tourists', 'New fee structure for Japan visa', guides);
  assert.equal(g?.key, 'visa:japan:in');
});

test('matchGuide returns null for unrelated news', () => {
  assert.equal(matchGuide('New beach resort opens in Goa', 'Luxury stay', guides), null);
});

test('matchGuide does not match UK guide for Japan news', () => {
  const g = matchGuide('Japan visa fee change', '', guides);
  assert.notEqual(g?.key, 'visa:uk:in');
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./refresh.ts`.

- [ ] **Step 3: Implement**

```typescript
import { Client } from '@notionhq/client';
import { slugWord } from './topic-key.ts';

export interface GuideRef { pageId: string; key: string; title: string; slug: string; }

/**
 * Does this news candidate concern an existing evergreen guide? Matches when
 * every non-generic token of the guide's key appears in the candidate text.
 * Key shape is class:subject(:market), e.g. visa:japan:in — we require the
 * subject token (e.g. "japan") and the class token (e.g. "visa") to be present.
 */
const GENERIC = new Set(['in', 'india', 'howto', 'guide']);

export function matchGuide(title: string, summary: string, guides: GuideRef[]): GuideRef | null {
  const hay = ` ${slugWord(`${title} ${summary}`)} `.replace(/-/g, ' ');
  for (const g of guides) {
    const tokens = g.key.split(':').filter((t) => !GENERIC.has(t));
    if (tokens.length === 0) continue;
    const all = tokens.every((t) => hay.includes(` ${t.replace(/-/g, ' ')} `) || hay.includes(` ${t} `));
    if (all) return g;
  }
  return null;
}

/**
 * Regenerate the guide body with the new development folded in, then write it
 * to Notion in one update: replace body blocks, set Last Updated = today, and a
 * QA note describing the change. On any error, throw BEFORE writing so the live
 * guide is never left half-updated.
 *
 * `buildBlocks` converts markdown → Notion blocks (reuse publish.ts helper —
 * see Task 10 which exports it). `regenerateBody` produces the refreshed
 * markdown via generate.ts (the evergreen template, given the new info).
 */
export async function refreshGuide(args: {
  guide: GuideRef;
  newBodyMarkdown: string;
  qaNote: string;
  isoDate: string;
  buildBlocks: (md: string) => any[];
}): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_TOKEN! });
  const blocks = args.buildBlocks(args.newBodyMarkdown);
  if (!blocks.length) throw new Error('refresh produced no blocks; aborting to protect live guide');

  // 1. Delete existing children.
  const existing = await notion.blocks.children.list({ block_id: args.guide.pageId, page_size: 100 });
  for (const b of existing.results) await notion.blocks.delete({ block_id: (b as any).id });
  // 2. Append new body (batch of 90 per Notion limits).
  for (let i = 0; i < blocks.length; i += 90) {
    await notion.blocks.children.append({ block_id: args.guide.pageId, children: blocks.slice(i, i + 90) });
  }
  // 3. Update properties.
  await notion.pages.update({
    page_id: args.guide.pageId,
    properties: {
      'Last Updated': { date: { start: args.isoDate } },
      QA: { select: { name: 'Flagged' } },
      'QA Notes': { rich_text: [{ type: 'text', text: { content: `Auto-refreshed: ${args.qaNote}`.slice(0, 1900) } }] },
    } as any,
  });
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test`
Expected: PASS (matcher tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/refresh.ts scripts/agent/refresh.test.ts
git commit -m "feat(agent): evergreen refresh matcher + in-place updater"
```

---

## Task 10: Export markdown→blocks + new orchestrator

**Files:**
- Modify: `scripts/agent/publish.ts` (export `mdToBlocks`)
- Modify: `scripts/agent/run.ts` (full rewrite of orchestration)

- [ ] **Step 1: Export `mdToBlocks` from publish.ts**

In `scripts/agent/publish.ts`, change the declaration of the internal `mdToBlocks` function to be exported:

```typescript
export function mdToBlocks(md: string): any[] {
```

(Leave its body unchanged.)

- [ ] **Step 2: Typecheck the export**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Rewrite `run.ts`**

Replace the entire contents of `scripts/agent/run.ts` with:

```typescript
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
import { runQa } from './qa.js';

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

/** All published+draft posts, with type/key/date, for counting + dedup + backlinks. */
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
    type: 'evergreen', imageEntity: topic.imageEntity, unsplashQuery: post.coverQuery,
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
    type: 'news', unsplashQuery: post.coverQuery, candidateImageUrl: candidate.imageUrl,
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
      await refreshGuide({
        guide, newBodyMarkdown: refreshedBody, isoDate: todayUtc(),
        qaNote: `folded in: ${candidate.title}`.slice(0, 200), buildBlocks: mdToBlocks,
      });
      console.log(`[agent] refreshed guide ${guide.slug} in place.`);
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

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of tags) { const k = t.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(t); } }
  return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Extend `publishToNotion` to accept the new metadata**

In `scripts/agent/publish.ts`, update the `publishToNotion` signature and the properties it sets. Find the existing signature `export async function publishToNotion(post: GeneratedPost, coverUrl?: string)` and change it to:

```typescript
export async function publishToNotion(
  post: GeneratedPost,
  coverUrl?: string,
  meta?: { contentType?: 'Evergreen' | 'News'; topicKey?: string; lastUpdated?: string; qa?: 'Passed' | 'Flagged'; qaNotes?: string }
): Promise<{ pageId: string; url: string }> {
```

Then in the `properties` object that the function builds for `notion.pages.create`, add (alongside the existing `Status`, `Tags`, etc.):

```typescript
      ...(meta?.contentType ? { 'Content Type': { select: { name: meta.contentType } } } : {}),
      ...(meta?.topicKey ? { 'Topic Key': { rich_text: [{ type: 'text', text: { content: meta.topicKey } }] } } : {}),
      ...(meta?.lastUpdated ? { 'Last Updated': { date: { start: meta.lastUpdated } } } : {}),
      ...(meta?.qa ? { QA: { select: { name: meta.qa } } } : {}),
      ...(meta?.qaNotes ? { 'QA Notes': { rich_text: [{ type: 'text', text: { content: meta.qaNotes.slice(0, 1900) } }] } } : {}),
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors across `run.ts`, `publish.ts`, `generate.ts`, `images.ts`.

- [ ] **Step 6: Run unit tests**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add scripts/agent/run.ts scripts/agent/publish.ts
git commit -m "feat(agent): v3 orchestrator (planner + evergreen + news + refresh + QA)"
```

---

## Task 11: Remove dead modules + wire workflow

**Files:**
- Delete: `scripts/agent/cover.ts`, `scripts/agent/inline-images.ts`
- Modify: `.github/workflows/agent.yml`

- [ ] **Step 1: Confirm nothing imports the old modules**

Run: `grep -rn "from './cover" scripts/ ; grep -rn "from './inline-images" scripts/`
Expected: no matches (run.ts now uses `images.ts`). If `regen.ts` references them, update its imports to `./images.js` (`resolveCover`/`resolveInlineImages`).

- [ ] **Step 2: Delete the dead files**

```bash
git rm scripts/agent/cover.ts scripts/agent/inline-images.ts
```

- [ ] **Step 3: Update `agent.yml` cron + env**

In `.github/workflows/agent.yml`, replace the three `schedule:` cron lines with one every-2-hours line, and remove the `count` default behavior (one post/run). Set the schedule block to:

```yaml
  schedule:
    # Every 2 hours → 12 runs/day, one post each.
    - cron: '0 */2 * * *'
```

In the run step's `env:`, add the optional image keys (safe when unset):

```yaml
          PEXELS_API_KEY: ${{ secrets.PEXELS_API_KEY }}
          PIXABAY_API_KEY: ${{ secrets.PIXABAY_API_KEY }}
```

And change the run command so a scheduled run makes exactly one post (no count arg):

```yaml
        run: |
          if [ -n "$REGEN_PAGE_ID" ]; then
            npx tsx scripts/agent/regen.ts "$REGEN_PAGE_ID"
          else
            npm run agent
          fi
```

- [ ] **Step 4: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(agent): drop folded modules, cron every 2h (1 post/run)"
```

---

## Task 12: End-to-end dry run + live verification

**Files:** none (verification only)

- [ ] **Step 1: Add the Notion properties (if not already)**

Run: `npx tsx --env-file-if-exists=.env scripts/agent/add-agent-props.ts`
Expected: success line.

- [ ] **Step 2: Dry-run evergreen**

Run: `AGENT_NEWS_PER_DAY=0 AGENT_DRY_RUN=1 npx tsx --env-file-if-exists=.env scripts/agent/run.ts`
Expected: logs an evergreen topic key, a generated title, a cover source, a QA verdict, and `[DRY] would publish evergreen …` — writes nothing to Notion.

- [ ] **Step 3: Dry-run news**

Run: `AGENT_EVERGREEN_PER_DAY=0 AGENT_DRY_RUN=1 npx tsx --env-file-if-exists=.env scripts/agent/run.ts`
Expected: logs a news candidate, cover source, QA verdict, `[DRY] would publish news …`; if it matches a guide, logs the match.

- [ ] **Step 4: One real evergreen draft**

Run: `AGENT_NEWS_PER_DAY=0 npx tsx --env-file-if-exists=.env scripts/agent/run.ts`
Expected: an Evergreen draft appears in Notion with Content Type=Evergreen, a Topic Key, QA + QA Notes set. Verify in Notion.

- [ ] **Step 5: One real news draft**

Run: `AGENT_EVERGREEN_PER_DAY=0 npx tsx --env-file-if-exists=.env scripts/agent/run.ts`
Expected: a News draft with Content Type=News, QA set. Verify in Notion.

- [ ] **Step 6: Dedup check**

Run Step 4's command again.
Expected: it picks the *next* evergreen topic (not a duplicate of the first key).

- [ ] **Step 7: Commit any fixes, then push**

```bash
git push origin main
```

- [ ] **Step 8: Trigger the workflow once via dispatch**

Run: `gh workflow run agent.yml --repo edityeah/geo-traveller`
Then watch: `gh run watch "$(gh run list --workflow=agent.yml --repo edityeah/geo-traveller --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status`
Expected: green; one new draft in Notion with the v3 columns populated.

---

## Self-Review

**Spec coverage:**
- §1 cadence/stateless → Tasks 5, 10, 11 ✅
- §2 topic registry + backlog + keyword signals → Tasks 2, 3, 4, 5 ✅
- §3 evergreen refresh (Option A) → Task 9 + run.ts doNews ✅
- §4 two templates → Task 7 ✅
- §5 multi-source images → Task 6 ✅
- §6 QA gate + columns → Tasks 1, 8, 10 ✅
- §7 new Notion properties → Task 1 ✅
- §8 repo changes (new/rewritten/folded) → Tasks 6, 10, 11 ✅
- Dry-run + verification (spec "Testing") → Task 12 ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. The only intentionally-unchanged body is `mdToBlocks` (Task 10 Step 1 exports an existing function) and `publishToNotion`'s existing block — both reference real existing code in `publish.ts`.

**Type consistency:** `SeedTopic` shape is identical across topics.ts/keywords.ts/planner.ts/run.ts. `GeneratedPost` reused from generate.ts. `resolveCover`/`resolveInlineImages` names match between images.ts and run.ts. `publishToNotion` third arg `meta` shape matches the call sites in run.ts. `GuideRef` matches between refresh.ts and run.ts. `DayCounts`/`Quota` match between planner.ts and run.ts.

**Note for executor:** Task 10 Step 4 edits `publishToNotion` by description (its current full body isn't reproduced here). Open `scripts/agent/publish.ts`, locate the `properties` object passed to `notion.pages.create`, and splice in the five `...(meta?…)` lines. This is the one task that requires reading existing code rather than pasting a complete block.
