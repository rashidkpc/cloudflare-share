export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function fail(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return json({ error: message }, { status, headers: extraHeaders });
}

export function text(
  body: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/plain; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(body, { status, headers });
}

export function html(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("cdn-cache-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-robots-tag", "noindex, nofollow");
  headers.set(
    "content-security-policy",
    "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'",
  );
  return new Response(body, { status, headers });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Serialize JSON for embedding in an HTML attribute. */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/** RFC 5987 attachment header, safe for arbitrary filenames. */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
