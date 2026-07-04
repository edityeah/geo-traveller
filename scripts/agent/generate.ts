/**
 * Generate a Geo-Traveller blog post from a trending news candidate.
 * Single Claude API call that returns structured output via tool use.
 *
 * Output includes inline image placeholders + entity backlinks + internal
 * backlinks to other Geo-Traveller posts.
 */
import type { Candidate } from './discover.js';
import type { SeedTopic } from './topics.js';
import { structuredCompletion } from './llm.js';

export interface ExistingPost {
  title: string;
  slug: string;
  tags: string[];
  excerpt?: string;
}

const SYSTEM = `You write for Geo-Traveller, a travel journal by Aditya Chaudhari covering India and the world. Voice: observational, warm, grounded — not promotional, not clickbait.

Audience: travelers who want context. Indians traveling abroad, plus curious readers about places and policies.

For each story:

1. Lead with what happened in plain language and why it matters to a traveler.
2. Add context — prior policy, history, comparable situations, what readers should do.
3. Short paragraphs (2-3 sentences). Use ## and ### headings. Lists when they help.
4. Length: 500-800 words. Don't pad.
5. Don't invent facts. If a detail isn't in the source, write around it.
6. No emojis. No "In conclusion", no "stay tuned" CTAs.
7. Do NOT cite the source article or include any "Source:" line. The reader doesn't need to be told where this came from.

REQUIRED — inline links and images:

A. ENTITY LINKS (external): naturally hyperlink the key proper-nouns to their official websites or Wikipedia. Companies → their .com. Cities or landmarks → their Wikipedia page. Government bodies → their official site. Aim for 4-8 such links across the body. Use natural anchor text — don't link the same entity twice. Format: [Lighthouse](https://www.cloudbeds.com/lighthouse/).

B. INTERNAL BACKLINKS: you will be given a list of existing Geo-Traveller posts. When something in the post is topically related to one of those, link it inline using the post's slug, like [as we covered earlier](/posts/SLUG/). Aim for 1-3 internal backlinks per post. Pick relevant ones; don't force fits.

C. INLINE IMAGES: place 2-4 inline images at moments where a visual helps. Use this exact markdown syntax with a special "query:" URL — the build pipeline finds real photos and verifies each one visually before using it:

   ![Descriptive alt text](query:concrete photographable subject)

   Example: ![A traveler's passport with a visa sticker](query:passport with visa sticker)

   CRITICAL: the query MUST name a concrete, literal, photographable THING — a real object, place, building, document, person, or scene that a stock photo would actually show. The alt text and the query must describe the SAME concrete thing.
   GOOD queries: "Japanese passport and visa page", "Tokyo Narita airport terminal", "person at embassy visa counter", "Indian rupee banknotes and credit card".
   BAD queries (never use — these are abstract and return junk): "document checklist", "travel requirements", "application process", "planning a trip", "eligibility criteria". If a section is about an abstract concept, either choose a concrete object that represents it or omit the image.
   The first image should appear after the opening 1-2 paragraphs, not at the very top.

Output the result via the publish_post tool.`;

const SYSTEM_EVERGREEN = `You write evergreen, genuinely useful travel guides for Geo-Traveller by Aditya Chaudhari. Audience: Indians traveling abroad and readers researching a specific process.

This is NOT news. It is a reference guide people find by searching. Make it the most useful page on the topic:

1. Open with a one-paragraph summary of the answer, then a "Last updated" note.
2. Cover the topic exhaustively and concretely: requirements, document checklists, costs in INR, step-by-step process, timelines, official links, and common mistakes. Use real specifics; never pad.
3. Use ## and ### headings and lists so it scans well. 800-1400 words.
4. Do NOT invent facts (fees, processing times). If a number may change, say "as of the latest update, …" and link the official source so the reader can verify.
5. No emojis, no "In conclusion", no clickbait.

REQUIRED inline links and images — same rules as the news template:
A. ENTITY LINKS: hyperlink key proper nouns to official sites / Wikipedia (embassies, VFS, government portals). 4-8 links.
B. INTERNAL BACKLINKS: link to related Geo-Traveller posts by slug, [text](/posts/SLUG/). 1-3.
C. INLINE IMAGES: 2-4 ![alt](query:specific query) placeholders; first after the intro.

Output via the publish_post tool.`;

const TOOL = {
  name: 'publish_post',
  description: "Save the generated post's structured data",
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Punchy, descriptive headline. Not clickbait. 6-14 words.',
      },
      slug: {
        type: 'string',
        description: 'URL slug. Lowercase, hyphenated, 4-8 words. No year unless central.',
        pattern: '^[a-z0-9-]+$',
      },
      excerpt: {
        type: 'string',
        description: 'One sentence describing what the post covers. 130-180 characters.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Free-form. Include "Geo Daily" for news. Country/region. Topic (Flight, Festival, Food, Visa, etc.). 3-6 tags.',
      },
      locationName: {
        type: 'string',
        description: 'Primary place this is about, e.g. "Tokyo, Japan" or "Across India". Optional.',
      },
      body: {
        type: 'string',
        description: 'Full body in Markdown / MDX. Headings, paragraphs, lists. NO frontmatter, NO title at top. Must include entity links, internal backlinks, and inline images per the system prompt. NO "Source:" line.',
      },
      coverQuery: {
        type: 'string',
        description: 'A short Unsplash search query for the cover photo. Must be SPECIFIC to this story\'s subject — a place, object, person, or scene from the post — not abstract. Bad: "travel"; "technology". Good: "hotel front desk", "Tokyo street at night", "airport terminal sunset".',
      },
      focusKeyword: {
        type: 'string',
        description: 'The primary search phrase this post should rank for (2–5 words, e.g. "Thailand visa for Indians", "new Mumbai restaurants"). Weave it naturally into the title, opening paragraph, and at least one subheading.',
      },
    },
    required: ['title', 'slug', 'excerpt', 'tags', 'body', 'coverQuery', 'focusKeyword'],
  },
} as const;

export interface GeneratedPost {
  title: string;
  slug: string;
  excerpt: string;
  tags: string[];
  locationName?: string;
  body: string;
  coverQuery: string;
  focusKeyword?: string;
  sourceUrl: string;
  sourceName: string;
}

export async function generatePost(
  candidate: Candidate,
  existingPosts: ExistingPost[] = []
): Promise<GeneratedPost> {
  // Trim to most-relevant 20 by simple keyword overlap, so the prompt doesn't blow up.
  const topic = (candidate.title + ' ' + candidate.summary).toLowerCase();
  const ranked = existingPosts
    .map((p) => {
      const text = (p.title + ' ' + (p.tags ?? []).join(' ') + ' ' + (p.excerpt ?? '')).toLowerCase();
      let score = 0;
      for (const word of topic.split(/\W+/).filter((w) => w.length >= 4)) {
        if (text.includes(word)) score++;
      }
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.p);

  const postList = ranked.length > 0
    ? ranked.map((p) => `- ${p.title} — slug: ${p.slug}${p.tags?.length ? ' — tags: ' + p.tags.slice(0, 4).join(', ') : ''}`).join('\n')
    : '(none yet)';

  const userPrompt = `Trending news to cover:

Headline: ${candidate.title}
Source: ${candidate.source}
Source URL: ${candidate.url}
Summary: ${candidate.summary}

Existing Geo-Traveller posts you can backlink to inline when topically relevant (use the slug):

${postList}

Write the Geo-Traveller post. Use the publish_post tool to return the result.`;

  const input = (await structuredCompletion({
    system: SYSTEM,
    user: userPrompt,
    schema: TOOL.input_schema as any,
    toolName: TOOL.name,
    toolDescription: TOOL.description,
    maxTokens: 4000,
  })) as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
  return {
    ...input,
    sourceUrl: candidate.url,
    sourceName: candidate.source,
  };
}

export async function generateEvergreen(
  topic: SeedTopic,
  existingPosts: ExistingPost[] = []
): Promise<GeneratedPost> {
  const postList = existingPosts.length
    ? existingPosts.slice(0, 20).map((p) => `- ${p.title} — slug: ${p.slug}`).join('\n')
    : '(none yet)';

  const userPrompt = `Write the definitive Geo-Traveller guide on this topic.

Working title: ${topic.title}
Topic brief: ${topic.brief}
Suggested tags: ${topic.tags.join(', ')}

Existing Geo-Traveller posts you can backlink to inline when relevant (use the slug):

${postList}

Use the publish_post tool. Set tags to include the relevant ones above (do NOT include "Geo Daily"). coverQuery should describe a fitting photo subject.`;

  const input = (await structuredCompletion({
    system: SYSTEM_EVERGREEN,
    user: userPrompt,
    schema: TOOL.input_schema as any,
    toolName: TOOL.name,
    toolDescription: TOOL.description,
    maxTokens: 6000,
  })) as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
  return { ...input, sourceUrl: '', sourceName: '' };
}

const SYSTEM_EVENT = `You write event coverage for Geo-Traveller — notable events worth attending, watching, or booking: tech keynotes (Apple, Google, Meta, Microsoft, OpenAI), global sport (Olympics, FIFA, cricket/IPL), concerts, expos, and India events. Voice: clear, useful, grounded — not hype.

You are given a real news source about an event. Write a reader-useful post centered on HOW TO ENGAGE with it:

1. Lead with what the event is and why it matters, in plain language.
2. Cover the practical details that a reader needs: dates, location/venue (or "online"), and — most importantly — HOW TO BOOK, REGISTER, WATCH, or ATTEND (ticket sales, registration, livestream/where to stream, official site).
3. Add useful context: who it's for, what to expect, prior editions, India relevance if any.
4. Short paragraphs, ## and ### headings, lists where they help. 450-750 words.

ACCURACY IS CRITICAL:
- Use ONLY facts present in the source. Do NOT invent dates, ticket prices, venues, or links.
- If a specific date/price isn't in the source, say "as announced" or "check the official site" and LINK the official site rather than guessing.
- No "Source:" line.

REQUIRED inline links and images (same rules as other posts):
A. ENTITY LINKS: hyperlink the organizer / official event site / ticketing or streaming platform (the booking path) and key proper nouns. 4-8 links.
B. INTERNAL BACKLINKS: link to related Geo-Traveller posts by slug, [text](/posts/SLUG/). 1-3 when relevant.
C. INLINE IMAGES: 2-4 ![alt](query:concrete photographable subject) — a real scene/object (stadium, conference stage, concert crowd, city venue). Never abstract.

Output via the publish_post tool.`;

/** Generate an event post grounded in a discovered news source. */
export async function generateEvent(
  candidate: Candidate,
  existingPosts: ExistingPost[] = []
): Promise<GeneratedPost> {
  const postList = existingPosts.length
    ? existingPosts.slice(0, 20).map((p) => `- ${p.title} — slug: ${p.slug}`).join('\n')
    : '(none yet)';

  const userPrompt = `Event to cover (grounded in this source — do not invent details beyond it):

Headline: ${candidate.title}
Source: ${candidate.source}
Source URL: ${candidate.url}
Summary: ${candidate.summary}

Existing Geo-Traveller posts you can backlink to inline when relevant (use the slug):

${postList}

Write the event post. Use the publish_post tool. Tags MUST include "Events" plus topical tags (e.g. Tech, Sports, Cricket, Music, India, Olympics). coverQuery should describe a fitting concrete photo subject.`;

  const input = (await structuredCompletion({
    system: SYSTEM_EVENT,
    user: userPrompt,
    schema: TOOL.input_schema as any,
    toolName: TOOL.name,
    toolDescription: TOOL.description,
    maxTokens: 4000,
  })) as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
  return { ...input, sourceUrl: candidate.url, sourceName: candidate.source };
}

const SYSTEM_SEO_REWRITE = `You are an SEO editor for Geo-Traveller. You are given a draft post and a list of on-page SEO issues. Rewrite the post to fix EVERY issue while keeping the same facts, angle, and voice.

Hard rules:
- Do NOT invent facts, dates, prices, or events. Only restructure/expand what's already implied by the draft; if you can't fix an issue without inventing, leave that part accurate.
- Keep (and where helpful, add) inline images in the exact form ![alt](query:concrete subject).
- Keep internal backlinks [text](/posts/SLUG/) — use only slugs from the provided list — and entity links to official sites / Wikipedia.
- Weave the focus keyword naturally into the title, the opening paragraph, and at least one ## / ### subheading. Don't keyword-stuff.
- Use ## and ### subheadings and short paragraphs. No emojis, no "Source:" line.

Output the improved post via the publish_post tool (all fields), keeping the same focusKeyword.`;

/** Rewrite a draft to fix specific SEO issues. Grounded — no new facts. */
export async function rewriteForSeo(
  post: GeneratedPost,
  issues: string[],
  focusKeyword: string,
  existingPosts: ExistingPost[] = []
): Promise<GeneratedPost> {
  const postList = existingPosts.length
    ? existingPosts.slice(0, 20).map((p) => `- ${p.title} — slug: ${p.slug}`).join('\n')
    : '(none yet)';

  const userPrompt = `Focus keyword: ${focusKeyword}

SEO issues to fix:
${issues.map((i) => `- ${i}`).join('\n')}

Existing Geo-Traveller posts you can link to (use the slug):
${postList}

CURRENT DRAFT
Title: ${post.title}
Excerpt: ${post.excerpt}
Tags: ${post.tags.join(', ')}

Body:
${post.body}

Rewrite it to fix the issues. Use the publish_post tool.`;

  const input = (await structuredCompletion({
    system: SYSTEM_SEO_REWRITE,
    user: userPrompt,
    schema: TOOL.input_schema as any,
    toolName: TOOL.name,
    toolDescription: TOOL.description,
    maxTokens: 6000,
  })) as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
  // Preserve provenance from the original draft.
  return { ...input, sourceUrl: post.sourceUrl, sourceName: post.sourceName };
}
