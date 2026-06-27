# Magazine homepage redesign — design

Date: 2026-06-27
Inspiration: https://curlytales.com/india/

## Goal

Turn the homepage from a single "featured + sidebar + two-up rows" journal into a
denser, category-driven magazine hub — while keeping geo-traveller's warm cream +
Source Serif identity (not Curly Tales' clinical white look).

## Decisions (user-approved)

- **Type-led categories** drive nav, homepage sections, and card badges.
- **Absolute dates** on cards (e.g. "Jun 17, 2026") — not relative ("2 days ago").
  A small evergreen-heavy site looks neglected with relative stamps.
- **Keep the sidebar** on the homepage. Magazine sections live in the (narrower)
  main column; grids are responsive (`auto-fit`) so they show 2 cards in the main
  column and never look cramped. Post pages are untouched.

## Categories

Five categories, derived from `post.data.tags` only (no schema change — there is no
Content Type field in the post frontmatter). First match wins, in this order:

1. **News** — tag matches `geo daily`, `geo-daily`, or `news`. Badge: green.
2. **Events** — tag matches `event` / `events`. Badge: plum.
3. **Guides** — tag matches visa/flight/how-to family: `visa`, `e-visa`, `passport`,
   `flight`, `flights`, `airport`, `irctc`, `rail`, `train`, `booking`, `itinerary`,
   `how-to`, `guide`. Badge: ochre.
4. **Festivals & Food** — tag matches `festival`, `food`, `cuisine`, `restaurant`,
   `cafe`. Badge: magenta.
5. **Destinations** — default for everything else (it's a travel site). Badge: terracotta (accent).

New module: `src/lib/categories.ts`
- `CATEGORIES`: ordered list of `{ key, label, badge: {bg,fg}, match(tags) }`.
- `categoryOf(post)`: returns the single primary category (first match, default Destinations).
- `postsInCategory(posts, key)`: filter helper for sections + landing pages.

## Card restyle (`PostCard.astro`)

- Category **badge** overlaid top-left on the cover (color-coded), replacing the
  current "In tag · tag" kicker.
- Absolute date + read-time below the title (kept).
- Subtle **hover lift** (translateY + border emphasis). Image dims/lazy/decoding kept
  (the perf fixes from the previous change stay).

## Homepage (`index.astro`)

- Keep `featured` lead story (already has fetchpriority/preload).
- Replace the ad-hoc CATEGORY_ORDER with the five categories from `categories.ts`.
- For each category with >= 1 post: a section with a 2-up/auto-fit grid of its latest
  3 posts + a "More →" link to its landing page.
- Keep the sidebar.

## Category landing pages

New route `src/pages/category/[category].astro`:
- `getStaticPaths` over the five category keys.
- Lists all posts in that category, paginated-feel via PostCard grid, with the sidebar.
- "More →" links on the homepage point here (`/category/<key>/`).

## Nav (`SiteNav.astro`)

Top-level becomes type-led: Home · Destinations · Guides · News · Events ·
Festivals & Food · About · More (Map/Gallery/Search/Contact). Destinations keeps its
region submenu (India › Himachal/UP/Karnataka, Bhutan). Category links go to
`/category/<key>/`.

## Out of scope

- No change to post pages, the agent, Notion schema, or the contact/comment flows.
- No relative timestamps, no carousel JS (hero is static grid; carousels hurt LCP/CLS).

## Verification

- `npm test` (unit) + `npx astro build` (full static build).
- Preview server: check homepage (desktop + mobile), a category page, and a post page
  (sidebar + card badges render, dates correct, no console errors).

## Addendum (2026-06-27) — six focus categories + Curly Tales source

User refined the strategy: realign the taxonomy to six focus categories and add
Curly Tales as a food/experiences/events source, cutting evergreen to 1/day.

**Site taxonomy → six categories** (categories.ts, nav, sections, badges), first
match wins on tags:
1. Flights & Airlines (blue) — flight/airline/airport/aviation
2. Food (magenta) — food/restaurant/cuisine/cafe/dining
3. Experiences (plum) — experience/event/festival/concert/expo
4. Travel News (green) — geo daily/news
5. Guides (ochre) — visa/passport/irctc/rail/booking/how-to/guide
6. Travel (terracotta) — catch-all (destinations/places)

**Agent**:
- Daily mix 1 evergreen / 7 news / 8 food+experiences (was 5/7/5). Defaults in
  run.ts; agent.yml comment updated.
- discover.ts: `discoverExperiences()` (alias `discoverEvents` kept) pulls Curly
  Tales food + experiences feeds (pre-qualified, no keyword filter) tagged
  kind=food/experience, plus the existing event feeds (keyword-filtered)
  kind=event. Verified live: ~84 candidates (40 food / 38 experience / 6 event).
- run.ts `doExperiences()`: events → generateEvent (booking/watch); food +
  experiences → generatePost (flexible feature). Tagged Food / Experiences /
  Events so they land in the right site category. contentType stays 'Events'.
- Curly Tales feeds expose no images → covers fall back to the stock/vision
  pipeline, same as news.
