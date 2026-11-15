export interface RequestPreset {
  label: string;
  requests: number;
}

/** Used when SHARE_REQUEST_PRESETS is missing or malformed. */
export const FALLBACK_REQUEST_PRESETS: RequestPreset[] = [
  { label: "50 requests", requests: 50 },
  { label: "100 requests", requests: 100 },
  { label: "250 requests", requests: 250 },
  { label: "500 requests", requests: 500 },
  { label: "1,000 requests", requests: 1000 },
  { label: "2,500 requests", requests: 2500 },
  { label: "5,000 requests", requests: 5000 },
  { label: "10,000 requests", requests: 10000 },
];

export function loadRequestPresets(raw: string | undefined | null): RequestPreset[] {
  if (!raw) return FALLBACK_REQUEST_PRESETS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK_REQUEST_PRESETS;
  }

  if (!Array.isArray(parsed)) return FALLBACK_REQUEST_PRESETS;

  const presets: RequestPreset[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { label, requests } = entry as { label?: unknown; requests?: unknown };
    if (typeof requests !== "number" || !Number.isFinite(requests) || requests <= 0) continue;
    const whole = Math.floor(requests);
    presets.push({
      label:
        typeof label === "string" && label.trim()
          ? label
          : `${whole.toLocaleString("en-US")} requests`,
      requests: whole,
    });
  }

  return presets.length > 0 ? presets : FALLBACK_REQUEST_PRESETS;
}

export type RequestResolution =
  | { ok: true; preset: RequestPreset }
  | { ok: false; allowed: number[] };

/**
 * Presets only: the requested value must be one of the configured presets.
 * An empty request falls back to DEFAULT_SHARE_REQUESTS.
 */
export function resolveRequestLimit(
  presets: RequestPreset[],
  requested: string | null | undefined,
  defaultRequests: number,
): RequestResolution {
  if (requested == null || requested.trim() === "") {
    const preferred =
      presets.find((preset) => preset.requests === defaultRequests) ??
      presets.find((preset) => preset.requests === 1000) ??
      presets[0]!;
    return { ok: true, preset: preferred };
  }

  const requests = Number(requested.trim());
  if (!Number.isInteger(requests)) {
    return { ok: false, allowed: presets.map((preset) => preset.requests) };
  }

  const match = presets.find((preset) => preset.requests === requests);
  if (!match) return { ok: false, allowed: presets.map((preset) => preset.requests) };

  return { ok: true, preset: match };
}
