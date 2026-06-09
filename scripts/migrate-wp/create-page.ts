import { Client } from '@notionhq/client';

export type CreateInput = {
  databaseId: string;
  title: string;
  slug: string;
  publishDate: string; // ISO
  tags: string[];
  excerpt?: string;
  coverUrl?: string;
  originalUrl?: string;
  originalDate?: string;
  blocks: any[];
};

const BLOCK_BATCH = 90; // safely under Notion's 100/req limit

/**
 * WordPress exports often use http:// for media URLs even when the live site
 * forces https. Notion's URL validator rejects URLs whose final resolved
 * destination redirects, so http://geo-traveller.com/... → https://... fails.
 * Normalize to https:// for the known domains we control.
 */
export function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;

  // Force https for the user's WP host.
  let out = trimmed.replace(
    /^http:\/\/(www\.)?geo-traveller\.com/i,
    'https://geo-traveller.com'
  );

  // Must be absolute http(s) URL.
  if (!/^https?:\/\//i.test(out)) return undefined;

  // Notion has a 2000 char URL limit; reject anything absurd.
  if (out.length > 1900) return undefined;

  return out;
}

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status ?? err?.code;
    const retriable = status === 429 || status === 502 || status === 503 || status === 504;
    if (!retriable || attempt >= 5) throw err;
    const delay = Math.min(1000 * 2 ** attempt, 16000);
    await new Promise((r) => setTimeout(r, delay));
    return backoff(fn, attempt + 1);
  }
}

export async function createMigratedPage(
  notion: Client,
  input: CreateInput
): Promise<{ pageId: string; url: string; warnings: string[] }> {
  const warnings: string[] = [];

  const properties: Record<string, any> = {
    Title: { title: [{ text: { content: input.title } }] },
    Slug: { rich_text: [{ text: { content: input.slug } }] },
    Status: { select: { name: 'Archived' } },
    'Publish Date': { date: { start: input.publishDate.slice(0, 10) } },
    Tags: { multi_select: input.tags.map((t) => ({ name: t.slice(0, 100) })) },
  };
  if (input.excerpt) {
    properties.Excerpt = {
      rich_text: [{ text: { content: input.excerpt.slice(0, 2000) } }],
    };
  }
  if (input.originalUrl) {
    const normalized = normalizeUrl(input.originalUrl);
    if (normalized) properties['Original URL'] = { url: normalized };
  }
  if (input.originalDate) {
    properties['Original Date'] = {
      date: { start: input.originalDate.slice(0, 10) },
    };
  }

  // Normalize cover. Try with cover first; if Notion still rejects, retry without.
  const coverUrl = normalizeUrl(input.coverUrl);
  const cover = coverUrl
    ? { type: 'external' as const, external: { url: coverUrl } }
    : undefined;

  // Normalize image block URLs in-place. Drop any that don't validate.
  const cleanedBlocks: any[] = [];
  for (const block of input.blocks) {
    if (block?.type === 'image' && block.image?.type === 'external') {
      const u = normalizeUrl(block.image.external.url);
      if (!u) {
        warnings.push(`Dropped image block (invalid URL): ${block.image.external.url}`);
        continue;
      }
      block.image.external.url = u;
    }
    if (block?.type === 'embed' && block.embed?.url) {
      const u = normalizeUrl(block.embed.url);
      if (!u) {
        warnings.push(`Dropped embed block (invalid URL): ${block.embed.url}`);
        continue;
      }
      block.embed.url = u;
    }
    cleanedBlocks.push(block);
  }

  const first = cleanedBlocks.slice(0, BLOCK_BATCH);
  const rest = cleanedBlocks.slice(BLOCK_BATCH);

  const createParams = (withCover: boolean): any => ({
    parent: { database_id: input.databaseId },
    properties,
    ...(withCover && cover ? { cover } : {}),
    children: first,
  });

  let page: any;
  try {
    page = await backoff(() => notion.pages.create(createParams(true)));
  } catch (err: any) {
    const msg = err?.body?.message ?? err?.message ?? '';
    if (cover && /cover/i.test(msg)) {
      // Cover rejected — retry without it.
      warnings.push(`Cover URL rejected by Notion, page created without cover: ${coverUrl}`);
      page = await backoff(() => notion.pages.create(createParams(false)));
    } else {
      throw err;
    }
  }

  // Append remaining blocks in batches.
  for (let i = 0; i < rest.length; i += BLOCK_BATCH) {
    const chunk = rest.slice(i, i + BLOCK_BATCH);
    await backoff(() =>
      notion.blocks.children.append({
        block_id: page.id,
        children: chunk,
      })
    );
  }

  return { pageId: page.id, url: (page as any).url ?? '', warnings };
}
