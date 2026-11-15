const LIMITED_PREFIXES = ["/i/", "/img/", "/t/", "/raw/", "/f/"];

/** Public read routes that consume a share's request budget. */
export function isLimitedRead(pathname: string): boolean {
  return LIMITED_PREFIXES.some(
    (prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length,
  );
}
