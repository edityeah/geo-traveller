/**
 * Migrate WordPress posts from a WXR export into the Notion Posts database.
 *
 * Usage:
 *   tsx scripts/migrate-wp/migrate.ts <path-to-wxr.xml> [--dry-run] [--limit=N]
 *
 * Reads NOTION_TOKEN and NOTION_DATABASE_ID from env.
 *
 * Emits migration-report.md in cwd with per-post status + any warnings.
 */
import { Client } from '@notionhq/client';
import { writeFile } from 'node:fs/promises';
import { parseWxr } from './parse-wxr.js';
import { htmlToBlocks } from './html-to-blocks.js';
import { createMigratedPage } from './create-page.js';

type RowResult = {
  title: string;
  slug: string;
  status: 'created' | 'skipped' | 'failed' | 'dry-run';
  notionUrl?: string;
  warnings: string[];
  error?: string;
};

function parseArgs(argv: string[]) {
  const args = { file: '', dryRun: false, limit: Infinity };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--limit=')) args.limit = Number(a.split('=')[1]);
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: tsx scripts/migrate-wp/migrate.ts <wxr.xml> [--dry-run] [--limit=N]');
    process.exit(1);
  }

  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!args.dryRun && (!token || !databaseId)) {
    console.error('NOTION_TOKEN and NOTION_DATABASE_ID required (unless --dry-run).');
    process.exit(1);
  }

  const notion = token ? new Client({ auth: token }) : null;

  console.log(`[migrate] parsing ${args.file}`);
  const wp = await parseWxr(args.file);
  const publishable = wp.filter(
    (p) => p.status === 'publish' || p.status === 'private'
  );
  const toProcess = publishable.slice(0, args.limit);
  console.log(
    `[migrate] ${wp.length} items, ${publishable.length} publishable posts, processing ${toProcess.length}`
  );

  const results: RowResult[] = [];

  for (const post of toProcess) {
    const { blocks, imageUrls, warnings } = htmlToBlocks(post.bodyHtml);
    const slug = post.slug || slugify(post.title);
    if (!post.title || !post.publishDate) {
      results.push({
        title: post.title || '(untitled)',
        slug,
        status: 'failed',
        warnings,
        error: 'missing title or publishDate',
      });
      continue;
    }

    if (args.dryRun || !notion || !databaseId) {
      results.push({
        title: post.title,
        slug,
        status: 'dry-run',
        warnings: [
          ...warnings,
          `${blocks.length} blocks, ${imageUrls.length} images`,
        ],
      });
      console.log(
        `[migrate] DRY ${post.title} (${blocks.length} blocks, ${imageUrls.length} images)`
      );
      continue;
    }

    try {
      const tags = [...post.categories, ...post.tags].filter(
        (t, i, arr) => arr.indexOf(t) === i
      );
      const { url } = await createMigratedPage(notion, {
        databaseId,
        title: post.title,
        slug,
        publishDate: post.publishDate,
        tags,
        excerpt: post.excerpt || undefined,
        coverUrl: post.featuredImageUrl,
        originalUrl: post.link,
        originalDate: post.publishDate,
        blocks,
      });
      results.push({
        title: post.title,
        slug,
        status: 'created',
        notionUrl: url,
        warnings,
      });
      console.log(`[migrate] OK  ${post.title}`);
    } catch (err: any) {
      results.push({
        title: post.title,
        slug,
        status: 'failed',
        warnings,
        error: err?.message ?? String(err),
      });
      console.error(`[migrate] FAIL ${post.title}: ${err?.message}`);
    }
  }

  await writeReport(results);
  console.log(`[migrate] wrote migration-report.md (${results.length} rows)`);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function writeReport(rows: RowResult[]): Promise<void> {
  const lines: string[] = [];
  lines.push('# WordPress migration report');
  lines.push('');
  const stats = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  lines.push(
    `**Summary:** ${rows.length} posts — ${Object.entries(stats)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}`
  );
  lines.push('');
  lines.push('| Status | Title | Slug | Warnings | Error |');
  lines.push('|--------|-------|------|----------|-------|');
  for (const r of rows) {
    const warn = r.warnings.length ? r.warnings.length + ' warning(s)' : '';
    lines.push(
      `| ${r.status} | ${escapeMd(r.title)} | ${r.slug} | ${warn} | ${escapeMd(r.error ?? '')} |`
    );
  }
  lines.push('');
  for (const r of rows) {
    if (r.warnings.length === 0) continue;
    lines.push(`### ${r.title}`);
    for (const w of r.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  await writeFile('migration-report.md', lines.join('\n'));
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
