import { secretEquals } from "./auth";
import type { PostRow } from "./posts";

const COOKIE_PREFIX = "edit_";

export function editCookieName(postId: string): string {
  return `${COOKIE_PREFIX}${postId}`;
}

/** 32 random bytes, base64url — safe for a cookie value. */
export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function editCookie(
  postId: string,
  token: string,
  expiresAt: number,
  secure: boolean,
): string {
  const maxAge = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) flags.push("Secure");
  return `${editCookieName(postId)}=${token}; ${flags.join("; ")}`;
}

export function readEditToken(request: Request, postId: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  const name = editCookieName(postId);
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    if (trimmed.slice(0, separator) === name) return trimmed.slice(separator + 1);
  }
  return null;
}

export async function verifyEditToken(request: Request, post: PostRow): Promise<boolean> {
  if (!post.edit_hash) return false;

  const token = readEditToken(request, post.id);
  if (!token) return false;

  return secretEquals(await hashToken(token), post.edit_hash);
}
