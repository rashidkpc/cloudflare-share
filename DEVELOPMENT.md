# Development

Everything below is for working on the Worker itself. To deploy it, see
[README.md](README.md).

## Local setup

```sh
cp .dev.vars.example .dev.vars   # AUTH_MODE=basic for local work
npm run db:migrate:local
npm run dev
```

`ctx.access` is not available outside Cloudflare Access, so local development
uses Basic auth. `AUTH_MODE=open` skips authentication entirely.

Local state (D1 rows, R2 uploads, caches) lives in `.wrangler/`, which is
gitignored. It can contain real files you uploaded while testing; delete it for a
clean slate.

## Commands

```sh
npm run build:ui         # regenerate src/ui/generated.ts from src/ui/*.html|css|js
npm run typecheck        # build:ui, then tsc --noEmit
npm test                 # unit tests (ttl, sniffing, auth, sweep)
npm run dev              # wrangler dev against local D1 + R2
npm run deploy           # build:ui, then wrangler deploy
npm run db:migrate:local # apply migrations to the local D1 database
npm run db:migrate:remote
```

## Routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /` | public | "Nothing to see here" dead end |
| `GET /upload` | Access | upload page; uploading redirects to the manage page |
| `POST /api/upload` | Access | multipart: repeated `file`, plus `title` and `ttl`; creates the share and sets the edit cookie |
| `GET /i/:id` | public | share page: title, every image, Open Graph tags, countdown |
| `GET /m/:id` | cookie | manage page: reorder, delete, rename, add more |
| `POST /api/posts/:id/assets` | cookie | append images or files (`/images` also accepted) |
| `DELETE /api/posts/:id/assets/:assetId` | cookie | remove one asset from a share |
| `PATCH /api/posts/:id/order` | cookie | `{ assetIds: [...] }` — reorder a share |
| `PATCH /api/posts/:id` | cookie | `{ title }` — rename a share |
| `DELETE /api/posts/:id` | cookie | delete your own share |
| `GET /img/:id/:name` | public | display derivative (WebP, ≤2048 px), `inline`, ETag |
| `GET /t/:id/:name` | public | small preview for the gallery grid |
| `GET /raw/:id/:name` | public | alias for the stored image (the same stripped WebP) |
| `GET /f/:id/:name` | public | any asset, always `application/octet-stream` + `attachment` |
| `GET /robots.txt` | public | `Disallow: /` |
| `GET /healthz` | public | `ok` |

`/img/:id` also accepts a share id from the single-image era and serves that
share's first image, so older direct links keep working.

## Auth model

Creating a share is the only write that uses Access. Everything after that is
authorised by an `edit_<shareId>` cookie set on the creating browser (HttpOnly,
SameSite=Lax, expiring with the share). Only its SHA-256 is stored.

This is why `/api/posts/*` and `/m/*` must stay public: an Access wall in front
of them would redirect to a login that can never present the cookie.

## Expiry

Three independent layers, so a missed cron can never serve a dead image:

1. **Serve time** — `expires_at <= now` returns `410 Gone` and schedules a purge.
2. **Cron** (`*/10 * * * *`) — deletes expired shares in batches of 500, including
   every asset row and every R2 object per asset. Loops until drained, capped at
   20 rounds per run.
3. **Caching** — `Cache-Control: private, max-age=<remaining seconds>` on images.
   Browser copies lapse exactly when the share does, and no shared edge cache can
   keep serving a deleted image (a `public` policy was tried first; it made
   `DELETE` ineffective for the rest of the share's lifetime).

An R2 lifecycle rule under `p/` is a good backstop for objects orphaned by a
failed D1 write.

## Configuration

Variables live in `wrangler.jsonc`:

| Var | Default | Meaning |
| --- | --- | --- |
| `AUTH_MODE` | `access` | `access`, `basic`, or `open` |
| `DEFAULT_TTL_SECONDS` | `86400` | preselected lifetime |
| `TTL_PRESETS` | 1h, 6h, 24h, 3d, 7d, 14d, 30d, 90d, 365d | JSON `[{label, seconds}]`; requests must match a preset |
| `MAX_UPLOAD_BYTES` | `20971520` | 20 MB per image (also the Images input limit) |
| `MAX_IMAGES` | `20` | maximum assets (images + files) per share; `MAX_ASSETS` also works |
| `MAX_TOTAL_BYTES` | `52428800` | 50 MB per request |
| `SITE_NAME` | `share` | shown in titles |

TTLs are presets-only by design: the server rejects any `ttl` that is not in the
list, so storage cost cannot drift.

Secrets are never committed. Use `npx wrangler secret put <NAME>` for
`UPLOAD_PASSWORD`; local values go in `.dev.vars`.

## Notes

- The UI (`src/ui/*.html|css|js`) is inlined into `src/ui/generated.ts` by
  `scripts/gen-ui.mjs` — Wrangler cannot import a `.js` file as text, and Static
  Assets would suppress `ctx.access`. Regenerate with `npm run build:ui`; the
  pre-scripts do it automatically.
- Bytes are sniffed, not trusted: only jpeg/png/gif/webp/avif are accepted,
  regardless of the declared `Content-Type`.
- The display derivative comes from the Images binding (`env.IMAGES`). It costs
  one unique transformation per uploaded image; the free plan includes 5,000 per
  month. If the transform fails, the upload is rejected rather than falling back
  to unstripped bytes.
- Metadata: Cloudflare always discards EXIF for WebP output, so nothing stored
  here carries GPS or camera tags. There is no original file to fetch.
