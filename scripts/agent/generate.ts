/**
 * Generate a Geo-Traveller blog post from a trending news candidate.
 * Single Claude API call that returns structured output via tool use.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Candidate } from './discover.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-4-5-20250929';

const SYSTEM = `You write for Geo-Traveller, a travel journal by Aditya Chaudhari covering India and the world. Your voice is observational, warm, and grounded — not promotional, not clickbait.

Audience: travelers who want context, not just headlines. Indians traveling abroad. Curious readers about places and policies.

For each story you write:
1. Lead with the actual news in plain language — what happened, why it matters to a traveler.
2. Add useful context — prior history, related rules, what readers should do or watch for.
3. Keep paragraphs short (2-3 sentences). Use markdown headings (##, ###) and lists where the structure helps.
4. Length: 400-700 words. Don't pad.
5. Acknowledge the source — close with "Source: [Outlet]" linking to the original article.
6. Don't invent facts. If a detail isn't in the source, write around it.
7. No emojis. No "In conclusion" filler. No "stay tuned for more updates" CTAs.

Output structured JSON via the publish_post tool.`;

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
        description: 'URL slug. Lowercase, hyphenated, 4-8 words. No years unless central to the topic.',
        pattern: '^[a-z0-9-]+$',
      },
      excerpt: {
        type: 'string',
        description: 'One sentence describing what the post covers. 130-180 characters.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Free-form tags. Include "Geo Daily" for news pieces. Country/region. Topic (Flight, Festival, Food, Visa, etc.). 3-6 tags.',
      },
      locationName: {
        type: 'string',
        description: 'Primary place this is about, e.g. "Tokyo, Japan" or "Across India". Optional.',
      },
      body: {
        type: 'string',
        description: 'Full body in Markdown / MDX. Headings, paragraphs, lists. NO frontmatter, NO title at top (handled separately). Include the source link in a final line: "Source: [Outlet Name](URL)".',
      },
      coverQuery: {
        type: 'string',
        description: 'A short query for an Unsplash image search to use as the cover. E.g. "Tokyo skyline at night", "Indian airport terminal", "Bhutan mountains". 2-5 words.',
      },
    },
    required: ['title', 'slug', 'excerpt', 'tags', 'body', 'coverQuery'],
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
  sourceUrl: string;
  sourceName: string;
}

export async function generatePost(candidate: Candidate): Promise<GeneratedPost> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const userPrompt = `Trending news to cover:

Headline: ${candidate.title}
Source: ${candidate.source}
URL: ${candidate.url}
Summary: ${candidate.summary}

Write the Geo-Traveller post. Use the publish_post tool to return the result.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [TOOL as any],
    tool_choice: { type: 'tool', name: 'publish_post' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = res.content.find((c: any) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a tool_use block');
  }
  const input = toolUse.input as Omit<GeneratedPost, 'sourceUrl' | 'sourceName'>;
  return {
    ...input,
    sourceUrl: candidate.url,
    sourceName: candidate.source,
  };
}
