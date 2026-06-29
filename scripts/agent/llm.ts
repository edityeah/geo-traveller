/**
 * LLM provider abstraction for the blog agent.
 *
 * Lets the whole agent (writing, QA, image-selection-by-vision) run on either
 * Anthropic (Claude) or OpenAI, switched by a single env var:
 *
 *   AGENT_LLM_PROVIDER = anthropic (default) | openai
 *
 * Models (overridable):
 *   Anthropic: AGENT_MODEL, AGENT_QA_MODEL, AGENT_VISION_MODEL
 *   OpenAI:    AGENT_OPENAI_MODEL (writing+QA), AGENT_OPENAI_VISION_MODEL
 *
 * Keys: ANTHROPIC_API_KEY or OPENAI_API_KEY (whichever provider is active).
 *
 * The three primitives below map onto each provider's native shape:
 *   structuredCompletion — forced tool/function call → parsed JSON object
 *   judgeLine            — short free-text reply (QA verdict)
 *   visionPick           — interleaved images + instruction → short text reply
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type Provider = 'anthropic' | 'openai';

export function llmProvider(): Provider {
  return (process.env.AGENT_LLM_PROVIDER ?? 'anthropic').toLowerCase() === 'openai'
    ? 'openai'
    : 'anthropic';
}

/** Is the key for the ACTIVE provider present? */
export function hasLlmKey(): boolean {
  return llmProvider() === 'openai'
    ? !!process.env.OPENAI_API_KEY
    : !!process.env.ANTHROPIC_API_KEY;
}

const OPENAI_MODEL = process.env.AGENT_OPENAI_MODEL ?? 'gpt-5.1';

function writeModel(): string {
  return llmProvider() === 'openai'
    ? OPENAI_MODEL
    : (process.env.AGENT_MODEL ?? 'claude-sonnet-4-5-20250929');
}
function qaModel(): string {
  return llmProvider() === 'openai'
    ? (process.env.AGENT_OPENAI_QA_MODEL ?? OPENAI_MODEL)
    : (process.env.AGENT_QA_MODEL ?? 'claude-sonnet-4-5-20250929');
}
function visionModel(): string {
  return llmProvider() === 'openai'
    ? (process.env.AGENT_OPENAI_VISION_MODEL ?? OPENAI_MODEL)
    : (process.env.AGENT_VISION_MODEL ?? 'claude-haiku-4-5-20251001');
}

// API keys never contain whitespace; strip any (a pasted key that wrapped
// across lines would otherwise be an invalid HTTP header value).
function cleanKey(v: string | undefined): string {
  return (v ?? '').replace(/\s+/g, '');
}
function openai(): OpenAI {
  return new OpenAI({ apiKey: cleanKey(process.env.OPENAI_API_KEY) });
}
function anthropic(): Anthropic {
  return new Anthropic({ apiKey: cleanKey(process.env.ANTHROPIC_API_KEY), fetch: globalThis.fetch });
}

/** Reasoning models can spend tokens before emitting output — give headroom. */
function openaiCap(maxTokens: number): number {
  return Math.max(maxTokens, 8000);
}

export interface ImagePart { media_type: string; data: string } // base64 bytes

/**
 * Force a single structured object out of the model via tool/function calling.
 * `schema` is a JSON Schema for the object. Returns the parsed object.
 */
export async function structuredCompletion(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  toolName: string;
  toolDescription: string;
  maxTokens: number;
}): Promise<any> {
  if (llmProvider() === 'openai') {
    const res = await openai().chat.completions.create({
      model: writeModel(),
      max_completion_tokens: openaiCap(opts.maxTokens),
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      tools: [{
        type: 'function',
        function: { name: opts.toolName, description: opts.toolDescription, parameters: opts.schema },
      }],
      tool_choice: { type: 'function', function: { name: opts.toolName } },
    });
    const call = res.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== 'function') throw new Error('OpenAI did not return a function call');
    try {
      return JSON.parse(call.function.arguments);
    } catch {
      throw new Error('OpenAI returned malformed function arguments');
    }
  }

  const res = await anthropic().messages.create({
    model: writeModel(),
    max_tokens: opts.maxTokens,
    system: opts.system,
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema as any }],
    tool_choice: { type: 'tool', name: opts.toolName },
    messages: [{ role: 'user', content: opts.user }],
  });
  const toolUse = res.content.find((c: any) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude did not return a tool_use block');
  return (toolUse as any).input;
}

/** Short free-text reply (used by QA). */
export async function judgeLine(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
  if (llmProvider() === 'openai') {
    const res = await openai().chat.completions.create({
      model: qaModel(),
      max_completion_tokens: openaiCap(opts.maxTokens),
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    });
    return (res.choices[0]?.message?.content ?? '').trim();
  }
  const res = await anthropic().messages.create({
    model: qaModel(),
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });
  return ((res.content.find((c: any) => c.type === 'text') as any)?.text ?? '').trim();
}

/** Show interleaved images + an instruction; return the model's short reply. */
export async function visionPick(opts: {
  instruction: string;
  images: ImagePart[];
  maxTokens: number;
}): Promise<string> {
  if (llmProvider() === 'openai') {
    const content: any[] = [];
    opts.images.forEach((im, i) => {
      content.push({ type: 'text', text: `Image ${i + 1}:` });
      content.push({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } });
    });
    content.push({ type: 'text', text: opts.instruction });
    const res = await openai().chat.completions.create({
      model: visionModel(),
      max_completion_tokens: openaiCap(opts.maxTokens),
      messages: [{ role: 'user', content }],
    });
    return (res.choices[0]?.message?.content ?? '').trim();
  }
  const content: any[] = [];
  opts.images.forEach((im, i) => {
    content.push({ type: 'text', text: `Image ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
  });
  content.push({ type: 'text', text: opts.instruction });
  const res = await anthropic().messages.create({
    model: visionModel(),
    max_tokens: opts.maxTokens,
    messages: [{ role: 'user', content }],
  });
  return ((res.content.find((c: any) => c.type === 'text') as any)?.text ?? '').trim();
}
