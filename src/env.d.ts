interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;

  READ_PER_IP: RateLimit;
  READ_GLOBAL: RateLimit;

  DEFAULT_TTL_SECONDS: string;
  /** Public requests a share may serve before it expires. Defaults to 1000. */
  MAX_SHARE_REQUESTS?: string;
  TTL_PRESETS: string;
  MAX_UPLOAD_BYTES: string;
  MAX_IMAGES: string;
  MAX_ASSETS?: string;
  MAX_TOTAL_BYTES: string;
  SITE_NAME: string;
}
