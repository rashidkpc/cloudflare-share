import { describe, expect, it } from "vitest";
import { sanitizeTitle } from "../src/routes/upload";

describe("sanitizeTitle", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeTitle("  camping   photos \n")).toBe("camping photos");
  });

  it("strips control characters", () => {
    expect(sanitizeTitle("a\u0000b\u0007c")).toBe("a b c");
  });

  it("caps the length at 120 characters", () => {
    expect(sanitizeTitle("x".repeat(300))).toHaveLength(120);
  });

  it("returns an empty string for non-strings", () => {
    expect(sanitizeTitle(null)).toBe("");
    expect(sanitizeTitle(undefined)).toBe("");
    expect(sanitizeTitle(42)).toBe("");
  });

  it("keeps ordinary punctuation", () => {
    expect(sanitizeTitle("Trip: day 2 — beach & sunset")).toBe("Trip: day 2 — beach & sunset");
  });
});
