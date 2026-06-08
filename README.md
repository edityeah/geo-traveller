# Geo-Traveller

A personal travel blog. Static site built with [Astro](https://astro.build),
content sourced from a Notion database, hosted on Cloudflare Pages.

## Local development

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # builds dist/
npm run preview    # serve the built dist/
```

Without a Notion token, the site builds from local seed posts in
`src/content/posts/`. Useful for design work and testing.

## Project layout

```
src/
  content/
    posts/              # seed/static posts (committed)
      notion/           # Notion-sourced posts (gitignored, rebuilt each deploy)
  content.config.ts     # content collection schema
  layouts/Base.astro    # site shell
  components/           # PostCard, etc.
  pages/                # index, posts/[slug], tags/[tag], archive, about, rss
  lib/posts.ts          # post helpers
  styles/global.css
scripts/
  build-content.ts      # Notion → MDX
  lib/
    notion.ts           # Notion API wrapper
    image-mirror.ts     # downloads + mirrors Notion images to public/img/generated/
    blocks-to-mdx.ts    # Notion block tree → MDX
public/
  img/generated/        # mirrored images (gitignored, rebuilt each deploy)
docs/
  superpowers/specs/    # design spec for this rebuild
```

## Notion setup

You need to do this once.

### 1. Create the Notion integration

1. Go to https://notion.so/my-integrations and click **New integration**.
2. Name it "Geo-Traveller". Workspace = your personal workspace.
3. Type = **Internal**. Capabilities = read content, read comments (write is
   not required).
4. Copy the **Internal Integration Secret** — this is your `NOTION_TOKEN`.

### 2. Create the Posts database

In Notion, create a new full-page database called **Posts** with these
properties (case-sensitive, exact names):

| Property         | Type           | Notes                              |
|------------------|----------------|------------------------------------|
| Title            | Title          | (default property)                 |
| Slug             | Text           | leave blank to derive from title   |
| Status           | Select         | options: `Draft`, `Published`, `Archived` |
| Publish Date     | Date           | required                           |
| Tags             | Multi-select   |                                    |
| Location Name    | Text           | optional                           |
| Latitude         | Number         | optional, for map                  |
| Longitude        | Number         | optional, for map                  |
| Cover            | Files & media  | single image                       |
| Excerpt          | Text           | 1–2 sentences                      |
| Original URL     | URL            | set by migration script            |
| Original Date    | Date           | set by migration script            |

### 3. Connect the integration to the database

In the database, click `···` (top right) → **Add connections** → pick your
"Geo-Traveller" integration.

### 4. Find the database ID

Open the database as a full page. The URL looks like:

```
https://www.notion.so/<workspace>/<DATABASE_ID>?v=<view_id>
```

The 32-character `DATABASE_ID` is what you need.

### 5. Configure environment

Copy `.env.example` to `.env` and fill in:

```
NOTION_TOKEN=secret_...
NOTION_DATABASE_ID=...
```

Now `npm run build` will pull published posts from Notion in addition to the
seed posts.

## Cloudflare Pages deploy (Phase 4 — do later)

1. Push this repo to GitHub.
2. In Cloudflare dashboard → Pages → Create project → Connect to Git → pick
   the repo.
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output:** `dist`
   - **Node version env:** `NODE_VERSION = 22`
4. Add environment variables: `NOTION_TOKEN`, `NOTION_DATABASE_ID`.
5. Deploy. The first deploy uses the temporary `*.pages.dev` URL.
6. Once happy, add custom domain `geo-traveller.com` (Pages → Custom domains).

### Publishing a post

1. Write the post in the Posts database in Notion.
2. Flip `Status` to `Published`.
3. Trigger a deploy: hit your Cloudflare Pages **Deploy hook** URL. Easiest
   ways:
   - Notion button block that opens the hook URL.
   - iOS Shortcut / bookmarklet.
   - Cloudflare dashboard → Pages → your project → Deployments → Retry latest.

A build takes 1–2 minutes; when it finishes, the post is live.

## Phases (per the design spec)

- ✅ **Phase 1 — Skeleton.** Astro project, build pipeline, seed posts,
  templates. Builds cleanly.
- ⏭️ **Phase 2 — Design.** Iterate on typography, layout, photo treatment.
- ⏭️ **Phase 3 — Migration.** Build the WordPress importer, seed Notion from
  the WP export.
- ⏭️ **Phase 4 — Extras + cutover.** Pagefind search, Giscus comments,
  Buttondown newsletter, Leaflet map, gallery, `_redirects`, DNS flip.

See [docs/superpowers/specs/2026-06-08-geo-traveller-rebuild-design.md](docs/superpowers/specs/2026-06-08-geo-traveller-rebuild-design.md)
for the full design.

## Known gotchas

- **Notion image URLs expire** (~1 hour). The build mirrors them to
  `public/img/generated/`. Never link directly to a Notion image URL from a
  template — always go through `mirrorImage()`.
- **Notion API rate limits:** the client retries with exponential backoff.
- **npm cache:** if `npm install` fails with `EEXIST` cache errors on this
  machine, run `npm install --cache /tmp/npm-cache-$$` or
  `npm cache clean --force`.
