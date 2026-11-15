import { describe, expect, it } from "vitest";
import { FALLBACK_PRESETS, loadPresets, resolveTtl } from "../src/lib/ttl";

describe("loadPresets", () => {
  it("parses a configured preset list", () => {
    const presets = loadPresets('[{"label":"1 hour","seconds":3600},{"label":"24 hours","seconds":86400}]');
    expect(presets).toEqual([
      { label: "1 hour", seconds: 3600 },
      { label: "24 hours", seconds: 86400 },
    ]);
  });

  it("falls back when the value is missing, malformed, or empty", () => {
    expect(loadPresets(undefined)).toEqual(FALLBACK_PRESETS);
    expect(loadPresets("not json")).toEqual(FALLBACK_PRESETS);
    expect(loadPresets("[]")).toEqual(FALLBACK_PRESETS);
    expect(loadPresets('{"seconds": 60}')).toEqual(FALLBACK_PRESETS);
  });

  it("drops invalid entries and fills in a label", () => {
    const presets = loadPresets('[{"seconds":7200},{"label":"zero","seconds":0},{"label":"text","seconds":"x"}]');
    expect(presets).toEqual([{ label: "7200 seconds", seconds: 7200 }]);
  });
});

describe("resolveTtl", () => {
  const presets = FALLBACK_PRESETS;

  it("defaults to 24 hours when nothing is requested", () => {
    const result = resolveTtl(presets, null, 86400);
    expect(result).toEqual({ ok: true, ttl: { label: "24 hours", seconds: 86400 } });
  });

  it("defaults to the configured value when it is a preset", () => {
    const result = resolveTtl(presets, "", 3600);
    expect(result).toEqual({ ok: true, ttl: { label: "1 hour", seconds: 3600 } });
  });

  it("falls back to 24h if the configured default is not a preset", () => {
    const result = resolveTtl(presets, undefined, 12345);
    expect(result.ok && result.ttl.seconds).toBe(86400);
  });

  it("accepts a preset value", () => {
    const result = resolveTtl(presets, "604800", 86400);
    expect(result).toEqual({ ok: true, ttl: { label: "7 days", seconds: 604800 } });
  });

  it("rejects anything that is not a preset", () => {
    for (const requested of ["60", "12345", "-3600", "abc", "3600.5"]) {
      const result = resolveTtl(presets, requested, 86400);
      expect(result).toEqual({ ok: false, allowed: presets.map((p) => p.seconds) });
    }
  });
});
