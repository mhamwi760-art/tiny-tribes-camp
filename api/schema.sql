-- Tiny Tribes database (Cloudflare D1)

-- Dashboard accounts (owner and employees). Passwords are kept only as a salted PBKDF2 hash.
-- data = { name, role, perms, active, hr, createdAt, createdBy }
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  data TEXT NOT NULL
);

-- Signed-in devices. Only a hash of the token is kept.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One-time links to create the owner account. Only a hash of the code is kept.
CREATE TABLE IF NOT EXISTS invites (
  code_hash TEXT PRIMARY KEY,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Failed logins, to slow down password guessing
CREATE TABLE IF NOT EXISTS login_fails (
  email TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_fails_email ON login_fails (email, at);

-- Orders, messages, history, leave and payroll, one row per record.
-- secret = hash of the parent's edit token (orders only)
CREATE TABLE IF NOT EXISTS items (
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  secret TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (coll, id)
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
