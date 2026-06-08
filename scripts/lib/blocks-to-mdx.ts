import type { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { fetchBlocks } from './notion.js';
import { mirrorImage } from './image-mirror.js';

type RichText = {
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
  };
};

function escapeMdx(s: string): string {
  return s.replace(/([\\{}<>])/g, '\\$1');
}

function renderRich(rich: RichText[] | undefined): string {
  if (!rich) return '';
  return rich
    .map((r) => {
      let text = escapeMdx(r.plain_text);
      const a = r.annotations;
      if (a.code) text = `\`${r.plain_text}\``;
      if (a.bold) text = `**${text}**`;
      if (a.italic) text = `*${text}*`;
      if (a.strikethrough) text = `~~${text}~~`;
      if (r.href) text = `[${text}](${r.href})`;
      return text;
    })
    .join('');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

export async function blocksToMdx(
  pageId: string,
  slug: string,
  options: { warnings: string[] }
): Promise<string> {
  const blocks = await fetchBlocks(pageId);
  return renderBlocks(blocks, slug, 0, options);
}

async function renderBlocks(
  blocks: BlockObjectResponse[],
  slug: string,
  depth: number,
  ctx: { warnings: string[] }
): Promise<string> {
  const out: string[] = [];
  let listBuf: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuf) return;
    const marker = listBuf.type === 'ul' ? '- ' : '1. ';
    out.push(listBuf.items.map((i) => marker + i).join('\n'));
    listBuf = null;
  };

  for (const b of blocks) {
    const rendered = await renderBlock(b, slug, depth, ctx);
    if (rendered === null) continue;

    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
      const kind = b.type === 'bulleted_list_item' ? 'ul' : 'ol';
      if (!listBuf || listBuf.type !== kind) {
        flushList();
        listBuf = { type: kind, items: [] };
      }
      listBuf.items.push(rendered);
    } else {
      flushList();
      out.push(rendered);
    }
  }
  flushList();
  return out.filter(Boolean).join('\n\n');
}

async function renderBlock(
  b: BlockObjectResponse,
  slug: string,
  depth: number,
  ctx: { warnings: string[] }
): Promise<string | null> {
  switch (b.type) {
    case 'paragraph':
      return renderRich(b.paragraph.rich_text as RichText[]);
    case 'heading_1':
      return `## ${renderRich(b.heading_1.rich_text as RichText[])}`;
    case 'heading_2':
      return `### ${renderRich(b.heading_2.rich_text as RichText[])}`;
    case 'heading_3':
      return `#### ${renderRich(b.heading_3.rich_text as RichText[])}`;
    case 'bulleted_list_item':
    case 'numbered_list_item': {
      const data = (b as any)[b.type];
      let inner = renderRich(data.rich_text as RichText[]);
      if (b.has_children) {
        const children = await fetchBlocks(b.id);
        const sub = await renderBlocks(children, slug, depth + 1, ctx);
        inner += '\n' + indent(sub, 2);
      }
      return inner;
    }
    case 'quote':
      return `> ${renderRich(b.quote.rich_text as RichText[]).replace(/\n/g, '\n> ')}`;
    case 'code': {
      const lang = b.code.language ?? '';
      const src = (b.code.rich_text as RichText[]).map((r) => r.plain_text).join('');
      return '```' + lang + '\n' + src + '\n```';
    }
    case 'image': {
      const src =
        b.image.type === 'external' ? b.image.external.url : b.image.file.url;
      const caption = renderRich(b.image.caption as RichText[]);
      const mirrored = await mirrorImage(src, slug);
      const alt = caption || 'image';
      return caption
        ? `<figure>\n  <img src="${mirrored}" alt="${escapeAttr(alt)}" />\n  <figcaption>${caption}</figcaption>\n</figure>`
        : `![${escapeAttr(alt)}](${mirrored})`;
    }
    case 'divider':
      return '---';
    case 'callout': {
      const inner = renderRich(b.callout.rich_text as RichText[]);
      const emoji = b.callout.icon?.type === 'emoji' ? b.callout.icon.emoji + ' ' : '';
      return `> ${emoji}${inner}`;
    }
    case 'bookmark':
      return `[${b.bookmark.url}](${b.bookmark.url})`;
    case 'embed':
      return renderEmbed(b.embed.url);
    case 'video': {
      const url = b.video.type === 'external' ? b.video.external.url : b.video.file.url;
      return renderEmbed(url);
    }
    case 'table_of_contents':
    case 'breadcrumb':
    case 'column_list':
    case 'column':
      return null;
    default:
      ctx.warnings.push(`Unsupported Notion block type: ${b.type}`);
      return `{/* unsupported block: ${b.type} */}`;
  }
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderEmbed(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) {
    return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${yt[1]}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) {
    return `<iframe src="https://player.vimeo.com/video/${vimeo[1]}" width="640" height="360" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }
  return `[${url}](${url})`;
}
