/**
 * One-click unsubscribe.
 *
 * GET  /api/unsubscribe?id=<notion-page-id>&s=<hmac>  → marks the subscriber
 *      Status=Unsubscribed in Notion and returns a small confirmation page.
 * POST (same query) → for email clients' List-Unsubscribe-Post one-click; 200.
 *
 * The link is signed with HMAC-SHA256 over the Notion page id (opaque — no email
 * in the URL) using UNSUB_SECRET, so links can't be forged or enumerated.
 *
 * Runtime env: NOTION_TOKEN, UNSUB_SECRET.
 */

interface Env {
  NOTION_TOKEN?: string;
  UNSUB_SECRET?: string;
}

const NOTION_VERSION = '2022-06-28';

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type Result = 'ok' | 'bad' | 'error';

async function doUnsubscribe(env: Env, id: string, sig: string): Promise<Result> {
  if (!env.NOTION_TOKEN || !env.UNSUB_SECRET) return 'error';
  if (!id || !sig) return 'bad';
  const expected = await hmacHex(env.UNSUB_SECRET, id);
  if (!safeEqual(expected, sig)) return 'bad';
  try {
    const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          Status: { select: { name: 'Unsubscribed' } },
          Unsubscribed: { date: { start: new Date().toISOString() } },
        },
      }),
    });
    // If the optional "Unsubscribed" date property doesn't exist, retry with
    // just the Status flip so unsubscribe still works.
    if (!res.ok) {
      const retry = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${env.NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: { Status: { select: { name: 'Unsubscribed' } } } }),
      });
      return retry.ok ? 'ok' : 'error';
    }
    return 'ok';
  } catch {
    return 'error';
  }
}

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${title} — The Geo Traveller</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;background:#FAF7F0;color:#2B2622;
    display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:1.5rem}
  .card{max-width:30rem;background:#fff;border:1px solid #E7E0D5;border-radius:14px;
    padding:2.25rem 2rem;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .75rem}
  p{color:#6B635B;line-height:1.6;margin:0 0 1.25rem;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:.95rem}
  a{display:inline-block;background:#B5482B;color:#fff;text-decoration:none;
    padding:.6rem 1.3rem;border-radius:999px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:.9rem;font-weight:600}
</style></head><body><div class="card">${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const sig = url.searchParams.get('s') ?? '';
  const result = await doUnsubscribe(env, id, sig);
  if (result === 'ok') {
    return page(
      'Unsubscribed',
      `<h1>You're unsubscribed</h1><p>You won't receive the weekly roundup anymore. Changed your mind? You can subscribe again anytime.</p><a href="https://geo-traveller.com/">Back to The Geo Traveller</a>`
    );
  }
  if (result === 'bad') {
    return page(
      'Invalid link',
      `<h1>This link looks invalid</h1><p>The unsubscribe link is incomplete or has expired. You can manage your subscription from the contact page.</p><a href="https://geo-traveller.com/contact/">Contact</a>`,
      400
    );
  }
  return page(
    'Something went wrong',
    `<h1>Couldn't unsubscribe right now</h1><p>Please try again in a moment, or reach out via the contact page and I'll remove you.</p><a href="https://geo-traveller.com/contact/">Contact</a>`,
    500
  );
};

// Gmail/Apple Mail one-click unsubscribe (List-Unsubscribe-Post) sends a POST.
export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const sig = url.searchParams.get('s') ?? '';
  const result = await doUnsubscribe(env, id, sig);
  return new Response(result === 'ok' ? 'unsubscribed' : 'error', {
    status: result === 'ok' ? 200 : result === 'bad' ? 400 : 500,
  });
};
