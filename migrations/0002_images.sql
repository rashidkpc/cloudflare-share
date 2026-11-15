-- A share can hold several images, and carries an optional title.

CREATE TABLE IF NOT EXISTS images (
  id           TEXT PRIMARY KEY,
  post_id      TEXT NOT NULL,
  position     INTEGER NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  filename     TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  display_key  TEXT,
  display_size INTEGER,
  display_mime TEXT
);

CREATE INDEX IF NOT EXISTS idx_images_post ON images (post_id);

ALTER TABLE posts ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Fold the old one-image-per-post rows into images so existing /i/:id links
-- keep resolving. Legacy /img/:id links are handled per-request by falling
-- back to the post's first image.
INSERT INTO images (id, post_id, position, mime, size, filename, r2_key)
SELECT lower(substr(hex(randomblob(6)), 1, 12)), id, 0, mime, size, filename, r2_key
FROM posts;
