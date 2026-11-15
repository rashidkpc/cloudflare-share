import { describe, expect, it } from "vitest";
import { sanitizeFilename, sniffImage } from "../src/lib/images";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

describe("sniffImage", () => {
  it("detects png", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toEqual({
      mime: "image/png",
      ext: "png",
    });
  });

  it("detects jpeg", () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
    });
  });

  it("detects gif", () => {
    expect(sniffImage(bytes(...ascii("GIF89a"), 0, 0, 0, 0, 0, 0))).toEqual({
      mime: "image/gif",
      ext: "gif",
    });
    expect(sniffImage(bytes(...ascii("GIF87a"), 0, 0, 0, 0, 0, 0))).toEqual({
      mime: "image/gif",
      ext: "gif",
    });
  });

  it("detects webp", () => {
    expect(sniffImage(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toEqual({
      mime: "image/webp",
      ext: "webp",
    });
  });

  it("detects avif", () => {
    expect(sniffImage(bytes(0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii("avif")))).toEqual({
      mime: "image/avif",
      ext: "avif",
    });
  });

  it("rejects everything else", () => {
    expect(sniffImage(bytes(...ascii("<svg xmlns="), 0, 0))).toBeNull();
    expect(sniffImage(bytes(...ascii("hello world!")))).toBeNull();
    expect(sniffImage(new Uint8Array(4))).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("strips path traversal and separators", () => {
    expect(sanitizeFilename("../../etc/pass wd.png", "png")).toBe("pass-wd.png");
    expect(sanitizeFilename("C:\\photos\\cat.jpg", "jpg")).toBe("cat.jpg");
  });

  it("removes header-hostile characters", () => {
    expect(sanitizeFilename('bad"name\r\n.png', "png")).toBe("badname.png");
  });

  it("falls back for empty input", () => {
    expect(sanitizeFilename("", "webp")).toBe("image.webp");
    expect(sanitizeFilename("   ", "webp")).toBe("image.webp");
  });

  it("caps the length", () => {
    expect(sanitizeFilename("a".repeat(200) + ".png", "png").length).toBe(80);
  });
});
