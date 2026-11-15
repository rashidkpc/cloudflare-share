import { describe, expect, it } from "vitest";
import { isLimitedRead, shareRequestCap } from "../src/lib/limits";

describe("isLimitedRead", () => {
  it("matches the public share and asset routes", () => {
    expect(isLimitedRead("/i/abc123")).toBe(true);
    expect(isLimitedRead("/img/abc/name.webp")).toBe(true);
    expect(isLimitedRead("/t/abc/name.webp")).toBe(true);
    expect(isLimitedRead("/raw/abc/name.webp")).toBe(true);
    expect(isLimitedRead("/f/abc/file.zip")).toBe(true);
  });

  it("ignores routes that are not public reads", () => {
    expect(isLimitedRead("/")).toBe(false);
    expect(isLimitedRead("/upload")).toBe(false);
    expect(isLimitedRead("/healthz")).toBe(false);
    expect(isLimitedRead("/style.css")).toBe(false);
    expect(isLimitedRead("/api/posts/abc")).toBe(false);
    expect(isLimitedRead("/m/abc")).toBe(false);
  });

  it("requires an id after the prefix", () => {
    expect(isLimitedRead("/i/")).toBe(false);
    expect(isLimitedRead("/img/")).toBe(false);
  });
});

describe("shareRequestCap", () => {
  it("defaults to 1000", () => {
    expect(shareRequestCap(undefined)).toBe(1000);
  });

  it("uses a positive override", () => {
    expect(shareRequestCap("250")).toBe(250);
  });

  it("falls back for invalid or non-positive values", () => {
    expect(shareRequestCap("0")).toBe(1000);
    expect(shareRequestCap("-10")).toBe(1000);
    expect(shareRequestCap("nope")).toBe(1000);
  });

  it("floors fractional values", () => {
    expect(shareRequestCap("12.9")).toBe(12);
  });
});
