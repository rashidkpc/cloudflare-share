import { describe, expect, it } from "vitest";
import { handleManage } from "../src/routes/pages";
import { handleResetShare } from "../src/routes/upload";

const NOW = Date.now();

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: "sharet",
    owner_email: "Owner@Example.com",
    title: "Trip",
    created_at: NOW - 1_000,
    expires_at: NOW + 3_600_000,
    ttl_seconds: 3_600,
    hits: 12,
    hit_limit: 1_000,
    ...overrides,
  };
}

function makeEnv(post: Record<string, unknown> | null) {
  const calls: { sql: string; args: unknown[] }[] = [];

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return sql.includes("FROM posts") ? post : null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              calls.push({ sql, args });
              return { success: true };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };

  const env = {
    DB,
    BLOBS: { async delete() {} },
    SITE_NAME: "share",
    TTL_PRESETS: JSON.stringify([
      { label: "1 hour", seconds: 3600 },
      { label: "7 days", seconds: 604800 },
    ]),
    DEFAULT_TTL_SECONDS: "86400",
  } as unknown as Env;

  return { env, calls };
}

describe("handleManage", () => {
  it("shows request usage and the reset controls", async () => {
    const { env } = makeEnv(makePost());
    const response = await handleManage(
      new Request("https://example.com/m/sharet"),
      env,
      "sharet",
      "owner@example.com",
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("12 of 1,000 requests used");
    expect(body).toContain('id="reset-ttl"');
    expect(body).toContain('value="3600" selected');
    expect(body).toContain('id="reset"');
  });

  it("refuses another account", async () => {
    const { env } = makeEnv(makePost());
    const response = await handleManage(
      new Request("https://example.com/m/sharet"),
      env,
      "sharet",
      "other@example.com",
    );
    expect(response.status).toBe(403);
  });
});

describe("handleResetShare", () => {
  it("clears the counter and restarts the countdown", async () => {
    const { env, calls } = makeEnv(makePost());
    const response = await handleResetShare(
      new Request("https://example.com/api/posts/sharet/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttl: 604800 }),
      }),
      env,
      "sharet",
      "owner@example.com",
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      hits: number;
      ttlSeconds: number;
      hitLimit: number;
    };
    expect(payload.hits).toBe(0);
    expect(payload.ttlSeconds).toBe(604800);
    expect(payload.hitLimit).toBe(1_000);

    const update = calls.find((call) => call.sql.includes("UPDATE posts SET hits = 0"));
    expect(update).toBeDefined();
    expect(update!.args[0]).toBe(604800);
    expect(update!.args[2]).toBe("sharet");
  });

  it("rejects a ttl that is not a preset", async () => {
    const { env } = makeEnv(makePost());
    const response = await handleResetShare(
      new Request("https://example.com/api/posts/sharet/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttl: 12345 }),
      }),
      env,
      "sharet",
      "owner@example.com",
    );
    expect(response.status).toBe(400);
  });
});
