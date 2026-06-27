/**
 * Weekly subscriber digest.
 *
 * Runs every Saturday ~11:00 IST (05:30 UTC) via .github/workflows/digest.yml.
 * Emails every Active subscriber a roundup of posts published in the last 7
 * days. Skips entirely when there are no new posts (no empty emails). Each
 * email carries a signed one-click unsubscribe link.
 *
 * Env: NOTION_TOKEN, NOTION_DATABASE_ID (Posts), NOTION_SUBSCRIBERS_DB_ID,
 *      RESEND_API_KEY, UNSUB_SECRET, SITE_URL?, DIGEST_DRY_RUN?
 */
import { Client, isFullPage } from '@notionhq/client';
import { createHmac } from 'node:crypto';
import { withRetry } from '../lib/notion.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const POSTS_DB = process.env.NOTION_DATABASE_ID!;
const SUBS_DB = process.env.NOTION_SUBSCRIBERS_DB_ID!;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const UNSUB_SECRET = process.env.UNSUB_SECRET;
const SITE_URL = process.env.SITE_URL ?? 'https://geo-traveller.com';
const DRY = !!process.env.DIGEST_DRY_RUN;

const FROM_EMAIL = 'The Geo Traveller <no-reply@adityeah.ai>';
const notion = new Client({ auth: NOTION_TOKEN, fetch: globalThis.fetch });

function plain(rich: any[] | undefined): string {
  return (rich ?? []).map((r) => r.plain_text ?? '').join('');
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function unsubLink(pageId: string): string {
  if (!UNSUB_SECRET) return `${SITE_URL}/contact/`;
  const s = createHmac('sha256', UNSUB_SECRET).update(pageId).digest('hex');
  return `${SITE_URL}/api/unsubscribe?id=${encodeURIComponent(pageId)}&s=${s}`;
}

interface DigestPost { title: string; slug: string; excerpt: string; cover?: string; }
interface Subscriber { pageId: string; email: string; name: string; }

async function postsLastWeek(): Promise<DigestPost[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const out: DigestPost[] = [];
  let cursor: string | undefined;
  do {
    const res = await withRetry(() => notion.databases.query({
      database_id: POSTS_DB,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        and: [
          { property: 'Status', select: { equals: 'Published' } },
          { property: 'Publish Date', date: { on_or_after: cutoff } },
        ],
      },
      sorts: [{ property: 'Publish Date', direction: 'descending' }],
    }));
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const pr = p.properties as any;
      const slug = plain(pr.Slug?.rich_text);
      const title = plain(pr.Title?.title);
      if (!slug || !title) continue;
      const cover = pr.Cover?.files?.[0]?.external?.url ?? pr.Cover?.files?.[0]?.file?.url;
      out.push({ title, slug, excerpt: plain(pr.Excerpt?.rich_text), cover });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

async function activeSubscribers(): Promise<Subscriber[]> {
  const out: Subscriber[] = [];
  let cursor: string | undefined;
  do {
    const res = await withRetry(() => notion.databases.query({
      database_id: SUBS_DB,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: 'Status', select: { equals: 'Active' } },
    }));
    for (const p of res.results) {
      if (!isFullPage(p)) continue;
      const pr = p.properties as any;
      const email = pr.Email?.email;
      if (!email) continue;
      out.push({ pageId: p.id, email, name: plain(pr.Name?.title) });
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

function renderEmail(sub: Subscriber, posts: DigestPost[]): { html: string; text: string } {
  const firstName = (sub.name.split(/\s+/)[0] || '').trim();
  const greeting = firstName && !firstName.includes('@') ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  const unsub = unsubLink(sub.pageId);

  const items = posts.map((p) => {
    const url = `${SITE_URL}/posts/${p.slug}/`;
    const ex = p.excerpt ? `<p style="margin:.25rem 0 0;color:#6B635B;font-size:.9rem;line-height:1.5">${escapeHtml(p.excerpt)}</p>` : '';
    const thumb = p.cover
      ? `<td width="96" style="padding-right:14px;vertical-align:top"><a href="${url}"><img src="${escapeHtml(p.cover)}" width="96" height="64" alt="" style="border-radius:8px;object-fit:cover;display:block"/></a></td>`
      : '';
    return `<tr><table role="presentation" width="100%" style="margin:0 0 1.1rem"><tr>${thumb}<td style="vertical-align:top">
      <a href="${url}" style="color:#2b2b2b;text-decoration:none;font-weight:700;font-size:1.02rem;line-height:1.3">${escapeHtml(p.title)}</a>${ex}
    </td></tr></table></tr>`;
  }).join('');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2b2b2b;line-height:1.6">
  <p>${greeting}</p>
  <p>Here's what went up on <a href="${SITE_URL}" style="color:#a8442a;text-decoration:none">The Geo Traveller</a> this week:</p>
  <table role="presentation" width="100%" style="margin:1.25rem 0">${items}</table>
  <p style="margin:1.5rem 0">
    <a href="${SITE_URL}" style="display:inline-block;background:#a8442a;color:#fff;text-decoration:none;padding:0.6rem 1.3rem;border-radius:999px;font-weight:600">Read more on the site →</a>
  </p>
  <p style="margin-top:1.25rem">Until next Saturday,<br/>Aditya<br/><span style="color:#999">The Geo Traveller</span></p>
  <p style="margin-top:1.5rem;font-size:12px;color:#aaa">You get this roundup once a week. <a href="${unsub}" style="color:#aaa">Unsubscribe instantly</a>.</p>
</div>`;

  const text =
    `${greeting}\n\nHere's what went up on The Geo Traveller this week:\n\n` +
    posts.map((p) => `• ${p.title}\n  ${SITE_URL}/posts/${p.slug}/`).join('\n\n') +
    `\n\nRead more: ${SITE_URL}\n\nUntil next Saturday,\nAditya — The Geo Traveller\n\n` +
    `(Weekly roundup. Unsubscribe instantly: ${unsub})`;

  return { html, text };
}

async function sendOne(sub: Subscriber, posts: DigestPost[]): Promise<boolean> {
  const { html, text } = renderEmail(sub, posts);
  if (DRY || !RESEND_API_KEY) {
    console.log(`[digest] ${DRY ? 'DRY' : 'no RESEND_API_KEY'} — would email ${sub.email}`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [sub.email],
        subject: 'This week on The Geo Traveller',
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsubLink(sub.pageId)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!res.ok) {
      console.error(`[digest] send failed for ${sub.email}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[digest] send error for ${sub.email}`, e);
    return false;
  }
}

async function main() {
  const posts = await postsLastWeek();
  console.log(`[digest] ${posts.length} post(s) published in the last 7 days.`);
  if (posts.length === 0) {
    console.log('[digest] nothing new this week — no emails sent.');
    return;
  }
  const subs = await activeSubscribers();
  console.log(`[digest] ${subs.length} active subscriber(s).`);
  if (subs.length === 0) return;

  let sent = 0;
  // Sequential to stay well within Resend rate limits.
  for (const sub of subs) {
    if (await sendOne(sub, posts)) sent++;
  }
  console.log(`[digest] done — ${sent}/${subs.length} emails sent.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
