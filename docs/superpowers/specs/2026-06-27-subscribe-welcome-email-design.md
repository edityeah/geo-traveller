# Subscribe + welcome email — design

Date: 2026-06-27

## Goal

Let readers subscribe (email, optional first name) and immediately receive a
welcome letter — like Curly Tales' #CTSquad. Own the list; no new SaaS.

## Decisions (user-approved)

- **Backend: own it** — store subscribers in a new Notion `Subscribers` DB and
  send the welcome email via Resend (from `no-reply@adityeah.ai`). Mirrors the
  existing contact form exactly.
- **Placement**: subscribe block in the sidebar **below the About section**
  (sidebar is shared by homepage + posts); and a wider banner on **post pages,
  above "More stories like this"** (the RelatedPosts heading).
- Single opt-in (subscribe → welcome). Honeypot + per-IP rate limit, like contact.

## Pieces

### `functions/api/subscribe.ts` (new Pages Function)
Mirrors `functions/api/contact.ts`.
- POST `{ email, name?, hp?, source? }`.
- Honeypot (`hp`), per-IP rate limit via the COMMENTS KV namespace, email + length validation.
- Dedup: query the Subscribers DB for the email; if already present, return
  `{ ok: true, already: true }` and skip the welcome email (no duplicate row/email).
- Create a Notion row, then send the welcome email via Resend (best-effort —
  never blocks the success response).
- Env: `NOTION_TOKEN`, `NOTION_SUBSCRIBERS_DB_ID`, `RESEND_API_KEY` (all already
  Pages secrets except the new DB id), `COMMENTS` KV. Returns 503 if unconfigured.

### Notion `Subscribers` DB (user creates, then shares with the integration)
Properties: `Name` (Title), `Email` (Email), `Subscribed` (Date),
`Status` (Select), `Source` (Text). Title = first name, or the email if no name.

### `src/components/Subscribe.astro` (new)
- Props: `variant: 'sidebar' | 'banner'`.
- Form: optional first name + email + hidden honeypot + submit + live status.
- Client JS posts to `/api/subscribe`, shows inline success/error, resets on success.
- Script binds to ALL `.subscribe-form` on the page (sidebar + banner can coexist
  on a post page), each with its own status element.

### Wiring
- `Sidebar.astro`: replace the Buttondown `sb-newsletter` block with
  `<Subscribe variant="sidebar" />`, positioned right after the About section.
- `posts/[slug].astro`: `<Subscribe variant="banner" />` immediately before
  `<RelatedPosts />`.
- `set-pages-secrets.yml`: push `NOTION_SUBSCRIBERS_DB_ID`.
- `.env.example`: document `NOTION_SUBSCRIBERS_DB_ID`.

## Out of scope
- Recurring newsletter broadcasts (the welcome letter is transactional). Sending
  a periodic newsletter to the Notion list later would need an export-to-send step.
- Double opt-in.

## Verification
- `npm test` + `npx astro build`.
- Preview: sidebar block renders below About (homepage + post), banner renders
  above "More stories like this" on a post; submit shows graceful "not configured"
  until the DB id secret is set; no console errors; multiple forms on one page work.
