import { describe, expect, it } from "vitest";
import { accessIdentity } from "../src/lib/auth";
import { requireOwnedPost } from "../src/routes/guard";

const NOW = Date.now();

function makePost(overrides: Partial<{ owner_email: string; expires_at: number }> = {}) {
  return {
    id: "share123",
    owner_email: "Owner@Example.com",
    title: "",
    created_at: NOW - 1_000,
    expires_at: NOW + 60_000,
    ttl_seconds: 3_600,
    ...overrides,
  };
}

function makeEnv(row: unknown) {
  const DB = {
    prepare(_sql: string) {
      return {
        bind() {
          return {
            async first() {
              return row;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };

  return { DB, BLOBS: { async delete() {} } } as unknown as Env;
}

function context(access?: unknown): ExecutionContext {
  return { access } as unknown as ExecutionContext;
}

describe("accessIdentity", () => {
  it("returns a lowercased, trimmed email", async () => {
    const ctx = context({ getIdentity: async () => ({ email: "  Owner@Example.COM " }) });
    expect(await accessIdentity(ctx)).toBe("owner@example.com");
  });

  it("returns null when Access is not fronting the request", async () => {
    expect(await accessIdentity(context())).toBeNull();
  });

  it("returns null when Access has no identity", async () => {
    const ctx = context({ getIdentity: async () => null });
    expect(await accessIdentity(ctx)).toBeNull();
  });

  it("returns null when the identity has no email", async () => {
    const ctx = context({ getIdentity: async () => ({}) });
    expect(await accessIdentity(ctx)).toBeNull();
  });

  it("returns null when getIdentity throws", async () => {
    const ctx = context({
      getIdentity: async () => {
        throw new Error("no access");
      },
    });
    expect(await accessIdentity(ctx)).toBeNull();
  });
});

describe("requireOwnedPost", () => {
  it("allows the owner even when the stored email differs in case", async () => {
    const result = await requireOwnedPost(makeEnv(makePost()), "share123", "owner@example.com");
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { id: string }).id).toBe("share123");
  });

  it("rejects a different Access account", async () => {
    const result = await requireOwnedPost(makeEnv(makePost()), "share123", "someone@example.com");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("rejects a request without an Access identity", async () => {
    const result = await requireOwnedPost(makeEnv(makePost()), "share123", null);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("returns 404 for a missing share", async () => {
    const result = await requireOwnedPost(makeEnv(null), "nope", "owner@example.com");
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("returns 410 for an expired share", async () => {
    const result = await requireOwnedPost(
      makeEnv(makePost({ expires_at: NOW - 1 })),
      "share123",
      "owner@example.com",
    );
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(410);
  });
});
