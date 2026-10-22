import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";
import { loadEnv } from "./env.js";
import { StoreError } from "./store.js";

const SESSION = "raffle_session";
const STATE = "raffle_state";
const VERIFIER = "raffle_verifier";
const NEXT = "raffle_next";

let storePromise;

export function getStore() {
  if (!storePromise) {
    loadEnv();
    storePromise = openStore();
  }
  return storePromise;
}

async function openStore() {
  const { resolveNetlifyStore } = await import("./blobs.js");
  const blobs = resolveNetlifyStore();
  if (blobs) {
    const { createBlobStore } = await import("./blob-store.js");
    return createBlobStore(blobs);
  }
  const { createStore } = await import("./store.js");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  return createStore(path.join(root, "data", "raffle.db"));
}

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || "raffle-dev-session";
}

function signSession(user) {
  const body = Buffer.from(
    JSON.stringify({
      sub: user.sub,
      email: user.email,
      name: user.name,
      picture: user.picture || "",
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }),
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const user = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!user?.sub || !user?.email || Number(user.exp) < Date.now()) return null;
    return {
      sub: user.sub,
      email: user.email,
      name: user.name || user.email,
      picture: user.picture || "",
    };
  } catch {
    return null;
  }
}

function json(status, body, cookies = []) {
  return { status, json: body, cookies };
}

function redirect(location, cookies = []) {
  return { status: 302, location, cookies };
}

function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function writeCookie(name, value, { secure, maxAge }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function secureOrigin(origin) {
  return origin.startsWith("https:");
}

function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.slice(0, 200);
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function clearOauth(secure) {
  return [STATE, VERIFIER, NEXT].map((name) => writeCookie(name, "", { secure, maxAge: 0 }));
}

function userFrom(headers) {
  return readSession(readCookie(headers.cookie, SESSION));
}

function pinFrom(headers, body) {
  return headers["x-host-pin"] || body?.pin || "";
}

function route(path) {
  if (path === "/api/auth/google") return { name: "auth-google" };
  if (path === "/api/auth/callback") return { name: "auth-callback" };
  if (path === "/api/auth/logout") return { name: "auth-logout" };
  if (path === "/api/auth/me") return { name: "auth-me" };
  if (path === "/api/me/rooms") return { name: "my-rooms" };
  if (path === "/api/rooms") return { name: "rooms" };
  const room = path.match(
    /^\/api\/rooms\/([A-Za-z0-9]{4})(?:\/(host|join|draw|redraw|lock|prize|reveal|import))?$/,
  );
  if (room) return { name: "room", code: room[1].toUpperCase(), action: room[2] || "" };
  return null;
}

async function run(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StoreError) return json(err.status, { error: err.message });
    console.error(err);
    return json(500, { error: "Something went wrong." });
  }
}

export async function dispatch(request) {
  let store;
  try {
    store = await getStore();
  } catch (err) {
    console.error(err);
    return json(500, { error: err.expose || "Something went wrong." });
  }
  const method = request.method.toUpperCase();
  const path = request.path.replace(/\/+$/, "") || "/";
  const matched = route(path);
  const headers = request.headers || {};
  const body = request.body || {};
  const query = request.query || {};
  const origin = request.origin;
  const secure = secureOrigin(origin);
  if (!matched) return json(404, { error: "That page isn’t here." });

  const user = userFrom(headers);

  if (matched.name === "auth-me" && method === "GET") {
    return json(200, { user });
  }

  if (matched.name === "auth-logout" && method === "POST") {
    return json(200, { ok: true }, [writeCookie(SESSION, "", { secure, maxAge: 0 })]);
  }

  if (matched.name === "auth-google" && method === "GET") {
    if (!googleConfigured()) return redirect("/?auth=config");
    const state = base64url(crypto.randomBytes(16));
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    const redirectUri = `${origin}/api/auth/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return redirect(url.toString(), [
      writeCookie(STATE, state, { secure, maxAge: 600 }),
      writeCookie(VERIFIER, verifier, { secure, maxAge: 600 }),
      writeCookie(NEXT, safeNext(query.next), { secure, maxAge: 600 }),
    ]);
  }

  if (matched.name === "auth-callback" && method === "GET") {
    const next = safeNext(readCookie(headers.cookie, NEXT));
    const failed = redirect(`/?auth=error`, clearOauth(secure));
    if (!googleConfigured() || query.error) return failed;
    const state = readCookie(headers.cookie, STATE);
    const verifier = readCookie(headers.cookie, VERIFIER);
    if (!query.code || !state || state !== query.state || !verifier) return failed;
    try {
      const redirectUri = `${origin}/api/auth/callback`;
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: query.code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        }),
      });
      const token = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !token.id_token) return failed;
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: token.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const profile = ticket.getPayload() || {};
      if (!profile.sub || !profile.email) return failed;
      const session = signSession({
        sub: profile.sub,
        email: profile.email,
        name: profile.name || profile.email,
        picture: profile.picture,
      });
      return redirect(next, [
        ...clearOauth(secure),
        writeCookie(SESSION, session, { secure, maxAge: 60 * 60 * 24 * 30 }),
      ]);
    } catch (err) {
      console.error(err);
      return failed;
    }
  }

  if (matched.name === "my-rooms" && method === "GET") {
    if (!user) return json(401, { error: "Sign in with Google." });
    return run(async () => json(200, { rooms: await store.roomsForUser(user.sub) }));
  }

  if (matched.name === "rooms" && method === "POST") {
    if (!user) return json(401, { error: "Sign in with Google to save this room." });
    return run(async () => {
      const room = await store.createRoom({ ...body, ownerSub: user.sub });
      return json(201, room);
    });
  }

  if (matched.name === "room" && !matched.action && method === "GET") {
    return run(async () => json(200, await store.publicRoom(matched.code)));
  }

  if (matched.name === "room" && matched.action === "host" && method === "GET") {
    return run(async () => json(200, await store.hostRoom(matched.code, pinFrom(headers, body), user?.sub)));
  }

  if (matched.name === "room" && matched.action === "join" && method === "POST") {
    return run(async () => json(201, await store.join(matched.code, body)));
  }

  if (matched.name === "room" && matched.action === "draw" && method === "POST") {
    return run(async () =>
      json(200, await store.draw(matched.code, pinFrom(headers, body), body.reveal, user?.sub)),
    );
  }

  if (matched.name === "room" && matched.action === "redraw" && method === "POST") {
    return run(async () =>
      json(200, await store.redraw(matched.code, pinFrom(headers, body), body.reveal, user?.sub)),
    );
  }

  if (matched.name === "room" && matched.action === "lock" && method === "POST") {
    return run(async () =>
      json(200, await store.lock(matched.code, pinFrom(headers, body), Boolean(body.locked), user?.sub)),
    );
  }

  if (matched.name === "room" && matched.action === "prize" && method === "POST") {
    return run(async () =>
      json(200, await store.updatePrize(matched.code, pinFrom(headers, body), body.prize, user?.sub)),
    );
  }

  if (matched.name === "room" && matched.action === "reveal" && method === "POST") {
    return run(async () =>
      json(200, await store.updateReveal(matched.code, pinFrom(headers, body), body.reveal, user?.sub)),
    );
  }

  if (matched.name === "room" && matched.action === "import" && method === "POST") {
    return run(async () =>
      json(200, await store.importCsv(matched.code, pinFrom(headers, body), body.csv || "", user?.sub)),
    );
  }

  return json(404, { error: "That page isn’t here." });
}
