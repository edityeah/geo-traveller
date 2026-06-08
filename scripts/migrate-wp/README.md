# WordPress → Notion migration

One-time script to import every published WordPress post into the Notion
`Posts` database as an `Archived` row. After migration you review each post in
Notion and flip `Status` to `Published` to put it on the new site.

## How it works

1. Parses a WordPress WXR export XML.
2. For every `post_type=post` with `status=publish`:
   - Converts the post body HTML to Notion blocks (paragraphs, headings,
     lists, images, quotes, code, links, inline emphasis).
   - Extracts the featured image URL and any inline image URLs.
   - Calls the Notion API to create a page in the Posts DB with `Status =
     Archived`, `Original URL`, `Original Date`, tags, excerpt, cover.
3. Writes `migration-report.md` listing every post + any warnings (unknown
   tags, shortcodes, etc.).

**Images are NOT re-uploaded.** Their original WordPress URLs are referenced
from Notion. The site build script (`scripts/build-content.ts`) mirrors them
to `public/img/generated/` at deploy time, so they end up served from
geo-traveller.com without any extra hosting setup. **This requires the old
WP site to stay online until after the new site's first successful build.**

## Exporting from WordPress

1. Log into the WP admin at https://geo-traveller.com/wp-admin/.
2. **Tools → Export → All content → Download Export File.**
3. Save the XML somewhere local (e.g., `~/Downloads/geo-traveller.WordPress.xml`).

You do not need to separately download images — the script reads them by URL
from the live site at build time.

## Running it

```sh
# Dry run first — no Notion writes, just parses and reports.
npx tsx scripts/migrate-wp/migrate.ts ~/Downloads/geo-traveller.WordPress.xml --dry-run

# When dry run looks good, run for real (needs NOTION_TOKEN + NOTION_DATABASE_ID in env):
npx tsx scripts/migrate-wp/migrate.ts ~/Downloads/geo-traveller.WordPress.xml

# Limit for testing (only process the first 3 posts):
npx tsx scripts/migrate-wp/migrate.ts ~/Downloads/geo-traveller.WordPress.xml --limit=3
```

After the run, open `migration-report.md` to see the result of every post and
any warnings.

## What gets flagged for manual review

Posts can include things the script can't translate 1:1. These show up as
warnings in the report:

- **Shortcodes** (`[gallery]`, `[caption]`, `[embed]`, etc.) — the script
  flags them but does **not** render them as blocks. After migration, search
  the post body in Notion for raw `[shortcode]` text and replace with proper
  Notion blocks (gallery → image blocks, embed → embed block, etc.).
- **Tables, scripts, style tags** — preserved as raw HTML in a `code` block.
- **Unknown HTML tags** — emitted as paragraphs and logged in the report.

## Verifying without real data

A small fixture is included:

```sh
npx tsx scripts/migrate-wp/migrate.ts scripts/migrate-wp/fixture.xml --dry-run
```

Expected output: 1 publishable post, 12 blocks, 1 image, 1 shortcode warning.

## Rollback

If a migration run goes badly, you can delete the Notion pages by hand
(they're all `Status = Archived` and have `Original URL` set to a
geo-traveller.com path). Or use a database view filtered to "created today"
and bulk-delete.

## After migration

1. Open the Notion Posts database.
2. Review each migrated post: fix shortcodes, check images, edit content.
3. Set `Status = Published` on the ones you want to re-publish.
4. Trigger a site build — the new site picks up the post automatically.
