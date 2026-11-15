export interface ImageType {
  mime: string;
  ext: string;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

/**
 * Detect the image type from the bytes rather than trusting Content-Type.
 * Only formats a browser can render inline are accepted.
 */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;

  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return { mime: "image/png", ext: "png" };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  const head = ascii(bytes, 0, 6);
  if (head === "GIF87a" || head === "GIF89a") {
    return { mime: "image/gif", ext: "gif" };
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }

  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") {
      return { mime: "image/avif", ext: "avif" };
    }
  }

  return null;
}

/** Strip anything that could confuse a filename, a header, or a URL path. */
export function sanitizeFilename(name: string, fallbackExt: string): string {  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["'<>\r\n]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (!cleaned) return `image.${fallbackExt}`;
  return cleaned;
}

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Read dimensions straight from the file headers. Cheap CPU only — used to
 * avoid an Images binding round-trip (and the Free plan's 10 ms CPU budget).
 */
export function imageDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null;

  // PNG: IHDR width/height are big-endian at 16 and 20.
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      width: readUint32BE(bytes, 16),
      height: readUint32BE(bytes, 20),
    };
  }

  // GIF: little-endian at 6 and 8.
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") {
    return {
      width: bytes[6]! | (bytes[7]! << 8),
      height: bytes[8]! | (bytes[9]! << 8),
    };
  }

  // JPEG: walk the segments until a Start Of Frame.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        return {
          height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
          width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
        };
      }
      offset += 2 + length;
    }
    return null;
  }

  // WebP: VP8 (lossy), VP8L (lossless), VP8X (extended).
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8 ") {
      return {
        width: readUint16LE(bytes, 26) & 0x3fff,
        height: readUint16LE(bytes, 28) & 0x3fff,
      };
    }
    if (chunk === "VP8L") {
      const bits =
        bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === "VP8X") {
      return {
        width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
        height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
      };
    }
  }

  return null;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}
