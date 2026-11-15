import { describe, expect, it } from "vitest";
import {
  FALLBACK_REQUEST_PRESETS,
  loadRequestPresets,
  resolveRequestLimit,
} from "../src/lib/requests";

describe("loadRequestPresets", () => {
  it("falls back when the config is missing or malformed", () => {
    expect(loadRequestPresets(undefined)).toEqual(FALLBACK_REQUEST_PRESETS);
    expect(loadRequestPresets("not json")).toEqual(FALLBACK_REQUEST_PRESETS);
    expect(loadRequestPresets("{}")).toEqual(FALLBACK_REQUEST_PRESETS);
    expect(loadRequestPresets("[]")).toEqual(FALLBACK_REQUEST_PRESETS);
  });

  it("parses configured presets and drops invalid entries", () => {
    const presets = loadRequestPresets(
      JSON.stringify([
        { label: "Tiny", requests: 25 },
        { label: "", requests: 100 },
        { label: "Bad", requests: 0 },
        { label: "Also bad", requests: "500" },
        null,
      ]),
    );
    expect(presets).toEqual([
      { label: "Tiny", requests: 25 },
      { label: "100 requests", requests: 100 },
    ]);
  });

  it("floors fractional request counts", () => {
    expect(loadRequestPresets(JSON.stringify([{ label: "x", requests: 12.9 }]))).toEqual([
      { label: "x", requests: 12 },
    ]);
  });
});

describe("resolveRequestLimit", () => {
  const presets = [
    { label: "50", requests: 50 },
    { label: "100", requests: 100 },
    { label: "1,000", requests: 1000 },
  ];

  it("uses the configured default", () => {
    expect(resolveRequestLimit(presets, null, 100)).toEqual({
      ok: true,
      preset: presets[1],
    });
  });

  it("prefers 1000 when the default is not a preset", () => {
    expect(resolveRequestLimit(presets, "", 7)).toEqual({
      ok: true,
      preset: presets[2],
    });
  });

  it("falls back to the first preset when 1000 is absent", () => {
    expect(resolveRequestLimit([presets[0]!], null, 7)).toEqual({
      ok: true,
      preset: presets[0],
    });
  });

  it("accepts an exact preset", () => {
    expect(resolveRequestLimit(presets, "50", 1000)).toEqual({
      ok: true,
      preset: presets[0],
    });
  });

  it("rejects values that are not presets", () => {
    expect(resolveRequestLimit(presets, "75", 1000)).toEqual({
      ok: false,
      allowed: [50, 100, 1000],
    });
    expect(resolveRequestLimit(presets, "1.5", 1000)).toEqual({
      ok: false,
      allowed: [50, 100, 1000],
    });
  });
});
