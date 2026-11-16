interface AccessContext {
  access?: {
    getIdentity?: () => Promise<{ email?: string } | null>;
  };
}

/**
 * Email of the Cloudflare Access identity for this request, lowercased.
 * Returns null when the request did not come through Access.
 */
export async function accessIdentity(ctx: ExecutionContext): Promise<string | null> {
  const access = (ctx as unknown as AccessContext).access;
  if (!access?.getIdentity) return null;

  try {
    const identity = await access.getIdentity();
    const email = identity?.email?.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * True when the request carries an Access session cookie. This is only a hint:
 * /upload validates the session for real, so a stale cookie just means one
 * extra trip through the Access login.
 */
export function hasAccessSession(request: Request): boolean {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return /(?:^|;\s*)CF_Authorization=/.test(header);
}
