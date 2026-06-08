import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'public', 'img', 'generated');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function extFromUrl(url: string, contentType?: string): string {
  const u = new URL(url);
  const ext = extname(u.pathname).toLowerCase();
  if (ext && /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(ext)) return ext;
  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('svg')) return '.svg';
  return '.jpg';
}

const cache = new Map<string, string>();

/**
 * Download an image URL and mirror it to public/img/generated/<slug>/<hash>.<ext>.
 * Returns the public path (e.g., /img/generated/<slug>/abc123.jpg).
 * Idempotent: the hash key is derived from the URL's stable parts (path + filename),
 * not the signed query string, so re-runs hit the same file.
 */
export async function mirrorImage(srcUrl: string, slug: string): Promise<string> {
  const cacheKey = `${slug}::${srcUrl}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const u = new URL(srcUrl);
  const hashSrc = `${u.origin}${u.pathname}`;
  const hash = createHash('sha1').update(hashSrc).digest('hex').slice(0, 16);

  const dir = join(OUT_DIR, slug);
  await mkdir(dir, { recursive: true });

  let ext = extFromUrl(srcUrl);
  let publicPath = `/img/generated/${slug}/${hash}${ext}`;
  let filePath = join(dir, `${hash}${ext}`);

  if (await exists(filePath)) {
    cache.set(cacheKey, publicPath);
    return publicPath;
  }

  const res = await fetch(srcUrl);
  if (!res.ok) {
    throw new Error(`Image fetch failed: ${srcUrl} (${res.status})`);
  }
  const ct = res.headers.get('content-type') ?? undefined;
  if (!extname(filePath)) {
    ext = extFromUrl(srcUrl, ct);
    publicPath = `/img/generated/${slug}/${hash}${ext}`;
    filePath = join(dir, `${hash}${ext}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, buf);
  cache.set(cacheKey, publicPath);
  return publicPath;
}
