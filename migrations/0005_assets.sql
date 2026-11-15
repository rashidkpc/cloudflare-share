-- A share can hold images and arbitrary files. Images are re-encoded to WebP;
-- files are stored verbatim and always served as an attachment.

ALTER TABLE images ADD COLUMN kind TEXT NOT NULL DEFAULT 'image';
ALTER TABLE images RENAME TO assets;

DROP INDEX IF EXISTS idx_images_post;
CREATE INDEX IF NOT EXISTS idx_assets_post ON assets (post_id);
