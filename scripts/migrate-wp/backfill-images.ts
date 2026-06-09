/**
 * Download every WordPress image referenced in the WXR — even ones the
 * build-time mirror can't fetch anymore (because DNS for geo-traveller.com
 * now points to Cloudflare Pages, not Hostinger).
 *
 * We bypass DNS by hitting Hostinger's origin IPs directly with the right
 * Host header. Images get saved to public/img/generated/<slug>/<hash>.<ext>
 * using the same hash the build-time mirror uses, so the next build's
 * `exists()` check picks them up without re-fetching.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import * as https from 'node:https';
import { URL } from 'node:url';

const HOSTINGER_IPS = ['147.79.120.90', '148.135.128.87'];
const OUT_ROOT = 'public/img/generated';
const TIMEOUT_MS = 30_000;

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function pickText(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    if ('__cdata' in v) return String(v.__cdata);
    if ('#text' in v) return String(v['#text']);
  }
  return String(v);
}

function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

function extFromUrl(url: string, contentType?: string): string {
  try {
    const u = new URL(url);
    const ext = extname(u.pathname).toLowerCase();
    if (ext && /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(ext)) return ext;
  } catch {}
  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('svg')) return '.svg';
  return '.jpg';
}

function hashOf(url: string): string {
  try {
    const u = new URL(url);
    return createHash('sha1').update(`${u.origin}${u.pathname}`).digest('hex').slice(0, 16);
  } catch {
    return createHash('sha1').update(url).digest('hex').slice(0, 16);
  }
}

/** Direct HTTPS fetch with custom host resolution + Host header (bypasses DNS). */
function fetchViaIP(originalUrl: string, ip: string): Promise<{ status: number; body: Buffer; contentType?: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(originalUrl); } catch (e) { return reject(e); }
    const req = https.request({
      host: ip,
      port: 443,
      method: 'GET',
      path: u.pathname + u.search,
      headers: { Host: u.hostname, 'User-Agent': 'geo-traveller-backfill/1.0' },
      rejectUnauthorized: false, // Hostinger cert won't match the IP
      timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks),
        contentType: res.headers['content-type'] as string | undefined,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function tryFetch(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  for (const ip of HOSTINGER_IPS) {
    try {
      const res = await fetchViaIP(url, ip);
      if (res.status === 200 && res.body.length > 100) {
        return { buf: res.body, ext: extFromUrl(url, res.contentType) };
      }
    } catch (err: any) {
      // try next IP
    }
  }
  return null;
}

async function main() {
  const xml = await readFile('WordPress.2026-06-09.xml', 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    cdataPropName: '__cdata',
    trimValues: false,
    processEntities: true,
    isArray: (name) => ['item', 'category', 'wp:postmeta', 'wp:comment'].includes(name),
  });
  const tree = parser.parse(xml);
  const items = arr(tree.rss.channel.item);

  // Collect: slug -> list of image URLs
  const jobs: { slug: string; url: string }[] = [];

  // First pass: post body images + featured image
  const attachmentsById = new Map<string, string>();
  for (const it of items) {
    if (pickText(it['wp:post_type']) !== 'attachment') continue;
    const id = pickText(it['wp:post_id']);
    const url = pickText(it['wp:attachment_url']);
    if (id && url) attachmentsById.set(id, url);
  }

  for (const it of items) {
    if (pickText(it['wp:post_type']) !== 'post') continue;
    if (pickText(it['wp:status']) !== 'publish') continue;
    const slug = pickText(it['wp:post_name']).slice(0, 80);
    const body = pickText(it['content:encoded']);
    const imgs = Array.from(body.matchAll(/<img[^>]+src="([^"]+)"/g)).map((m) => m[1]);
    for (const src of imgs) {
      // normalize http -> https
      const url = src.replace(/^http:\/\/(www\.)?geo-traveller\.com/i, 'https://geo-traveller.com');
      jobs.push({ slug, url });
    }
    // Featured image
    for (const meta of arr(it['wp:postmeta'])) {
      const key = pickText(meta['wp:meta_key']);
      if (key === '_thumbnail_id') {
        const thumbId = pickText(meta['wp:meta_value']);
        const attUrl = attachmentsById.get(thumbId);
        if (attUrl) {
          const url = attUrl.replace(/^http:\/\/(www\.)?geo-traveller\.com/i, 'https://geo-traveller.com');
          jobs.push({ slug, url });
        }
      }
    }
  }

  console.log(`${jobs.length} image URLs to check across ${new Set(jobs.map((j) => j.slug)).size} posts.`);

  let downloaded = 0, skipped = 0, failed = 0;
  for (const job of jobs) {
    const hash = hashOf(job.url);
    const ext0 = extFromUrl(job.url);
    const dir = join(OUT_ROOT, job.slug);
    const candidate = join(dir, `${hash}${ext0}`);
    if (await exists(candidate)) { skipped++; continue; }
    // Try alternate extensions
    let foundExisting = false;
    for (const e of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
      if (await exists(join(dir, `${hash}${e}`))) { foundExisting = true; break; }
    }
    if (foundExisting) { skipped++; continue; }

    const result = await tryFetch(job.url);
    if (!result) {
      failed++;
      if (failed <= 5) console.log(`  FAIL ${job.url}`);
      continue;
    }
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${hash}${result.ext}`), result.buf);
    downloaded++;
    if (downloaded % 10 === 0) console.log(`  downloaded ${downloaded}`);
  }
  console.log(`\nDone: ${downloaded} downloaded, ${skipped} already cached, ${failed} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
