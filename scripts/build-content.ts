/**
 * Pull published posts from Notion, mirror images, write MDX files to
 * src/content/posts-generated/. Runs before `astro build`.
 *
 * If NOTION_TOKEN / NOTION_DATABASE_ID are unset, exits cleanly without
 * touching the filesystem — so local dev works with just the seed posts
 * in src/content/posts/.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchPublishedPosts, extractProps, notionConfigured } from './lib/notion.js';
import { blocksToMdx } from './lib/blocks-to-mdx.js';
import { mirrorImage } from './lib/image-mirror.js';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'src', 'content', 'posts', 'notion');

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

async function main() {
  if (!notionConfigured) {
    console.log('[build-content] NOTION_TOKEN/NOTION_DATABASE_ID not set — skipping Notion fetch.');
    return;
  }

  console.log('[build-content] Fetching published posts from Notion...');
  const pages = await fetchPublishedPosts();
  console.log(`[build-content] ${pages.length} posts to render`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const warnings: string[] = [];

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

    const file = join(OUT_DIR, `${props.slug}.mdx`);
    await writeFile(file, fm + '\n\n' + body + '\n');
    console.log(`[build-content] wrote ${file}`);
  }

  if (warnings.length) {
    console.log(`\n[build-content] ${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log('  - ' + w);
  }
}

main().catch((err) => {
  console.error('[build-content] FAILED:', err);
  process.exit(1);
});
