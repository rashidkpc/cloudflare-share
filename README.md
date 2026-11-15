# Cloudflare Share

Source: <https://github.com/rashidkpc/cloudflare-share>

> **This project was vibe-coded.** An AI agent wrote it and nobody audited it.
> Review the code before trusting it with anything. And honestly, why even use this?
> Why note vibe up your own trash?
>
> **The easiest way to deploy it is with an agent.** Give a coding agent the repo
> and tell it to follow the install steps: create the D1 database and R2 bucket,
> fill in the ids, run the migrations, deploy, and configure Access. The manual
> steps below work too. Probably. I don't know, I didn't read them.

Temporary image and file hosting on a single Cloudflare Worker.

- Reads are public, writes are private.
- No gallery, no index: the 10-character id is the capability.
- Images become stripped WebP; other files are served as attachments.
- Shares expire on their own, 24 hours by default.

## Install on Cloudflare

You need a Cloudflare account, Node 20+, and Zero Trust enabled (pick a team
domain the first time you open it).

**1. Clone and log in**

```sh
git clone https://github.com/rashidkpc/cloudflare-share.git
cd cloudflare-share
npm install
npx wrangler login
```

**2. Create storage**

```sh
npx wrangler d1 create img
npx wrangler r2 bucket create img-photos
```

Put the printed `database_id` into `wrangler.jsonc` in place of
`REPLACE_WITH_YOUR_D1_DATABASE_ID`. Rename `name`, `bucket_name`, or
`database_name` first if they would collide with an existing deployment. The
binding names (`DB`, `BLOBS`, `IMAGES`) must stay as they are.

**3. Migrate and deploy**

```sh
npm run db:migrate:remote
npm run deploy
```

Wrangler prints `https://share.<account-subdomain>.workers.dev`. Uploads return
`403` until step 4 is done — that is intentional. To test before Access exists,
set `"AUTH_MODE": "open"` in `wrangler.jsonc`, deploy, then switch it back.

**4. Lock down uploads with Access**

Only two paths create shares:

- `/upload`
- `/api/upload`

In **Zero Trust → Access controls → Applications → Add an application →
Self-hosted**:

1. Name it `share: uploader`.
2. Add two public hostnames on your Worker host: path `upload`, and path
   `api/upload` (no leading slash).
3. Add an `Allow` policy for your email, or your email domain.
4. Save. No redeploy needed.

Do not add a blank or `/` path, and do not enable "Protect this Worker behind
Access" — either one hides `/img/*` and breaks every shared link. Do not protect
`/api/posts/*` or `/m/*` either: edits use an edit cookie, not an Access session,
so a login wall there breaks the manage page.

Check it:

```sh
curl -i https://<host>/upload    # redirects to the Access login
curl -i https://<host>/          # 200, "Nothing to see here"
curl -i https://<host>/i/<id>    # 200, no login
```

If Access refuses a `workers.dev` hostname, add a custom domain and use that
hostname for both the Access application and the Worker, or switch to Basic auth:

```sh
npx wrangler secret put UPLOAD_PASSWORD
# set "AUTH_MODE": "basic" in wrangler.jsonc, then npm run deploy
```

Local setup, commands, all routes, and implementation notes are in
[DEVELOPMENT.md](DEVELOPMENT.md).

## License

Code: GPL-3.0-or-later, © 2026 rashidkpc — see [`LICENSE`](LICENSE). The bundled
Space Grotesk font is SIL OFL 1.1, not GPL — see
[`src/ui/fonts/OFL.txt`](src/ui/fonts/OFL.txt).
