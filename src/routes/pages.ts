import { attachmentHeader, escapeHtml, formatBytes, html, text } from "../lib/http";
import {
  deletePost,
  getAssetWithPost,
  getFirstImage,
  getPost,
  getPostAssets,
  registerHit,
  type AssetRow,
} from "../lib/posts";
import { requireOwnedPost } from "./guard";
import { loadPresets } from "../lib/ttl";
import { uiVersion } from "../ui/assets";

function expiredPage(siteName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Gone — ${escapeHtml(siteName)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${uiVersion}">
</head>
<body>
<main class="wrap">
  <h1 class="gone-title">This share is gone</h1>
  <p class="muted">It hit its expiry time and has been removed. Ask for a fresh upload.</p>
</main>
</body>
</html>`;
}

function missingPage(siteName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not found — ${escapeHtml(siteName)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${uiVersion}">
</head>
<body>
<main class="wrap">
  <h1 class="gone-title">No such share</h1>
  <p class="muted">The link is wrong, or the share was deleted.</p>
</main>
</body>
</html>`;
}

function extensionLabel(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "FILE";
  return filename.slice(dot + 1).slice(0, 5).toUpperCase();
}

function galleryItem(
  origin: string,
  image: AssetRow,
  preview: "thumb" | "display" = "thumb",
): string {
  const name = encodeURIComponent(image.filename);
  const full = `${origin}/img/${image.id}/${name}`;
  const thumb = `${origin}/t/${image.id}/${name}`;
  const src = preview === "display" ? full : thumb;
  const alt = escapeHtml(image.filename);
  const size =
    image.width && image.height ? ` width="${image.width}" height="${image.height}"` : "";
  return `    <a class="thumb" href="${escapeHtml(full)}" data-full="${escapeHtml(full)}" data-name="${alt}">
      <img src="${escapeHtml(src)}" alt="${alt}"${size} loading="lazy" decoding="async">
    </a>`;
}

function fileItem(origin: string, file: AssetRow): string {
  const name = encodeURIComponent(file.filename);
  return `    <li class="file-item">
      <span class="file-badge">${escapeHtml(extensionLabel(file.filename))}</span>
      <span class="file-name">${escapeHtml(file.filename)}</span>
      <span class="file-size">${escapeHtml(formatBytes(file.size))}</span>
      <a class="file-download" href="${origin}/f/${file.id}/${name}" download>Download</a>
    </li>`;
}

function buildGallery(origin: string, images: AssetRow[]): string {
  if (images.length === 0) return "";

  // A lone image fills the whole column, so the 640 px thumbnail would be
  // stretched and look soft. Use the display derivative instead.
  const preview: "thumb" | "display" = images.length === 1 ? "display" : "thumb";
  const count = images.length <= 1 ? 1 : images.length <= 4 ? 2 : 3;
  const columns: AssetRow[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);

  // Greedy balance by aspect ratio, so columns end at similar heights.
  for (const image of images) {
    const ratio = image.width && image.height ? image.height / image.width : 1;
    let target = 0;
    for (let index = 1; index < count; index += 1) {
      if (heights[index]! < heights[target]!) target = index;
    }
    columns[target]!.push(image);
    heights[target]! += ratio;
  }

  return columns
    .filter((column) => column.length > 0)
    .map(
      (column) =>
        `    <div class="gallery-col">\n${column
          .map((image) => galleryItem(origin, image, preview))
          .join("\n")}\n    </div>`,
    )
    .join("\n");
}

export async function handleViewer(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  const post = await getPost(env.DB, id);
  if (!post) return html(missingPage(env.SITE_NAME), 404);

  const now = Date.now();
  const hit = await registerHit(env.DB, post.id, now);
  if (!hit || hit.expires_at <= now) {
    ctx.waitUntil(deletePost(env, post.id).catch(() => undefined));
    return html(expiredPage(env.SITE_NAME), 410);
  }

  const assets = await getPostAssets(env.DB, post.id);
  const images = assets.filter((asset) => asset.kind === "image");
  const files = assets.filter((asset) => asset.kind === "file");

  const origin = new URL(request.url).origin;
  const title = post.title || "Shared files";
  const first = images[0];
  const ogImage = first ? `${origin}/img/${first.id}/${encodeURIComponent(first.filename)}` : "";

  const gallery = buildGallery(origin, images);
  const fileList = files.map((file) => fileItem(origin, file)).join("\n");

  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="build" content="${uiVersion}">
<title>${escapeHtml(title)} — ${escapeHtml(env.SITE_NAME)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ""}
<meta property="og:url" content="${escapeHtml(`${origin}/i/${post.id}`)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${uiVersion}">
</head>
<body>
<main class="wrap viewer">
  <section class="gallery-block">
    <div class="post-head">
      <div class="post-head-row">
        <h1 class="post-title">${escapeHtml(title)}</h1>
        <a class="edit-link" href="/m/${post.id}">Edit</a>
      </div>
    </div>
${gallery ? `    <div class="${images.length === 1 ? "gallery gallery-single" : "gallery"}">\n${gallery}\n    </div>` : ""}
  </section>
${files.length > 0 ? `  <ul class="file-list">\n${fileList}\n  </ul>` : ""}
</main>
<script src="/view.js?v=${uiVersion}" type="module"></script>
</body>
</html>`);
}

export async function handleImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
  mode: "display" | "raw" | "thumb" = "display",
): Promise<Response> {
  const found = await getAssetWithPost(env.DB, id);

  let asset = found?.asset ?? null;
  let expiresAt = found?.expires_at ?? null;
  let postId = found?.asset.post_id ?? null;

  // Legacy links from the one-image-per-post era: /img/<post-id>/<filename>.
  if (!asset) {
    const post = await getPost(env.DB, id);
    if (post) {
      asset = await getFirstImage(env.DB, post.id);
      expiresAt = post.expires_at;
      postId = post.id;
    }
  }

  if (!asset || expiresAt === null || postId === null) return text("Not found", 404);

  const now = Date.now();
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    ctx.waitUntil(deletePost(env, asset.post_id).catch(() => undefined));
    return text("Gone — this image has expired", 410);
  }

  const hit = await registerHit(env.DB, postId, now);
  if (!hit || hit.expires_at <= now) {
    ctx.waitUntil(deletePost(env, postId).catch(() => undefined));
    return text("Gone — this image has expired", 410);
  }

  const candidates: { key: string; mime: string }[] = [];
  if (mode === "raw") {
    candidates.push({ key: asset.r2_key, mime: asset.mime });
  } else if (mode === "thumb") {
    if (asset.thumb_key) {
      candidates.push({ key: asset.thumb_key, mime: asset.thumb_mime ?? "image/webp" });
    }
    if (asset.display_key) {
      candidates.push({ key: asset.display_key, mime: asset.display_mime ?? "image/webp" });
    }
    candidates.push({ key: asset.r2_key, mime: asset.mime });
  } else {
    if (asset.display_key) {
      candidates.push({ key: asset.display_key, mime: asset.display_mime ?? "image/webp" });
    }
    candidates.push({ key: asset.r2_key, mime: asset.mime });
  }

  let object: R2Object | R2ObjectBody | null = null;
  let mime = asset.mime;
  for (const candidate of candidates) {
    const hit = await env.BLOBS.get(candidate.key, { onlyIf: request.headers });
    if (hit) {
      object = hit;
      mime = candidate.mime;
      break;
    }
  }
  if (!object) return text("Not found", 404);

  const body = "body" in object ? object.body : null;

  const headers = new Headers();
  headers.set("content-type", mime);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "none");
  headers.set(
    "cache-control",
    `private, max-age=${Math.max(1, Math.floor(remainingMs / 1000))}`,
  );
  headers.set("content-disposition", `inline; filename="${asset.filename.replace(/"/g, "")}"`);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("access-control-allow-origin", "*");

  if (!body) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-length", String(object.size));

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(body, { status: 200, headers });
}

/**
 * Downloads. Everything is served as an opaque attachment so an uploaded HTML
 * or SVG page can never render on this origin.
 */
export async function handleFile(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  const found = await getAssetWithPost(env.DB, id);
  if (!found) return text("Not found", 404);

  const now = Date.now();
  const remainingMs = found.expires_at - now;
  if (remainingMs <= 0) {
    ctx.waitUntil(deletePost(env, found.asset.post_id).catch(() => undefined));
    return text("Gone — this file has expired", 410);
  }

  const hit = await registerHit(env.DB, found.asset.post_id, now);
  if (!hit || hit.expires_at <= now) {
    ctx.waitUntil(deletePost(env, found.asset.post_id).catch(() => undefined));
    return text("Gone — this file has expired", 410);
  }

  const object = await env.BLOBS.get(found.asset.r2_key, { onlyIf: request.headers });
  if (!object) return text("Not found", 404);

  const body = "body" in object ? object.body : null;

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  headers.set("content-disposition", attachmentHeader(found.asset.filename));
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "none");
  headers.set(
    "cache-control",
    `private, max-age=${Math.max(1, Math.floor(remainingMs / 1000))}`,
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set("content-security-policy", "default-src 'none'; sandbox");

  if (!body) {
    return new Response(null, { status: 304, headers });
  }

  headers.set("content-length", String(object.size));

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(body, { status: 200, headers });
}

function manageItem(origin: string, asset: AssetRow): string {
  const name = encodeURIComponent(asset.filename);
  const media =
    asset.kind === "image"
      ? `<img src="${origin}/t/${asset.id}/${name}" alt=""${
          asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : ""
        } loading="lazy" decoding="async">`
      : `<span class="asset-badge">${escapeHtml(extensionLabel(asset.filename))}</span>`;

  return `    <li class="manage-item" draggable="true" data-id="${asset.id}">
      <div class="manage-media">${media}</div>
      <div class="manage-meta">
        <span class="manage-name">${escapeHtml(asset.filename)}</span>
        <div class="manage-actions">
          <button type="button" class="icon" data-move="-1" title="Move up" aria-label="Move up">↑</button>
          <button type="button" class="icon" data-move="1" title="Move down" aria-label="Move down">↓</button>
          <button type="button" class="icon danger-icon" data-delete title="Delete" aria-label="Delete">✕</button>
        </div>
      </div>
    </li>`;
}

export async function handleManage(
  request: Request,
  env: Env,
  id: string,
  email: string | null,
): Promise<Response> {
  const post = await requireOwnedPost(env, id, email);
  if (post instanceof Response) return post;

  const assets = await getPostAssets(env.DB, post.id);
  const images = assets.filter((asset) => asset.kind === "image").length;
  const files = assets.length - images;
  const origin = new URL(request.url).origin;
  const shareUrl = `${origin}/i/${post.id}`;
  const expiresIso = new Date(post.expires_at).toISOString();
  const summary = [
    `${images} image${images === 1 ? "" : "s"}`,
    files > 0 ? `${files} file${files === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const items = assets.map((asset) => manageItem(origin, asset)).join("\n");

  const ttlPresets = loadPresets(env.TTL_PRESETS);
  const selectedTtl = ttlPresets.some((preset) => preset.seconds === post.ttl_seconds)
    ? post.ttl_seconds
    : ttlPresets[0]!.seconds;
  const ttlOptions = ttlPresets
    .map(
      (preset) =>
        `<option value="${preset.seconds}"${preset.seconds === selectedTtl ? " selected" : ""}>${escapeHtml(preset.label)}</option>`,
    )
    .join("");
  const requestsUsed = `${post.hits.toLocaleString("en-US")} of ${post.hit_limit.toLocaleString("en-US")} requests used`;

  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="build" content="${uiVersion}">
<title>Manage — ${escapeHtml(post.title || env.SITE_NAME)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${uiVersion}">
</head>
<body data-share="${post.id}">
<main class="wrap manage">
  <div class="top">
    <h1>Manage share</h1>
    <p class="muted small">${summary} · ${escapeHtml(requestsUsed)} · expires in
      <span data-expires-at="${post.expires_at}" data-expires-iso="${escapeHtml(expiresIso)}">—</span>
      · <a href="/i/${post.id}">view</a></p>
  </div>

  <div class="manage-fields">
    <label class="field">
      <span class="field-label">Title</span>
      <div class="inline-field">
        <input id="title" class="text-input" type="text" maxlength="120" value="${escapeHtml(post.title)}">
        <button id="save-title" class="secondary" type="button">Save</button>
      </div>
    </label>
    <label class="field">
      <span class="field-label">Share link</span>
      <div class="inline-field">
        <input id="post-url" class="text-input link-input" readonly value="${escapeHtml(shareUrl)}">
        <button id="copy-link" class="secondary" type="button">Copy</button>
      </div>
    </label>
    <label class="field">
      <span class="field-label">Reset countdown &amp; request counter</span>
      <div class="inline-field">
        <select id="reset-ttl" class="text-input">${ttlOptions}</select>
        <button id="reset" class="secondary" type="button">Reset</button>
      </div>
    </label>
  </div>

  <div id="progress" class="upload-progress" hidden>
    <div class="upload-track"><div id="progress-fill" class="upload-fill"></div></div>
    <span id="progress-label" class="upload-label"></span>
  </div>

  <ul id="assets" class="manage-list">
${items}
  </ul>

  <div class="manage-footer">
    <input id="add-input" type="file" multiple hidden>
    <button id="add" class="secondary" type="button">Add images or files</button>
    <button id="delete-share" class="danger" type="button">Delete share</button>
  </div>

  <p id="notice" class="notice" hidden role="alert"></p>
</main>
<script src="/view.js?v=${uiVersion}" type="module"></script>
<script src="/manage.js?v=${uiVersion}" type="module"></script>
</body>
</html>`);
}

export async function handleDelete(
  env: Env,
  id: string,
  email: string | null,
): Promise<Response> {
  const post = await requireOwnedPost(env, id, email);
  if (post instanceof Response) return post;

  await deletePost(env, post.id);
  return new Response(null, { status: 204 });
}
