import { judgeLine } from './llm.js';

export interface QaInput { title: string; body: string; sourceSummary?: string; }
export interface QaResult { status: 'Passed' | 'Flagged'; notes: string; }

/**
 * Deterministic completeness check — is the body a finished article, or does it
 * end mid-sentence / mid-thought? This is the hard gate the orchestrator uses to
 * refuse to save a truncated draft (no LLM, so it can never be fooled).
 *
 * A complete body: has enough words, doesn't end on a dangling connector or
 * punctuation that implies more is coming, and ends on real terminal
 * punctuation (or closing markdown).
 */
export function bodyIsComplete(body: string, minWords = 120): { ok: boolean; reason?: string } {
  const t = (body ?? '').replace(/\s+$/, '');
  if (!t) return { ok: false, reason: 'empty body' };
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < minWords) return { ok: false, reason: `too short (${words.length} words)` };
  // Ends on a comma/colon/semicolon/dash/ellipsis-less connector → cut off.
  if (/[,:;\-–—]$/.test(t)) return { ok: false, reason: 'ends on a dangling connector' };
  // Ends on a common continuation word ("... and", "to", "the", "of" …) → cut off.
  const lastWord = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '');
  const DANGLERS = new Set(['and', 'or', 'but', 'the', 'a', 'an', 'to', 'of', 'for', 'with', 'in', 'on', 'at', 'by', 'as', 'is', 'are', 'was', 'were', 'that', 'which', 'this', 'these', 'your', 'you', 'we', 'it']);
  if (DANGLERS.has(lastWord)) return { ok: false, reason: `ends mid-sentence ("…${words.slice(-4).join(' ')}")` };
  // Must end on terminal punctuation or a clean closing character.
  if (!/[.!?…"'’”)\]*`]$/.test(t)) return { ok: false, reason: `no terminal punctuation ("…${words.slice(-4).join(' ')}")` };
  return { ok: true };
}

/** Local, no-LLM checks for the obvious failure modes. Returns issue strings. */
export function deterministicChecks(p: QaInput): string[] {
  const issues: string[] = [];
  if (/\]\(query:/.test(p.body)) issues.push('Unresolved image placeholder (query:) left in body.');
  if (/\]\(\s*\)/.test(p.body)) issues.push('Empty link target in body.');
  if (/!#[^)]*!#/.test(p.body)) issues.push('Placeholder link token (!#…!#) in body.');
  if (/\]\((?:#|javascript:)/i.test(p.body)) issues.push('Suspicious link target in body.');
  if (!p.title || p.title.length < 8) issues.push('Title missing or too short.');
  return issues;
}

/**
 * Full QA: deterministic checks + a cheap LLM judgment on factual
 * self-consistency and whether the title matches the body. Best-effort:
 * if the LLM call fails, fall back to the deterministic result.
 */
export async function runQa(p: QaInput): Promise<QaResult> {
  const det = deterministicChecks(p);

  let llmNotes = '';
  try {
    const line = await judgeLine({
      system:
        'You are a publishing QA reviewer. Given a draft title and body, reply with a single line: ' +
        'either "OK" if it is internally consistent, on-topic, and free of obvious factual contradictions, ' +
        'or "FLAG: <short reason>" if not. Be terse.',
      user: `TITLE: ${p.title}\n\nBODY:\n${p.body.slice(0, 6000)}`,
      maxTokens: 400,
    });
    if (/^FLAG/i.test(line)) llmNotes = line.replace(/^FLAG:?\s*/i, '');
  } catch (e: any) {
    llmNotes = `QA LLM check skipped: ${e?.message ?? e}`;
  }

  const allIssues = [...det, ...(llmNotes ? [llmNotes] : [])];
  return allIssues.length
    ? { status: 'Flagged', notes: allIssues.join(' | ').slice(0, 1900) }
    : { status: 'Passed', notes: 'No issues found by automated QA.' };
}
