# Geo-Traveller Rebuild — Design Spec

**Date:** 2026-06-08
**Owner:** Aditya
**Status:** Approved (brainstorm phase)

## Goal

Replace the existing WordPress-hosted travel blog at `geo-traveller.com` with a low-maintenance, fast-loading static site. The author writes posts in Notion; the site rebuilds on publish. All existing WordPress content is migrated into the new system. The current domain is preserved.

## Non-goals

- A general-purpose CMS for other people.
- Multi-author workflows, drafts review, scheduling beyond what Notion natively offers.
- Running WordPress in parallel after cutover.

## Stack

| Concern | Choice |
|---|---|
| Content source | Notion database (`Posts`) via Notion API |
| Site generator | Astro (static output, MDX support, minimal client JS) |
| Hosting | Cloudflare Pages |
| Build trigger | Cloudflare Pages deploy hook (manual button initially) |
| Search | Pagefind (build-time index, client-side runtime) |
| Comments | Giscus (GitHub Discussions backend) |
| Newsletter | Buttondown (embed form) |
| Map | Leaflet + OpenStreetMap tiles |
| Analytics | Cloudflare Web Analytics |
| Domain | Keep `geo-traveller.com`; DNS cutover after staging QA |

## Content model (Notion database `Posts`)

| Property | Type | Notes |
|---|---|---|
| Title | Title | Post title. |
| Slug | Rich text | URL slug. If blank at build time, derived from title via `slugify`. |
| Status | Select | `Draft`, `Published`, `Archived`. Only `Published` ships. |
| Publish Date | Date | Displayed and sort key. |
| Tags | Multi-select | Free-form. Each generates a tag page. |
| Location Name | Rich text | E.g., "Kyoto, Japan". Optional. |
| Latitude | Number | For map pin. Optional; if missing, post is omitted from the map. |
| Longitude | Number | For map pin. Optional. |
| Cover | Files | Single hero image. |
| Excerpt | Rich text | 1–2 sentence summary. Used on cards, RSS, OG meta. |
| Original URL | URL | Old WordPress URL (set by importer on migrated posts). Drives 301 redirects when slug changes. |
| Original Date | Date | Original WP publish date (preserved for migrated posts). |

The Notion page body itself is the post content — blocks become rendered HTML.

## Architecture

```
┌────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐
│ Notion         │    │ Build (Astro)       │    │ Cloudflare Pages     │
│  Posts DB      │───▶│  - Fetch published  │───▶│  - Static HTML/CSS   │
│  Page blocks   │    │  - Mirror images    │    │  - Pagefind index    │
│  Images        │    │  - Convert → MDX    │    │  - _redirects        │
└────────────────┘    │  - Render pages     │    │  - Custom domain     │
                      │  - Build search idx │    └──────────────────────┘
                      └─────────────────────┘
                              ▲
                              │ deploy hook
                              │
                       ┌──────────────────┐
                       │ "Publish" button │
                       │ (bookmarklet /   │
                       │  Notion button)  │
                       └──────────────────┘
```

### Build steps (in order)

1. **Fetch published posts.** Query Notion DB filtered by `Status = Published`, paginated.
2. **Mirror images.** Notion's S3 image URLs are signed and expire in ~1 hour, so any image *uploaded into Notion* must be mirrored. For every such image (block-level or `Cover`), download to `public/img/<slug>/<hash>.<ext>` and rewrite the reference. Images referenced by external URL (e.g., R2-hosted, from the migration) are stable and can either be mirrored too (simpler, uniform) or left as-is (saves build time). Decision: mirror everything, uniformly — simpler invariant, cost is negligible at this scale.
3. **Convert Notion blocks → MDX.** Supported blocks: paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, quote, code, image (with caption), divider, callout, embed (YouTube, Twitter/X, Instagram, generic iframe), bookmark, video (YouTube/Vimeo). Unsupported blocks log a warning with the post slug — the build does not fail but emits a report.
4. **Render pages.**
   - `/` — homepage with latest posts, optionally featured.
   - `/posts/<slug>/` — individual post.
   - `/tags/<tag>/` — tag archive.
   - `/archive/` — chronological list of all posts.
   - `/map/` — Leaflet map with a pin per post that has lat/lng.
   - `/gallery/` — grid of all post cover images, linking to the posts.
   - `/about/` — static MDX page in the repo (not in Notion).
   - `/rss.xml` and `/sitemap.xml`.
5. **Build search index.** Pagefind runs after Astro emits HTML; produces `/pagefind/`.
6. **Emit `_redirects`.** For each migrated post whose new slug differs from `Original URL`, add `OLD_PATH NEW_PATH 301`.
7. **Deploy.** Cloudflare Pages picks up the artifact and serves.

### Publish flow

- Default: flip `Status` to `Published` in Notion, then tap the "Publish" Notion button (or a bookmarklet on desktop). The button hits the Cloudflare Pages deploy hook URL. Build runs in 1–2 minutes.
- Optional later upgrade: a Cloudflare Worker on a 15-minute cron polls Notion for newly-Published rows and auto-triggers the hook. Defer until manual flow is annoying.

## WordPress migration

One-time, run locally. Script lives in `scripts/migrate-wp/` and is deleted after use.

1. **Export from WordPress.** WP admin → Tools → Export → All content → WXR XML file. Also download `/wp-content/uploads/` as a zip (via Hostinger file manager or SFTP if WP can't zip it).
2. **Parse WXR.** For each `<item type="post">` extract: title, slug, publish date, status, tag/category list, body HTML, featured image reference.
3. **HTML → Notion blocks.** Implemented with a focused HTML-to-Notion-blocks converter. Map: `<p>` → paragraph, `<h1..h6>` → heading_1/2/3 (clamp h4+ to h3), `<img>` → image block, `<blockquote>` → quote, `<ul>/<ol>` → lists, `<pre>` → code, `<a>` → inline link. Shortcodes (`[gallery]`, `[caption]`, etc.) and custom HTML widgets log a warning and emit the raw HTML as a code block placeholder for manual cleanup.
4. **Image upload.** For each `<img>`, find the file in the uploads zip, upload to a Cloudflare R2 bucket (or imgur-equivalent), and reference by external URL in the Notion image block. Rationale: Notion's own upload-to-page flow via API is awkward for bulk migration; R2 keeps images stable and CDN-served.
5. **Create Notion rows.** Status = `Archived`, never `Published` on first import — author flips to `Published` after review. Set `Original URL`, `Original Date`, `Tags`, `Cover`.
6. **Report.** Emit `migration-report.md` listing every post, every warning, every image not found.

## Domain cutover plan

1. Build new site, deploy to `geo-traveller.pages.dev` (Cloudflare Pages default).
2. QA: every imported post renders, images load, search finds them, RSS validates, map pins appear, Giscus loads, newsletter form embeds.
3. In Cloudflare Pages → custom domains, add `geo-traveller.com` and `www.geo-traveller.com`.
4. At Hostinger DNS, update A/AAAA/CNAME records to point at Cloudflare. (Or transfer the domain to Cloudflare DNS for faster propagation control.)
5. Wait for SSL provisioning (~minutes).
6. Verify on the live domain.
7. Disable WordPress / cancel Hostinger plan.

## SEO preservation

- `_redirects` covers any URL whose slug changed during migration.
- `<link rel="canonical">` on each post points at the new canonical URL.
- `sitemap.xml` lists every post.
- `Original Date` is used as `<meta property="article:published_time">` so search engines see the true historical date.

## Error handling

| Failure | Handling |
|---|---|
| Notion API rate limit | Exponential backoff in the Notion client wrapper. |
| Image download fails during build | Fail the build (loudly) — broken images shouldn't ship. |
| Unsupported Notion block | Emit warning; render a `<!-- unsupported block: type -->` HTML comment in place. |
| Post with no `Publish Date` | Fail the build with a clear message naming the offending post. |
| Migration script can't find an image | Logged to report; post still imported with image placeholder. |
| Build trigger button fires repeatedly | Cloudflare Pages dedupes concurrent builds; harmless. |

## Repo layout

```
.
├── astro.config.mjs
├── src/
│   ├── layouts/
│   ├── components/
│   ├── pages/
│   │   ├── index.astro
│   │   ├── posts/[slug].astro
│   │   ├── tags/[tag].astro
│   │   ├── archive.astro
│   │   ├── map.astro
│   │   ├── gallery.astro
│   │   └── about.mdx
│   └── styles/
├── content/                   # generated MDX from Notion — gitignored, rebuilt every deploy
├── public/
│   └── img/                   # mirrored Notion images
├── scripts/
│   ├── build-content.ts       # Notion → MDX
│   ├── mirror-images.ts
│   └── migrate-wp/            # one-time WP importer
└── docs/superpowers/specs/    # this file
```

## Phasing

Each phase is independently deployable.

1. **Skeleton.** Astro project, Notion content model created manually, build pipeline working end-to-end with 2–3 hand-written test posts. Deployed to `geo-traveller.pages.dev`. Validates the architecture.
2. **Design.** Photo-forward editorial layout — homepage, post page, tag page, archive. Visual polish, typography, responsive.
3. **Migration.** Build and run the WordPress importer. Review imported posts in Notion. Flip them to `Published` in batches.
4. **Extras + cutover.** Pagefind search, Giscus comments, Buttondown newsletter, Leaflet map, gallery, RSS, sitemap, analytics, `_redirects`. DNS cutover from Hostinger to Cloudflare.

## Open questions

None — all decisions are locked in for the brainstorm phase. The implementation plan (next step) will surface the lower-level questions (exact image-mirror naming scheme, Pagefind config, Giscus repo to use, R2 bucket setup vs. alternatives).
