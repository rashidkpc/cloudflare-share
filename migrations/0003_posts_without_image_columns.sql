-- Rebuild posts now that per-image columns live in `images`.
-- SQLite cannot drop NOT NULL columns in place, and the old ones would reject
-- every insert that does not supply them.

CREATE TABLE IF NOT EXISTS posts_next (
  id          TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL
);

INSERT INTO posts_next (id, owner_email, title, created_at, expires_at, ttl_seconds)
SELECT id, owner_email, title, created_at, expires_at, ttl_seconds FROM posts;

DROP TABLE posts;

ALTER TABLE posts_next RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_expires ON posts (expires_at);
