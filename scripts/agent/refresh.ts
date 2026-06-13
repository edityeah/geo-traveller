import { Client } from '@notionhq/client';
import { slugWord } from './topic-key.ts';

export interface GuideRef { pageId: string; key: string; title: string; slug: string; }

/**
 * Does this news candidate concern an existing evergreen guide? Matches when
 * EVERY non-generic token of the guide's key appears in the candidate text AND
 * at least one matched token is "specific" (≥4 chars or an alias hit).
 *
 * Key shape is class:subject(:market), e.g. visa:japan:in. Short, ambiguous
 * subject codes (us/uk/uae) are matched via disambiguating alias phrases rather
 * than the bare 2-letter token — otherwise "us"/"uk" match the English word
 * "us" or unrelated text. We bias toward false-negatives (a missed auto-refresh
 * is harmless; a false one would mutate a live published guide).
 */
const GENERIC = new Set(['in', 'india', 'howto', 'guide']);

const ALIASES: Record<string, string[]> = {
  us: ['united states', 'us visa', 'usa visa', 'u s visa', 'american visa'],
  uk: ['united kingdom', 'uk visa', 'british visa'],
  uae: ['uae', 'united arab emirates', 'dubai visa', 'abu dhabi'],
};

export function matchGuide(title: string, summary: string, guides: GuideRef[]): GuideRef | null {
  const hay = ` ${slugWord(`${title} ${summary}`)} `.replace(/-/g, ' ');
  for (const g of guides) {
    const tokens = g.key.split(':').filter((t) => !GENERIC.has(t));
    if (tokens.length === 0) continue;

    let allMatch = true;
    let specific = false;
    for (const t of tokens) {
      const aliases = ALIASES[t];
      if (aliases) {
        const hit = aliases.some((a) => hay.includes(` ${a} `));
        if (!hit) { allMatch = false; break; }
        specific = true; // an alias phrase is inherently distinctive
      } else {
        const term = t.replace(/-/g, ' ');
        if (!hay.includes(` ${term} `)) { allMatch = false; break; }
        if (term.length >= 4) specific = true;
      }
    }
    if (allMatch && specific) return g;
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

  // 1. Delete ALL existing children — paginate; a guide easily exceeds 100
  //    blocks, and deleting only the first page would leave stale trailing
  //    content under the freshly-appended body (corrupting the live guide).
  const toDelete: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await notion.blocks.children.list({ block_id: args.guide.pageId, start_cursor: cursor, page_size: 100 });
    for (const b of page.results) toDelete.push((b as any).id);
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);
  for (const id of toDelete) await notion.blocks.delete({ block_id: id });
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
