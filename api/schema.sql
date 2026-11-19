-- Tiny Tribes database (Cloudflare D1)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Signed-in devices. Only a hash of the token is kept.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One-time links to create an account. Only a hash of the code is kept.
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Failed sign-ins, to slow down password guessing
CREATE TABLE IF NOT EXISTS login_fails (
  email TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_fails_email ON login_fails (email, at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  edit_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);

-- Programs, prices and photo lists (one row, key = 'site')
CREATE TABLE IF NOT EXISTS content (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Photos uploaded from the dashboard
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT NOT NULL
);
