/**
 * Wildcard 410 for demo.geo-traveller.com — the subdomain that hosted the old
 * hacked WordPress (hiroshi.php Japanese-keyword spam). Google discovered
 * ~500k junk URLs there; with DNS dead it only sees "DNS error" and retries
 * for months. An explicit 410 Gone tells it each URL is permanently dead, so
 * the backlog purges much faster and crawl budget returns to the real site.
 *
 * Deployed by .github/workflows/demo-410.yml (route: demo.geo-traveller.com/*).
 * robots.txt is intentionally 410 too — Google needs the URLs crawlable to see
 * the 410s; a missing/410 robots.txt permits crawling.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response('410 Gone — this page no longer exists.', {
      status: 410,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-robots-tag': 'noindex',
      },
    });
  },
};
