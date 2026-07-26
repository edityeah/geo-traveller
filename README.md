# Geo-Traveller

[geo-traveller.com](https://geo-traveller.com) — a travel publication covering
flights, food, experiences, travel news, and how-to guides across India and the
world.

It's a **static site** built with [Astro](https://astro.build), with **Notion as
the CMS**, hosted on **Cloudflare Pages**. On top of that sits an **autonomous
blog agent** that discovers trending stories, writes them with an LLM, checks
their SEO, and files them into Notion as drafts for review.

---

## How it works

```
                    ┌── Google Trends (IN + US) ──┐
 RSS / news feeds ──┤                             ├─► agent ─► LLM (write) ─► SEO self-edit ─► QA ─► Notion (DRAFT)
 Curly Tales feeds ─┘                             │
                                                  │           you review + flip Status → Published in Notion
                                                  ▼
 Notion "Posts" DB (Published) ──► build-content ──► Astro build ──► Cloudflare Pages ──► geo-traveller.com
                                   (mirrors images to R2)
```

- **Content lives in Notion.** The `Posts` database is the source of truth. Only
  posts with `Status = Published` are built onto the site.
- **The agent only ever creates _drafts_.** Nothing auto-publishes — you review
  in Notion and flip `Status` to `Published`.
- **Each deploy rebuilds the whole site from Notion.** Editing a published post
  (text or cover) is picked up on the next deploy; images are mirrored to R2.

---

## Local development

Requires Node 22 (see `.nvmrc`).

```sh
npm install
npm run dev          # http://localhost:4321
npm run build        # build:content (Notion→MDX) + astro build + pagefind
npm run preview      # serve the built dist/
npm test             # unit tests (node --test)
npm run typecheck    # astro check
```

Without a Notion token, the site builds from the local seed posts in
`src/content/posts/` — handy for design work.

---

## Project layout

```
src/
  content/
    posts/notion/       # Notion-sourced posts (gitignored, rebuilt each deploy)
    pages/              # about/contact/privacy/terms (from Notion "Pages" DB)
  content.config.ts     # content collection schema
  layouts/Base.astro    # site shell (SEO meta, JSON-LD, header/footer)
  components/            # PostCard, Sidebar, Subscribe, CommentSection, …
  pages/                # index, posts/[slug], category/[category], tags/[tag],
                        #   archive ("All stories"), map, gallery, search, rss
  lib/
    posts.ts            # post helpers
    category-data.ts    # the six focus categories + tag→category matching
    categories.ts       # Astro wrappers over category-data
    seo.ts              # SITE config, JSON-LD builders

functions/api/          # Cloudflare Pages Functions (serverless endpoints)
  contact.ts            # contact form   → Notion + Resend ack
  subscribe.ts          # newsletter     → Notion "Subscribers" + welcome email
  unsubscribe.ts        # one-click unsubscribe (HMAC-signed)
  likes/[slug].ts       # like counter (KV: LIKES)
  comments/[slug].ts    # native comments (KV: COMMENTS, mirrored to Notion)

scripts/
  build-content.ts      # Notion → MDX (+ mirrors images, writes _redirects)
  lib/
    notion.ts           # Notion API wrapper
    image-mirror.ts     # mirrors images to R2 (images.geo-traveller.com)
    blocks-to-mdx.ts    # Notion block tree → MDX
  agent/                # the auto-blog agent (see below)
  digest/send.ts        # weekly subscriber digest email
  migrate-wp/           # one-off WordPress → Notion migration

.github/workflows/      # CI (see below)
docs/superpowers/specs/ # design specs
```

---

## The auto-blog agent (`scripts/agent/`)

Runs 4×/day in CI (`agent.yml`). Each run produces **one** draft. The daily cap
and mix are computed from Notion state + a trends signal.

**Pipeline** (`run.ts` orchestrates):

1. **Discover** — `discover.ts` pulls travel/news RSS feeds + Curly Tales
   (food/experiences); `trends.ts` pulls the **Google Trends** "trending now"
   RSS (India + US), filtered to travel/food/experience relevance and grounded
   in each trend's real source article.
2. **Plan** — `planner.ts` + `trends.ts::trendMix` decide the day's category
   split. Base is **2 posts/day** (`1` evergreen guide + `1` food/experiences;
   news only when trends tilt the flexible slot). Deliberately low velocity:
   high-volume LLM news rewrites tripped Google's scaled-content
   classification and blocked indexing — evergreen long-tail is where a
   low-authority domain can rank.
3. **Write** — `generate.ts` produces the post (title, slug, body, tags,
   excerpt, cover query, focus keyword) via the LLM. Three templates: news,
   evergreen guide, event.
4. **SEO self-edit** — `seo.ts` scores the draft 0–100 (focus keyword in
   title/intro/heading/density, heading structure, internal + external links,
   readability). If it scores below `AGENT_SEO_MIN` (70), the agent **rewrites
   it once** and keeps the better version.
5. **Images** — `images.ts` resolves a cover + inline images from Unsplash /
   Wikimedia / Pexels / Pixabay, using **LLM vision** to pick the best match.
6. **QA** — `qa.ts` runs deterministic checks + an LLM sanity check.
7. **Publish** — `publish.ts` writes the post to Notion as a **Draft** (with the
   SEO score in the QA Notes column).

**Pluggable LLM provider** (`llm.ts`) — the whole agent runs on either Anthropic
or OpenAI, switched by one env var:

```
AGENT_LLM_PROVIDER = anthropic (default) | openai
```

Currently the CI runs on **OpenAI**: `gpt-5.1` for writing + image vision,
`gpt-4.1` for QA (`AGENT_OPENAI_MODEL`, `AGENT_OPENAI_QA_MODEL`). Revert to
Claude by flipping `AGENT_LLM_PROVIDER` back to `anthropic`.

**Manual controls** (`agent.yml` → Run workflow):
- `category` = `news | events | evergreen` → force one post of that category
  (env `AGENT_FORCE_CATEGORY`), ignoring quotas.
- `regen_page_id` → regenerate a specific Notion page (`regen.ts`).

Quotas/thresholds are env-overridable: `AGENT_EVERGREEN_PER_DAY`,
`AGENT_NEWS_PER_DAY`, `AGENT_EVENTS_PER_DAY`, `AGENT_SEO_MIN`, `AGENT_DRY_RUN`.

---

## Content categories

Posts are grouped into six focus categories, derived purely from their tags
(`src/lib/category-data.ts`), which drive the nav, homepage sections, card
badges, and `/category/<key>/` landing pages:

`Flights & Airlines` · `Food` · `Experiences` · `Travel News` · `Guides` ·
`Travel` (catch-all).

---

## Interactive features (Cloudflare Pages Functions)

All email is sent from `no-reply@geo-traveller.com` via **Resend**.

- **Contact form** → stored in a Notion "Contact Submissions" DB + an
  acknowledgement email to the sender.
- **Newsletter** → `subscribe.ts` stores subscribers in a Notion "Subscribers"
  DB and sends a **welcome email**. `unsubscribe.ts` handles one-click
  unsubscribe (HMAC-signed over the Notion page id via `UNSUB_SECRET`).
- **Weekly digest** (`scripts/digest/send.ts`, `digest.yml`, Sat 05:30 UTC =
  11:00 IST) → emails active subscribers a newsletter-style roundup of the
  week's posts (skips weeks with no new posts).
- **Likes** and **comments** → Cloudflare KV (`LIKES`, `COMMENTS`); comments are
  mirrored to a Notion "Comments" DB.

---

## GitHub Actions

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy.yml` | every 30 min + push | build from Notion + deploy to Cloudflare Pages |
| `agent.yml` | 4×/day + manual | run the blog agent (one draft/run) |
| `digest.yml` | Sat 05:30 UTC + manual | send the weekly subscriber digest |
| `set-pages-secrets.yml` | manual | push runtime secrets to the Pages project |
| `backfill-comments-kv.yml`, `kv-comment-remove.yml`, `dns-audit.yml`, `r2-migrate.yml` | manual | one-off maintenance |

> Scheduled runs consume GitHub Actions minutes. This repo is **public** so
> Actions are free/unlimited; on a private repo the hourly cadence exceeds the
> free tier.

---

## Environment & secrets

**Build-time** (GitHub Actions secrets, inlined by Astro / used by the build):
`NOTION_TOKEN`, `NOTION_DATABASE_ID`, `PUBLIC_CLARITY_ID`, `PUBLIC_CFA_TOKEN`,
site-verification vars, and R2 (`R2_PUBLIC_BASE`, `R2_BUCKET`,
`CLOUDFLARE_API_TOKEN`) for image mirroring. See `.env.example`.

**Agent** (GitHub Actions secrets): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`AGENT_LLM_PROVIDER`, `AGENT_OPENAI_MODEL`, `AGENT_OPENAI_QA_MODEL`,
`NEWSAPI_KEY` (optional), `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`,
`PIXABAY_API_KEY`.

**Runtime** (Cloudflare Pages secrets, for the Functions — pushed via
`set-pages-secrets.yml`): `NOTION_TOKEN`, `NOTION_CONTACT_DB_ID`,
`NOTION_COMMENTS_DB_ID`, `NOTION_SUBSCRIBERS_DB_ID`, `RESEND_API_KEY`,
`UNSUB_SECRET`, plus the `COMMENTS` and `LIKES` KV bindings.

---

## Deploy

Pushing to `main`, the 30-minute cron, or a manual `deploy.yml` run rebuilds the
site from Notion (`Published` posts only) and deploys `dist/` to Cloudflare Pages
via `wrangler-action`. To deploy locally:

```sh
npm run deploy       # build + wrangler pages deploy
```
