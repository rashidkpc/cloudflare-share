import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { hasAccessSession } from "../src/lib/auth";

function request(cookie?: string): Request {
  return new Request("https://example.com/", cookie ? { headers: { cookie } } : undefined);
}

describe("hasAccessSession", () => {
  it("is false without a cookie header", () => {
    expect(hasAccessSession(request())).toBe(false);
  });

  it("detects the Access cookie alone", () => {
    expect(hasAccessSession(request("CF_Authorization=abc"))).toBe(true);
  });

  it("detects it among other cookies", () => {
    expect(hasAccessSession(request("a=1; CF_Authorization=abc; b=2"))).toBe(true);
  });

  it("ignores lookalike cookie names", () => {
    expect(hasAccessSession(request("XCF_Authorization=abc"))).toBe(false);
    expect(hasAccessSession(request("CF_Authorization_extra=abc"))).toBe(false);
  });
});

describe("GET /", () => {
  it("redirects to the uploader when an Access session exists", async () => {
    const response = await worker.fetch(
      request("CF_Authorization=abc"),
      {} as Env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/upload");
  });

  it("stays a dead end without a session", async () => {
    const response = await worker.fetch(request(), {} as Env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Nothing to see here");
  });
});
