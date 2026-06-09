/**
 * Apply targeted post-migration fixes to Notion pages.
 *
 * Strategy:
 * 1. Bulk patterns — for every block in every Archived page, scan for known
 *    residue patterns (caption shortcodes, fvplayer, Instagram embed leftover
 *    text) and clean them up.
 * 2. Specific fixes — operate on a list of (block-id, action) tuples drawn
 *    from the review agents' findings. Actions: delete, replace text.
 *
 * The script is idempotent — running it twice should produce no further changes.
 */
import { Client, isFullPage, isFullBlock } from '@notionhq/client';
import type {
  PageObjectResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { writeFile } from 'node:fs/promises';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID!;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('NOTION_TOKEN and NOTION_DATABASE_ID required');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// Specific fixes by block ID. Each is { action: 'delete' | 'replace', text? }.
// IDs collected from the 5 review agents.
const SPECIFIC_FIXES: Record<string, { action: 'delete' | 'replace'; text?: string }> = {
  // === Post 02 typos / fixes ===
  '37a7bc30-b890-8194-add4-c26a75b872ec': { action: 'replace', text: 'Tip: You need to verify your hotel rooms before booking, since some hotels in Bhutan have basic amenities only.' },
  '37a7bc30-b890-8122-8426-c76f797186c9': { action: 'replace', text: 'The shrine is open seven days a week. Entry is free.' },
  '37a7bc30-b890-81f6-83c2-d83db3bae00d': { action: 'replace', text: 'Best time to visit: October to March.' },

  // === Post 03 fixes ===
  '37a7bc30-b890-818d-989d-ec6f5523b7b6': { action: 'replace', text: 'Reach Sankri by 6 PM and rest for the evening.' },
  '37a7bc30-b890-8137-86ef-c79e89beaef0': { action: 'replace', text: 'Opt for train travel to Dehradun for the most comfortable journey.' },

  // === Post 04 ===
  '37a7bc30-b890-81a3-a766-f9aa3acc9684': { action: 'replace', text: "One such is the Sri Radha Krishna Temple in Rajajinagar, Bangalore — one of the world's largest ISKCON temples." },
  '37a7bc30-b890-8153-a69c-e4c1bd841b1b': { action: 'delete' },
  '37a7bc30-b890-81ae-ab22-e79708e11056': { action: 'delete' },
  '37a7bc30-b890-8184-b19e-cd312c796e15': { action: 'delete' },
  '37a7bc30-b890-815a-9e7c-e226edb3edbd': { action: 'delete' },
  '37a7bc30-b890-81ce-96d4-f5608fe54415': { action: 'replace', text: 'Things to do' },

  // === Post 05 ===
  '37a7bc30-b890-814d-b083-d645f54467ea': { action: 'replace', text: 'The things to see in the monument are mentioned below:' },

  // === Post 06 ===
  '37a7bc30-b890-81c9-bc6d-f516dd735ce5': { action: 'replace', text: 'Ever since it has come to the limelight, ChatGPT has been finding its way into the travel industry.' },

  // === Post 10 ===
  '37a7bc30-b890-818e-a887-eb69fbe54e5d': { action: 'replace', text: 'According to some activists in the country, the pollution in Serbia and in other parts of the Balkan peninsula is so bad that it can be smelt, seen and even tasted during winter and autumn.' },
  '37a7bc30-b890-8154-bfb4-ed8e669dfdd8': { action: 'replace', text: 'They look like giant green columns standing on city streets — equal parts art installation and environmental engineering.' },
  '37a7bc30-b890-81b8-9be3-cfbd8843a4e3': { action: 'replace', text: "Now, you might be thinking — there's a catch, right?" },

  // === Post 11 — WP template placeholders ===
  '37a7bc30-b890-819e-8284-c5598a7bdda1': { action: 'replace', text: 'The package includes visits to Ayodhya, Prayagraj, Varanasi, and Vaishno Devi.' },
  '37a7bc30-b890-812b-bd4c-d37201012e6f': { action: 'delete' },
  '37a7bc30-b890-814d-9de8-e86d7be0406a': { action: 'delete' },
  '37a7bc30-b890-8118-80c4-c6e0d1eceffa': { action: 'delete' },
  '37a7bc30-b890-81c0-9aea-cadc1bc019f3': { action: 'delete' },
  '37a7bc30-b890-81c2-ab77-d9fbc4ed7d08': { action: 'delete' },
  '37a7bc30-b890-8125-9d99-f426d7a84f96': { action: 'delete' },
  '37a7bc30-b890-81f8-90c3-d5617095da20': { action: 'delete' },
  '37a7bc30-b890-8181-a373-d3b91f57b744': { action: 'delete' },

  // === Post 12 ===
  '37a7bc30-b890-8163-9ee3-f41b1dafbc04': { action: 'replace', text: 'The most convenient way to reach Gokarna is by train, especially if you are traveling from Mumbai or Bangalore.' },
  '37a7bc30-b890-81d1-a8c4-ce6b9ea65230': { action: 'replace', text: 'The faint glow of the lighthouse in the distance made the cliffside walk worth every step.' },

  // === Post 13 ===
  '37a7bc30-b890-8125-8016-d6939425c612': { action: 'replace', text: 'Bhutan reminds you that life beyond the rat race is not only possible — it is being lived, just across the border.' },
  '37a7bc30-b890-8104-b016-da49d1d44489': { action: 'replace', text: 'When every individual is in such a state of well-being, the nation marches ahead in unison.' },
  '37a7bc30-b890-81af-8eae-c0f6d98f44c9': { action: 'replace', text: "It's time we embraced such a holistic measure of progress." },

  // === Post 16 — All Together Now Festival typos ===
  '37a7bc30-b890-8170-827a-e31f5b533236': { action: 'replace', text: 'Loyle Carner' },
  '37a7bc30-b890-8159-8333-efdacb827f4c': { action: 'replace', text: 'Loyle Carner' },
  '37a7bc30-b890-8164-ab00-e784de0f3f0e': { action: 'replace', text: '12.15-1.45am' },

  // === Post 22 — Instagram embed residue (delete all) ===
  '37a7bc30-b890-8198-9667-e6991df78aa4': { action: 'delete' },
  '37a7bc30-b890-8109-b051-f4b60b3bdc5b': { action: 'delete' },
  '37a7bc30-b890-8153-a078-f5ed1f4297fe': { action: 'delete' },
  '37a7bc30-b890-81e6-99a1-c0dd1fb438d5': { action: 'delete' },
  '37a7bc30-b890-81b9-9199-d81bd0c3208e': { action: 'delete' },
  '37a7bc30-b890-81ed-a1d2-d2bf7ef48c6f': { action: 'delete' },
  '37a7bc30-b890-810a-8a02-f895d9412014': { action: 'delete' },
  '37a7bc30-b890-817d-84ec-ff60cfc68499': { action: 'delete' },
  '37a7bc30-b890-812b-bad1-e6ddbe1eff21': { action: 'delete' },
  '37a7bc30-b890-8132-95ef-c23a4d9ff89d': { action: 'delete' },
  '37a7bc30-b890-819f-a59b-f683f25c6202': { action: 'delete' },
  '37a7bc30-b890-81d3-8cd7-e0924386c4af': { action: 'delete' },
  '37a7bc30-b890-8166-b97b-f3a8f3971077': { action: 'delete' },
  '37a7bc30-b890-81db-95ad-e0c956aa6c8f': { action: 'delete' },
  '37a7bc30-b890-8112-8bbf-e002814b4de0': { action: 'replace', text: 'December 28th to 31st, 2023.' },

  // === Post 26 — broken CTA ===
  '37a7bc30-b890-81d1-b1af-cc6a942c0927': { action: 'delete' },

  // === Post 27 — tweet embed residue (delete all) ===
  '37a7bc30-b890-815e-ab71-c4bb5a3dc6d3': { action: 'delete' },
  '37a7bc30-b890-819d-8d28-e3cf8ba9af9f': { action: 'delete' },
  '37a7bc30-b890-815c-b318-fc7ababf9fd5': { action: 'delete' },
  '37a7bc30-b890-812c-922b-faab5c9b2f42': { action: 'delete' },
  '37a7bc30-b890-8103-9978-d421efa44177': { action: 'delete' },
  '37a7bc30-b890-8196-8445-c1f5fa28dc28': { action: 'delete' },
  '37a7bc30-b890-8193-a1f8-fe64cf5c8bb5': { action: 'delete' },
  '37a7bc30-b890-8144-a166-e45d404cd474': { action: 'delete' },
  '37a7bc30-b890-813c-a04d-e6e62f8d8914': { action: 'delete' },
  '37a7bc30-b890-8143-87a7-ec286fbdbb2c': { action: 'delete' },

  // === Post 28 — promotional CTA ===
  '37a7bc30-b890-8102-98c0-c2bdd1065c47': { action: 'delete' },

  // === Post 30 ===
  '37a7bc30-b890-81dc-af42-e965c3de8417': { action: 'replace', text: 'The Bangalore Literature Festival (BLF), a gem in the cultural and literary landscape of Bangalore, is back with its 12th edition.' },
  '37a7bc30-b890-81d6-a175-f1922b0febb0': { action: 'delete' },
  '37a7bc30-b890-8112-99b0-db730fae052c': { action: 'delete' },

  // === Post 34 — Instagram embed ===
  '37a7bc30-b890-8179-a881-e7c6f85779ef': { action: 'delete' },
  '37a7bc30-b890-812d-9b52-de6c3aabf969': { action: 'delete' },

  // === Post 35 — Instagram embed ===
  '37a7bc30-b890-81df-b805-d77fee639140': { action: 'delete' },

  // === Post 38 — promotional CTAs ===
  '37a7bc30-b890-815e-a822-ff565676fdeb': { action: 'replace', text: 'Enhanced Connectivity' },
  '37a7bc30-b890-81da-8b8e-e5cdea78b586': { action: 'delete' },
  '37a7bc30-b890-818a-804c-e841d8437df6': { action: 'delete' },

  // === Post 42 — Varanasi: duplicate + Instagram embed ===
  '37a7bc30-b890-816f-8f48-c37f3581d895': { action: 'delete' },
  '37a7bc30-b890-81f0-b4d6-e086886a2185': { action: 'delete' },
  '37a7bc30-b890-81a9-b650-f4a238d9f4b1': { action: 'replace', text: 'Note: cannabis use is illegal in India outside of certain religious contexts.' },
};

// Patterns to clean from any paragraph text encountered in any post.
// Returns: { newText, deleted } — if newText becomes empty after cleaning,
// block is marked for deletion.
function cleanText(text: string): { newText: string; shouldDelete: boolean } {
  let t = text;

  // Strip [caption ...] opening shortcodes
  t = t.replace(/\[caption\s+[^\]]*\]/gi, '');

  // Strip [/caption] closing tags
  t = t.replace(/\[\/caption\]/gi, '');

  // Strip [fvplayer id="N" ...] shortcodes
  t = t.replace(/\[fvplayer[^\]]*\]/gi, '');

  // Strip WP template placeholders
  t = t.replace(/!#\w+!#/g, '');

  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();

  // After cleaning, is it empty?
  if (!t) return { newText: '', shouldDelete: true };

  // Is it just "View this post on Instagram" boilerplate?
  if (/^>?\s*View this post on Instagram/i.test(t)) {
    return { newText: '', shouldDelete: true };
  }

  return { newText: t, shouldDelete: false };
}

function plain(rich: any[] | undefined): string {
  if (!rich) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

function richTextFor(content: string): any[] {
  // Notion caps each run at 2000 chars.
  const out: any[] = [];
  for (let i = 0; i < content.length; i += 1900) {
    out.push({ type: 'text', text: { content: content.slice(i, i + 1900) } });
  }
  return out;
}

async function backoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status ?? err?.code;
    const retriable = status === 429 || status === 502 || status === 503 || status === 504;
    if (!retriable || attempt >= 5) throw err;
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 16000)));
    return backoff(fn, attempt + 1);
  }
}

async function fetchBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const out: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 })
    );
    for (const b of res.results) if (isFullBlock(b)) out.push(b);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

type Log = { kind: 'delete' | 'update' | 'dup-delete'; blockId: string; title: string; note?: string };

async function processPage(page: PageObjectResponse, log: Log[]): Promise<void> {
  const props = page.properties as any;
  const title = plain(props.Title?.title) || '(untitled)';
  const blocks = await fetchBlocks(page.id);

  // Build text fingerprints to detect exact duplicates within a page.
  const seenTexts = new Set<string>();

  for (const b of blocks) {
    const bid = b.id;

    // Specific-fix override wins over pattern cleaning.
    const fix = SPECIFIC_FIXES[bid];
    if (fix) {
      if (fix.action === 'delete') {
        await backoff(() => notion.blocks.delete({ block_id: bid }));
        log.push({ kind: 'delete', blockId: bid, title, note: 'specific' });
        continue;
      } else if (fix.action === 'replace' && fix.text) {
        const key = pickTextKey(b.type);
        if (key) {
          await backoff(() =>
            notion.blocks.update({
              block_id: bid,
              [key]: { rich_text: richTextFor(fix.text!) },
            } as any)
          );
          log.push({ kind: 'update', blockId: bid, title, note: 'specific replace' });
        }
        continue;
      }
    }

    // Pattern-based cleanup on text-bearing blocks.
    const tk = pickTextKey(b.type);
    if (!tk) continue;
    const data = (b as any)[b.type];
    const text = plain(data.rich_text);
    if (!text) continue;

    const { newText, shouldDelete } = cleanText(text);

    if (shouldDelete) {
      await backoff(() => notion.blocks.delete({ block_id: bid }));
      log.push({ kind: 'delete', blockId: bid, title, note: 'cleanup' });
      continue;
    }

    if (newText !== text) {
      // Detect duplicate-after-cleaning (within same page).
      if (seenTexts.has(newText)) {
        await backoff(() => notion.blocks.delete({ block_id: bid }));
        log.push({ kind: 'dup-delete', blockId: bid, title, note: 'duplicate after cleanup' });
        continue;
      }
      seenTexts.add(newText);
      await backoff(() =>
        notion.blocks.update({
          block_id: bid,
          [b.type]: { rich_text: richTextFor(newText) },
        } as any)
      );
      log.push({ kind: 'update', blockId: bid, title, note: 'cleanup' });
    } else {
      seenTexts.add(text);
    }
  }
}

function pickTextKey(type: string): string | null {
  if (
    type === 'paragraph' ||
    type === 'heading_1' ||
    type === 'heading_2' ||
    type === 'heading_3' ||
    type === 'quote' ||
    type === 'callout' ||
    type === 'bulleted_list_item' ||
    type === 'numbered_list_item'
  ) {
    return type;
  }
  return null;
}

async function main() {
  const log: Log[] = [];
  console.log('Fetching Archived posts...');
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const res = await backoff(() =>
      notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        start_cursor: cursor,
        page_size: 100,
        filter: { property: 'Status', select: { equals: 'Archived' } },
      })
    );
    for (const p of res.results) if (isFullPage(p)) pages.push(p);
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  console.log(`${pages.length} pages to process`);

  let done = 0;
  for (const page of pages) {
    await processPage(page, log);
    done++;
    if (done % 5 === 0) console.log(`  ${done}/${pages.length} pages done, ${log.length} ops so far`);
  }

  const summary = {
    total: log.length,
    deletes: log.filter((l) => l.kind === 'delete' || l.kind === 'dup-delete').length,
    updates: log.filter((l) => l.kind === 'update').length,
  };
  console.log(`\n${summary.total} total operations: ${summary.updates} updates, ${summary.deletes} deletes`);

  const lines = ['# Apply-fixes report', '', `**Total ops:** ${summary.total}`, ''];
  for (const l of log) {
    lines.push(`- ${l.kind} \`${l.blockId}\` (${l.title}) — ${l.note ?? ''}`);
  }
  await writeFile('fix-report.md', lines.join('\n') + '\n');
  console.log('Wrote fix-report.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
