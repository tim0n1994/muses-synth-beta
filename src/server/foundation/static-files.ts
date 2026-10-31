import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

import type { RuntimeConfig } from "./config.js";
import { MusesHttpError } from "./errors.js";
import {
  LOCAL_V07_ACCESS_POLICY,
  type V07AccessPolicy,
} from "./feature-flags.js";

function acceptsHtml(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(",") : header;
  // Preserve the existing non-API page fallback: text/html, */*, or an
  // Accept value without application/json may receive the SPA shell.
  if (value === undefined || value === "") return true;
  return (
    value.includes("text/html") ||
    value.includes("*/*") ||
    !value.includes("application/json")
  );
}

function isApiPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  return path === "/api" || path.startsWith("/api/");
}

function isAssetPath(url: string): boolean {
  const raw = url.split("?", 1)[0] ?? url;
  try {
    const path = decodeURIComponent(raw);
    return path === "/assets" || path.startsWith("/assets/");
  } catch {
    return true;
  }
}

/**
 * The client-router feature hint for the v0.7 surfaces (Round-1 review B2):
 * the SPA must not mount /self-track, /signature or /replay unless the
 * server says the switches are on, otherwise a flag-off deployment answers
 * those URLs with an error page where v0.6 answered the foundation status
 * page. The hint is a <meta name="muses-features"> tag injected into the
 * HTML shell ONLY while any v0.7 feature is enabled AND the requester is
 * admitted by the v0.7 access policy (Round-2: per-user allowlist — an
 * anonymous visitor or an account outside MUSES_V07_USERS receives the
 * untouched shell, exactly like a flag-off process). A flag-off process
 * keeps serving the file untouched via sendFile — byte-identical HTML and
 * the same etag/cache headers as v0.6 (V11: switch off = v0.6 behavior,
 * including the client surface).
 */
const featureHintMeta = (features: {
  selfTrack: boolean;
  replay: boolean;
}): string =>
  // A <meta> tag, not an inline script: the foundation CSP pins
  // script-src 'self', which would block any injected inline script (found
  // by the flag-on e2e arm). Meta tags are outside script-src's reach, and
  // the JSON payload (boolean fields only) needs no attribute escaping
  // inside single quotes.
  `<meta name="muses-features" content='${JSON.stringify(features)}'>`;

const injectFeatureHint = (
  html: string,
  features: { selfTrack: boolean; replay: boolean },
): string => {
  const injection = featureHintMeta(features);
  if (html.includes("</head>")) {
    return html.replace("</head>", `${injection}</head>`);
  }
  return `${html}${injection}`;
};

export async function registerStaticFiles(
  app: FastifyInstance,
  config: RuntimeConfig,
  v07Access: V07AccessPolicy = LOCAL_V07_ACCESS_POLICY,
): Promise<boolean> {
  if (!config.serveStatic) {
    return false;
  }

  const root = resolve(config.staticRoot);
  const indexFile = resolve(root, "index.html");
  try {
    await access(indexFile);
  } catch {
    throw new MusesHttpError({
      code: "STATIC_BUILD_MISSING",
      expose: false,
      message: `Static production build is missing at ${indexFile}`,
      statusCode: 500,
    });
  }

  // Pre-render the injected shell once at registration time while any v0.7
  // feature is on; null keeps the untouched sendFile path below. Whether a
  // given request receives it is decided per request by the access policy
  // (request.user is resolved by the bearer gate, also on non-API paths).
  let injectedShell: string | null = null;
  if (config.v07Features.selfTrack || config.v07Features.replay) {
    injectedShell = injectFeatureHint(
      await readFile(indexFile, "utf8"),
      config.v07Features,
    );
  }

  await app.register(fastifyStatic, {
    index: false,
    root,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === "GET" &&
      !isApiPath(request.url) &&
      !isAssetPath(request.url) &&
      acceptsHtml(request.headers.accept)
    ) {
      if (injectedShell !== null && v07Access.allows(request.user?.id)) {
        return reply
          .type("text/html; charset=utf-8")
          .header("cache-control", "no-cache")
          .send(injectedShell);
      }
      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }

    throw new MusesHttpError({
      code: "NOT_FOUND",
      message: "Route not found",
      statusCode: 404,
    });
  });

  return true;
}
