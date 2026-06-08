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
): Promise<{ pageId: string; url: string }> {
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
    properties['Original URL'] = { url: input.originalUrl };
  }
  if (input.originalDate) {
    properties['Original Date'] = {
      date: { start: input.originalDate.slice(0, 10) },
    };
  }

  const cover = input.coverUrl
    ? { type: 'external' as const, external: { url: input.coverUrl } }
    : undefined;

  const first = input.blocks.slice(0, BLOCK_BATCH);
  const rest = input.blocks.slice(BLOCK_BATCH);

  const page = await backoff(() =>
    notion.pages.create({
      parent: { database_id: input.databaseId },
      properties,
      cover,
      children: first,
    })
  );

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

  return { pageId: page.id, url: (page as any).url ?? '' };
}
