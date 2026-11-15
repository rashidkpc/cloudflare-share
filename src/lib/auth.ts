export interface Uploader {
  email: string;
}

export type AuthOutcome =
  | { ok: true; uploader: Uploader }
  | { ok: false; status: number; message: string; headers?: Record<string, string> };

interface AccessIdentity {
  email?: string;
  name?: string;
}

interface AccessContext {
  access?: {
    getIdentity?: () => Promise<AccessIdentity | null>;
  };
}

/** Constant-time-ish comparison; avoids leaking the secret's length via timing. */
export function secretEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** Decode a Basic credential header into its password half. */
export function parseBasicPassword(header: string | null): string | null {
  if (!header) return null;
  const match = /^basic\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = atob(match[1]!.replace(/\s/g, ""));
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  return separator >= 0 ? decoded.slice(separator + 1) : decoded;
}

export async function authenticate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<AuthOutcome> {
  if (env.AUTH_MODE === "open") {
    console.warn("img: AUTH_MODE=open — uploads are unauthenticated");
    return { ok: true, uploader: { email: env.OWNER_EMAIL ?? "owner" } };
  }
  if (env.AUTH_MODE === "basic") return authenticateBasic(request, env);
  return authenticateAccess(env, ctx);
}

function authenticateBasic(request: Request, env: Env): AuthOutcome {
  const expected = env.UPLOAD_PASSWORD;
  if (!expected) {
    return { ok: false, status: 500, message: "UPLOAD_PASSWORD is not configured" };
  }

  const password = parseBasicPassword(request.headers.get("authorization"));
  if (password === null) {
    return {
      ok: false,
      status: 401,
      message: "Authentication required",
      headers: { "www-authenticate": 'Basic realm="img", charset="UTF-8"' },
    };
  }

  if (!secretEquals(password, expected)) {
    return {
      ok: false,
      status: 401,
      message: "Invalid credentials",
      headers: { "www-authenticate": 'Basic realm="img", charset="UTF-8"' },
    };
  }

  return { ok: true, uploader: { email: env.OWNER_EMAIL ?? "owner" } };
}

async function authenticateAccess(env: Env, ctx: ExecutionContext): Promise<AuthOutcome> {
  const access = (ctx as unknown as AccessContext).access;
  if (!access?.getIdentity) {
    return {
      ok: false,
      status: 403,
      message: "Cloudflare Access is not configured for this request",
    };
  }

  const identity = await access.getIdentity();
  if (!identity) {
    return { ok: false, status: 403, message: "Cloudflare Access identity unavailable" };
  }

  return {
    ok: true,
    uploader: { email: identity.email ?? env.OWNER_EMAIL ?? "owner" },
  };
}
