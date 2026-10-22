import assert from "node:assert/strict";
import test from "node:test";
import { createBlobStore } from "./blob-store.js";

function memoryBlobs() {
  const map = new Map();
  let sequence = 0;
  return {
    async get(key) {
      const row = map.get(key);
      return row ? structuredClone(row.data) : null;
    },
    async getWithMetadata(key) {
      const row = map.get(key);
      if (!row) return null;
      return { data: structuredClone(row.data), etag: row.etag, metadata: {} };
    },
    async setJSON(key, data, options = {}) {
      const row = map.get(key);
      if (options.onlyIfNew && row) return { modified: false };
      if (options.onlyIfMatch && (!row || row.etag !== options.onlyIfMatch)) return { modified: false };
      const etag = String(++sequence);
      map.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
    async list({ prefix }) {
      return {
        blobs: [...map.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key, etag: map.get(key).etag })),
      };
    },
  };
}

test("blobs save a room on the google account and still accept the pin", async () => {
  const store = createBlobStore(memoryBlobs());
  const room = await store.createRoom({
    title: "Friday meetup",
    prize: "T-shirt",
    style: "meetup",
    ownerSub: "google-sub",
  });
  await store.join(room.code, { name: "Priya Shah", token: "token-token-token-0" });
  const draw = await store.draw(room.code, "", "wheel", "google-sub");
  assert.equal(draw.name, "Priya Shah");
  const saved = await store.roomsForUser("google-sub");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].code, room.code);
  assert.equal(saved[0].latestName, "Priya Shah");
  assert.equal((await store.roomsForUser("someone-else")).length, 0);
  const again = await store.draw(room.code, room.pin, "instant", "someone-else");
  assert.equal(again.eligibleCount, 1);
  await assert.rejects(() => store.hostRoom(room.code, "NOPE00", "someone-else"), /Wrong pin/);
});
