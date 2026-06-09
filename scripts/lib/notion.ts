import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_PAGES_DATABASE_ID = process.env.NOTION_PAGES_DATABASE_ID;

export const notionConfigured = Boolean(NOTION_TOKEN && NOTION_DATABASE_ID);
export const pagesConfigured = Boolean(NOTION_TOKEN && NOTION_PAGES_DATABASE_ID);

const client = NOTION_TOKEN ? new Client({ auth: NOTION_TOKEN }) : null;

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

export async function fetchPublishedPosts(): Promise<PageObjectResponse[]> {
  if (!client || !NOTION_DATABASE_ID) {
    throw new Error('Notion not configured (NOTION_TOKEN, NOTION_DATABASE_ID).');
  }
  const limit = process.env.NOTION_FETCH_LIMIT
    ? Number(process.env.NOTION_FETCH_LIMIT)
    : Infinity;

  const out: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      client.databases.query({
        database_id: NOTION_DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: {
          property: 'Status',
          select: { equals: 'Published' },
        },
        sorts: [{ property: 'Publish Date', direction: 'descending' }],
      })
    );
    for (const page of res.results) {
      if (isFullPage(page)) out.push(page);
      if (out.length >= limit) return out;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

export async function fetchPublishedPages(): Promise<PageObjectResponse[]> {
  if (!client || !NOTION_PAGES_DATABASE_ID) return [];
  const out: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      client.databases.query({
        database_id: NOTION_PAGES_DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: {
          property: 'Status',
          select: { equals: 'Published' },
        },
      })
    );
    for (const page of res.results) {
      if (isFullPage(page)) out.push(page);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

export type PageProps = {
  id: string;
  title: string;
  slug: string;
  description?: string;
  showInFooter: boolean;
};

export function extractPageProps(page: PageObjectResponse): PageProps {
  const p = page.properties as Record<string, any>;
  const title = plainText(p.Title?.title);
  const slug = (plainText(p.Slug?.rich_text) || slugify(title)).toLowerCase();
  const description = plainText(p.Description?.rich_text) || undefined;
  const showInFooter = Boolean(p['Show in footer']?.checkbox);
  return { id: page.id, title, slug, description, showInFooter };
}

export async function fetchBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  if (!client) throw new Error('Notion not configured.');
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      client.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    for (const block of res.results) {
      if (isFullBlock(block)) out.push(block);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

export type PostProps = {
  id: string;
  title: string;
  slug: string;
  publishDate: string;
  tags: string[];
  locationName?: string;
  lat?: number;
  lng?: number;
  coverUrl?: string;
  excerpt?: string;
  originalUrl?: string;
  originalDate?: string;
};

function plainText(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
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

export function extractProps(page: PageObjectResponse): PostProps {
  const p = page.properties as Record<string, any>;
  const title = plainText(p.Title?.title);
  const slugRaw = plainText(p.Slug?.rich_text);
  const slug = slugRaw ? slugify(slugRaw) : slugify(title);
  const publishDate: string = p['Publish Date']?.date?.start ?? '';
  const tags: string[] =
    p.Tags?.multi_select?.map((t: any) => t.name as string) ?? [];
  const locationName = plainText(p['Location Name']?.rich_text) || undefined;
  const lat =
    typeof p.Latitude?.number === 'number' ? p.Latitude.number : undefined;
  const lng =
    typeof p.Longitude?.number === 'number' ? p.Longitude.number : undefined;
  const coverFile = p.Cover?.files?.[0];
  const coverUrl =
    coverFile?.type === 'external'
      ? coverFile.external.url
      : coverFile?.file?.url;
  const excerpt = plainText(p.Excerpt?.rich_text) || undefined;
  const originalUrl = p['Original URL']?.url || undefined;
  const originalDate = p['Original Date']?.date?.start || undefined;

  return {
    id: page.id,
    title,
    slug,
    publishDate,
    tags,
    locationName,
    lat,
    lng,
    coverUrl,
    excerpt,
    originalUrl,
    originalDate,
  };
}
