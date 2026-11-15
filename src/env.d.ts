interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;

  /** "access" (Cloudflare Access), "basic" (HTTP Basic), or "open" */
  AUTH_MODE: string;
  /** Required when AUTH_MODE=basic */
  UPLOAD_PASSWORD?: string;
  /** Recorded as owner_email in basic mode / when Access returns no email */
  OWNER_EMAIL?: string;

  DEFAULT_TTL_SECONDS: string;
  TTL_PRESETS: string;
  MAX_UPLOAD_BYTES: string;
  MAX_IMAGES: string;
  MAX_ASSETS?: string;
  MAX_TOTAL_BYTES: string;
  SITE_NAME: string;
}
