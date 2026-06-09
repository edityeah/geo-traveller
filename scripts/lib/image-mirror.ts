import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Image mirror with optional Cloudflare R2 backend.
 *
 * Two modes:
 *  1. R2 mode (build / CI): when R2_PUBLIC_BASE + R2_BUCKET + CLOUDFLARE_API_TOKEN
 *     are set, images are uploaded to R2 and the public URL points at
 *     R2_PUBLIC_BASE/<slug>/<hash>.<ext>. The local public/img/generated/ folder
 *     is NOT written, so the repo stays small.
 *  2. Local mode (no R2 env): the legacy behaviour — write to
 *     public/img/generated/<slug>/<hash>.<ext> and return a /img/generated/...
 *     URL. Used for local development if R2 isn't configured.
 *
 * In both modes:
 *  - The hash key uses only origin + pathname (not the signed query string),
 *    so repeated runs hit the same key.
 *  - On any failure (timeout, 404, upload error) we return the original
 *    upstream URL unchanged. The build still ships; the image may 404 client-
 *    side but the page layout is intact.
 */

const ROOT = process.cwd();
const LOCAL_OUT_DIR = join(ROOT, 'public', 'img', 'generated');
const FETCH_TIMEOUT_MS = 20_000;

const R2_PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ENABLED = Boolean(R2_PUBLIC_BASE && R2_BUCKET && process.env.CLOUDFLARE_API_TOKEN);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extFromUrl(url: string, contentType?: string): string {
  try {
    const u = new URL(url);
    const ext = extname(u.pathname).toLowerCase();
    if (ext && /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(ext)) return ext;
  } catch {
    /* fall through */
  }
  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('svg')) return '.svg';
  if (contentType?.includes('avif')) return '.avif';
  return '.jpg';
}

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}

const cache = new Map<string, string>();
export const mirrorFailures: { url: string; slug: string; reason: string }[] = [];

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

/** HEAD a URL with a short timeout. Returns true if 2xx. */
async function urlExists(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Upload a buffer to R2 by shelling out to wrangler. Returns true on success. */
async function uploadToR2(key: string, buf: Buffer, contentType: string): Promise<boolean> {
  // Wrangler needs the bytes on disk. Use a temp file.
  const tmp = join('/tmp', `r2-${createHash('sha1').update(key).digest('hex').slice(0, 12)}${extname(key) || ''}`);
  try {
    await writeFile(tmp, buf);
  } catch {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    const args = [
      'wrangler',
      'r2',
      'object',
      'put',
      `${R2_BUCKET}/${key}`,
      '--file',
      tmp,
      '--content-type',
      contentType,
    ];
    const child = spawn('npx', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: process.env,
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code !== 0) {
        // Don't dump the full wrangler output — keep build logs readable.
        console.warn(`[mirror] R2 upload failed for ${key} (exit ${code}): ${stderr.split('\n').slice(-3).join(' ')}`);
      }
      resolve(code === 0);
    });
  });
}

/**
 * Download an image URL and mirror it.
 *
 * In R2 mode, returns https://<R2_PUBLIC_BASE>/<slug>/<hash>.<ext>.
 * In local mode, returns /img/generated/<slug>/<hash>.<ext>.
 *
 * On any failure, returns the original srcUrl unchanged.
 */
export async function mirrorImage(srcUrl: string, slug: string): Promise<string> {
  const cacheKey = `${slug}::${srcUrl}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  let u: URL;
  try {
    u = new URL(srcUrl);
  } catch {
    mirrorFailures.push({ url: srcUrl, slug, reason: 'invalid URL' });
    cache.set(cacheKey, srcUrl);
    return srcUrl;
  }

  const hashSrc = `${u.origin}${u.pathname}`;
  const hash = createHash('sha1').update(hashSrc).digest('hex').slice(0, 16);
  let ext = extFromUrl(srcUrl);
  const safeSlug = slug || 'misc';

  // ── R2 mode ────────────────────────────────────────────────────────────────
  if (R2_ENABLED) {
    const key = `${safeSlug}/${hash}${ext}`;
    const publicUrl = `${R2_PUBLIC_BASE}/${key}`;

    // Fast path: already in R2.
    if (await urlExists(publicUrl)) {
      cache.set(cacheKey, publicUrl);
      return publicUrl;
    }

    // Download upstream.
    try {
      const res = await fetchWithTimeout(srcUrl, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        mirrorFailures.push({ url: srcUrl, slug, reason: `HTTP ${res.status}` });
        cache.set(cacheKey, srcUrl);
        return srcUrl;
      }
      const ct = res.headers.get('content-type') ?? undefined;
      if (!extname(key)) ext = extFromUrl(srcUrl, ct);
      const buf = Buffer.from(await res.arrayBuffer());
      const finalKey = `${safeSlug}/${hash}${ext}`;
      const finalUrl = `${R2_PUBLIC_BASE}/${finalKey}`;
      const ok = await uploadToR2(finalKey, buf, ct ?? contentTypeFor(ext));
      if (!ok) {
        mirrorFailures.push({ url: srcUrl, slug, reason: 'r2 upload failed' });
        cache.set(cacheKey, srcUrl);
        return srcUrl;
      }
      cache.set(cacheKey, finalUrl);
      return finalUrl;
    } catch (err: any) {
      const reason = err?.code ?? err?.name ?? err?.message ?? 'unknown';
      mirrorFailures.push({ url: srcUrl, slug, reason: String(reason) });
      cache.set(cacheKey, srcUrl);
      return srcUrl;
    }
  }

  // ── Local mode (legacy, dev only) ─────────────────────────────────────────
  const dir = join(LOCAL_OUT_DIR, safeSlug);
  await mkdir(dir, { recursive: true });
  let publicPath = `/img/generated/${safeSlug}/${hash}${ext}`;
  let filePath = join(dir, `${hash}${ext}`);

  if (await exists(filePath)) {
    cache.set(cacheKey, publicPath);
    return publicPath;
  }

  try {
    const res = await fetchWithTimeout(srcUrl, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      mirrorFailures.push({ url: srcUrl, slug, reason: `HTTP ${res.status}` });
      cache.set(cacheKey, srcUrl);
      return srcUrl;
    }
    const ct = res.headers.get('content-type') ?? undefined;
    if (!extname(filePath)) {
      ext = extFromUrl(srcUrl, ct);
      publicPath = `/img/generated/${safeSlug}/${hash}${ext}`;
      filePath = join(dir, `${hash}${ext}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(filePath, buf);
    cache.set(cacheKey, publicPath);
    return publicPath;
  } catch (err: any) {
    const reason = err?.code ?? err?.name ?? err?.message ?? 'unknown';
    mirrorFailures.push({ url: srcUrl, slug, reason: String(reason) });
    cache.set(cacheKey, srcUrl);
    return srcUrl;
  }
}
