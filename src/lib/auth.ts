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
