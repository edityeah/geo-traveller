// End-to-end live site checker.
// Crawls the sitemap, fetches every page, extracts all <img>, internal <a>,
// and <link> URLs, then verifies each unique URL returns a healthy status.
// Also checks feeds, robots, llms.txt, and the comments/likes API.
//
// Usage: node scripts/e2e-check.mjs [https://geo-traveller.com]

const BASE = (process.argv[2] || 'https://geo-traveller.com').replace(/\/$/, '');
const ORIGIN = new URL(BASE).origin;
const CONCURRENCY = 12;
const TIMEOUT_MS = 20000;

const UA = 'GeoTravellerE2E/1.0 (+health-check)';

function color(c, s) {
  const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 };
  return `\x1b[${codes[c]}m${s}\x1b[0m`;
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA }, ...opts });
  } finally {
    clearTimeout(t);
  }
}

// Check a URL with one retry on timeout/network error (filters transient blips).
async function checkUrl(url, { head = true } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let res = await fetchWithTimeout(url, head ? { method: 'HEAD' } : {});
      if (head && (res.status === 405 || res.status === 501)) res = await fetchWithTimeout(url);
      return res.status;
    } catch (e) {
      if (attempt === 1) return e.name === 'AbortError' ? 'timeout' : (e.message || 'error');
    }
  }
}

// Simple promise pool.
async function pool(items, n, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

function isInternal(url) {
  try {
    return new URL(url, BASE).origin === ORIGIN;
  } catch {
    return false;
  }
}

function abs(url) {
  try {
    return new URL(url, BASE).toString();
  } catch {
    return null;
  }
}

// ── 1. Gather page URLs from the sitemap ──────────────────────────────────────
async function getSitemapUrls() {
  const idxRes = await fetchWithTimeout(`${BASE}/sitemap-index.xml`);
  if (!idxRes.ok) throw new Error(`sitemap-index.xml -> ${idxRes.status}`);
  const idxXml = await idxRes.text();
  const childMaps = [...idxXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const pageUrls = new Set();
  for (const sm of childMaps) {
    const res = await fetchWithTimeout(sm);
    if (!res.ok) continue;
    const xml = await res.text();
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) pageUrls.add(m[1]);
  }
  return [...pageUrls];
}

// ── 2. Extract assets + links from a page's HTML ─────────────────────────────
function extractFromHtml(rawHtml) {
  // Strip <script>/<style> bodies so we don't match <a>/src inside JS/CSS source
  // (e.g. the Leaflet map's client-side popup template).
  const html = rawHtml
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const imgs = new Set();
  const links = new Set();
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi)) imgs.add(m[1]);
  // srcset
  for (const m of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) imgs.add(u);
    }
  }
  for (const m of html.matchAll(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi)) links.add(m[1]);
  return { imgs: [...imgs], links: [...links] };
}

function validJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let ok = 0, bad = 0;
  for (const b of blocks) {
    try { JSON.parse(b[1]); ok++; } catch { bad++; }
  }
  return { ok, bad, count: blocks.length };
}

const run = async () => {
  console.log(color('bold', `\n🌐 E2E check: ${BASE}\n`));

  // Pages
  let pages;
  try {
    pages = await getSitemapUrls();
  } catch (e) {
    console.log(color('red', `Could not read sitemap: ${e.message}`));
    process.exit(1);
  }
  console.log(color('cyan', `Discovered ${pages.length} pages in sitemap.`));

  // Fetch every page, record status + extract assets.
  const allImgs = new Set();
  const allLinks = new Set();
  const referrer = new Map(); // resource URL -> first page that referenced it
  const pageFailures = [];
  let jsonLdBad = 0, jsonLdTotal = 0;
  let pagesMissingClarity = 0, pagesMissingCfa = 0;
  let mobileNavPages = 0;

  await pool(pages, CONCURRENCY, async (pageUrl) => {
    let res = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { res = await fetchWithTimeout(pageUrl); break; }
      catch (e) { if (attempt === 1) { pageFailures.push({ url: pageUrl, status: e.name === 'AbortError' ? 'timeout' : e.message }); return; } }
    }
    try {
      if (!res.ok) { pageFailures.push({ url: pageUrl, status: res.status }); return; }
      const html = await res.text();
      const { imgs, links } = extractFromHtml(html);
      imgs.forEach((u) => { const a = abs(u); if (a) { allImgs.add(a); if (!referrer.has(a)) referrer.set(a, pageUrl); } });
      links.forEach((u) => {
        if (!isInternal(u)) return;
        const a = abs(u);
        if (!a) return;
        // /cdn-cgi/* is Cloudflare's runtime (email obfuscation etc.) — works
        // in-browser via JS, 404s to a bare crawler. Not a real broken link.
        if (a.includes('/cdn-cgi/')) return;
        const key = a.split('#')[0];
        allLinks.add(key);
        if (!referrer.has(key)) referrer.set(key, pageUrl);
      });
      const jl = validJsonLd(html);
      jsonLdTotal += jl.count; jsonLdBad += jl.bad;
      if (!html.includes('clarity.ms')) pagesMissingClarity++;
      if (!html.includes('cloudflareinsights')) pagesMissingCfa++;
      if (html.includes('class="nav-toggle"')) mobileNavPages++;
    } catch (e) {
      pageFailures.push({ url: pageUrl, status: e.name === 'AbortError' ? 'timeout' : e.message });
    }
  });

  // ── 3. Check unique images ─────────────────────────────────────────────────
  const imgList = [...allImgs];
  const imgFailures = [];
  await pool(imgList, CONCURRENCY, async (url) => {
    const status = await checkUrl(url, { head: true });
    if (status !== 200) imgFailures.push({ url, status });
  });

  // ── 4. Check unique internal links ──────────────────────────────────────────
  const linkList = [...allLinks];
  const linkFailures = [];
  await pool(linkList, CONCURRENCY, async (url) => {
    const status = await checkUrl(url, { head: true });
    if (status !== 200) linkFailures.push({ url, status });
  });

  // ── 5. Special endpoints ────────────────────────────────────────────────────
  const special = [
    '/robots.txt', '/rss.xml', '/sitemap-index.xml', '/llms.txt', '/llms-full.txt',
    '/favicon.png', '/search/', '/map/', '/gallery/', '/archive/',
    '/this-page-should-not-exist-xyz123', // must 404
  ];
  const specialResults = [];
  await pool(special, 6, async (path) => {
    try {
      const res = await fetchWithTimeout(`${BASE}${path}`);
      specialResults.push({ path, status: res.status });
    } catch (e) {
      specialResults.push({ path, status: e.message });
    }
  });
  const MISSING_PATH = '/this-page-should-not-exist-xyz123';

  // ── 6. API endpoints (likes read + comments read) ──────────────────────────
  const apiResults = [];
  const sampleSlug = pages.find((p) => p.includes('/posts/'))?.match(/\/posts\/([^/]+)/)?.[1] || 'test';
  for (const [label, path] of [
    ['likes GET', `/api/likes/${sampleSlug}`],
    ['comments GET', `/api/comments/${sampleSlug}`],
  ]) {
    try {
      const res = await fetchWithTimeout(`${BASE}${path}`);
      let body = '';
      try { body = JSON.stringify(await res.json()).slice(0, 80); } catch {}
      apiResults.push({ label, status: res.status, body });
    } catch (e) {
      apiResults.push({ label, status: e.message, body: '' });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log(color('bold', '\n──────────── RESULTS ────────────'));
  const ok = (s) => color('green', s);
  const bad = (s) => color('red', s);

  console.log(`\n${color('bold', 'Pages')}: ${pages.length} crawled, ${pageFailures.length ? bad(pageFailures.length + ' FAILED') : ok('all 200')}`);
  pageFailures.forEach((f) => console.log(`   ${bad('✗')} ${f.status}  ${f.url}`));

  console.log(`\n${color('bold', 'Images')}: ${imgList.length} unique, ${imgFailures.length ? bad(imgFailures.length + ' BROKEN') : ok('all load')}`);
  imgFailures.slice(0, 40).forEach((f) => console.log(`   ${bad('✗')} ${f.status}  ${f.url}\n        ${color('gray', 'on: ' + (referrer.get(f.url) || '?'))}`));
  if (imgFailures.length > 40) console.log(`   …and ${imgFailures.length - 40} more`);

  console.log(`\n${color('bold', 'Internal links')}: ${linkList.length} unique, ${linkFailures.length ? bad(linkFailures.length + ' BROKEN') : ok('all resolve')}`);
  linkFailures.slice(0, 40).forEach((f) => console.log(`   ${bad('✗')} ${f.status}  ${f.url}\n        ${color('gray', 'on: ' + (referrer.get(f.url) || '?'))}`));
  if (linkFailures.length > 40) console.log(`   …and ${linkFailures.length - 40} more`);

  console.log(`\n${color('bold', 'Special endpoints')}:`);
  specialResults.sort((a, b) => a.path.localeCompare(b.path)).forEach((r) => {
    const good = r.path === MISSING_PATH ? r.status === 404 : r.status === 200;
    const label = r.path === MISSING_PATH ? `${r.path}  ${color('gray', '(expect 404)')}` : r.path;
    console.log(`   ${good ? ok('✓') : bad('✗')} ${r.status}  ${label}`);
  });

  console.log(`\n${color('bold', 'API')}:`);
  apiResults.forEach((r) => {
    const good = r.status === 200;
    console.log(`   ${good ? ok('✓') : bad('✗')} ${r.status}  ${r.label}  ${color('gray', r.body)}`);
  });

  console.log(`\n${color('bold', 'Structured data')}: ${jsonLdTotal} JSON-LD blocks, ${jsonLdBad ? bad(jsonLdBad + ' invalid') : ok('all valid')}`);
  console.log(`${color('bold', 'Analytics')}: Clarity missing on ${pagesMissingClarity ? bad(pagesMissingClarity) : ok(0)} pages, CF beacon missing on ${pagesMissingCfa ? bad(pagesMissingCfa) : ok(0)} pages`);
  console.log(`${color('bold', 'Mobile nav')}: hamburger present on ${mobileNavPages === pages.length ? ok(mobileNavPages + '/' + pages.length) : bad(mobileNavPages + '/' + pages.length)} pages`);

  const totalProblems =
    pageFailures.length + imgFailures.length + linkFailures.length + jsonLdBad +
    specialResults.filter((r) => (r.path === '/404' ? r.status !== 404 : r.status !== 200)).length +
    apiResults.filter((r) => r.status !== 200).length;

  console.log('\n' + color('bold', '─────────────────────────────────'));
  if (totalProblems === 0) {
    console.log(color('green', '✅ ALL CHECKS PASSED — nothing broken.\n'));
    process.exit(0);
  } else {
    console.log(bad(`❌ ${totalProblems} problem(s) found — see above.\n`));
    process.exit(1);
  }
};

run();
