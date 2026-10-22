import { getStore } from "@netlify/blobs";

export const STORE_NAME = "raffle-rooms";

// Missing keys on signed blob URLs can come back as 403 and make the client
// retry for a long time. Treat those as a miss, same as Meridian.
export const fastBlobsFetch = async (input, init) => {
  try {
    const res = await fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(5000),
    });
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (!url.includes("api.netlify.com") && res.status === 403 && method === "GET") {
      return new Response(null, { status: 404, headers: res.headers });
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      return new Response(res.body, { status: 400, headers: res.headers });
    }
    return res;
  } catch {
    return new Response(null, { status: 400 });
  }
};

export function resolveNetlifyStore() {
  try {
    const hasAutoContext =
      Boolean(process.env.NETLIFY_BLOBS_CONTEXT) || Boolean(globalThis.netlifyBlobsContext);
    if (hasAutoContext) {
      return getStore({ name: STORE_NAME, consistency: "strong", fetch: fastBlobsFetch });
    }
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (siteID && token) {
      return getStore({
        name: STORE_NAME,
        siteID,
        token,
        consistency: "strong",
        fetch: fastBlobsFetch,
      });
    }
  } catch {
    return null;
  }
  return null;
}
