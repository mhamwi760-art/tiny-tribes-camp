/* ==========================================================
   Tiny Tribes – backend (Cloudflare Worker + D1)

   Public (the website):
     GET   /api/content            programs, prices, photo lists
     GET   /photos/:id             an uploaded photo
     POST  /api/orders             new registration -> { order, editToken }
     PATCH /api/orders/:id         parent edits own order (X-Edit-Token)
     POST  /api/messages           contact form

   Dashboard (needs "Authorization: Bearer <token>"):
     POST  /api/login              { email, password } -> { token, user }
     POST  /api/accept-invite      { code, name, email, password } -> { token, user }
     GET   /api/me   POST /api/logout   POST /api/password
     GET   /api/orders   PATCH/DELETE /api/orders/:id
     GET   /api/messages PATCH/DELETE /api/messages/:id
     PUT   /api/content  POST /api/photos
     GET   /api/users    DELETE /api/users/:id   POST /api/invites
   ========================================================== */

const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const MAX_FAILS = 5; // wrong passwords allowed per email ...
const FAIL_WINDOW_MIN = 15; // ... in this many minutes
const PBKDF2_ITERATIONS = 100000;
const STATUSES = ["Awaiting payment", "Paid", "Paid (demo)", "Cancelled"];

/* ---------- small helpers ---------- */
const enc = new TextEncoder();
const now = () => new Date().toISOString();
const addDays = (d) => new Date(Date.now() + d * 864e5).toISOString();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

function makeId(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(5));
  const part = [...r].map((b) => chars[b % chars.length]).join("");
  return `${prefix}-${Date.now().toString().slice(-5)}-${part}`;
}

async function hashPassword(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}

function sameText(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

function text(v, max, label, required = true) {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) fail(400, `Please fill in ${label}.`);
  if (s.length > max) fail(400, `${label} is too long.`);
  return s;
}

async function body(request, maxBytes = 200000) {
  const raw = await request.text();
  if (raw.length > maxBytes) fail(413, "That is too much data.");
  try {
    return JSON.parse(raw || "{}");
  } catch (e) {
    fail(400, "Bad request.");
  }
}

function checkPassword(p) {
  if (typeof p !== "string" || p.length < 10) fail(400, "Please use a password with at least 10 characters.");
  if (p.length > 200) fail(400, "That password is too long.");
  return p;
}

function checkEmail(e) {
  const s = text(e, 200, "your email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(400, "Please enter a valid email.");
  return s;
}

/* ---------- CORS ---------- */
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Edit-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });

/* ---------- sessions ---------- */
async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now(), addDays(SESSION_DAYS))
    .run();
  return token;
}

async function currentUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.name, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  )
    .bind(await sha256(token), now())
    .first();
  return row || null;
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) fail(401, "Please sign in again.");
  return user;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

/* ---------- content ---------- */
async function getContent(env) {
  const row = await env.DB.prepare("SELECT data FROM content WHERE key = 'site'").first();
  return row ? JSON.parse(row.data) : null;
}

/* Rebuild an order from what the parent sent, using the real prices */
async function buildOrder(env, input) {
  const content = await getContent(env);
  if (!content) fail(503, "Registration is not available right now. Please call us.");
  const program = content.programs && content.programs[input.programId];
  if (!program || !program.open) fail(400, "This program is not open for registration.");
  const option = (program.options || []).find((o) => o.id === input.optionId);
  if (!option) fail(400, "Please choose an option.");
  const kids = Array.isArray(input.children) ? input.children : [];
  if (kids.length < 1 || kids.length > 10) fail(400, "Please add between 1 and 10 children.");
  const p = input.parent || {};
  const children = kids.map((c) => ({
    name: text(c.name, 100, "the child's name"),
    age: text(c.age, 40, "the child's age"),
    notes: text(c.notes, 1000, "notes", false)
  }));
  return {
    programId: input.programId,
    programName: program.name,
    optionId: option.id,
    optionLabel: `${option.label} (${option.dates})`,
    unitPrice: Number(option.price) || 0,
    parent: {
      name: text(p.name, 100, "the parent's name"),
      phone: text(p.phone, 40, "the phone number"),
      email: text(p.email, 200, "the email", false),
      emergency: text(p.emergency, 40, "the emergency phone")
    },
    children,
    total: (Number(option.price) || 0) * children.length
  };
}

async function loadOrder(env, id) {
  const row = await env.DB.prepare("SELECT id, edit_hash, created_at, data FROM orders WHERE id = ?").bind(id).first();
  if (!row) fail(404, "Order not found.");
  return row;
}

const orderOut = (row) => Object.assign(JSON.parse(row.data), { id: row.id, createdAt: row.created_at });
const messageOut = (row) => Object.assign(JSON.parse(row.data), { id: row.id, createdAt: row.created_at });

/* ---------- routes ---------- */
async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  const parts = pathname.split("/").filter(Boolean); // e.g. ["api","orders","TT-1"]

  /* Photos */
  if (method === "GET" && parts[0] === "photos" && parts[1]) {
    const row = await env.DB.prepare("SELECT type, bytes FROM photos WHERE id = ?").bind(parts[1]).first();
    if (!row) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(row.bytes), {
      headers: { "Content-Type": row.type, "Cache-Control": "public, max-age=31536000, immutable" }
    });
  }

  if (parts[0] !== "api") fail(404, "Not found.");
  const what = parts[1];
  const id = parts[2];

  /* ----- public ----- */
  if (what === "content" && method === "GET") {
    return json({ content: await getContent(env) }, 200, { "Cache-Control": "no-store" });
  }

  if (what === "orders" && method === "POST" && !id) {
    const order = await buildOrder(env, await body(request));
    order.status = "Awaiting payment";
    const orderId = makeId("TT");
    const editToken = randomHex(24);
    const created = now();
    await env.DB.prepare("INSERT INTO orders (id, edit_hash, created_at, data) VALUES (?, ?, ?, ?)")
      .bind(orderId, await sha256(editToken), created, JSON.stringify(order))
      .run();
    return json({ order: Object.assign(order, { id: orderId, createdAt: created }), editToken }, 201);
  }

  if (what === "messages" && method === "POST" && !id) {
    const b = await body(request, 20000);
    const msg = {
      name: text(b.name, 100, "your name"),
      phone: text(b.phone, 40, "your phone"),
      email: text(b.email, 200, "your email", false),
      message: text(b.message, 3000, "your message"),
      read: false
    };
    await env.DB.prepare("INSERT INTO messages (id, created_at, data) VALUES (?, ?, ?)")
      .bind(makeId("MSG"), now(), JSON.stringify(msg))
      .run();
    return json({ ok: true }, 201);
  }

  // A parent editing their own order (only before it is paid)
  if (what === "orders" && method === "PATCH" && id && request.headers.get("X-Edit-Token")) {
    const row = await loadOrder(env, id);
    if (!sameText(await sha256(request.headers.get("X-Edit-Token")), row.edit_hash)) fail(403, "You cannot change this order.");
    const current = JSON.parse(row.data);
    if (current.status !== "Awaiting payment") fail(409, "This order can no longer be changed.");
    const b = await body(request);
    let next;
    if (b.status === "Paid (demo)") {
      // Payments are still a demo: this only marks the order, no money is taken.
      next = Object.assign(current, { status: "Paid (demo)", method: text(b.method, 20, "method", false), paidAt: now() });
    } else {
      next = Object.assign(await buildOrder(env, b), { status: "Awaiting payment" });
    }
    await env.DB.prepare("UPDATE orders SET data = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
    return json({ order: Object.assign(next, { id, createdAt: row.created_at }) });
  }

  /* ----- signing in ----- */
  if (what === "login" && method === "POST") {
    const b = await body(request, 5000);
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");
    const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
    const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?").bind(email, since).first();
    if (fails.n >= MAX_FAILS) fail(429, `Too many wrong tries. Please wait ${FAIL_WINDOW_MIN} minutes and try again.`);
    const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
    const hash = await hashPassword(password, user ? user.pass_salt : "00".repeat(16));
    if (!user || !sameText(hash, user.pass_hash)) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO login_fails (email, at) VALUES (?, ?)").bind(email, now()),
        env.DB.prepare("DELETE FROM login_fails WHERE at < ?").bind(new Date(Date.now() - 864e5).toISOString())
      ]);
      fail(401, "Wrong email or password.");
    }
    await env.DB.prepare("DELETE FROM login_fails WHERE email = ?").bind(email).run();
    return json({ token: await startSession(env, user.id), user: publicUser(user) });
  }

  if (what === "accept-invite" && method === "POST") {
    const b = await body(request, 5000);
    const codeHash = await sha256(String(b.code || ""));
    const invite = await env.DB.prepare("SELECT * FROM invites WHERE code_hash = ? AND expires_at > ?").bind(codeHash, now()).first();
    if (!invite) fail(400, "This invite link is not valid or has expired. Please ask for a new one.");
    const email = checkEmail(b.email);
    const name = text(b.name, 100, "your name");
    const password = checkPassword(b.password);
    const taken = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (taken) fail(409, "An account with this email already exists. Please sign in instead.");
    const salt = randomHex(16);
    const result = await env.DB.prepare("INSERT INTO users (email, name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(email, name, await hashPassword(password, salt), salt, now())
      .run();
    await env.DB.prepare("DELETE FROM invites WHERE code_hash = ?").bind(codeHash).run();
    const userId = result.meta.last_row_id;
    return json({ token: await startSession(env, userId), user: { id: userId, email, name } }, 201);
  }

  /* ----- everything below needs a signed-in user ----- */
  const user = await requireUser(request, env);

  if (what === "me" && method === "GET") return json({ user: publicUser(user) });

  if (what === "logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.token_hash).run();
    return json({ ok: true });
  }

  if (what === "password" && method === "POST") {
    const b = await body(request, 5000);
    const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    if (!sameText(await hashPassword(String(b.current || ""), row.pass_salt), row.pass_hash)) fail(400, "Your current password is not right.");
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(await hashPassword(checkPassword(b.next), salt), salt, user.id),
      // Sign out every other device
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, user.token_hash)
    ]);
    return json({ ok: true });
  }

  /* Orders */
  if (what === "orders") {
    if (method === "GET" && !id) {
      const { results } = await env.DB.prepare("SELECT id, created_at, data FROM orders ORDER BY created_at DESC").all();
      return json({ orders: results.map(orderOut) });
    }
    if (method === "PATCH" && id) {
      const row = await loadOrder(env, id);
      const b = await body(request);
      const next = JSON.parse(row.data);
      if (b.status !== undefined) {
        if (!STATUSES.includes(b.status)) fail(400, "Unknown status.");
        next.status = b.status;
      }
      await env.DB.prepare("UPDATE orders SET data = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
      return json({ order: orderOut({ id, created_at: row.created_at, data: JSON.stringify(next) }) });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM orders WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  /* Messages */
  if (what === "messages") {
    if (method === "GET" && !id) {
      const { results } = await env.DB.prepare("SELECT id, created_at, data FROM messages ORDER BY created_at DESC").all();
      return json({ messages: results.map(messageOut) });
    }
    if (method === "PATCH" && id) {
      const row = await env.DB.prepare("SELECT * FROM messages WHERE id = ?").bind(id).first();
      if (!row) fail(404, "Message not found.");
      const b = await body(request, 2000);
      const next = Object.assign(JSON.parse(row.data), { read: !!b.read });
      await env.DB.prepare("UPDATE messages SET data = ? WHERE id = ?").bind(JSON.stringify(next), id).run();
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  /* Content */
  if (what === "content" && method === "PUT") {
    const raw = await request.text();
    if (raw.length > 500000) fail(413, "That is too much data.");
    let content;
    try {
      content = JSON.parse(raw);
    } catch (e) {
      fail(400, "Bad request.");
    }
    if (!content || typeof content.programs !== "object" || !Array.isArray(content.categories)) fail(400, "Bad content.");
    const data = JSON.stringify(content);
    await env.DB.prepare("INSERT INTO content (key, data, updated_at) VALUES ('site', ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(data, now())
      .run();
    // Remove uploaded photos that are no longer used anywhere
    const { results } = await env.DB.prepare("SELECT id FROM photos").all();
    const unused = results.filter((r) => !data.includes(`/photos/${r.id}`));
    if (unused.length) await env.DB.batch(unused.map((r) => env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(r.id)));
    return json({ ok: true });
  }

  /* Photo upload (already made small by the dashboard) */
  if (what === "photos" && method === "POST") {
    const type = (request.headers.get("Content-Type") || "").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) fail(400, "Please upload a JPG, PNG or WebP photo.");
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 1500000) fail(413, "This photo is too big.");
    const photoId = randomHex(12);
    await env.DB.prepare("INSERT INTO photos (id, type, bytes, created_at) VALUES (?, ?, ?, ?)").bind(photoId, type, bytes, now()).run();
    return json({ url: `${url.origin}/photos/${photoId}` }, 201);
  }

  /* Accounts */
  if (what === "users" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, email, name, created_at FROM users ORDER BY id").all();
    return json({ users: results.map((u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at })), me: user.id });
  }
  if (what === "users" && method === "DELETE" && id) {
    if (Number(id) === user.id) fail(400, "You cannot remove your own account.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(Number(id)),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(Number(id))
    ]);
    return json({ ok: true });
  }
  if (what === "invites" && method === "POST") {
    const code = randomHex(20);
    await env.DB.prepare("INSERT INTO invites (code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(code), user.id, now(), addDays(INVITE_DAYS))
      .run();
    return json({ code, expiresAt: addDays(INVITE_DAYS) }, 201);
  }

  fail(404, "Not found.");
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env, new URL(request.url));
    } catch (err) {
      if (err instanceof HttpError) res = json({ error: err.message }, err.status);
      else {
        console.error(err);
        res = json({ error: "Something went wrong. Please try again." }, 500);
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};
