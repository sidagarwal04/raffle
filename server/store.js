import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { schemaSql, statements } from "./schema.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STYLES = new Set(["meetup", "booth", "virtual"]);
const REVEALS = new Set(["wheel", "odometer", "instant"]);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function randomToken(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function hashPin(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

export function pinsMatch(pin, hashed) {
  const left = Buffer.from(hashPin(pin));
  const right = Buffer.from(hashed);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function cleanLine(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanName(value) {
  return cleanLine(value, 40);
}

export function normName(value) {
  return cleanName(value).toLowerCase();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function clock(at, withSeconds) {
  const d = new Date(Number(at));
  const base = `${d.getHours()}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

export function labelFor(entry, all) {
  const same = all.filter((item) => normName(item.name) === normName(entry.name));
  if (same.length < 2) return entry.name;
  const minutes = same.map((item) => clock(item.joined_at, false));
  const collided = new Set(minutes).size !== minutes.length;
  return `${entry.name} · ${clock(entry.joined_at, collided)}`;
}

export function pickIndex(seed, ids) {
  const n = ids.length;
  const hash = crypto.createHash("sha256").update(`${seed}\n${ids.join("\n")}`).digest();
  const num = hash.readUInt32BE(0);
  const limit = Math.floor(0x100000000 / n) * n;
  if (num < limit) return num % n;
  return hash.readUInt32BE(4) % n;
}

export function reelFor(entries, winnerId) {
  const winner = entries.find((entry) => entry.id === winnerId);
  const others = entries.filter((entry) => entry.id !== winnerId);
  for (let i = others.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [others[i], others[j]] = [others[j], others[i]];
  }
  return [...others.slice(0, 11).map((entry) => entry.label), winner.label];
}

export function normHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => String(value).trim()));
}

export function checkedIn(value) {
  return /^(y|yes|true|1|x|checked|checked in)$/i.test(String(value || "").trim());
}

export function headerIndex(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

export function cleanToken(value) {
  const token = String(value || "");
  if (/^[a-zA-Z0-9_-]{16,80}$/.test(token)) return token;
  return crypto.randomBytes(16).toString("hex");
}

function on(value) {
  return Number(value) === 1;
}

function sqliteAdapter(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  return {
    dialect: "sqlite",
    async exec(sql) {
      db.exec(sql);
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    async close() {
      db.close();
    },
  };
}

async function ensureSchema(db) {
  if (db.dialect === "sqlite") {
    await db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }
  const parts = statements(schemaSql);
  for (const statement of parts) {
    if (/^CREATE (UNIQUE )?INDEX/i.test(statement)) continue;
    await db.exec(statement);
  }
  if (db.dialect === "sqlite") {
    const columns = await db.all("PRAGMA table_info(rooms)");
    if (!columns.some((column) => column.name === "owner_sub")) {
      await db.exec("ALTER TABLE rooms ADD COLUMN owner_sub TEXT");
    }
  }
  for (const statement of parts) {
    if (/^CREATE (UNIQUE )?INDEX/i.test(statement)) await db.exec(statement);
  }
}

export async function createStore(dbPath) {
  return createStoreFromDb(sqliteAdapter(dbPath));
}

export async function createStoreFromDb(db) {
  await ensureSchema(db);

  async function roomByCode(code) {
    return db.get("SELECT * FROM rooms WHERE code = ?", [String(code || "").toUpperCase()]);
  }

  async function requireRoom(code) {
    const room = await roomByCode(code);
    if (!room) throw new StoreError("That code doesn't match a room.", 404);
    return room;
  }

  async function requireHost(code, pin, userSub) {
    const room = await requireRoom(code);
    if (userSub && room.owner_sub && room.owner_sub === userSub) return room;
    const attempt = cleanLine(pin, 20).toUpperCase();
    if (!attempt || !pinsMatch(attempt, room.pin_hash)) {
      throw new StoreError("Wrong pin.", 403);
    }
    return room;
  }

  async function entriesForRoom(code) {
    return db.all("SELECT * FROM entries WHERE room_code = ? ORDER BY joined_at ASC, id ASC", [code]);
  }

  async function eligibleForRoom(code) {
    return db.all("SELECT * FROM entries WHERE room_code = ? AND eligible = 1 ORDER BY id ASC", [code]);
  }

  async function entryByToken(code, token) {
    return db.get("SELECT * FROM entries WHERE room_code = ? AND token = ?", [code, token]);
  }

  async function drawsForRoom(code) {
    return db.all("SELECT * FROM draws WHERE room_code = ? ORDER BY created_at ASC, rowid ASC", [code]);
  }

  function labeled(entries) {
    return entries.map((entry) => ({ ...entry, label: labelFor(entry, entries) }));
  }

  function drawRow(row) {
    return {
      id: row.id,
      entryId: row.entry_id,
      name: row.name,
      prize: row.prize,
      eligibleCount: Number(row.eligible_count),
      reveal: row.reveal,
      reel: JSON.parse(row.reel_json),
      at: Number(row.created_at),
    };
  }

  async function present(room, { host = false } = {}) {
    const entries = labeled(await entriesForRoom(room.code));
    const draws = (await drawsForRoom(room.code)).map(drawRow);
    const latest = draws.at(-1) || null;
    const body = {
      code: room.code,
      title: room.title,
      prize: room.prize,
      style: room.style,
      locked: on(room.locked),
      reveal: room.reveal,
      count: entries.filter((entry) => on(entry.eligible)).length,
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
        eligible: on(entry.eligible),
        joinedAt: Number(entry.joined_at),
      }));
    }
    return body;
  }

  async function createRoom(input) {
    const title = cleanLine(input.title, 80);
    const prize = cleanLine(input.prize, 60);
    const style = String(input.style || "meetup");
    if (!title) throw new StoreError("Give the room a title.");
    if (!prize) throw new StoreError("Name a prize.");
    if (!STYLES.has(style)) throw new StoreError("Pick meetup, booth, or virtual.");

    const pin = randomToken(6);
    let code = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const next = randomToken(4);
      if (!(await roomByCode(next))) {
        code = next;
        break;
      }
    }
    if (!code) throw new StoreError("Could not open a room. Try again.", 500);
    await db.run(
      `INSERT INTO rooms (code, title, prize, style, pin_hash, locked, reveal, created_at, owner_sub)
       VALUES (?, ?, ?, ?, ?, 0, 'wheel', ?, ?)`,
      [code, title, prize, style, hashPin(pin), Date.now(), input.ownerSub || null],
    );
    return { code, pin, title, prize, style };
  }

  async function join(code, input) {
    const room = await requireRoom(code);
    const name = cleanName(input.name);
    if (!name) throw new StoreError("Enter your name.");
    const token = cleanToken(input.token);
    const source = input.source === "booth" || room.style === "booth" ? "booth" : "join";
    const existing = await entryByToken(room.code, token);
    if (on(room.locked) && !existing) throw new StoreError("This room is closed.", 403);
    if (existing) {
      if (on(existing.eligible) && existing.name !== name) {
        await db.run("UPDATE entries SET name = ? WHERE id = ?", [name, existing.id]);
      }
      const fresh = await entryByToken(room.code, token);
      return {
        entryId: fresh.id,
        name: fresh.name,
        token,
        count: (await present(room)).count,
      };
    }
    const count = (await eligibleForRoom(room.code)).length;
    if (count >= 5000) throw new StoreError("This room is full.", 403);
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO entries (id, room_code, name, source, token, email, eligible, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, room.code, name, source, token, null, Date.now()],
    );
    return { entryId: id, name, token, count: count + 1 };
  }

  async function draw(code, pin, revealInput, userSub) {
    const room = await requireHost(code, pin, userSub);
    const reveal = REVEALS.has(revealInput) ? revealInput : room.reveal;
    if (reveal !== room.reveal) {
      await db.run("UPDATE rooms SET reveal = ? WHERE code = ?", [reveal, room.code]);
    }
    const entries = labeled(await entriesForRoom(room.code)).filter((entry) => on(entry.eligible));
    if (!entries.length) throw new StoreError("Nobody is in the draw yet.");
    const seed = crypto.randomBytes(16).toString("hex");
    const index = pickIndex(seed, entries.map((entry) => entry.id));
    const winner = entries[index];
    const row = {
      id: crypto.randomUUID(),
      room: room.code,
      entryId: winner.id,
      name: winner.label,
      prize: room.prize,
      count: entries.length,
      reveal,
      reel: JSON.stringify(reelFor(entries, winner.id)),
      at: Date.now(),
    };
    await db.run(
      `INSERT INTO draws (id, room_code, entry_id, name, prize, eligible_count, reveal, reel_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.room, row.entryId, row.name, row.prize, row.count, row.reveal, row.reel, row.at],
    );
    return (await present(await requireRoom(room.code), { host: true })).latestDraw;
  }

  async function redraw(code, pin, reveal, userSub) {
    const room = await requireHost(code, pin, userSub);
    const latest = (await drawsForRoom(room.code)).at(-1);
    if (!latest) throw new StoreError("Draw a winner first.");
    const remaining = (await eligibleForRoom(room.code)).filter((entry) => entry.id !== latest.entry_id);
    if (!remaining.length) throw new StoreError("They're the last person in the draw.");
    await db.run("UPDATE entries SET eligible = 0 WHERE id = ?", [latest.entry_id]);
    return draw(code, pin, reveal, userSub);
  }

  async function lock(code, pin, locked, userSub) {
    const room = await requireHost(code, pin, userSub);
    await db.run("UPDATE rooms SET locked = ? WHERE code = ?", [locked ? 1 : 0, room.code]);
    return present(await requireRoom(room.code), { host: true });
  }

  async function updatePrize(code, pin, prizeInput, userSub) {
    const room = await requireHost(code, pin, userSub);
    const prize = cleanLine(prizeInput, 60);
    if (!prize) throw new StoreError("Name a prize.");
    await db.run("UPDATE rooms SET prize = ? WHERE code = ?", [prize, room.code]);
    return present(await requireRoom(room.code), { host: true });
  }

  async function updateReveal(code, pin, reveal, userSub) {
    const room = await requireHost(code, pin, userSub);
    if (!REVEALS.has(reveal)) throw new StoreError("Pick wheel, odometer, or instant.");
    await db.run("UPDATE rooms SET reveal = ? WHERE code = ?", [reveal, room.code]);
    return present(await requireRoom(room.code), { host: true });
  }

  async function importCsv(code, pin, csv, userSub) {
    const room = await requireHost(code, pin, userSub);
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

    const existing = await entriesForRoom(room.code);
    const emails = new Set(existing.map((entry) => entry.email).filter(Boolean));
    const names = new Set(existing.map((entry) => normName(entry.name)));
    let added = 0;
    let unchecked = 0;
    let duplicates = 0;
    const now = Date.now();

    for (let index = 0; index < rows.length - 1; index++) {
      const row = rows[index + 1];
      if (!checkedIn(row[checkedIdx])) {
        unchecked++;
        continue;
      }
      const named = nameIdx >= 0 ? row[nameIdx] : `${row[firstIdx] || ""} ${row[lastIdx] || ""}`;
      const name = cleanName(named);
      if (!name) continue;
      const email = emailIdx >= 0 ? cleanLine(row[emailIdx], 120).toLowerCase() : "";
      if ((email && emails.has(email)) || names.has(normName(name))) {
        duplicates++;
        continue;
      }
      await db.run(
        `INSERT INTO entries (id, room_code, name, source, token, email, eligible, joined_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [crypto.randomUUID(), room.code, name, "csv", null, email || null, now + index],
      );
      if (email) emails.add(email);
      names.add(normName(name));
      added++;
    }

    return { ...(await present(await requireRoom(room.code), { host: true })), added, unchecked, duplicates };
  }

  async function roomsForUser(sub) {
    const rows = await db.all(
      `SELECT r.code, r.title, r.prize, r.style, r.locked, r.created_at,
        (SELECT COUNT(*) FROM entries e WHERE e.room_code = r.code AND e.eligible = 1) AS eligible_count,
        (SELECT name FROM draws d WHERE d.room_code = r.code ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS latest_name,
        (SELECT prize FROM draws d WHERE d.room_code = r.code ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS latest_prize,
        (SELECT created_at FROM draws d WHERE d.room_code = r.code ORDER BY d.created_at DESC, d.rowid DESC LIMIT 1) AS latest_at
       FROM rooms r
       WHERE r.owner_sub = ?
       ORDER BY r.created_at DESC`,
      [sub],
    );
    return rows.map((row) => ({
      code: row.code,
      title: row.title,
      prize: row.prize,
      style: row.style,
      locked: on(row.locked),
      createdAt: Number(row.created_at),
      count: Number(row.eligible_count),
      latestName: row.latest_name || "",
      latestPrize: row.latest_prize || "",
      latestAt: row.latest_at == null ? null : Number(row.latest_at),
    }));
  }

  async function upsertUser(user) {
    const sub = String(user.sub || "");
    const email = cleanLine(user.email, 120).toLowerCase();
    const name = cleanLine(user.name, 80) || email;
    const picture = cleanLine(user.picture, 500) || null;
    if (!sub || !email) throw new StoreError("Google did not return an email.", 400);
    await db.run(
      `INSERT INTO users (sub, email, name, picture, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
      [sub, email, name, picture, Date.now()],
    );
  }

  async function createSession(sub) {
    const id = crypto.randomBytes(32).toString("hex");
    await db.run("INSERT INTO sessions (id, user_sub, expires_at) VALUES (?, ?, ?)", [
      id,
      sub,
      Date.now() + SESSION_MS,
    ]);
    return id;
  }

  async function userForSession(id) {
    if (!id) return null;
    const row = await db.get(
      `SELECT u.sub, u.email, u.name, u.picture, s.expires_at
       FROM sessions s JOIN users u ON u.sub = s.user_sub
       WHERE s.id = ?`,
      [id],
    );
    if (!row) return null;
    if (Number(row.expires_at) < Date.now()) {
      await db.run("DELETE FROM sessions WHERE id = ?", [id]);
      return null;
    }
    return { sub: row.sub, email: row.email, name: row.name, picture: row.picture || "" };
  }

  async function deleteSession(id) {
    if (!id) return;
    await db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }

  return {
    createRoom,
    join,
    draw,
    redraw,
    lock,
    updatePrize,
    updateReveal,
    importCsv,
    roomsForUser,
    upsertUser,
    createSession,
    userForSession,
    deleteSession,
    async publicRoom(code) {
      return present(await requireRoom(code));
    },
    async hostRoom(code, pin, userSub) {
      return present(await requireHost(code, pin, userSub), { host: true });
    },
    close() {
      return db.close();
    },
  };
}
