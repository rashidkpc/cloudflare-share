export interface TtlPreset {
  label: string;
  seconds: number;
}

/** Used when TTL_PRESETS is missing or malformed. */
export const FALLBACK_PRESETS: TtlPreset[] = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 259200 },
  { label: "7 days", seconds: 604800 },
];

export function loadPresets(raw: string | undefined | null): TtlPreset[] {
  if (!raw) return FALLBACK_PRESETS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return FALLBACK_PRESETS;
  }

  if (!Array.isArray(parsed)) return FALLBACK_PRESETS;

  const presets: TtlPreset[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { label, seconds } = entry as { label?: unknown; seconds?: unknown };
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
    const whole = Math.floor(seconds);
    presets.push({
      label: typeof label === "string" && label.trim() ? label : `${whole} seconds`,
      seconds: whole,
    });
  }

  return presets.length > 0 ? presets : FALLBACK_PRESETS;
}

export type TtlResolution =
  | { ok: true; ttl: TtlPreset }
  | { ok: false; allowed: number[] };

/**
 * Presets only: the requested value must be one of the configured presets.
 * An empty request falls back to DEFAULT_TTL_SECONDS (or 24h if that is not
 * itself a preset).
 */
export function resolveTtl(
  presets: TtlPreset[],
  requested: string | null | undefined,
  defaultSeconds: number,
): TtlResolution {
  if (requested == null || requested.trim() === "") {
    const preferred =
      presets.find((p) => p.seconds === defaultSeconds) ??
      presets.find((p) => p.seconds === 86400) ??
      presets[0]!;
    return { ok: true, ttl: preferred };
  }

  const seconds = Number(requested.trim());
  if (!Number.isInteger(seconds)) {
    return { ok: false, allowed: presets.map((p) => p.seconds) };
  }

  const match = presets.find((p) => p.seconds === seconds);
  if (!match) return { ok: false, allowed: presets.map((p) => p.seconds) };

  return { ok: true, ttl: match };
}
