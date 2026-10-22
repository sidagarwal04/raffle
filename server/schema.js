export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  style TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  reveal TEXT NOT NULL DEFAULT 'wheel',
  created_at BIGINT NOT NULL,
  owner_sub TEXT
);

CREATE INDEX IF NOT EXISTS rooms_owner ON rooms (owner_sub);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  token TEXT,
  email TEXT,
  eligible INTEGER NOT NULL DEFAULT 1,
  joined_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS entries_room_token
  ON entries (room_code, token) WHERE token IS NOT NULL;

CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prize TEXT NOT NULL,
  eligible_count INTEGER NOT NULL,
  reveal TEXT NOT NULL,
  reel_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
`;

export function statements(sql) {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}
