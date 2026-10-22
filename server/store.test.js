import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "./store.js";

async function roomWith(store, names, style = "meetup") {
  const room = await store.createRoom({ title: "Friday meetup", prize: "T-shirt", style });
  for (const [index, name] of names.entries()) {
    await store.join(room.code, { name, token: `token-token-token-${index}` });
  }
  return room;
}

test("create, join, draw, and exclude", async () => {
  const store = await createStore(":memory:");
  const room = await roomWith(store, ["Priya Shah", "Kenji Mori", "Ada Okonkwo"]);
  assert.equal(room.code.length, 4);
  assert.equal(room.pin.length, 6);
  assert.equal((await store.publicRoom(room.code)).count, 3);
  assert.equal(JSON.stringify(await store.publicRoom(room.code)).includes(room.pin), false);

  const again = await store.join(room.code, { name: "Priya S.", token: "token-token-token-0" });
  assert.equal((await store.publicRoom(room.code)).count, 3);
  assert.equal(again.name, "Priya S.");

  const first = await store.draw(room.code, room.pin, "wheel");
  assert.equal(first.eligibleCount, 3);
  assert.equal(["Priya S.", "Kenji Mori", "Ada Okonkwo"].includes(first.name), true);

  const second = await store.redraw(room.code, room.pin, "odometer");
  const third = await store.redraw(room.code, room.pin, "instant");
  const winners = [first.name, second.name, third.name];
  assert.equal(new Set(winners).size, 3);
  await assert.rejects(() => store.redraw(room.code, room.pin, "wheel"), /last person/);
  await store.close();
});

test("wrong pin and a closed room", async () => {
  const store = await createStore(":memory:");
  const room = await roomWith(store, ["Mei Chen"]);
  await assert.rejects(() => store.draw(room.code, "NOPE00", "wheel"), /Wrong pin/);
  await store.lock(room.code, room.pin, true);
  await assert.rejects(
    () => store.join(room.code, { name: "Noah Adeyemi", token: "another-token-0001" }),
    /closed/,
  );
  const back = await store.join(room.code, { name: "Mei Chen", token: "token-token-token-0" });
  assert.equal(back.name, "Mei Chen");
  await store.close();
});

test("check-in import keeps checked-in rows and skips duplicates", async () => {
  const store = await createStore(":memory:");
  const room = await roomWith(store, ["Ada Okonkwo"]);
  const csv = [
    "Name,Email,Checked In",
    "Ada Okonkwo,ada@example.com,Yes",
    "Luis Ortega,luis@example.com,No",
    "Mei Chen,mei@example.com,true",
    "Jonah Berg,jonah@example.com,Yes",
  ].join("\n");
  const imported = await store.importCsv(room.code, room.pin, csv);
  assert.equal(imported.added, 2);
  assert.equal(imported.unchecked, 1);
  assert.equal(imported.duplicates, 1);
  assert.equal(imported.count, 3);

  await assert.rejects(
    () => store.importCsv(room.code, room.pin, "Name,Email\nAda,ada@example.com\n"),
    /Checked In/,
  );
  await store.close();
});

test("unknown code", async () => {
  const store = await createStore(":memory:");
  await assert.rejects(() => store.publicRoom("ZZZZ"), /doesn't match/);
  await store.close();
});

test("a signed-in host can open saved rooms without the pin", async () => {
  const store = await createStore(":memory:");
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
  await assert.rejects(() => store.draw(room.code, "NOPE00", "wheel", "someone-else"), /Wrong pin/);
  await store.close();
});

test("sessions resolve to the google user", async () => {
  const store = await createStore(":memory:");
  await store.upsertUser({ sub: "sub-1", email: "sid@example.com", name: "Sid", picture: null });
  const id = await store.createSession("sub-1");
  const user = await store.userForSession(id);
  assert.equal(user.email, "sid@example.com");
  await store.deleteSession(id);
  assert.equal(await store.userForSession(id), null);
  await store.close();
});
