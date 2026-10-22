import { dispatch } from "../../server/api.js";

const PATHS = [
  "/api/auth/google",
  "/api/auth/callback",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/me/rooms",
  "/api/invites/:token",
  "/api/invites/:token/accept",
  "/api/rooms",
  "/api/rooms/:code",
  "/api/rooms/:code/:action",
];

function apiPath(url) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const marker = "/.netlify/functions/api";
  if (!pathname.startsWith(marker)) return pathname;
  const rest = pathname.slice(marker.length) || "/";
  return rest.startsWith("/api") ? rest : `/api${rest.startsWith("/") ? rest : `/${rest}`}`;
}

function send(result) {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of result.cookies || []) headers.append("set-cookie", cookie);
  if (result.location) {
    headers.set("location", result.location);
    return new Response(null, { status: result.status, headers });
  }
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(result.json ?? {}), { status: result.status, headers });
}

export default async (request) => {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    const raw = await request.text();
    if (raw.length > 2_000_000) {
      return send({ status: 413, json: { error: "That request is too large." } });
    }
    let body = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send({ status: 400, json: { error: "That request could not be read." } });
      }
    }
    return send(
      await dispatch({
        method: request.method,
        path: apiPath(url),
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(request.headers),
        body,
        origin: url.origin,
      }),
    );
  }
  return send(
    await dispatch({
      method: request.method,
      path: apiPath(url),
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(request.headers),
      body: {},
      origin: url.origin,
    }),
  );
};

export const config = { path: PATHS };
