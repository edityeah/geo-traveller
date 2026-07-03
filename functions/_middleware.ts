/**
 * Return HTTP 410 Gone for junk URL patterns left over from the old hacked
 * WordPress site (spam/scraper URLs Google discovered during the hack, e.g.
 * /content.php?g=…, /detail/<id>, /shopdetail/<id>, /wp-*). These never exist
 * on the current Astro site.
 *
 * 410 tells Google the URL is PERMANENTLY gone, so it drops them from its index
 * faster than a plain 404. Everything else passes straight through untouched.
 *
 * This runs before static assets and the /api functions; real routes never
 * match these patterns, so they fall through to `next()` normally.
 */
const GONE_PREFIXES = ['/detail/', '/shopdetail/', '/shopdetails/', '/wp-content/', '/wp-includes/', '/wp-admin/'];

function isJunk(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (p.endsWith('.php')) return true;                 // content.php, xmlrpc.php, …
  if (p === '/wp-login') return true;
  return GONE_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export const onRequest: PagesFunction = async (ctx) => {
  if (isJunk(new URL(ctx.request.url).pathname)) {
    return new Response('410 Gone — this page no longer exists.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' },
    });
  }
  return ctx.next();
};
