interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;

  READ_PER_IP: RateLimit;
  READ_GLOBAL: RateLimit;

  DEFAULT_TTL_SECONDS: string;
  /** JSON [{label, requests}] choices for a share's public request budget. */
  SHARE_REQUEST_PRESETS?: string;
  /** Fallback request budget when the upload does not pick one. */
  DEFAULT_SHARE_REQUESTS?: string;
  TTL_PRESETS: string;
  MAX_UPLOAD_BYTES: string;
  MAX_IMAGES: string;
  MAX_ASSETS?: string;
  MAX_TOTAL_BYTES: string;
  SITE_NAME: string;
}
