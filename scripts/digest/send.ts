/**
 * Weekly subscriber digest.
 *
 * Runs every Saturday ~11:00 IST (05:30 UTC) via .github/workflows/digest.yml.
 * Emails every Active subscriber a newsletter-style roundup of posts published
 * in the last 7 days — a top-highlights box, then posts grouped into the site's
 * focus categories, each with a snippet + "Read more" link. Skips entirely when
 * there are no new posts. Each email carries a signed one-click unsubscribe link.
 *
 * Env: NOTION_TOKEN, NOTION_DATABASE_ID (Posts), NOTION_SUBSCRIBERS_DB_ID,
 *      RESEND_API_KEY, UNSUB_SECRET, SITE_URL?, DIGEST_DRY_RUN?
 */
import { Client, isFullPage } from '@notionhq/client';
import { createHmac } from 'node:crypto';
import { withRetry } from '../lib/notion.js';
import { CATEGORIES, categoryKeyForTags } from '../../src/lib/category-data.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const POSTS_DB = process.env.NOTION_DATABASE_ID!;
const SUBS_DB = process.env.NOTION_SUBSCRIBERS_DB_ID!;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const UNSUB_SECRET = process.env.UNSUB_SECRET;
const SITE_URL = process.env.SITE_URL ?? 'https://geo-traveller.com';
const DRY = !!process.env.DIGEST_DRY_RUN;

const FROM_EMAIL = 'The Geo Traveller <no-reply@adityeah.ai>';
const LOGO_URL = `${SITE_URL}/img/brand/logo.png`;
const ACCENT = '#B5482B';
const INK = '#2b2622';
const SOFT = '#6B635B';

// How many posts to feature per category section, and in the highlights box.
const PER_CATEGORY = 4;
const HIGHLIGHTS = 5;

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
function postUrl(slug: string): string {
  return `${SITE_URL}/posts/${slug}/`;
}

interface DigestPost { title: string; slug: string; excerpt: string; cover?: string; tags: string[]; }
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
      out.push({
        title,
        slug,
        excerpt: plain(pr.Excerpt?.rich_text),
        cover,
        tags: (pr.Tags?.multi_select ?? []).map((t: any) => t.name),
      });
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

/** Group posts into site categories, in CATEGORIES order, dropping empties. */
function groupByCategory(posts: DigestPost[]) {
  const byKey = new Map<string, DigestPost[]>();
  for (const p of posts) {
    const key = categoryKeyForTags(p.tags);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(p);
  }
  return CATEGORIES
    .map((cat) => ({ cat, posts: byKey.get(cat.key) ?? [] }))
    .filter((g) => g.posts.length > 0);
}

function snippet(p: DigestPost): string {
  const ex = (p.excerpt || '').trim();
  if (!ex) return '';
  return ex.length > 180 ? `${ex.slice(0, 177).trimEnd()}…` : ex;
}

function renderCard(p: DigestPost): string {
  const url = postUrl(p.slug);
  const sn = snippet(p);
  const thumb = p.cover
    ? `<td width="116" valign="top" style="padding:0 14px 0 0">
         <a href="${url}"><img src="${escapeHtml(p.cover)}" width="116" height="78" alt="" style="display:block;width:116px;height:78px;object-fit:cover;border-radius:8px;border:0" /></a>
       </td>`
    : '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
    ${thumb}
    <td valign="top">
      <a href="${url}" style="color:${INK};text-decoration:none;font-weight:700;font-size:16px;line-height:1.3">${escapeHtml(p.title)}</a>
      ${sn ? `<div style="margin:5px 0 7px;color:${SOFT};font-size:13.5px;line-height:1.5">${escapeHtml(sn)}</div>` : '<div style="height:5px"></div>'}
      <a href="${url}" style="color:${ACCENT};text-decoration:none;font-size:13px;font-weight:700">Read more →</a>
    </td>
  </tr></table>`;
}

function renderSection(cat: { key: string; label: string; badge: { bg: string } }, posts: DigestPost[]): string {
  const shown = posts.slice(0, PER_CATEGORY);
  const more = posts.length - shown.length;
  const seeAll = more > 0
    ? `<div style="margin:2px 0 0"><a href="${SITE_URL}/category/${cat.key}/" style="color:${SOFT};text-decoration:none;font-size:12.5px;font-weight:600">See all ${escapeHtml(cat.label)} (+${more}) →</a></div>`
    : '';
  return `
  <tr><td style="padding:6px 0 14px">
    <div style="border-top:2px solid ${cat.badge.bg};padding-top:10px;margin:18px 0 14px">
      <span style="display:inline-block;background:${cat.badge.bg};color:#fff;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:4px 10px;border-radius:4px">${escapeHtml(cat.label)}</span>
    </div>
    ${shown.map(renderCard).join('')}
    ${seeAll}
  </td></tr>`;
}

function renderEmail(sub: Subscriber, posts: DigestPost[]): { html: string; text: string } {
  const firstName = (sub.name.split(/\s+/)[0] || '').trim();
  const greeting = firstName && !firstName.includes('@') ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  const unsub = unsubLink(sub.pageId);
  const groups = groupByCategory(posts);
  const dateLine = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  const highlights = posts.slice(0, HIGHLIGHTS).map((p, i) =>
    `<tr>
       <td valign="top" width="22" style="color:${ACCENT};font-weight:700;font-size:14px;padding:3px 0">${i + 1}.</td>
       <td style="padding:3px 0"><a href="${postUrl(p.slug)}" style="color:${INK};text-decoration:none;font-weight:600;font-size:14px;line-height:1.4">${escapeHtml(p.title)}</a></td>
     </tr>`
  ).join('');

  const sections = groups.map((g) => renderSection(g.cat, g.posts)).join('');

  const html = `
<div style="background:#FAF7F0;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #E7E0D5;border-radius:14px">
  <tr><td style="padding:26px 28px 4px;text-align:center;border-bottom:1px solid #F0EAE0">
    <a href="${SITE_URL}"><img src="${LOGO_URL}" alt="The Geo Traveller" height="34" style="height:34px;border:0" /></a>
    <div style="margin:8px 0 18px;color:${SOFT};font-size:12px;letter-spacing:.04em;text-transform:uppercase">Your weekly roundup · ${dateLine}</div>
  </td></tr>

  <tr><td style="padding:22px 28px 0">
    <p style="margin:0 0 10px;color:${INK};font-size:15px">${greeting}</p>
    <p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6">Here's everything that went up on <a href="${SITE_URL}" style="color:${ACCENT};text-decoration:none">The Geo Traveller</a> this week — ${posts.length} new ${posts.length === 1 ? 'story' : 'stories'}.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F0;border:1px solid #EADFD0;border-radius:10px;margin:0 0 8px">
      <tr><td style="padding:16px 18px">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${SOFT};margin:0 0 10px">This week's highlights</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${highlights}</table>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 28px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections}</table>
  </td></tr>

  <tr><td style="padding:8px 28px 4px;text-align:center">
    <a href="${SITE_URL}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:11px 26px;border-radius:999px;font-weight:700;font-size:14px">Browse everything on the site →</a>
  </td></tr>

  <tr><td style="padding:22px 28px 26px;border-top:1px solid #F0EAE0;margin-top:18px">
    <p style="margin:14px 0 0;color:${INK};font-size:14px">Until next Saturday,<br/>Aditya — <span style="color:${SOFT}">The Geo Traveller</span></p>
    <p style="margin:14px 0 0;color:#aaa;font-size:12px;line-height:1.5">You get this roundup once a week, every Saturday morning. <a href="${unsub}" style="color:#999">Unsubscribe instantly</a>.</p>
  </td></tr>
</table>
</td></tr></table>
</div>`;

  const text =
    `${greeting}\n\nThis week on The Geo Traveller — ${posts.length} new ${posts.length === 1 ? 'story' : 'stories'}:\n\n` +
    `THIS WEEK'S HIGHLIGHTS\n` +
    posts.slice(0, HIGHLIGHTS).map((p, i) => `${i + 1}. ${p.title}\n   ${postUrl(p.slug)}`).join('\n') +
    `\n\n` +
    groups.map((g) => {
      const shown = g.posts.slice(0, PER_CATEGORY);
      const more = g.posts.length - shown.length;
      return `${g.cat.label.toUpperCase()}\n` +
        shown.map((p) => {
          const sn = snippet(p);
          return `• ${p.title}${sn ? `\n  ${sn}` : ''}\n  Read more: ${postUrl(p.slug)}`;
        }).join('\n\n') +
        (more > 0 ? `\n  See all ${g.cat.label} (+${more}): ${SITE_URL}/category/${g.cat.key}/` : '');
    }).join('\n\n') +
    `\n\nBrowse everything: ${SITE_URL}\n\nUntil next Saturday,\nAditya — The Geo Traveller\n\n` +
    `(Weekly roundup, Saturday mornings. Unsubscribe instantly: ${unsub})`;

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

// Local preview: render the email with mock posts (no Notion / no send) and
// print the HTML. Usage: DIGEST_PREVIEW=1 npx tsx scripts/digest/send.ts
if (process.env.DIGEST_PREVIEW) {
  const mk = (title: string, excerpt: string, tags: string[]): DigestPost => ({
    title, excerpt, tags,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    cover: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=232',
  });
  const mock: DigestPost[] = [
    mk('Vande Bharat adds 12 new routes this month', 'The fast trains expand to a dozen new city pairs — here are the timings and what changes for travellers.', ['Geo Daily']),
    mk('Forex cards vs UPI abroad: what Indians should carry', 'A complete breakdown of forex cards, debit and credit cards, UPI abroad, cash, fees and a pre-trip money checklist.', ['Visa', 'Guide']),
    mk('IndiGo opens Delhi–Bali direct: fares from ₹18k', 'The new direct route cuts a long layover — early fares and the booking window, explained.', ['Flight', 'Airline']),
    mk('10 new Mumbai restaurants to try this month', 'Thai with a Michelin touch to an Afghan feast — the openings worth a table this month.', ['Food', 'Restaurant']),
    mk('SOCIAL’s Satrangi Mela 2026: dates and tickets', 'A weekend of food, music and craft — when it runs, where, and how to book.', ['Experience', 'Festival']),
    mk('A 7-day Bhutan loop: Thimphu, Punakha and Paro', 'A week-long itinerary with stays, permits and the drives that are worth it.', ['Bhutan', 'India']),
    mk('Japan visa for Indians: 2026 step-by-step', 'Documents, fees in INR, processing times and the common mistakes that cause rejections.', ['Visa', 'Japan']),
  ];
  const { html } = renderEmail({ pageId: 'preview', email: 'you@example.com', name: 'Aditya' }, mock);
  process.stdout.write(html);
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}
