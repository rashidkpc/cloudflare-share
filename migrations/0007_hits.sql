-- A share expires once it has served its request budget. Counting every public
-- request (page and assets) bounds the R2 and D1 work a single share can cause.
ALTER TABLE posts ADD COLUMN hits INTEGER NOT NULL DEFAULT 0;
