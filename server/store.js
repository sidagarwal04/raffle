import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const STYLES = new Set(["meetup", "booth", "virtual"]);
const REVEALS = new Set(["wheel", "odometer", "instant"]);

export class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function randomToken(length) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function hashPin(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

function pinsMatch(pin, hashed) {
  const left = Buffer.from(hashPin(pin));
  const right = Buffer.from(hashed);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function cleanLine(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanName(value) {
  return cleanLine(value, 40);
}

function normName(value) {
  return cleanName(value).toLowerCase();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function clock(at, withSeconds) {
  const d = new Date(at);
  const base = `${d.getHours()}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

function labelFor(entry, all) {
  const same = all.filter((item) => normName(item.name) === normName(entry.name));
  if (same.length < 2) return entry.name;
  const minutes = same.map((item) => clock(item.joined_at, false));
  const collided = new Set(minutes).size !== minutes.length;
  return `${entry.name} · ${clock(entry.joined_at, collided)}`;
}

function pickIndex(seed, ids) {
  const n = ids.length;
  const hash = crypto.createHash("sha256").update(`${seed}\n${ids.join("\n")}`).digest();
  const num = hash.readUInt32BE(0);
  const limit = Math.floor(0x100000000 / n) * n;
  if (num < limit) return num % n;
  return hash.readUInt32BE(4) % n;
}

function reelFor(entries, winnerId) {
  const winner = entries.find((entry) => entry.id === winnerId);
  const others = entries.filter((entry) => entry.id !== winnerId);
  for (let i = others.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [others[i], others[j]] = [others[j], others[i]];
  }
  return [...others.slice(0, 11).map((entry) => entry.label), winner.label];
}

function normHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseCsv(text) {
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

function checkedIn(value) {
  return /^(y|yes|true|1|x|checked|checked in)$/i.test(String(value || "").trim());
}

function headerIndex(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

export function createStore(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS rooms (
      code TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prize TEXT NOT NULL,
      style TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      reveal TEXT NOT NULL DEFAULT 'wheel',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      token TEXT,
      email TEXT,
      eligible INTEGER NOT NULL DEFAULT 1,
      joined_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS entries_room_token
      ON entries(room_code, token) WHERE token IS NOT NULL;
    CREATE TABLE IF NOT EXISTS draws (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prize TEXT NOT NULL,
      eligible_count INTEGER NOT NULL,
      reveal TEXT NOT NULL,
      reel_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const roomByCode = db.prepare("SELECT * FROM rooms WHERE code = ?");
  const insertRoom = db.prepare(`
    INSERT INTO rooms (code, title, prize, style, pin_hash, locked, reveal, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 'wheel', ?)
  `);
  const entriesForRoom = db.prepare(
    "SELECT * FROM entries WHERE room_code = ? ORDER BY joined_at ASC, id ASC",
  );
  const eligibleForRoom = db.prepare(
    "SELECT * FROM entries WHERE room_code = ? AND eligible = 1 ORDER BY id ASC",
  );
  const entryByToken = db.prepare(
    "SELECT * FROM entries WHERE room_code = ? AND token = ?",
  );
  const insertEntry = db.prepare(`
    INSERT INTO entries (id, room_code, name, source, token, email, eligible, joined_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const renameEntry = db.prepare("UPDATE entries SET name = ? WHERE id = ?");
  const drawsForRoom = db.prepare(
    "SELECT * FROM draws WHERE room_code = ? ORDER BY created_at ASC, id ASC",
  );
  const insertDraw = db.prepare(`
    INSERT INTO draws (id, room_code, entry_id, name, prize, eligible_count, reveal, reel_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setLocked = db.prepare("UPDATE rooms SET locked = ? WHERE code = ?");
  const setPrize = db.prepare("UPDATE rooms SET prize = ? WHERE code = ?");
  const setReveal = db.prepare("UPDATE rooms SET reveal = ? WHERE code = ?");
  const excludeEntry = db.prepare("UPDATE entries SET eligible = 0 WHERE id = ?");

  function requireRoom(code) {
    const room = roomByCode.get(String(code || "").toUpperCase());
    if (!room) throw new StoreError("That code doesn't match a room.", 404);
    return room;
  }

  function requireHost(code, pin) {
    const room = requireRoom(code);
    const attempt = cleanLine(pin, 20).toUpperCase();
    if (!attempt || !pinsMatch(attempt, room.pin_hash)) {
      throw new StoreError("Wrong pin.", 403);
    }
    return room;
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
      eligibleCount: row.eligible_count,
      reveal: row.reveal,
      reel: JSON.parse(row.reel_json),
      at: row.created_at,
    };
  }

  function present(room, { host = false } = {}) {
    const entries = labeled(entriesForRoom.all(room.code));
    const draws = drawsForRoom.all(room.code).map(drawRow);
    const latest = draws.at(-1) || null;
    const body = {
      code: room.code,
      title: room.title,
      prize: room.prize,
      style: room.style,
      locked: room.locked === 1,
      reveal: room.reveal,
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

  function createRoom(input) {
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
      if (!roomByCode.get(next)) {
        code = next;
        break;
      }
    }
    if (!code) throw new StoreError("Could not open a room. Try again.", 500);
    insertRoom.run(code, title, prize, style, hashPin(pin), Date.now());
    return { code, pin, title, prize, style };
  }

  function join(code, input) {
    const room = requireRoom(code);
    const name = cleanName(input.name);
    if (!name) throw new StoreError("Enter your name.");
    const token = cleanToken(input.token);
    const source = input.source === "booth" || room.style === "booth" ? "booth" : "join";
    const existing = entryByToken.get(room.code, token);
    if (room.locked && !existing) throw new StoreError("This room is closed.", 403);
    if (existing) {
      if (existing.eligible && existing.name !== name) renameEntry.run(name, existing.id);
      const fresh = entryByToken.get(room.code, token);
      return {
        entryId: fresh.id,
        name: fresh.name,
        token,
        count: present(room).count,
      };
    }
    const count = eligibleForRoom.all(room.code).length;
    if (count >= 5000) throw new StoreError("This room is full.", 403);
    const id = crypto.randomUUID();
    insertEntry.run(id, room.code, name, source, token, null, Date.now());
    return { entryId: id, name, token, count: count + 1 };
  }

  function draw(code, pin, revealInput) {
    const room = requireHost(code, pin);
    const reveal = REVEALS.has(revealInput) ? revealInput : room.reveal;
    if (reveal !== room.reveal) setReveal.run(reveal, room.code);
    const entries = labeled(entriesForRoom.all(room.code)).filter((entry) => entry.eligible === 1);
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
    insertDraw.run(
      row.id,
      row.room,
      row.entryId,
      row.name,
      row.prize,
      row.count,
      row.reveal,
      row.reel,
      row.at,
    );
    return present(requireRoom(room.code), { host: true }).latestDraw;
  }

  function redraw(code, pin, reveal) {
    const room = requireHost(code, pin);
    const latest = drawsForRoom.all(room.code).at(-1);
    if (!latest) throw new StoreError("Draw a winner first.");
    const remaining = eligibleForRoom.all(room.code).filter((entry) => entry.id !== latest.entry_id);
    if (!remaining.length) throw new StoreError("They're the last person in the draw.");
    excludeEntry.run(latest.entry_id);
    return draw(code, pin, reveal);
  }

  function lock(code, pin, locked) {
    const room = requireHost(code, pin);
    setLocked.run(locked ? 1 : 0, room.code);
    return present(requireRoom(room.code), { host: true });
  }

  function updatePrize(code, pin, prizeInput) {
    const room = requireHost(code, pin);
    const prize = cleanLine(prizeInput, 60);
    if (!prize) throw new StoreError("Name a prize.");
    setPrize.run(prize, room.code);
    return present(requireRoom(room.code), { host: true });
  }

  function updateReveal(code, pin, reveal) {
    const room = requireHost(code, pin);
    if (!REVEALS.has(reveal)) throw new StoreError("Pick wheel, odometer, or instant.");
    setReveal.run(reveal, room.code);
    return present(requireRoom(room.code), { host: true });
  }

  function importCsv(code, pin, csv) {
    const room = requireHost(code, pin);
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

    const existing = entriesForRoom.all(room.code);
    const emails = new Set(existing.map((entry) => entry.email).filter(Boolean));
    const names = new Set(existing.map((entry) => normName(entry.name)));
    let added = 0;
    let unchecked = 0;
    let duplicates = 0;
    const now = Date.now();

    rows.slice(1).forEach((row, index) => {
      if (!checkedIn(row[checkedIdx])) {
        unchecked++;
        return;
      }
      const named = nameIdx >= 0 ? row[nameIdx] : `${row[firstIdx] || ""} ${row[lastIdx] || ""}`;
      const name = cleanName(named);
      if (!name) return;
      const email = emailIdx >= 0 ? cleanLine(row[emailIdx], 120).toLowerCase() : "";
      if ((email && emails.has(email)) || names.has(normName(name))) {
        duplicates++;
        return;
      }
      insertEntry.run(
        crypto.randomUUID(),
        room.code,
        name,
        "csv",
        null,
        email || null,
        now + index,
      );
      if (email) emails.add(email);
      names.add(normName(name));
      added++;
    });

    return { ...present(requireRoom(room.code), { host: true }), added, unchecked, duplicates };
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
    publicRoom(code) {
      return present(requireRoom(code));
    },
    hostRoom(code, pin) {
      return present(requireHost(code, pin), { host: true });
    },
    close() {
      db.close();
    },
  };
}

function cleanToken(value) {
  const token = String(value || "");
  if (/^[a-zA-Z0-9_-]{16,80}$/.test(token)) return token;
  return crypto.randomBytes(16).toString("hex");
}
