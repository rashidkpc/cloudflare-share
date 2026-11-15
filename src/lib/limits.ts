const LIMITED_PREFIXES = ["/i/", "/img/", "/t/", "/raw/", "/f/"];

/** Public read routes that consume a share's request budget. */
export function isLimitedRead(pathname: string): boolean {
  return LIMITED_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length,
  );
}

/** Number of public requests a share may serve before it expires. */
export function shareRequestCap(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
}
