import { Client } from '@notionhq/client';
import { slugWord } from './topic-key.ts';

export interface GuideRef { pageId: string; key: string; title: string; slug: string; }

/**
 * Does this news candidate concern an existing evergreen guide? Matches when
 * every non-generic token of the guide's key appears in the candidate text.
 * Key shape is class:subject(:market), e.g. visa:japan:in — we require the
 * subject token (e.g. "japan") and the class token (e.g. "visa") to be present.
 */
const GENERIC = new Set(['in', 'india', 'howto', 'guide']);

export function matchGuide(title: string, summary: string, guides: GuideRef[]): GuideRef | null {
  const hay = ` ${slugWord(`${title} ${summary}`)} `.replace(/-/g, ' ');
  for (const g of guides) {
    const tokens = g.key.split(':').filter((t) => !GENERIC.has(t));
    if (tokens.length === 0) continue;
    const all = tokens.every((t) => hay.includes(` ${t.replace(/-/g, ' ')} `) || hay.includes(` ${t} `));
    if (all) return g;
  }
  return null;
}

/**
 * Regenerate the guide body with the new development folded in, then write it
 * to Notion in one update: replace body blocks, set Last Updated = today, and a
 * QA note describing the change. On any error, throw BEFORE writing so the live
 * guide is never left half-updated.
 *
 * `buildBlocks` converts markdown → Notion blocks (reuse publish.ts helper).
 */
export async function refreshGuide(args: {
  guide: GuideRef;
  newBodyMarkdown: string;
  qaNote: string;
  isoDate: string;
  buildBlocks: (md: string) => any[];
}): Promise<void> {
  const notion = new Client({ auth: process.env.NOTION_TOKEN! });
  const blocks = args.buildBlocks(args.newBodyMarkdown);
  if (!blocks.length) throw new Error('refresh produced no blocks; aborting to protect live guide');

  // 1. Delete existing children.
  const existing = await notion.blocks.children.list({ block_id: args.guide.pageId, page_size: 100 });
  for (const b of existing.results) await notion.blocks.delete({ block_id: (b as any).id });
  // 2. Append new body (batch of 90 per Notion limits).
  for (let i = 0; i < blocks.length; i += 90) {
    await notion.blocks.children.append({ block_id: args.guide.pageId, children: blocks.slice(i, i + 90) });
  }
  // 3. Update properties.
  await notion.pages.update({
    page_id: args.guide.pageId,
    properties: {
      'Last Updated': { date: { start: args.isoDate } },
      QA: { select: { name: 'Flagged' } },
      'QA Notes': { rich_text: [{ type: 'text', text: { content: `Auto-refreshed: ${args.qaNote}`.slice(0, 1900) } }] },
    } as any,
  });
}
