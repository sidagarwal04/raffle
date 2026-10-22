import crypto from "node:crypto";
import {
  StoreError,
  checkedIn,
  cleanEmail,
  cleanLine,
  cleanName,
  cleanToken,
  hashPin,
  headerIndex,
  labelFor,
  normHeader,
  normName,
  parseCsv,
  pickIndex,
  pinsMatch,
  randomToken,
  reelFor,
} from "./store.js";

const STYLES = new Set(["meetup", "booth", "virtual"]);
const REVEALS = new Set(["wheel", "odometer", "instant"]);

function ownerPrefix(sub) {
  return `u/${Buffer.from(String(sub)).toString("base64url")}/`;
}

function roomKey(code) {
  return `codes/${String(code || "").toUpperCase()}`;
}

function indexKey(sub, code) {
  return `${ownerPrefix(sub)}${code}`;
}

function emailKey(email) {
  return Buffer.from(String(email)).toString("base64url");
}

function inviteIndexKey(email, code) {
  return `inv/${emailKey(email)}/${code}`;
}

function inviteTokenKey(token) {
  return `invite/${token}`;
}

function memberRole(doc, userSub) {
  if (userSub && doc.ownerSub && doc.ownerSub === userSub) return "owner";
  if ((doc.collaborators || []).some((person) => person.sub === userSub)) return "collaborator";
  return "pin";
}

function peopleOf(doc) {
  return {
    collaborators: (doc.collaborators || []).map((person) => ({ email: person.email, name: person.name })),
    invites: (doc.invites || []).map((invite) => ({ email: invite.email, token: invite.token })),
  };
}

function accountOf(userOrSub) {
  if (userOrSub && typeof userOrSub === "object") return userOrSub;
  return { sub: userOrSub || "", email: "", name: "" };
}

function labeled(entries) {
  return entries.map((entry) => ({ ...entry, label: labelFor(entry, entries) }));
}

function summary(doc) {
  const latest = doc.draws.at(-1) || null;
  return {
    code: doc.code,
    title: doc.title,
    prize: doc.prize,
    style: doc.style,
    locked: doc.locked === 1,
    createdAt: doc.createdAt,
    count: doc.entries.filter((entry) => entry.eligible === 1).length,
    latestName: latest?.name || "",
    latestPrize: latest?.prize || "",
    latestAt: latest ? latest.at : null,
  };
}

function present(doc, { host = false } = {}) {
  const entries = labeled(doc.entries);
  const draws = doc.draws.map((draw) => ({
    id: draw.id,
    entryId: draw.entryId,
    name: draw.name,
    prize: draw.prize,
    eligibleCount: draw.eligibleCount,
    reveal: draw.reveal,
    reel: draw.reel,
    at: draw.at,
  }));
  const latest = draws.at(-1) || null;
  const body = {
    code: doc.code,
    title: doc.title,
    prize: doc.prize,
    style: doc.style,
    locked: doc.locked === 1,
    reveal: doc.reveal,
    count: entries.filter((entry) => entry.eligible === 1).length,
    latestDraw: latest,
    earlier: draws.slice(0, -1).map((draw) => ({
      id: draw.id,
      entryId: draw.entryId,
      name: draw.name,
      prize: draw.prize,
    })),
  };
  if (host) {
    body.entries = entries.map((entry) => ({
      id: entry.id,
      name: entry.label,
      source: entry.source,
      eligible: entry.eligible === 1,
      joinedAt: entry.joined_at,
    }));
  }
  return body;
}

function assertHost(doc, pin, userSub) {
  if (memberRole(doc, userSub) !== "pin") return;
  const attempt = cleanLine(pin, 20).toUpperCase();
  if (!attempt || !pinsMatch(attempt, doc.pinHash)) throw new StoreError("Wrong pin.", 403);
}

export function createBlobStore(blobs) {
  async function load(code) {
    const found = await blobs.getWithMetadata(roomKey(code), { type: "json" });
    return found?.data || null;
  }

  async function removeKey(key) {
    if (typeof blobs.delete === "function") await blobs.delete(key);
  }

  async function syncIndexes(doc, previous) {
    const base = summary(doc);
    if (doc.ownerSub) await blobs.setJSON(indexKey(doc.ownerSub, doc.code), { ...base, role: "owner" });
    const nextPeople = new Map((doc.collaborators || []).map((person) => [person.sub, person]));
    const prevPeople = new Map((previous?.collaborators || []).map((person) => [person.sub, person]));
    for (const sub of nextPeople.keys()) {
      if (sub && sub !== doc.ownerSub) {
        await blobs.setJSON(indexKey(sub, doc.code), { ...base, role: "collaborator" });
      }
    }
    for (const sub of prevPeople.keys()) {
      if (!nextPeople.has(sub) && sub !== doc.ownerSub) await removeKey(indexKey(sub, doc.code));
    }
    const nextInvites = new Map((doc.invites || []).map((invite) => [invite.email, invite]));
    const prevInvites = new Map((previous?.invites || []).map((invite) => [invite.email, invite]));
    for (const invite of nextInvites.values()) {
      await blobs.setJSON(inviteIndexKey(invite.email, doc.code), {
        token: invite.token,
        email: invite.email,
        code: doc.code,
      });
      await blobs.setJSON(inviteTokenKey(invite.token), {
        token: invite.token,
        email: invite.email,
        code: doc.code,
        title: doc.title,
      });
    }
    for (const invite of prevInvites.values()) {
      if (!nextInvites.has(invite.email)) await removeKey(inviteIndexKey(invite.email, doc.code));
      if (![...nextInvites.values()].some((item) => item.token === invite.token)) {
        await removeKey(inviteTokenKey(invite.token));
      }
    }
  }

  async function write(doc, options, previous = null) {
    const result = await blobs.setJSON(roomKey(doc.code), doc, options);
    if (!result.modified) return false;
    await syncIndexes(doc, previous);
    return true;
  }

  async function update(code, change) {
    const key = roomKey(code);
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await blobs.getWithMetadata(key, { type: "json" });
      if (!current?.data) throw new StoreError("That code doesn't match a room.", 404);
      const previous = structuredClone(current.data);
      const next = change(structuredClone(current.data));
      const saved = await write(next, current.etag ? { onlyIfMatch: current.etag } : {}, previous);
      if (saved) return next;
    }
    throw new StoreError("Could not save the room. Try again.", 503);
  }

  async function require(code) {
    const doc = await load(code);
    if (!doc) throw new StoreError("That code doesn't match a room.", 404);
    return doc;
  }

  return {
    async createRoom(input) {
      const title = cleanLine(input.title, 80);
      const prize = cleanLine(input.prize, 60);
      const style = String(input.style || "meetup");
      if (!title) throw new StoreError("Give the room a title.");
      if (!prize) throw new StoreError("Name a prize.");
      if (!STYLES.has(style)) throw new StoreError("Pick meetup, booth, or virtual.");
      const pin = randomToken(6);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomToken(4);
        const doc = {
          code,
          title,
          prize,
          style,
          pinHash: hashPin(pin),
          locked: 0,
          reveal: "wheel",
          createdAt: Date.now(),
          ownerSub: input.ownerSub || null,
          collaborators: [],
          invites: [],
          entries: [],
          draws: [],
        };
        if (await write(doc, { onlyIfNew: true })) return { code, pin, title, prize, style };
      }
      throw new StoreError("Could not open a room. Try again.", 500);
    },

    async join(code, input) {
      const name = cleanName(input.name);
      if (!name) throw new StoreError("Enter your name.");
      const token = cleanToken(input.token);
      let result;
      await update(code, (doc) => {
        const source = input.source === "booth" || doc.style === "booth" ? "booth" : "join";
        const existing = doc.entries.find((entry) => entry.token === token);
        if (doc.locked === 1 && !existing) throw new StoreError("This room is closed.", 403);
        if (existing) {
          if (existing.eligible === 1 && existing.name !== name) existing.name = name;
          result = { entryId: existing.id, name: existing.name, token, count: 0 };
          return doc;
        }
        const count = doc.entries.filter((entry) => entry.eligible === 1).length;
        if (count >= 5000) throw new StoreError("This room is full.", 403);
        const id = crypto.randomUUID();
        doc.entries.push({
          id,
          name,
          source,
          token,
          email: null,
          eligible: 1,
          joined_at: Date.now(),
        });
        result = { entryId: id, name, token, count: count + 1 };
        return doc;
      });
      const doc = await load(code);
      result.count = present(doc).count;
      return result;
    },

    async draw(code, pin, revealInput, userSub) {
      let drawn;
      await update(code, (doc) => {
        assertHost(doc, pin, userSub);
        const reveal = REVEALS.has(revealInput) ? revealInput : doc.reveal;
        doc.reveal = reveal;
        const entries = labeled(doc.entries).filter((entry) => entry.eligible === 1);
        if (!entries.length) throw new StoreError("Nobody is in the draw yet.");
        const seed = crypto.randomBytes(16).toString("hex");
        const winner = entries[pickIndex(seed, entries.map((entry) => entry.id))];
        doc.draws.push({
          id: crypto.randomUUID(),
          entryId: winner.id,
          name: winner.label,
          prize: doc.prize,
          eligibleCount: entries.length,
          reveal,
          reel: reelFor(entries, winner.id),
          at: Date.now(),
        });
        drawn = present(doc, { host: true }).latestDraw;
        return doc;
      });
      return drawn;
    },

    async redraw(code, pin, reveal, userSub) {
      await update(code, (doc) => {
        assertHost(doc, pin, userSub);
        const latest = doc.draws.at(-1);
        if (!latest) throw new StoreError("Draw a winner first.");
        const remaining = doc.entries.filter((entry) => entry.eligible === 1 && entry.id !== latest.entryId);
        if (!remaining.length) throw new StoreError("They're the last person in the draw.");
        const entry = doc.entries.find((item) => item.id === latest.entryId);
        if (entry) entry.eligible = 0;
        return doc;
      });
      return this.draw(code, pin, reveal, userSub);
    },

    async lock(code, pin, locked, userSub) {
      const doc = await update(code, (room) => {
        assertHost(room, pin, userSub);
        room.locked = locked ? 1 : 0;
        return room;
      });
      return present(doc, { host: true });
    },

    async updatePrize(code, pin, prizeInput, userSub) {
      const prize = cleanLine(prizeInput, 60);
      if (!prize) throw new StoreError("Name a prize.");
      const doc = await update(code, (room) => {
        assertHost(room, pin, userSub);
        room.prize = prize;
        return room;
      });
      return present(doc, { host: true });
    },

    async updateReveal(code, pin, reveal, userSub) {
      if (!REVEALS.has(reveal)) throw new StoreError("Pick wheel, odometer, or instant.");
      const doc = await update(code, (room) => {
        assertHost(room, pin, userSub);
        room.reveal = reveal;
        return room;
      });
      return present(doc, { host: true });
    },

    async importCsv(code, pin, csv, userSub) {
      const rows = parseCsv(csv);
      if (rows.length < 2) throw new StoreError("That file is empty.");
      const headers = rows[0].map(normHeader);
      const nameIdx = headerIndex(headers, ["name", "full name", "attendee", "attendee name", "guest", "guest name"]);
      const firstIdx = headerIndex(headers, ["first name", "first"]);
      const lastIdx = headerIndex(headers, ["last name", "last"]);
      const emailIdx = headerIndex(headers, ["email", "e mail", "email address"]);
      const checkedIdx = headerIndex(headers, ["checked in", "check in", "attended"]);
      if (nameIdx < 0 && firstIdx < 0) throw new StoreError("This file needs a name column.");
      if (checkedIdx < 0) {
        throw new StoreError("This file needs a Checked In column. Export check-ins, then import again.");
      }
      let added = 0;
      let unchecked = 0;
      let duplicates = 0;
      const doc = await update(code, (room) => {
        assertHost(room, pin, userSub);
        const emails = new Set(room.entries.map((entry) => entry.email).filter(Boolean));
        const names = new Set(room.entries.map((entry) => normName(entry.name)));
        const now = Date.now();
        let nextAdded = 0;
        let nextUnchecked = 0;
        let nextDuplicates = 0;
        rows.slice(1).forEach((row, index) => {
          if (!checkedIn(row[checkedIdx])) {
            nextUnchecked++;
            return;
          }
          const named = nameIdx >= 0 ? row[nameIdx] : `${row[firstIdx] || ""} ${row[lastIdx] || ""}`;
          const name = cleanName(named);
          if (!name) return;
          const email = emailIdx >= 0 ? cleanLine(row[emailIdx], 120).toLowerCase() : "";
          if ((email && emails.has(email)) || names.has(normName(name))) {
            nextDuplicates++;
            return;
          }
          room.entries.push({
            id: crypto.randomUUID(),
            name,
            source: "csv",
            token: null,
            email: email || null,
            eligible: 1,
            joined_at: now + index,
          });
          if (email) emails.add(email);
          names.add(normName(name));
          nextAdded++;
        });
        added = nextAdded;
        unchecked = nextUnchecked;
        duplicates = nextDuplicates;
        return room;
      });
      return { ...present(doc, { host: true }), added, unchecked, duplicates };
    },

    async inviteCollaborator(code, user, emailInput) {
      if (!user?.sub) throw new StoreError("Sign in with Google.", 401);
      const email = cleanEmail(emailInput);
      if (!email) throw new StoreError("Enter a Google email.");
      if (cleanEmail(user.email) === email) throw new StoreError("You’re already on this room.");
      let token = "";
      let already = false;
      const doc = await update(code, (room) => {
        const role = memberRole(room, user.sub);
        if (role !== "owner" && role !== "collaborator") {
          throw new StoreError("Only people on this room can invite.", 403);
        }
        room.collaborators = room.collaborators || [];
        room.invites = room.invites || [];
        if (room.collaborators.some((person) => person.email === email)) {
          throw new StoreError("They’re already on this room.");
        }
        const pending = room.invites.find((invite) => invite.email === email);
        if (pending) {
          token = pending.token;
          already = true;
          return room;
        }
        token = randomToken(16);
        room.invites.push({ token, email, createdAt: Date.now() });
        return room;
      });
      return { token, email, already, ...peopleOf(doc) };
    },

    async removeCollaborator(code, user, emailInput) {
      if (!user?.sub) throw new StoreError("Sign in with Google.", 401);
      const email = cleanEmail(emailInput);
      if (!email) throw new StoreError("That email isn’t on this room.");
      const doc = await update(code, (room) => {
        if (memberRole(room, user.sub) !== "owner") {
          throw new StoreError("Only the person who opened the room can remove someone.", 403);
        }
        room.collaborators = (room.collaborators || []).filter((person) => person.email !== email);
        room.invites = (room.invites || []).filter((invite) => invite.email !== email);
        return room;
      });
      return peopleOf(doc);
    },

    async previewInvite(token) {
      const invite = await blobs.get(inviteTokenKey(String(token || "").toUpperCase()), { type: "json" });
      if (!invite?.code) throw new StoreError("That invite isn’t valid anymore.", 404);
      return { email: invite.email, code: invite.code, title: invite.title };
    },

    async acceptInvite(token, user) {
      if (!user?.sub || !user.email) throw new StoreError("Sign in with Google.", 401);
      const email = cleanEmail(user.email);
      const invite = await blobs.get(inviteTokenKey(String(token || "").toUpperCase()), { type: "json" });
      if (!invite?.code) throw new StoreError("That invite isn’t valid anymore.", 404);
      if (invite.email !== email) throw new StoreError("This invite is for a different Google account.", 403);
      const doc = await update(invite.code, (room) => {
        room.collaborators = room.collaborators || [];
        room.invites = (room.invites || []).filter((item) => item.email !== email);
        if (room.ownerSub === user.sub) return room;
        if (!room.collaborators.some((person) => person.sub === user.sub)) {
          room.collaborators.push({
            sub: user.sub,
            email,
            name: cleanLine(user.name, 80) || email,
            createdAt: Date.now(),
          });
        }
        return room;
      });
      return { code: doc.code, title: doc.title };
    },

    async roomsForUser(userOrSub) {
      const user = accountOf(userOrSub);
      const email = cleanEmail(user.email || "");
      if (user.sub && email) {
        const pending = await blobs.list({ prefix: `inv/${emailKey(email)}/` });
        for (const blob of pending.blobs) {
          const invite = await blobs.get(blob.key, { type: "json" });
          if (!invite?.token) continue;
          try {
            await this.acceptInvite(invite.token, user);
          } catch (err) {
            if (!(err instanceof StoreError)) throw err;
          }
        }
      }
      const listed = await blobs.list({ prefix: ownerPrefix(user.sub) });
      const rooms = await Promise.all(listed.blobs.map((blob) => blobs.get(blob.key, { type: "json" })));
      return rooms
        .filter(Boolean)
        .map((room) => ({ ...room, role: room.role || "owner" }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async publicRoom(code) {
      return present(await require(code));
    },

    async hostRoom(code, pin, userSub) {
      const doc = await require(code);
      assertHost(doc, pin, userSub);
      const body = present(doc, { host: true });
      const role = memberRole(doc, userSub);
      body.access = role;
      if (role === "owner" || role === "collaborator") {
        const people = peopleOf(doc);
        body.collaborators = people.collaborators;
        body.invites = people.invites;
      }
      return body;
    },

    async close() {},
  };
}
