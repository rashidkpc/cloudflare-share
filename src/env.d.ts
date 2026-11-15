interface Env {
  BLOBS: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;

  DEFAULT_TTL_SECONDS: string;
  TTL_PRESETS: string;
  MAX_UPLOAD_BYTES: string;
  MAX_IMAGES: string;
  MAX_ASSETS?: string;
  MAX_TOTAL_BYTES: string;
  SITE_NAME: string;
}
