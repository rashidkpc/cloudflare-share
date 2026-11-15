-- One row per post. The bytes live in R2 under r2_key.
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  filename    TEXT NOT NULL,
  r2_key      TEXT NOT NULL
);

-- Drives the expiry sweep. There is deliberately no "recent posts" index:
-- nothing ever lists or sorts posts.
CREATE INDEX IF NOT EXISTS idx_posts_expires ON posts (expires_at);
