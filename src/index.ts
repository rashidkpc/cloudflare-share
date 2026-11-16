import { accessIdentity, hasAccessSession } from "./lib/auth";
import { escapeHtml, html, text } from "./lib/http";
import { isLimitedRead } from "./lib/limits";
import { sweepExpired } from "./lib/posts";
import { loadPresets, resolveTtl } from "./lib/ttl";
import { loadRequestPresets, resolveRequestLimit } from "./lib/requests";
import {
  handleAddAssets,
  handleDeleteAsset,
  handleReorder,
  handleResetShare,
  handleUpdateTitle,
  handleUpload,
} from "./routes/upload";
import { handleDelete, handleFile, handleImage, handleManage, handleViewer } from "./routes/pages";
import { appJs, displayFont, indexHtml, manageJs, styleCss, uiVersion, viewJs } from "./ui/assets";

const STATIC_HEADERS = {
  "cache-control": "public, max-age=300",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};

let fontCache: Uint8Array | null = null;

function fontBytes(): Uint8Array {
  if (!fontCache) {
    const binary = atob(displayFont);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    fontCache = bytes;
  }
  return fontCache;
}

function needsAuth(pathname: string): boolean {
  // Access protects /upload and /api/upload at the edge; this is the fail-closed
  // check for when a path is missing from the Access application.
  return pathname === "/api/upload";
}

function renderUploadPage(env: Env): Response {
  const presets = loadPresets(env.TTL_PRESETS);
  const fallbackDefault = Number(env.DEFAULT_TTL_SECONDS) || 86400;
  const resolved = resolveTtl(presets, null, fallbackDefault);
  const defaultTtlSeconds = resolved.ok ? resolved.ttl.seconds : presets[0]!.seconds;

  const requestPresets = loadRequestPresets(env.SHARE_REQUEST_PRESETS);
  const requestDefault = resolveRequestLimit(
    requestPresets,
    null,
    Number(env.DEFAULT_SHARE_REQUESTS) || 1000,
  );

  const config = {
    presets,
    defaultTtlSeconds,
    requestPresets,
    defaultRequestLimit: requestDefault.ok ? requestDefault.preset.requests : 1000,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES) || 20 * 1024 * 1024,
    maxAssets: Number(env.MAX_ASSETS ?? env.MAX_IMAGES) || 20,
    maxTotalBytes: Number(env.MAX_TOTAL_BYTES) || 50 * 1024 * 1024,
    siteName: env.SITE_NAME,
  };

  const page = indexHtml
    .replaceAll("__SITE_NAME__", escapeHtml(env.SITE_NAME))
    .replaceAll("__VERSION__", uiVersion)
    .replace("__CONFIG__", escapeHtml(JSON.stringify(config)));

  return html(page);
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="8" fill="#14161b"/>
<circle cx="16" cy="17" r="8" fill="none" stroke="#39415a" stroke-width="2.5"/>
<path d="M16 11.5V17l4 2.5" fill="none" stroke="#5b8cff" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

/**
 * The root is deliberately a dead end: the uploader lives at /upload and
 * nothing links to it.
 */
function renderNothingPage(): Response {
  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Nothing to see here</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${uiVersion}">
</head>
<body>
<main class="center-page">
  <div>
    <h1 class="gone-title">Nothing to see here</h1>
    <a class="login-link" href="/upload">Login</a>
  </div>
</main>
</body>
</html>`);
}

function notFoundPage(env: Env): Response {
  return html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Not found — ${escapeHtml(env.SITE_NAME)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${uiVersion}"></head>
<body><main class="wrap"><h1 class="gone-title">Nothing here</h1>
<p class="muted">Try the upload page at <a href="/">/</a>.</p></main></body></html>`,
    404,
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      if (pathname === "/robots.txt") {
        return text("User-agent: *\nDisallow: /\n", 200, {
          "cache-control": "public, max-age=3600",
          "x-robots-tag": "noindex, nofollow",
        });
      }

      if (pathname === "/healthz") {
        return text("ok");
      }

      if (method === "GET" || method === "HEAD") {
        if (pathname === "/style.css") {
          return new Response(styleCss, {
            headers: { ...STATIC_HEADERS, "content-type": "text/css; charset=utf-8" },
          });
        }
        if (pathname === "/app.js") {
          return new Response(appJs, {
            headers: { ...STATIC_HEADERS, "content-type": "text/javascript; charset=utf-8" },
          });
        }
        if (pathname === "/view.js") {
          return new Response(viewJs, {
            headers: { ...STATIC_HEADERS, "content-type": "text/javascript; charset=utf-8" },
          });
        }
        if (pathname === "/manage.js") {
          return new Response(manageJs, {
            headers: { ...STATIC_HEADERS, "content-type": "text/javascript; charset=utf-8" },
          });
        }
        if (pathname === "/favicon.svg") {
          return new Response(FAVICON, {
            headers: {
              "content-type": "image/svg+xml",
              "cache-control": "public, max-age=86400",
              "x-content-type-options": "nosniff",
            },
          });
        }
        if (pathname === "/font.woff2") {
          return new Response(fontBytes(), {
            headers: {
              "content-type": "font/woff2",
              "cache-control": "public, max-age=31536000, immutable",
            },
          });
        }
      }

      // Burst control on the public read paths. Limits are per location and
      // approximate; the per-share request budget is the hard cost bound.
      if ((method === "GET" || method === "HEAD") && isLimitedRead(pathname)) {
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        const [byIp, global] = await Promise.all([
          env.READ_PER_IP.limit({ key: ip }),
          env.READ_GLOBAL.limit({ key: "global" }),
        ]);
        if (!byIp.success || !global.success) {
          return text("Too many requests", 429, { "retry-after": "60" });
        }
      }

      // The root is a dead end unless an Access session already exists.
      if (pathname === "/") {
        if (method !== "GET" && method !== "HEAD") {
          return text("Method not allowed", 405, { allow: "GET, HEAD" });
        }
        if (hasAccessSession(request)) {
          return new Response(null, {
            status: 302,
            headers: { location: "/upload", "cache-control": "no-store" },
          });
        }
        return renderNothingPage();
      }

      if (pathname === "/upload") {
        if (method !== "GET" && method !== "HEAD") {
          return text("Method not allowed", 405, { allow: "GET, HEAD" });
        }
        if (!(await accessIdentity(ctx))) {
          return text("Cloudflare Access is required", 403);
        }
        return renderUploadPage(env);
      }

      if (needsAuth(pathname)) {
        if (method !== "POST") {
          return text("Method not allowed", 405, { allow: "POST" });
        }
        const email = await accessIdentity(ctx);
        if (!email) return text("Cloudflare Access is required", 403);
        return handleUpload(request, env, ctx, email);
      }

      // Edits: the Access identity must also own the share.
      if (pathname.startsWith("/api/posts/")) {
        const rest = pathname.slice("/api/posts/".length);
        const [postId, action, assetId] = rest.split("/");
        if (!postId) return text("Not found", 404);

        const email = await accessIdentity(ctx);

        if (!action) {
          if (method === "DELETE") {
            return handleDelete(env, postId, email);
          }
          if (method === "PATCH") {
            return handleUpdateTitle(request, env, postId, email);
          }
          return text("Method not allowed", 405, { allow: "DELETE, PATCH" });
        }

        if (action === "reset") {
          if (method !== "POST") {
            return text("Method not allowed", 405, { allow: "POST" });
          }
          return handleResetShare(request, env, postId, email);
        }

        if (action === "images" || action === "assets") {
          if (assetId) {
            if (method !== "DELETE") {
              return text("Method not allowed", 405, { allow: "DELETE" });
            }
            return handleDeleteAsset(request, env, postId, assetId, email);
          }
          if (method !== "POST") {
            return text("Method not allowed", 405, { allow: "POST" });
          }
          return handleAddAssets(request, env, ctx, postId, email);
        }

        if (action === "order") {
          if (method !== "PATCH") {
            return text("Method not allowed", 405, { allow: "PATCH" });
          }
          return handleReorder(request, env, postId, email);
        }

        return text("Not found", 404);
      }

      if (pathname.startsWith("/m/")) {
        if (method !== "GET" && method !== "HEAD") {
          return text("Method not allowed", 405, { allow: "GET, HEAD" });
        }
        const id = pathname.slice(3);
        if (!id) return notFoundPage(env);
        const email = await accessIdentity(ctx);
        return handleManage(request, env, id, email);
      }

      if (pathname.startsWith("/i/")) {
        if (method !== "GET" && method !== "HEAD") {
          return text("Method not allowed", 405, { allow: "GET, HEAD" });
        }
        const id = pathname.slice(3);
        if (!id) return notFoundPage(env);
        return handleViewer(request, env, ctx, id);
      }

      if (pathname.startsWith("/f/")) {
        if (method !== "GET" && method !== "HEAD") {
          return text("Method not allowed", 405, { allow: "GET, HEAD" });
        }
        const id = pathname.slice(3).split("/")[0] ?? "";
        if (!id) return text("Not found", 404);
        return handleFile(request, env, ctx, id);
      }

      if (
        pathname.startsWith("/img/") ||
        pathname.startsWith("/raw/") ||
        pathname.startsWith("/t/")
      ) {
        if (method !== "GET" && method !== "HEAD") {
          return text("Method not allowed", 405, { allow: "GET, HEAD" });
        }
        const mode = pathname.startsWith("/raw/")
          ? "raw"
          : pathname.startsWith("/t/")
            ? "thumb"
            : "display";
        // /img/:imageId/:filename — the filename is cosmetic.
        const id = pathname.slice(mode === "thumb" ? 3 : 5).split("/")[0] ?? "";
        if (!id) return text("Not found", 404);
        return handleImage(request, env, ctx, id, mode);
      }

      return notFoundPage(env);
    } catch (error) {
      console.error("unhandled error", error);
      return text("Internal error", 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deleted = await sweepExpired(env);
    console.log(`sweep: removed ${deleted} expired post(s)`);
  },
} satisfies ExportedHandler<Env>;
