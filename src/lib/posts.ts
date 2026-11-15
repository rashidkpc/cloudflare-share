export interface PostRow {
  id: string;
  owner_email: string;
  title: string;
  created_at: number;
  expires_at: number;
  ttl_seconds: number;
  hits: number;
  hit_limit: number;
}

export type AssetKind = "image" | "file";

export interface AssetRow {
  id: string;
  post_id: string;
  position: number;
  kind: AssetKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  filename: string;
  r2_key: string;
  display_key: string | null;
  display_size: number | null;
  display_mime: string | null;
  thumb_key: string | null;
  thumb_size: number | null;
  thumb_mime: string | null;
}

export type Db = Pick<D1Database, "prepare" | "batch">;
export type Storage = { DB: Db; BLOBS: Pick<R2Bucket, "delete"> };

const POST_COLUMNS =
  "id, owner_email, title, created_at, expires_at, ttl_seconds, hits, hit_limit";
const ASSET_COLUMNS =
  "id, post_id, position, kind, mime, size, width, height, filename, r2_key, display_key, display_size, display_mime, thumb_key, thumb_size, thumb_mime";

const SWEEP_BATCH = 500;
const SWEEP_MAX_ROUNDS = 20;
const ID_CHUNK = 100;
const KEY_CHUNK = 900; // R2 delete accepts 1000 keys per call

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `?${index + 1}`).join(", ");
}

async function deleteKeys(blobs: Pick<R2Bucket, "delete">, keys: (string | null)[]): Promise<void> {
  const unique = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  for (const group of chunk(unique, KEY_CHUNK)) {
    await blobs.delete(group);
  }
}

export async function getPost(db: Db, id: string): Promise<PostRow | null> {
  const row = await db
    .prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?1`)
    .bind(id)
    .first<PostRow>();
  return row ?? null;
}

export interface HitState {
  hits: number;
  expires_at: number;
  hit_limit: number;
}

/**
 * Charge one request to a share. Returns null when the share is missing or
 * already expired, including when a concurrent request spent the last request.
 *
 * The budget is spent by expiring the share in place, so the normal purge path
 * (serve-time delete plus the cron sweep) does the cleanup.
 */
export async function registerHit(db: Db, postId: string, now: number): Promise<HitState | null> {
  const row = await db
    .prepare(
      `UPDATE posts
          SET hits = hits + 1,
              expires_at = CASE WHEN hits + 1 > hit_limit THEN ?2 ELSE expires_at END
        WHERE id = ?1 AND expires_at > ?2
    RETURNING hits, expires_at, hit_limit`,
    )
    .bind(postId, now)
    .first<HitState>();
  return row ?? null;
}

export async function getPostAssets(db: Db, postId: string): Promise<AssetRow[]> {
  const { results } = await db
    .prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE post_id = ?1 ORDER BY position ASC`)
    .bind(postId)
    .all<AssetRow>();
  return results ?? [];
}

/** Used by legacy /img/<share-id>/<name> links from the one-image-per-post era. */
export async function getFirstImage(db: Db, postId: string): Promise<AssetRow | null> {
  const row = await db
    .prepare(
      `SELECT ${ASSET_COLUMNS} FROM assets
        WHERE post_id = ?1 AND kind = 'image'
        ORDER BY position ASC LIMIT 1`,
    )
    .bind(postId)
    .first<AssetRow>();
  return row ?? null;
}

export interface AssetWithExpiry {
  asset: AssetRow;
  expires_at: number;
}

export async function getAssetWithPost(db: Db, assetId: string): Promise<AssetWithExpiry | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.post_id, a.position, a.kind, a.mime, a.size, a.width, a.height, a.filename,
              a.r2_key, a.display_key, a.display_size, a.display_mime,
              a.thumb_key, a.thumb_size, a.thumb_mime, p.expires_at
         FROM assets a JOIN posts p ON p.id = a.post_id
        WHERE a.id = ?1`,
    )
    .bind(assetId)
    .first<AssetRow & { expires_at: number }>();

  if (!row) return null;
  const { expires_at, ...asset } = row;
  return { asset, expires_at };
}

/** Remove every object and row belonging to a share. */
export async function deletePost(env: Storage, postId: string): Promise<void> {
  const { results } = await env.DB
    .prepare("SELECT r2_key, display_key, thumb_key FROM assets WHERE post_id = ?1")
    .bind(postId)
    .all<{ r2_key: string; display_key: string | null; thumb_key: string | null }>();

  await deleteKeys(
    env.BLOBS,
    (results ?? []).flatMap((row) => [row.r2_key, row.display_key, row.thumb_key]),
  );

  await env.DB.batch([
    env.DB.prepare("DELETE FROM assets WHERE post_id = ?1").bind(postId),
    env.DB.prepare("DELETE FROM posts WHERE id = ?1").bind(postId),
  ]);
}

/**
 * Delete every share that has passed its expiry, including all of its assets.
 * Called by the cron trigger and from the serve path when an expired share is
 * requested.
 */
export async function sweepExpired(env: Storage, now = Date.now()): Promise<number> {
  let deleted = 0;

  for (let round = 0; round < SWEEP_MAX_ROUNDS; round += 1) {
    const { results: posts } = await env.DB
      .prepare(
        `SELECT id FROM posts WHERE expires_at <= ?1 ORDER BY expires_at ASC LIMIT ${SWEEP_BATCH}`,
      )
      .bind(now)
      .all<{ id: string }>();

    if (!posts || posts.length === 0) break;

    for (const group of chunk(posts, ID_CHUNK)) {
      const ids = group.map((post) => post.id);
      const list = placeholders(ids.length);

      const { results: assets } = await env.DB
        .prepare(`SELECT r2_key, display_key, thumb_key FROM assets WHERE post_id IN (${list})`)
        .bind(...ids)
        .all<{ r2_key: string; display_key: string | null; thumb_key: string | null }>();

      await deleteKeys(
        env.BLOBS,
        (assets ?? []).flatMap((row) => [row.r2_key, row.display_key, row.thumb_key]),
      );

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM assets WHERE post_id IN (${list})`).bind(...ids),
        env.DB.prepare(`DELETE FROM posts WHERE id IN (${list})`).bind(...ids),
      ]);
    }

    deleted += posts.length;
    if (posts.length < SWEEP_BATCH) break;
  }

  return deleted;
}
