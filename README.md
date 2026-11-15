# share

Source: <https://github.com/rashidkpc/cloudflare-share>

> **Full disclosure: this whole thing was vibed into existence.** An AI agent
> wrote it, nobody audited every line, and no, that definitely won't come back to
> bite anyone. It works. Think of it as a pretty dumb friend's side project — and
> honestly, you're probably just as dumb for deploying it. No offense. It takes
> one to know one.
>
> **The genuinely best way to deploy it is to make an agent do it.** Hand this
> repo to a coding agent and tell it to follow the install steps. It will happily
> create the D1 database and R2 bucket, paste in the ids, run the migrations,
> deploy, and wire up Access — fixing its own mistakes along the way — while you
> take the credit. And don't bother clearing this with your compliance
> department. You don't have one. Why would you?

Temporary image and file hosting on a single Cloudflare Worker. Upload photos or
arbitrary files, give the share a title, get a link, paste it into IRC. The share
deletes itself when its timer runs out.

- **Reads are public.** Anyone with the link can open `/i/:id` or `/img/:id/name`,
  no login, and IRC clients can preview it.
- **Writes are private.** Only you can upload or delete, gated by Cloudflare
  Access (or HTTP Basic as a fallback).
- **No gallery.** There is no listing endpoint and no index page. The 10-character
  id is the capability: if you lose the link, the share is unreachable.
- **Images are re-encoded at upload.** Only a metadata-free WebP derivative is
  stored — 2,048 px on the long edge, animation preserved, plus a 480 px
  thumbnail. The uploaded original is never kept, so EXIF, camera model, and GPS
  location cannot leak from this service.
- **Everything else is stored verbatim** and always served as an
  `application/octet-stream` attachment, so an uploaded HTML or SVG page can
  never execute on this origin. Non-image files keep their own metadata.
- **TTL is per share**, chosen from presets, defaulting to 24 hours.

---

## Install on Cloudflare

You need a Cloudflare account, Node.js 20 or newer, and Zero Trust enabled once
for Access (the dashboard asks you to pick a team domain when you first open
**Zero Trust**).

### 1. Clone, install dependencies and log in

```sh
git clone https://github.com/rashidkpc/cloudflare-share.git
cd cloudflare-share
npm install
npx wrangler login
```

To deploy your own copy, change the Worker and resource names in
`wrangler.jsonc` (`name`, `bucket_name`, `database_name`) so they do not collide
with an existing deployment.

### 2. Create the storage bindings

The Worker needs one D1 database, one R2 bucket, and the Images binding. The
binding names in `wrangler.jsonc` (`DB`, `BLOBS`, `IMAGES`) are used by the code
and must not be renamed.

```sh
npx wrangler d1 create img
npx wrangler r2 bucket create img-photos
```

`d1 create` prints a `database_id`. Open `wrangler.jsonc` and replace the
`REPLACE_WITH_YOUR_D1_DATABASE_ID` placeholder with yours:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "img",
    "database_id": "<your-database-id>"
  }
],
```

If you picked different names for the bucket or database, update
`bucket_name` / `database_name` to match. The Images binding needs no extra
resource; it is available to Workers directly (`"images": { "binding": "IMAGES" }`).

### 3. Apply the schema

```sh
npm run db:migrate:remote
```

This runs every file in `migrations/` in order. Re-run it on each schema change
(`0007_…`, `0008_…`, and so on).

### 4. Deploy

```sh
npm run deploy
```

Wrangler prints the Worker URL, which looks like:

```
https://share.<account-subdomain>.workers.dev
```

`workers_dev` is on and `preview_urls` is off, so this hostname is the only
ingress. Uploads fail closed with `403 Cloudflare Access is not configured`
until step 5 is done — that is intentional. If you want to try the uploader
before Access exists, temporarily set `"AUTH_MODE": "open"` in
`wrangler.jsonc`, deploy, and switch it back to `access` afterwards.

### 5. Put `/upload` and `/api/upload` behind Access

Only two paths create shares. Everything else must stay public.

In the Cloudflare dashboard:

1. Go to **Zero Trust → Access controls → Applications** and click
   **Add an application → Self-hosted**.
2. Name it `share: uploader`.
3. Add **two public hostnames**, both pointing at your Worker:
   - hostname `share.<account-subdomain>.workers.dev`, path `upload`
   - hostname `share.<account-subdomain>.workers.dev`, path `api/upload`

   Enter the path without a leading slash. A blank path (or `/`) means the
   **whole hostname**, which is wrong here — it would hide the shared images.
4. Session duration `24h` is a good default.
5. Add one policy: **Action** `Allow`, **Include → Emails →** your address
   (or **Emails ending in** your domain).
6. Save. There is no redeploy step: Access sits in front of the Worker.

One-time PIN is the quickest identity method; make sure it is enabled under
**Zero Trust → Settings → Authentication**, or add your own IdP.

#### Which paths are protected vs public

| Path | Access | Why |
| --- | --- | --- |
| `/upload` | **protected** | the upload page |
| `/api/upload` | **protected** | creates shares |
| `/` | public | "Nothing to see here" dead end |
| `/i/:id` | public | share page and Open Graph previews |
| `/img/:id/:name`, `/raw/:id/:name` | public | full-size images |
| `/t/:id/:name` | public | gallery thumbnails |
| `/f/:id/:name` | public | non-image attachments |
| `/m/:id` | public | manage page, authorised by the edit cookie |
| `/api/posts/*` | public | edits, authorised by the edit cookie |
| `/style.css`, `/app.js`, `/view.js`, `/manage.js`, `/favicon.svg`, `/font.woff2` | public | static UI assets |
| `/robots.txt`, `/healthz` | public | crawler and uptime endpoints |

Two rules matter:

- **Do not protect `/api/posts/*` or `/m/*`.** Edits are authorised by the
  `edit_<shareId>` cookie set on the creating browser, not by an Access session.
  If Access fronts those paths the manage page redirects to a login that can
  never present the cookie.
- **Do not use "Protect this Worker behind Access" or a path of `/`.** Both
  cover `/img/*` as well, which breaks every shared link and every IRC preview.
  The two specific paths above are the whole configuration.

#### Verify

```sh
# redirects to the Access login
curl -i https://share.<account-subdomain>.workers.dev/upload

# also blocked (302 to Access, or 401/403 without a session)
curl -i -X POST https://share.<account-subdomain>.workers.dev/api/upload

# 200, "Nothing to see here"
curl -i https://share.<account-subdomain>.workers.dev/

# 200 once you have a share id
curl -i https://share.<account-subdomain>.workers.dev/i/<id>
```

Then open `/upload` in a private window, log in, upload a file, and open the
returned `/i/<id>` link in another private window — it must load without a
login.

### 6. Optional: R2 lifecycle safety net

Objects live under the `p/` prefix. Add a lifecycle rule that deletes them
after 400 days as a backstop for objects orphaned by a failed D1 write. The
normal expiry path is the cron sweep, which removes rows and objects together.

### If Access rejects the `workers.dev` hostname

Some accounts cannot attach a self-hosted Access application to a `workers.dev`
hostname. Either:

- add a custom domain (**Workers → your Worker → Settings → Domains & Routes →
  Add custom domain**) and use that hostname for both the Access application and
  your links, or
- use HTTP Basic instead:

  ```sh
  npx wrangler secret put UPLOAD_PASSWORD
  ```

  then set `"AUTH_MODE": "basic"` in `wrangler.jsonc` and redeploy. Browsers
  prompt once for `/` and for `/upload`; `curl -u me:<password>` works the same
  way. Uploads are recorded with `OWNER_EMAIL` (or `owner`).

---

## Routes

| Route | Access | Purpose |
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

Edits are authorised by an `edit_<shareId>` cookie set on the creating browser
(HttpOnly, SameSite=Lax, expiring with the share). Only its SHA-256 is stored.

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
list, so storage cost can't drift.

Secrets are never committed. Use `npx wrangler secret put <NAME>` for
`UPLOAD_PASSWORD`; local values go in `.dev.vars` (see `.dev.vars.example`).

## Local development

```sh
cp .dev.vars.example .dev.vars   # AUTH_MODE=basic for local work
npm run db:migrate:local
npm run dev
```

Local state (D1 rows, R2 uploads, caches) is written to `.wrangler/`, which is
gitignored. It can contain real files you uploaded while testing; delete
`.wrangler/` if you want a clean slate before sharing or archiving the project.

`ctx.access` is not available outside Access, which is why local dev uses Basic
auth.

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
- `Content-Disposition: inline` plus the filename in the path means IRC clients
  and unfurlers see a normal image URL.

## License

The Worker code is free software under the GNU General Public License,
version 3 or (at your option) any later version. Copyright (C) 2026
rashidkpc. The full text is in [`LICENSE`](LICENSE).

The bundled Space Grotesk font (`src/ui/fonts/space-grotesk-700.woff2`) is
**not** covered by the GPL. It is licensed under the SIL Open Font License,
version 1.1; its copyright notice and license text are in
[`src/ui/fonts/OFL.txt`](src/ui/fonts/OFL.txt).
