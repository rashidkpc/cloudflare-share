-- The public request budget is chosen per share at upload time.
ALTER TABLE posts ADD COLUMN hit_limit INTEGER NOT NULL DEFAULT 1000;
