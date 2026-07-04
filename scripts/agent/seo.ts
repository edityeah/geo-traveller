/**
 * On-page SEO scoring for a generated draft (the "Rank Math check", native).
 *
 * Pure + deterministic — no network, no LLM. Produces a 0-100 score and a list
 * of concrete issues. The orchestrator uses the score to decide whether the
 * creator agent should rewrite the draft before saving (see rewriteForSeo).
 *
 * Checks: focus keyword in title / intro / a heading / body (not stuffed),
 * heading structure, internal links, external links, readability.
 */

const GENERIC_TAGS = new Set(['guide', 'how-to', 'travel', 'news', 'geo daily', 'geo-daily', 'events', 'india']);

export interface SeoInput {
  title: string;
  body: string;
  excerpt?: string;
  focusKeyword?: string;
  tags?: string[];
  /** Minimum word count for this content type (news ~500, evergreen ~800). */
  minWords?: number;
}

export interface SeoResult { score: number; issues: string[]; focusKeyword: string; }

/** The keyword the post should rank for: declared by the model, else derived. */
export function pickFocusKeyword(input: { focusKeyword?: string; tags?: string[]; title: string }): string {
  const declared = (input.focusKeyword ?? '').trim();
  if (declared) return declared;
  const tag = (input.tags ?? []).find((t) => !GENERIC_TAGS.has(t.toLowerCase()));
  if (tag) return tag;
  // Fall back to the first 3–4 meaningful words of the title.
  return input.title.split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(' ');
}

const STOP = /[#*_>`~]/g;
function plainText(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')             // links → anchor text
    .replace(STOP, ' ');
}
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (hay.match(re) ?? []).length;
}

export function seoScore(input: SeoInput): SeoResult {
  const kw = pickFocusKeyword(input);
  const kwLower = kw.toLowerCase();
  const body = input.body ?? '';
  const text = plainText(body);
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const issues: string[] = [];
  let score = 0;

  // 1. Focus keyword in title (15)
  if (input.title.toLowerCase().includes(kwLower)) score += 15;
  else issues.push(`Focus keyword "${kw}" not in the title.`);

  // 2. Focus keyword in the intro — first ~160 words (15)
  const intro = words.slice(0, 160).join(' ').toLowerCase();
  if (intro.includes(kwLower)) score += 15;
  else issues.push(`Focus keyword not in the opening paragraph.`);

  // 3. Focus keyword in at least one heading (10)
  const headings = body.split('\n').filter((l) => /^#{2,3}\s+/.test(l.trim()));
  if (headings.some((h) => h.toLowerCase().includes(kwLower))) score += 10;
  else issues.push(`Focus keyword not in any subheading.`);

  // 4. Keyword usage: present at least twice, but not stuffed (15).
  // Measured as phrase occurrences per 100 words (>~3.5 reads as stuffing).
  const kwCount = countOccurrences(text, kw);
  const per100 = wordCount ? (kwCount / wordCount) * 100 : 0;
  if (kwCount >= 2 && per100 <= 3.5) score += 15;
  else if (kwCount < 2) issues.push(`Focus keyword used only ${kwCount}× — use it a few more times naturally.`);
  else issues.push(`Focus keyword over-used (keyword stuffing) — reduce it.`);

  // 5. Heading structure — at least 2 subheadings (10)
  if (headings.length >= 2) score += 10;
  else issues.push(`Add more ## / ### subheadings (found ${headings.length}).`);

  // 6. Internal links to other posts (15)
  const internal = (body.match(/\]\(\/posts\/[a-z0-9-]+\/?\)/gi) ?? []).length;
  if (internal >= 2) score += 15;
  else if (internal === 1) { score += 8; issues.push(`Only 1 internal link — add 1–2 more to related posts.`); }
  else issues.push(`No internal links — add 2–3 links to related Geo-Traveller posts.`);

  // 7. External / entity links (10)
  const external = (body.match(/\]\(https?:\/\//gi) ?? []).length;
  if (external >= 3) score += 10;
  else issues.push(`Only ${external} external links — link key entities to authoritative sources (aim 4–8).`);

  // 8. Readability — avg sentence length + no giant paragraphs (10)
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);
  const avgSentence = sentences.length ? wordCount / sentences.length : 0;
  const paras = body.split(/\n{2,}/).map((p) => plainText(p).split(/\s+/).filter(Boolean).length);
  const maxPara = paras.length ? Math.max(...paras) : 0;
  if (avgSentence <= 24 && maxPara <= 110) score += 10;
  else issues.push(`Readability: shorten sentences (avg ${Math.round(avgSentence)} words) / break up long paragraphs.`);

  // Length gate — informational, folds into issues (no separate points).
  if (input.minWords && wordCount < input.minWords) {
    issues.push(`Too short: ${wordCount} words (aim ≥ ${input.minWords}).`);
    score = Math.min(score, 65); // cap so a thin post can't "pass"
  }

  return { score: Math.max(0, Math.min(100, score)), issues, focusKeyword: kw };
}
