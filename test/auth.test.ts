import { describe, expect, it } from "vitest";
import { authenticate, parseBasicPassword, secretEquals } from "../src/lib/auth";

function basic(user: string, password: string): string {
  return "Basic " + btoa(`${user}:${password}`);
}

function makeCtx(identity: { email?: string } | null, present = true): ExecutionContext {
  if (!present) return {} as ExecutionContext;
  return {
    access: { getIdentity: async () => identity },
  } as unknown as ExecutionContext;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AUTH_MODE: "basic",
    UPLOAD_PASSWORD: "s3cret",
    OWNER_EMAIL: "me@example.com",
    ...overrides,
  } as Env;
}

describe("parseBasicPassword", () => {
  it("extracts the password half", () => {
    expect(parseBasicPassword(basic("me", "s3cret"))).toBe("s3cret");
    expect(parseBasicPassword(basic("me", "with:colon"))).toBe("with:colon");
  });

  it("returns null for missing or malformed headers", () => {
    expect(parseBasicPassword(null)).toBeNull();
    expect(parseBasicPassword("Bearer abc")).toBeNull();
    expect(parseBasicPassword("Basic !!!not-base64!!!")).toBeNull();
    expect(parseBasicPassword("")).toBeNull();
  });
});

describe("secretEquals", () => {
  it("compares in constant time fashion", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abd")).toBe(false);
    expect(secretEquals("abc", "abcd")).toBe(false);
  });
});

describe("authenticate (basic)", () => {
  it("accepts the configured password", async () => {
    const request = new Request("https://img.example.com/api/upload", {
      headers: { authorization: basic("me", "s3cret") },
    });
    const result = await authenticate(request, makeEnv(), makeCtx(null, false));
    expect(result).toEqual({ ok: true, uploader: { email: "me@example.com" } });
  });

  it("challenges without credentials", async () => {
    const request = new Request("https://img.example.com/api/upload");
    const result = await authenticate(request, makeEnv(), makeCtx(null, false));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.headers?.["www-authenticate"]).toContain("Basic");
    }
  });

  it("rejects the wrong password", async () => {
    const request = new Request("https://img.example.com/api/upload", {
      headers: { authorization: basic("me", "nope") },
    });
    const result = await authenticate(request, makeEnv(), makeCtx(null, false));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("fails loudly when no password is configured", async () => {
    const request = new Request("https://img.example.com/api/upload", {
      headers: { authorization: basic("me", "anything") },
    });
    const result = await authenticate(
      request,
      makeEnv({ UPLOAD_PASSWORD: undefined }),
      makeCtx(null, false),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });
});

describe("authenticate (access)", () => {
  const env = makeEnv({ AUTH_MODE: "access" });

  it("uses the Access identity", async () => {
    const request = new Request("https://img.example.com/");
    const result = await authenticate(request, env, makeCtx({ email: "owner@example.com" }));
    expect(result).toEqual({ ok: true, uploader: { email: "owner@example.com" } });
  });

  it("refuses when Access is absent", async () => {
    const request = new Request("https://img.example.com/");
    const result = await authenticate(request, env, makeCtx(null, false));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("refuses when Access has no identity", async () => {
    const request = new Request("https://img.example.com/");
    const result = await authenticate(request, env, makeCtx(null));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("authenticate (open)", () => {
  it("lets anything through, for the deliberate temporary window", async () => {
    const request = new Request("https://img.example.com/api/upload");
    const result = await authenticate(request, makeEnv({ AUTH_MODE: "open" }), makeCtx(null, false));
    expect(result).toEqual({ ok: true, uploader: { email: "me@example.com" } });
  });
});
