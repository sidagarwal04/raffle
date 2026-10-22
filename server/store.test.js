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

test("an invited collaborator can host and finds the room on their account", async () => {
  const store = await createStore(":memory:");
  const room = await store.createRoom({
    title: "Friday meetup",
    prize: "T-shirt",
    style: "meetup",
    ownerSub: "owner-sub",
  });
  await store.join(room.code, { name: "Priya Shah", token: "token-token-token-0" });
  const owner = { sub: "owner-sub", email: "owner@example.com", name: "Owner" };
  await assert.rejects(
    () => store.inviteCollaborator(room.code, { sub: "stranger", email: "s@example.com", name: "Sam" }, "alex@example.com"),
    /Only people on this room/,
  );
  const invite = await store.inviteCollaborator(room.code, owner, "Alex@Example.com");
  assert.equal(invite.email, "alex@example.com");
  assert.equal(invite.invites.length, 1);
  const again = await store.inviteCollaborator(room.code, owner, "alex@example.com");
  assert.equal(again.token, invite.token);

  const preview = await store.previewInvite(invite.token);
  assert.equal(preview.title, "Friday meetup");
  assert.equal(preview.email, "alex@example.com");
  await assert.rejects(
    () => store.acceptInvite(invite.token, { sub: "other", email: "other@example.com", name: "Other" }),
    /different Google account/,
  );
  await assert.rejects(() => store.draw(room.code, "", "wheel", "alex-sub"), /Wrong pin/);

  const host = await store.hostRoom(room.code, "", "owner-sub");
  assert.equal(host.access, "owner");
  assert.equal(host.invites[0].email, "alex@example.com");
  const withPin = await store.hostRoom(room.code, room.pin, "stranger");
  assert.equal(withPin.access, "pin");
  assert.equal(withPin.invites, undefined);

  const claimed = await store.roomsForUser({ sub: "alex-sub", email: "alex@example.com", name: "Alex" });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].code, room.code);
  assert.equal(claimed[0].role, "collaborator");
  const draw = await store.draw(room.code, "", "wheel", "alex-sub");
  assert.equal(draw.name, "Priya Shah");
  const owners = await store.roomsForUser(owner);
  assert.equal(owners[0].role, "owner");
  assert.equal(owners[0].latestName, "Priya Shah");

  await assert.rejects(
    () => store.removeCollaborator(room.code, { sub: "alex-sub", email: "alex@example.com", name: "Alex" }, "alex@example.com"),
    /opened the room/,
  );
  await store.removeCollaborator(room.code, owner, "alex@example.com");
  assert.equal((await store.roomsForUser("alex-sub")).length, 0);
  await assert.rejects(() => store.draw(room.code, "NOPE00", "wheel", "alex-sub"), /Wrong pin/);
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
