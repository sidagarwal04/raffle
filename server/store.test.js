import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "./store.js";

function roomWith(store, names, style = "meetup") {
  const room = store.createRoom({ title: "Friday meetup", prize: "T-shirt", style });
  names.forEach((name, index) => {
    store.join(room.code, { name, token: `token-token-token-${index}` });
  });
  return room;
}

test("create, join, draw, and exclude", () => {
  const store = createStore(":memory:");
  const room = roomWith(store, ["Priya Shah", "Kenji Mori", "Ada Okonkwo"]);
  assert.equal(room.code.length, 4);
  assert.equal(room.pin.length, 6);
  assert.equal(store.publicRoom(room.code).count, 3);
  assert.equal(JSON.stringify(store.publicRoom(room.code)).includes(room.pin), false);

  const again = store.join(room.code, { name: "Priya S.", token: "token-token-token-0" });
  assert.equal(store.publicRoom(room.code).count, 3);
  assert.equal(again.name, "Priya S.");

  const first = store.draw(room.code, room.pin, "wheel");
  assert.equal(first.eligibleCount, 3);
  assert.equal(["Priya S.", "Kenji Mori", "Ada Okonkwo"].includes(first.name), true);

  const second = store.redraw(room.code, room.pin, "odometer");
  const third = store.redraw(room.code, room.pin, "instant");
  const winners = [first.name, second.name, third.name];
  assert.equal(new Set(winners).size, 3);
  assert.throws(() => store.redraw(room.code, room.pin, "wheel"), /last person/);
  store.close();
});

test("wrong pin and a closed room", () => {
  const store = createStore(":memory:");
  const room = roomWith(store, ["Mei Chen"]);
  assert.throws(() => store.draw(room.code, "NOPE00", "wheel"), /Wrong pin/);
  store.lock(room.code, room.pin, true);
  assert.throws(
    () => store.join(room.code, { name: "Noah Adeyemi", token: "another-token-0001" }),
    /closed/,
  );
  const back = store.join(room.code, { name: "Mei Chen", token: "token-token-token-0" });
  assert.equal(back.name, "Mei Chen");
  store.close();
});

test("check-in import keeps checked-in rows and skips duplicates", () => {
  const store = createStore(":memory:");
  const room = roomWith(store, ["Ada Okonkwo"]);
  const csv = [
    "Name,Email,Checked In",
    "Ada Okonkwo,ada@example.com,Yes",
    "Luis Ortega,luis@example.com,No",
    "Mei Chen,mei@example.com,true",
    "Jonah Berg,jonah@example.com,Yes",
  ].join("\n");
  const imported = store.importCsv(room.code, room.pin, csv);
  assert.equal(imported.added, 2);
  assert.equal(imported.unchecked, 1);
  assert.equal(imported.duplicates, 1);
  assert.equal(imported.count, 3);

  assert.throws(
    () => store.importCsv(room.code, room.pin, "Name,Email\nAda,ada@example.com\n"),
    /Checked In/,
  );
  store.close();
});

test("unknown code", () => {
  const store = createStore(":memory:");
  assert.throws(() => store.publicRoom("ZZZZ"), /doesn't match/);
  store.close();
});
