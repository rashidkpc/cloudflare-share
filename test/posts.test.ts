import { describe, expect, it } from "vitest";
import { sweepExpired } from "../src/lib/posts";

type ImageRow = { r2_key: string; display_key: string | null };

function makeFakeEnv(postPages: string[][], imagesByPost: Record<string, ImageRow[]>) {
  const queue = [...postPages];
  const deletedKeys: string[] = [];
  const deleteCalls: string[][] = [];
  const batches: string[][] = [];

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            __sql: sql,
            async all() {
              if (sql.includes("FROM posts")) {
                const ids = queue.shift() ?? [];
                return { results: ids.map((id) => ({ id })) };
              }
              if (sql.includes("FROM assets")) {
                const ids = args as string[];
                return { results: ids.flatMap((id) => imagesByPost[id] ?? []) };
              }
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ __sql: string }>) {
      batches.push(statements.map((s) => (s.__sql.includes("FROM assets") || s.__sql.includes("images") ? "images" : "posts")));
      return [];
    },
  };

  const BLOBS = {
    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      deleteCalls.push(list);
      deletedKeys.push(...list);
    },
  };

  return {
    env: { DB, BLOBS } as unknown as Parameters<typeof sweepExpired>[0],
    deletedKeys,
    deleteCalls,
    batches,
  };
}

function posts(count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, index) => `p${offset + index}`);
}

function imagesFor(ids: string[]): Record<string, ImageRow[]> {
  const map: Record<string, ImageRow[]> = {};
  for (const id of ids) {
    map[id] = [
      { r2_key: `p/${id}/a`, display_key: `p/${id}/a.webp` },
      { r2_key: `p/${id}/b`, display_key: null },
    ];
  }
  return map;
}

describe("sweepExpired", () => {
  it("does nothing when nothing has expired", async () => {
    const { env, deletedKeys, batches } = makeFakeEnv([[]], {});
    expect(await sweepExpired(env, 1000)).toBe(0);
    expect(deletedKeys).toEqual([]);
    expect(batches).toEqual([]);
  });

  it("deletes every object of a share, originals and derivatives", async () => {
    const { env, deletedKeys, batches } = makeFakeEnv(
      [["p1"], []],
      imagesFor(["p1"]),
    );
    expect(await sweepExpired(env, 1000)).toBe(1);
    expect(deletedKeys.sort()).toEqual(["p/p1/a", "p/p1/a.webp", "p/p1/b"]);
    expect(batches).toEqual([["images", "posts"]]);
  });

  it("sweeps several shares in one batch", async () => {
    const ids = ["p0", "p1", "p2"];
    const { env, deletedKeys } = makeFakeEnv([ids, []], imagesFor(ids));
    expect(await sweepExpired(env, 1000)).toBe(3);
    expect(deletedKeys).toHaveLength(9);
    expect(deletedKeys).toContain("p/p2/a.webp");
  });

  it("chunks R2 deletes at the 900-key limit within a group", async () => {
    const ids = posts(100);
    const map: Record<string, ImageRow[]> = {};
    for (const id of ids) {
      map[id] = Array.from({ length: 10 }, (_, index) => ({
        r2_key: `p/${id}/${index}`,
        display_key: `p/${id}/${index}.webp`,
      }));
    }

    const { env, deletedKeys, deleteCalls } = makeFakeEnv([ids, []], map);
    expect(await sweepExpired(env, 1000)).toBe(100);
    expect(deletedKeys).toHaveLength(2000);
    expect(deleteCalls.map((call) => call.length)).toEqual([900, 900, 200]);
  });

  it("keeps going while full pages come back, capped at 20 rounds", async () => {
    const pages = Array.from({ length: 50 }, (_, round) => posts(500, round * 500));
    const { env } = makeFakeEnv(pages, {});
    expect(await sweepExpired(env, 1000)).toBe(500 * 20);
  });
});
