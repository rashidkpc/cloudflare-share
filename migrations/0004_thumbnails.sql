-- Small square-ish preview for the grid, generated at upload.
ALTER TABLE images ADD COLUMN thumb_key TEXT;
ALTER TABLE images ADD COLUMN thumb_size INTEGER;
ALTER TABLE images ADD COLUMN thumb_mime TEXT;
