/**
 * Pull published posts + pages from Notion, mirror images, write MDX files
 * to src/content/posts/notion/ and src/content/pages/. Runs before
 * `astro build`.
 *
 * If NOTION_TOKEN / NOTION_DATABASE_ID are unset, exits cleanly without
 * touching the filesystem — so local dev works with just the seed posts
 * in src/content/posts/.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fetchPublishedPosts,
  fetchPublishedPages,
  extractProps,
  extractPageProps,
  notionConfigured,
  pagesConfigured,
} from './lib/notion.js';
import { blocksToMdx } from './lib/blocks-to-mdx.js';
import { mirrorImage, mirrorFailures } from './lib/image-mirror.js';

const ROOT = process.cwd();
const POSTS_OUT = join(ROOT, 'src', 'content', 'posts', 'notion');
const PAGES_OUT = join(ROOT, 'src', 'content', 'pages');

function yamlEscape(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function frontmatter(props: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlEscape(String(item))}`);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${yamlEscape(String(v))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

async function buildPosts(warnings: string[]) {
  if (!notionConfigured) {
    console.log('[build-content] NOTION_TOKEN/NOTION_DATABASE_ID not set — skipping posts fetch.');
    return;
  }

  console.log('[build-content] Fetching published posts from Notion...');
  const pages = await fetchPublishedPosts();
  console.log(`[build-content] ${pages.length} posts to render`);

  await rm(POSTS_OUT, { recursive: true, force: true });
  await mkdir(POSTS_OUT, { recursive: true });

  for (const page of pages) {
    const props = extractProps(page);
    if (!props.title || !props.publishDate) {
      throw new Error(
        `Post ${page.id} missing required field (title or Publish Date)`
      );
    }

    const cover = props.coverUrl
      ? await mirrorImage(props.coverUrl, props.slug)
      : undefined;

    const body = await blocksToMdx(page.id, props.slug, { warnings });

    const fm = frontmatter({
      title: props.title,
      slug: props.slug,
      publishDate: props.publishDate,
      tags: props.tags,
      locationName: props.locationName,
      lat: props.lat,
      lng: props.lng,
      cover,
      excerpt: props.excerpt,
      originalUrl: props.originalUrl,
      originalDate: props.originalDate,
    });

    const file = join(POSTS_OUT, `${props.slug}.mdx`);
    await writeFile(file, fm + '\n\n' + body + '\n');
  }
}

async function buildPages(warnings: string[]) {
  if (!pagesConfigured) {
    console.log('[build-content] NOTION_PAGES_DATABASE_ID not set — skipping pages fetch.');
    return;
  }

  console.log('[build-content] Fetching published pages from Notion...');
  const pages = await fetchPublishedPages();
  console.log(`[build-content] ${pages.length} pages to render`);

  await rm(PAGES_OUT, { recursive: true, force: true });
  await mkdir(PAGES_OUT, { recursive: true });

  for (const page of pages) {
    const props = extractPageProps(page);
    if (!props.title || !props.slug) {
      console.warn(`[build-content] Skipping page ${page.id} (missing title or slug)`);
      continue;
    }

    const body = await blocksToMdx(page.id, `page-${props.slug}`, { warnings });

    const fm = frontmatter({
      title: props.title,
      slug: props.slug,
      description: props.description,
      showInFooter: props.showInFooter,
    });

    const file = join(PAGES_OUT, `${props.slug}.mdx`);
    await writeFile(file, fm + '\n\n' + body + '\n');
    console.log(`[build-content] wrote ${file}`);
  }
}

async function main() {
  const warnings: string[] = [];

  await buildPosts(warnings);
  await buildPages(warnings);

  if (warnings.length) {
    console.log(`\n[build-content] ${warnings.length} block warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log('  - ' + w);
  }
  if (mirrorFailures.length) {
    console.log(`\n[build-content] ${mirrorFailures.length} image(s) could not be mirrored (using original URL — may 404):`);
    for (const f of mirrorFailures.slice(0, 30)) {
      console.log(`  - [${f.slug}] ${f.reason}: ${f.url}`);
    }
  }
}

main().catch((err) => {
  console.error('[build-content] FAILED:', err);
  process.exit(1);
});
