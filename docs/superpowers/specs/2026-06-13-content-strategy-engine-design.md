# Auto-blog v3 — Search-Intent Content Engine

**Date:** 2026-06-13
**Status:** Approved design, pending implementation plan

## Problem

The current auto-blog agent is a **news reactor**: it waits for travel news to
break (NewsAPI + travel RSS), then writes a reaction. Microsoft Clarity shows
very few visitors. Two structural reasons:

1. **News decays fast and is un-rankable.** A reaction to today's headline
   spikes for a day, then dies, and competes with major outlets we cannot
   outrank.
2. **No search-demand signal.** Topics are whatever happened to be in the feed,
   not what people actually search for.

The fix is to turn the agent into a **search-intent engine**: pick topics by
what people search, skew toward evergreen guides that rank for months, keep
those guides deduped and self-updating, broaden scope to anything affecting
mobility, and put a QA verdict on every draft.

## Goals

- Shift the topic mix toward evergreen, search-intent content.
- Broaden scope beyond travel/flight news to **anything affecting mobility**:
  visa processes & news, Middle-East-conflict traveler impact, entry rules,
  practical how-tos — angled at travelers (esp. Indians traveling abroad).
- **12 posts / 24h**, one every 2 hours.
- No duplicate evergreen guides — each canonical topic exists exactly once.
- Evergreen guides **self-update** when relevant news breaks.
- Better, more relatable, legally-clean images.
- An automated **QA gate** recording a verdict in Notion; **nothing
  auto-publishes** — the user flips Draft → Published manually.

## Non-Goals

- Auto-publishing. Every *new* post lands as a Draft for manual publishing.
- Paid keyword/SEO data **now** (designed to bolt on later — hybrid).
- Scraping copyrighted images from other blogs (legal/credibility risk).

## Decisions (locked with user)

| Topic | Decision |
| --- | --- |
| Keyword data | **Hybrid (C)**: free signals now (Google Autocomplete + Trends India + seed pillars), paid volume API later. |
| Images | **Multi-source resolver**. Evergreen: Wikimedia/Wikipedia → Pexels/Pixabay → Unsplash. News: source/OG image → Wikimedia → Pexels → Unsplash. Unsplash kept as fallback + inline on both. |
| Publishing | **Drafts only + automated QA gate.** Nothing auto-publishes. |
| Daily mix | **~5 evergreen / 7 news** (configurable), 12/day. |
| Evergreen dedup | Canonical **Topic Key**; a topic exists exactly once. |
| Evergreen refresh | **Option A**: auto-edit the live guide in place + "Last Updated" + QA note. New posts still draft-gated. |

## Architecture

Same pipeline shape as today (discover → generate → image → Notion), but topic
*selection* becomes demand-driven, and three subsystems are added: topic
planner, QA gate, evergreen refresh.

### 1. Orchestration & cadence — stateless, Notion-as-state

- GitHub Actions cron every 2 hours (`0 */2 * * *`), 12 runs/day.
- **Each run creates exactly one post.**
- The run reads Notion to count *today's* posts by **Content Type**, then writes
  whichever category is under its daily quota (default 5 evergreen / 7 news).
- No separate queue store. Notion is the only state, so a missed or failed run
  self-corrects on the next slot.
- Quotas + cadence configurable via env (`AGENT_EVERGREEN_PER_DAY`,
  `AGENT_NEWS_PER_DAY`).

Rejected alternatives: nightly planner filling a 12-slot queue (more moving
parts, single point of failure); one 1×/day batch (bursty, violates the
every-2h requirement).

### 2. Topic planning & dedup

- **Topic registry**: new Notion **"Topic Key"** text property on evergreen
  posts, e.g. `visa:japan:in`, `mobility:middle-east-flights`. The planner
  never writes an evergreen topic whose key already exists in Notion.
- **Evergreen backlog**: a repo config (`topics.ts`) of high-intent seed topics
  across the pillars, each with a canonical key + a base query template.
  Expanded at run time by free keyword signals (Google Autocomplete + Trends
  India) to surface real phrasings and rising interest. Planner picks the next
  uncovered, highest-signal topic.
- **News dedup**: by source URL (as today) **plus** Topic-Key matching (see §3).

#### Evergreen pillars (seed)

1. **Visa guides — India outbound**: "How to apply for a [Japan / Schengen / UK
   / US / Canada / Australia / Ireland / UAE / …] visa from India" —
   requirements, cost, processing time, appointment process.
2. **Visa / entry news affecting Indians**: US rule changes, Schengen fee hikes,
   new e-visas, passport-ranking shifts. (Often arrives via §3 as guide
   updates + a news post.)
3. **Mobility & safety explainers**: "Is it safe to travel to [region]?", how
   the Middle East situation affects flights / routes / insurance, airspace
   closures, what to do if a flight reroutes.
4. **Practical how-tos**: forex/UPI abroad, eSIM, travel insurance, airport
   procedures, cheapest time to fly X→Y.
5. **Destination guides** (existing strength): itineraries, budgets, treks.

### 3. Evergreen refresh workflow (self-updating guide)

When a news candidate matches an existing guide's Topic Key (e.g. "Japan raises
visa fee" → `visa:japan:in`):

1. **Refresh the live guide in place** — regenerate/patch the body with the new
   info, set a new **"Last Updated"** date, write a QA note describing the
   change. It stays live (editing existing content, not publishing a new post).
2. **Create a separate news Draft** that backlinks to the guide.

Matching is by Topic Key derived from the candidate (entity + topic class). When
no guide matches, the news post is created normally.

### 4. Generation — two templates

- **Evergreen guide prompt**: comprehensive and genuinely useful — requirements,
  cost, step-by-step, processing time, common pitfalls, strong internal linking,
  "last updated" framing. Higher word count. Must add real reader value.
- **News prompt**: the existing traveler-impact angle, kept tight; backlinks to
  any related guide.

Both reuse the existing structured tool-use output, entity links, internal
backlinks, and `query:` inline-image placeholders.

### 5. Images — multi-source resolver (`images.ts`)

One resolver; priority by post type; Unsplash kept as fallback throughout.

- **Evergreen cover**: Wikimedia/Wikipedia entity image (real embassy / landmark
  / passport) → Pexels/Pixabay → Unsplash.
- **News cover**: source article / OG image → Wikimedia → Pexels → Unsplash.
- **Inline (both)**: Wikimedia for named entities, else Unsplash.
- **Keys**: Wikimedia needs none; Unsplash already configured → **works with
  zero new keys today.** Pexels/Pixabay are optional free keys that improve
  coverage when added.

Folds today's `cover.ts` + `inline-images.ts` into one module.

### 6. QA gate (`qa.ts`) → Notion columns

After a draft is written, a second cheap LLM pass checks:

- factual self-consistency (against the source for news);
- leftover placeholders / broken or empty links (e.g. stray `query:`,
  `!#…!#`, empty `href`);
- title on-topic;
- near-duplicate detection vs existing titles / topic keys.

It writes:

- **"QA"** select: `Passed` / `Flagged`
- **"QA Notes"** text: what to check before publishing

Nothing auto-publishes. The user reads the verdict and publishes manually.

### 7. New Notion properties (idempotent one-shot script)

On the Posts database:

- **Topic Key** (text) — evergreen dedup + refresh matching
- **Content Type** (select: `Evergreen` / `News`) — daily-mix counting
- **QA** (select: `Passed` / `Flagged`)
- **QA Notes** (text)
- **Last Updated** (date) — evergreen refresh tracking

Added via a script in the style of `add-author-photo-prop.ts` — no manual Notion
work.

### 8. Repo changes

- **New**: `scripts/agent/topics.ts` (seed pillars + keyword-signal expansion),
  `planner.ts` (choose type, pick topic, dedup), `qa.ts` (QA pass),
  `images.ts` (multi-source resolver), `refresh.ts` (evergreen update),
  `scripts/agent/add-agent-props.ts` (one-shot Notion schema).
- **Rewritten**: `generate.ts` (two templates), `run.ts` (new orchestration).
- **Folded in**: `cover.ts` + `inline-images.ts` → `images.ts`.
- **Reused**: NewsAPI + RSS discovery, URL dedup, Unsplash, publish-to-Notion.
- `.github/workflows/agent.yml`: cron → `0 */2 * * *`, one post per run.

## Data flow (per run)

```
cron (every 2h)
  → read Notion: today's Evergreen vs News counts
  → choose category under quota
  → EVERGREEN:
       planner picks next uncovered seed topic (Topic Key not in Notion),
       expanded/ranked by free keyword signals
       → generate (evergreen template)
  → NEWS:
       discover candidates → dedup by URL
       → if candidate matches an existing guide's Topic Key:
            refresh that live guide in place (§3) + generate news draft (backlink)
          else: generate (news template)
  → resolve cover + inline images (multi-source, by type)
  → QA pass → set QA / QA Notes
  → write to Notion as Draft (Content Type, Topic Key, Last Updated set)
```

## Error handling

- Each run is independent; a failure affects only that one slot.
- Keyword-signal fetches (Autocomplete/Trends) are best-effort; on failure the
  planner falls back to the static seed order.
- Image resolver degrades down the chain to Unsplash, then to no cover (never
  blocks publishing).
- Evergreen refresh failure must **not** corrupt the live guide: build the new
  body fully, then write in a single Notion update; on error, leave the guide
  untouched and log.
- QA failure → mark `Flagged` with the error as the note (fail safe, never
  blocks the draft from being created).

## Testing / verification

- Dry-run mode (`AGENT_DRY_RUN=1`): run the full pipeline, print the would-be
  post + QA verdict + chosen images, write nothing to Notion.
- Unit-test the Topic-Key canonicalizer and the dedup/refresh matcher.
- Manual: trigger the workflow once via `workflow_dispatch`, inspect the drafts +
  QA columns in Notion.

## Cost

- 12 Claude calls/day for generation + 12 cheap QA calls/day ≈ trivial on Sonnet.
- NewsAPI/Unsplash within existing free tiers. Wikimedia free. Pexels/Pixabay
  optional free.

## Rollout

1. Add Notion properties (one-shot script).
2. Land new modules + rewritten `generate`/`run` behind the existing
   `workflow_dispatch` so it can be tested without touching the cron.
3. Verify drafts + QA columns look right in Notion.
4. Flip `agent.yml` cron to every-2h.
