import { fail, json } from "../lib/http";
import { randomId } from "../lib/ids";
import { imageDimensions, sanitizeFilename, sniffImage } from "../lib/images";
import { loadPresets, resolveTtl } from "../lib/ttl";
import type { Uploader } from "../lib/auth";
import { getPostAssets, type AssetRow } from "../lib/posts";
import { editCookie, hashToken, randomToken } from "../lib/edit";
import { requireEditablePost } from "./guard";

const DISPLAY_WIDTH = 2048;
const DISPLAY_QUALITY = 82;
const THUMB_SIZE = 640;
const THUMB_QUALITY = 75;
const TITLE_MAX = 120;
const CONCURRENCY = 4; // stay under the 6 simultaneous-connection limit per request

interface Derivative {
  bytes: Uint8Array;
  mime: string;
}

interface ImageAsset {
  kind: "image";
  /** The stored bytes: always a metadata-free WebP derivative. */
  bytes: Uint8Array;
  mime: string;
  filename: string;
  width: number | null;
  height: number | null;
  thumb: Derivative | null;
}

interface FileAsset {
  kind: "file";
  /** Stored verbatim. */
  bytes: Uint8Array;
  mime: string;
  filename: string;
}

type PreparedAsset = ImageAsset | FileAsset;

interface StoredAsset {
  asset: PreparedAsset;
  assetId: string;
  position: number;
  key: string;
  displayKey: string | null;
  thumbKey: string | null;
}

class UploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  // Enqueues the existing view instead of copying into a Blob first.
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function megabytes(bytes: number): number {
  return Math.floor(bytes / (1024 * 1024));
}

/**
 * Images binding results are RPC objects; the runtime wants them disposed.
 * Types don't expose it, so look the well-known symbol up defensively.
 */
function disposeResult(value: unknown): void {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return;
  const key = (Symbol as unknown as { dispose?: symbol }).dispose;
  if (!key) return;
  const disposer = (value as { [index: symbol]: unknown })[key];
  if (typeof disposer !== "function") return;
  try {
    (disposer as () => void).call(value);
  } catch (error) {
    console.error("upload: dispose failed", error);
  }
}

function normalizeMime(raw: string): string {
  const value = raw.trim().toLowerCase();
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(value) ? value : "application/octet-stream";
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "bin";
  return name.slice(dot + 1).slice(0, 12).toLowerCase();
}

async function transformTo(
  env: Env,
  bytes: Uint8Array,
  transform: { width: number; height?: number; fit: "scale-down" },
  quality: number,
  label: string,
  anim: boolean,
): Promise<Derivative | null> {
  let transformer: ImageTransformer | null = null;
  let result: ImageTransformationResult | null = null;

  try {
    transformer = env.IMAGES.input(streamOf(bytes)).transform(transform);
    result = await transformer.output({ format: "image/webp", quality, anim });
    const buffer = await result.response().arrayBuffer();
    if (buffer.byteLength === 0) return null;
    return { bytes: new Uint8Array(buffer), mime: "image/webp" };
  } catch (error) {
    console.error(`upload: ${label} transform failed`, error);
    return null;
  } finally {
    disposeResult(result);
    disposeResult(transformer);
  }
}

/**
 * WebP derivatives only: Cloudflare discards all metadata on WebP output, so
 * the stored object never carries EXIF or GPS. Animated GIFs stay animated via
 * `anim`, and the thumbnail takes the first frame.
 */
async function makeDerivatives(
  env: Env,
  bytes: Uint8Array,
): Promise<{ display: Derivative; thumb: Derivative | null }> {
  const display = await transformTo(
    env,
    bytes,
    { width: DISPLAY_WIDTH, fit: "scale-down" },
    DISPLAY_QUALITY,
    "display",
    true,
  );

  if (!display) {
    // Without a derivative there is nothing to store that is metadata-free.
    throw new UploadError(422, "Could not process that image — try a different file");
  }

  // Thumb from the small derivative, not the multi-megabyte original: it keeps
  // the second RPC transfer tiny.
  const thumb = await transformTo(
    env,
    display.bytes,
    { width: THUMB_SIZE, height: THUMB_SIZE, fit: "scale-down" },
    THUMB_QUALITY,
    "thumb",
    false,
  );

  return { display, thumb };
}

async function readDimensions(
  bytes: Uint8Array,
): Promise<{ width: number | null; height: number | null }> {
  const dimensions = imageDimensions(bytes);
  return { width: dimensions?.width ?? null, height: dimensions?.height ?? null };
}

interface IncomingFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

interface Incoming {
  files: IncomingFile[];
  titleRaw: unknown;
  ttlRaw: string | null;
}

async function collectFiles(request: Request, allowRawBody: boolean): Promise<Incoming> {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const entries = form.getAll("file").filter((entry): entry is File => entry instanceof File);
      const files = await Promise.all(
        entries.map(async (file) => ({
          bytes: new Uint8Array(await file.arrayBuffer()),
          name: file.name,
          type: file.type,
        })),
      );
      return {
        files,
        titleRaw: form.get("title"),
        ttlRaw: form.get("ttl")?.toString() ?? null,
      };
    }

    if (!allowRawBody) {
      throw new UploadError(415, "Send multipart/form-data");
    }

    // Raw body: the browser sends the file bytes directly, so we skip multipart
    // parsing entirely (it is the most CPU-expensive part on big photos).
    const url = new URL(request.url);
    return {
      files: [
        {
          bytes: new Uint8Array(await request.arrayBuffer()),
          name: url.searchParams.get("filename") ?? "upload",
          type: contentType,
        },
      ],
      titleRaw: url.searchParams.get("title"),
      ttlRaw: url.searchParams.get("ttl"),
    };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    console.error("upload: could not read body", error);
    throw new UploadError(400, "Could not read the request body");
  }
}

function validateFiles(files: IncomingFile[], maxBytes: number, maxTotal: number, maxAssets: number): void {
  if (files.length === 0) throw new UploadError(400, "Nothing in the request");
  if (files.length > maxAssets) throw new UploadError(400, `Too many files (max ${maxAssets})`);

  let total = 0;
  for (const file of files) {
    if (file.bytes.byteLength === 0) throw new UploadError(400, "One of the files is empty");
    if (file.bytes.byteLength > maxBytes) {
      throw new UploadError(413, `A file is too large (max ${megabytes(maxBytes)} MB each)`);
    }
    total += file.bytes.byteLength;
  }

  if (total > maxTotal) {
    throw new UploadError(413, `Payload too large (max ${megabytes(maxTotal)} MB total)`);
  }
}

/** Images go through the stripping pipeline; everything else is stored verbatim. */
async function prepareAsset(env: Env, file: IncomingFile): Promise<PreparedAsset> {
  const bytes = file.bytes;
  const imageType = sniffImage(bytes);

  if (imageType) {
    const { width, height } = await readDimensions(bytes);
    const { display, thumb } = await makeDerivatives(env, bytes);
    return {
      kind: "image",
      bytes: display.bytes,
      mime: display.mime,
      filename: sanitizeFilename(file.name, imageType.ext),
      width,
      height,
      thumb,
    };
  }

  return {
    kind: "file",
    bytes,
    mime: normalizeMime(file.type),
    filename: sanitizeFilename(file.name, extensionOf(file.name)),
  };
}

async function prepareFiles(env: Env, files: IncomingFile[]): Promise<PreparedAsset[]> {
  return mapLimit(files, CONCURRENCY, (file) => prepareAsset(env, file));
}

function buildRecords(prepared: PreparedAsset[], postId: string, startPosition: number): StoredAsset[] {
  return prepared.map((asset, index) => {
    const assetId = randomId(10);
    const key = `p/${postId}/${assetId}`;
    return {
      asset,
      assetId,
      position: startPosition + index,
      key,
      displayKey: null,
      thumbKey: asset.kind === "image" && asset.thumb ? `${key}.thumb.webp` : null,
    };
  });
}

async function writeObjects(env: Env, records: StoredAsset[], expiresAt: number): Promise<void> {
  const writtenKeys: string[] = [];
  const failures: unknown[] = [];

  await mapLimit(records, CONCURRENCY, async (record) => {
    try {
      await env.BLOBS.put(record.key, record.asset.bytes, {
        httpMetadata: { contentType: record.asset.mime },
        customMetadata: { filename: record.asset.filename, expires: String(expiresAt) },
      });
      writtenKeys.push(record.key);

      if (record.asset.kind === "image" && record.asset.thumb && record.thumbKey) {
        await env.BLOBS.put(record.thumbKey, record.asset.thumb.bytes, {
          httpMetadata: { contentType: record.asset.thumb.mime },
          customMetadata: { expires: String(expiresAt) },
        });
        writtenKeys.push(record.thumbKey);
      }
    } catch (error) {
      failures.push(error);
    }
  });

  if (failures.length > 0) {
    console.error("upload: r2 put failed", failures[0]);
    await env.BLOBS.delete(writtenKeys).catch(() => undefined);
    throw new UploadError(500, "Could not store the files");
  }
}

function assetStatements(env: Env, postId: string, records: StoredAsset[]): D1PreparedStatement[] {
  return records.map((record) =>
    env.DB.prepare(
      `INSERT INTO assets
         (id, post_id, position, kind, mime, size, width, height, filename, r2_key, display_key, display_size, display_mime, thumb_key, thumb_size, thumb_mime)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    ).bind(
      record.assetId,
      postId,
      record.position,
      record.asset.kind,
      record.asset.mime,
      record.asset.bytes.byteLength,
      record.asset.kind === "image" ? record.asset.width : null,
      record.asset.kind === "image" ? record.asset.height : null,
      record.asset.filename,
      record.key,
      record.displayKey,
      null,
      null,
      record.thumbKey,
      record.asset.kind === "image" ? record.asset.thumb?.bytes.byteLength ?? null : null,
      record.asset.kind === "image" ? record.asset.thumb?.mime ?? null : null,
    ),
  );
}

function assetJson(origin: string, record: StoredAsset) {
  const name = encodeURIComponent(record.asset.filename);
  const base = {
    id: record.assetId,
    kind: record.asset.kind,
    filename: record.asset.filename,
    size: record.asset.bytes.byteLength,
  };

  if (record.asset.kind === "image") {
    return {
      ...base,
      url: `${origin}/img/${record.assetId}/${name}`,
      raw: `${origin}/raw/${record.assetId}/${name}`,
      thumb: `${origin}/t/${record.assetId}/${name}`,
      width: record.asset.width,
      height: record.asset.height,
    };
  }

  return {
    ...base,
    url: `${origin}/f/${record.assetId}/${name}`,
  };
}

function limit(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxAssets(env: Env): number {
  return limit(env.MAX_ASSETS ?? env.MAX_IMAGES, 20);
}

export async function handleUpload(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  uploader: Uploader,
): Promise<Response> {
  const maxBytes = limit(env.MAX_UPLOAD_BYTES, 20 * 1024 * 1024);
  const maxTotal = limit(env.MAX_TOTAL_BYTES, 50 * 1024 * 1024);
  const maxCount = maxAssets(env);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maxTotal + 1024 * 1024) {
    return fail(413, `Payload too large (max ${megabytes(maxTotal)} MB total)`);
  }

  try {
    const { files, titleRaw, ttlRaw } = await collectFiles(request, true);
    validateFiles(files, maxBytes, maxTotal, maxCount);

    const presets = loadPresets(env.TTL_PRESETS);
    const choice = resolveTtl(presets, ttlRaw, Number(env.DEFAULT_TTL_SECONDS) || 86400);
    if (!choice.ok) {
      return fail(400, `Unsupported ttl. Allowed values (seconds): ${choice.allowed.join(", ")}`);
    }

    const prepared = await prepareFiles(env, files);

    const now = Date.now();
    const expiresAt = now + choice.ttl.seconds * 1000;
    const title = sanitizeTitle(titleRaw);
    const origin = new URL(request.url).origin;
    const postId = randomId(10);
    const records = buildRecords(prepared, postId, 0);
    const editToken = randomToken();
    const editHash = await hashToken(editToken);

    await writeObjects(env, records, expiresAt);

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO posts
           (id, owner_email, title, created_at, expires_at, ttl_seconds, edit_hash, edit_expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        postId,
        uploader.email,
        title,
        now,
        expiresAt,
        choice.ttl.seconds,
        editHash,
        expiresAt,
      ),
      ...assetStatements(env, postId, records),
    ];

    try {
      await env.DB.batch(statements);
    } catch (error) {
      console.error("upload: d1 insert failed", error);
      const keys = records
        .flatMap((record) => [record.key, record.displayKey, record.thumbKey])
        .filter((key): key is string => Boolean(key));
      ctx.waitUntil(env.BLOBS.delete(keys).catch(() => undefined));
      return fail(500, "Could not save the share");
    }

    return json(
      {
        id: postId,
        pageUrl: `${origin}/i/${postId}`,
        manageUrl: `${origin}/m/${postId}`,
        deleteUrl: `${origin}/api/posts/${postId}`,
        title,
        ttlSeconds: choice.ttl.seconds,
        expiresAt: new Date(expiresAt).toISOString(),
        count: records.length,
        assets: records.map((record) => assetJson(origin, record)),
      },
      {
        status: 201,
        headers: {
          "set-cookie": editCookie(
            postId,
            editToken,
            expiresAt,
            new URL(request.url).protocol === "https:",
          ),
        },
      },
    );
  } catch (error) {
    if (error instanceof UploadError) return fail(error.status, error.message);
    console.error("upload: unexpected failure", error);
    return fail(500, "Upload failed");
  }
}

export async function handleAddAssets(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  postId: string,
  accessEmail: string | null,
): Promise<Response> {
  const post = await requireEditablePost(env, request, postId, accessEmail);
  if (post instanceof Response) return post;

  const maxBytes = limit(env.MAX_UPLOAD_BYTES, 20 * 1024 * 1024);
  const maxTotal = limit(env.MAX_TOTAL_BYTES, 50 * 1024 * 1024);
  const maxCount = maxAssets(env);

  try {
    const { files } = await collectFiles(request, true);
    const existing = await getPostAssets(env.DB, post.id);

    if (files.length + existing.length > maxCount) {
      return fail(400, `A share holds at most ${maxCount} files`);
    }

    validateFiles(files, maxBytes, maxTotal, maxCount);
    const prepared = await prepareFiles(env, files);

    const startPosition =
      existing.reduce((max, asset) => Math.max(max, asset.position), -1) + 1;
    const records = buildRecords(prepared, post.id, startPosition);

    await writeObjects(env, records, post.expires_at);

    try {
      await env.DB.batch(assetStatements(env, post.id, records));
    } catch (error) {
      console.error("upload: d1 insert failed", error);
      const keys = records
        .flatMap((record) => [record.key, record.displayKey, record.thumbKey])
        .filter((key): key is string => Boolean(key));
      ctx.waitUntil(env.BLOBS.delete(keys).catch(() => undefined));
      return fail(500, "Could not save the files");
    }

    const origin = new URL(request.url).origin;
    return json(
      {
        id: post.id,
        count: existing.length + records.length,
        assets: records.map((record) => assetJson(origin, record)),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UploadError) return fail(error.status, error.message);
    console.error("upload: unexpected failure", error);
    return fail(500, "Upload failed");
  }
}

export async function handleReorder(
  request: Request,
  env: Env,
  postId: string,
  accessEmail: string | null,
): Promise<Response> {
  const post = await requireEditablePost(env, request, postId, accessEmail);
  if (post instanceof Response) return post;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Expected a JSON body");
  }

  const payload = body as { assetIds?: unknown; imageIds?: unknown };
  const assetIds = payload.assetIds ?? payload.imageIds;
  if (!Array.isArray(assetIds) || assetIds.some((id) => typeof id !== "string")) {
    return fail(400, "Expected { assetIds: string[] }");
  }

  const existing = await getPostAssets(env.DB, post.id);
  const known = new Set(existing.map((asset) => asset.id));

  if (assetIds.length !== existing.length) {
    return fail(400, "assetIds must list every asset in the share");
  }
  if (new Set(assetIds).size !== assetIds.length) {
    return fail(400, "Duplicate asset id");
  }
  for (const id of assetIds) {
    if (!known.has(id as string)) return fail(400, "Unknown asset id");
  }

  await env.DB.batch(
    (assetIds as string[]).map((id, index) =>
      env.DB.prepare("UPDATE assets SET position = ?1 WHERE id = ?2 AND post_id = ?3").bind(
        index,
        id,
        post.id,
      ),
    ),
  );

  return json({ id: post.id, assetIds });
}

export async function handleUpdateTitle(
  request: Request,
  env: Env,
  postId: string,
  accessEmail: string | null,
): Promise<Response> {
  const post = await requireEditablePost(env, request, postId, accessEmail);
  if (post instanceof Response) return post;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Expected a JSON body");
  }

  const title = sanitizeTitle((body as { title?: unknown })?.title);
  await env.DB.prepare("UPDATE posts SET title = ?1 WHERE id = ?2").bind(title, post.id).run();

  return json({ id: post.id, title });
}

export async function handleDeleteAsset(
  request: Request,
  env: Env,
  postId: string,
  assetId: string,
  accessEmail: string | null,
): Promise<Response> {
  const post = await requireEditablePost(env, request, postId, accessEmail);
  if (post instanceof Response) return post;

  const assets = await getPostAssets(env.DB, post.id);
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) return fail(404, "Not found");

  const keys = [asset.r2_key, asset.display_key, asset.thumb_key].filter(
    (key): key is string => Boolean(key),
  );
  if (keys.length > 0) await env.BLOBS.delete(keys);

  await env.DB.prepare("DELETE FROM assets WHERE id = ?1 AND post_id = ?2")
    .bind(asset.id, post.id)
    .run();

  return new Response(null, { status: 204 });
}
