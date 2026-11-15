-- Edit rights are granted to the uploading browser via a per-share cookie.
-- Only a SHA-256 of the token is stored.
ALTER TABLE posts ADD COLUMN edit_hash TEXT;
ALTER TABLE posts ADD COLUMN edit_expires_at INTEGER;
