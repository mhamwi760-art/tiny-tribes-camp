/* ==========================================================
   Tiny Tribes – backend (Cloudflare Worker + D1)

   Public (the website):
     GET   /api/content            programs, prices, photo lists
     GET   /photos/:id             an uploaded photo
     POST  /api/orders             new registration -> { order, editToken }
     PATCH /api/orders/:id         parent edits own order (X-Edit-Token)
     POST  /api/messages           contact form
     GET   /api/status             { hasOwner }

   Dashboard:
     POST  /api/setup              { code, name, username, password } (first owner, one-time code)
     POST  /api/login              { username, password } -> { token, user }
   Needs "Authorization: Bearer <token>":
     POST  /api/logout   POST /api/password { current, next }
     GET   /api/all                everything this person may see
     PUT   /api/items/:coll/:id    save one order, message, leave or payroll record
     POST  /api/history            add a history line (who and when are set here)
     PUT   /api/users/:id          owner: add or change an employee
     PUT   /api/content  POST /api/photos  POST /api/reset

   Permissions are checked here, not only in the browser.
   ========================================================== */

const SESSION_HOURS = 12;
const MAX_FAILS = 5; // wrong passwords allowed per username ...
const FAIL_WINDOW_MIN = 15; // ... in this many minutes
const PBKDF2_ITERATIONS = 100000;
const MIN_PASSWORD = 6;
const HISTORY_LIMIT = 5000;
const ORDER_PERMS = ["orders.status", "orders.cancel", "orders.restore", "orders.refund", "orders.test"];

/* ---------- small helpers ---------- */
const enc = new TextEncoder();
const now = () => new Date().toISOString();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

function makeId(prefix) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(5));
  return `${prefix}-${Date.now().toString().slice(-5)}-${[...r].map((b) => chars[b % chars.length]).join("")}`;
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
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
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
  if (typeof p !== "string" || p.length < MIN_PASSWORD) fail(400, `The password needs at least ${MIN_PASSWORD} characters.`);
  if (p.length > 200) fail(400, "That password is too long.");
  return p;
}

function checkUsername(u) {
  const s = String(u || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(s)) fail(400, "Username: at least 3 letters or numbers, no spaces.");
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
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

/* ---------- accounts ---------- */
function userFromRow(row) {
  return Object.assign(JSON.parse(row.data), { id: row.id, username: row.username });
}

const can = (u, perm) => !!u && (u.role === "owner" || (perm !== "owner" && (u.perms || []).includes(perm)));
const canAny = (u, perms) => perms.some((p) => can(u, p));

async function startSession(env, userId) {
  const token = randomHex(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, now(), new Date(Date.now() + SESSION_HOURS * 36e5).toISOString())
    .run();
  return token;
}

async function currentUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT a.id, a.username, a.data FROM sessions s JOIN accounts a ON a.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  )
    .bind(tokenHash, now())
    .first();
  if (!row) return null;
  const user = userFromRow(row);
  if (!user.active) return null;
  user.tokenHash = tokenHash;
  return user;
}

/* What one person may see about another (salaries only for the owner and yourself) */
function userOut(u, viewer) {
  const out = { id: u.id, username: u.username, name: u.name, role: u.role, perms: u.perms || [], active: !!u.active, createdAt: u.createdAt, createdBy: u.createdBy };
  if (u.hr) {
    if (viewer.role === "owner" || viewer.id === u.id) out.hr = u.hr;
    else out.hr = { job: u.hr.job, annual: u.hr.annual, sick: u.hr.sick };
  }
  return out;
}

/* ---------- history ---------- */
function historyRow(entry, by) {
  const h = {
    id: makeId("H"),
    at: now(),
    by: by ? by.name : "Website",
    byId: by ? by.id : "website",
    area: text(entry.area, 40, "area"),
    target: text(entry.target, 200, "target", false),
    action: text(entry.action, 600, "action"),
    from: text(entry.from, 2000, "from", false),
    to: text(entry.to, 2000, "to", false)
  };
  if (entry.photo) h.photo = text(entry.photo, 300, "photo", false);
  return h;
}

function logStmt(env, entry, by) {
  const h = historyRow(entry, by);
  return env.DB.prepare("INSERT INTO items (coll, id, data, updated_at) VALUES ('history', ?, ?, ?)").bind(h.id, JSON.stringify(h), h.at);
}

/* ---------- content and orders ---------- */
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
  const price = Number(option.price) || 0;
  return {
    programId: input.programId,
    programName: program.name,
    optionId: option.id,
    optionLabel: `${option.label} (${option.dates})`,
    unitPrice: price,
    parent: {
      name: text(p.name, 100, "the parent's name"),
      phone: text(p.phone, 40, "the phone number"),
      email: text(p.email, 200, "the email", false),
      emergency: text(p.emergency, 40, "the emergency phone")
    },
    children,
    total: price * children.length
  };
}

const childText = (o) => `${o.parent.name} · ${o.programName} · ${o.children.length} ${o.children.length === 1 ? "child" : "children"}`;

async function getItem(env, coll, id) {
  const row = await env.DB.prepare("SELECT data, secret FROM items WHERE coll = ? AND id = ?").bind(coll, id).first();
  return row ? { data: JSON.parse(row.data), secret: row.secret } : null;
}

async function listItems(env, coll, sortKey, limit = 100000) {
  const { results } = await env.DB.prepare(
    `SELECT data FROM items WHERE coll = ? ORDER BY json_extract(data, '$.${sortKey}') DESC LIMIT ?`
  )
    .bind(coll, limit)
    .all();
  return results.map((r) => JSON.parse(r.data));
}

/* May this person save this record? */
function mayWrite(user, coll, next, existing) {
  if (user.role === "owner") return true;
  if (coll === "orders") return existing ? canAny(user, ORDER_PERMS) : can(user, "orders.test") && next.test === true;
  if (coll === "messages") return !!existing && can(user, "messages.manage");
  if (coll === "leave") {
    if (can(user, "hr.approve")) return true;
    if (next.userId !== user.id || (existing && existing.userId !== user.id)) return false;
    if (next.status === "pending" && (!existing || existing.status === "pending") && !next.cancelled) return true;
    return !!existing && next.cancelled === true; // cancelling your own leave
  }
  return false; // payroll: owner only
}

/* ---------- routes ---------- */
async function route(request, env, url) {
  const method = request.method;
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","orders","TT-1"]

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

  /* ===== public ===== */
  if (what === "content" && method === "GET") return json({ content: await getContent(env) });

  if (what === "status" && method === "GET") {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first();
    return json({ hasOwner: row.n > 0 });
  }

  if (what === "orders" && method === "POST" && !id) {
    const order = await buildOrder(env, await body(request));
    const editToken = randomHex(24);
    Object.assign(order, { id: makeId("TT"), createdAt: now(), status: "Awaiting payment" });
    await env.DB.batch([
      env.DB.prepare("INSERT INTO items (coll, id, data, secret, updated_at) VALUES ('orders', ?, ?, ?, ?)").bind(order.id, JSON.stringify(order), await sha256(editToken), now()),
      logStmt(env, { area: "Order", target: order.id, action: "New registration", to: childText(order) })
    ]);
    return json({ order, editToken }, 201);
  }

  // A parent changing their own order (only before it is paid)
  if (what === "orders" && method === "PATCH" && id) {
    const item = await getItem(env, "orders", id);
    const tokenHash = await sha256(request.headers.get("X-Edit-Token") || "");
    if (!item || !item.secret || !sameText(tokenHash, item.secret)) fail(403, "You cannot change this order.");
    const current = item.data;
    if (current.status !== "Awaiting payment") fail(409, "This order can no longer be changed.");
    const b = await body(request);
    let next;
    let entry;
    if (b.status === "Paid (demo)") {
      // Payments are still a demo: this only marks the order, no money is taken.
      const m = text(b.method, 20, "method", false);
      next = Object.assign(current, { status: "Paid (demo)", method: m, paidAt: now() });
      entry = { area: "Order", target: id, action: "Status changed", from: "Awaiting payment", to: `Paid (demo) by ${m}` };
    } else {
      next = Object.assign(await buildOrder(env, b), { id, createdAt: current.createdAt, status: "Awaiting payment" });
      entry = { area: "Order", target: id, action: "Parent edited registration", to: childText(next) };
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE items SET data = ?, updated_at = ? WHERE coll = 'orders' AND id = ?").bind(JSON.stringify(next), now(), id),
      logStmt(env, entry)
    ]);
    return json({ order: next });
  }

  if (what === "messages" && method === "POST" && !id) {
    const b = await body(request, 20000);
    const msg = {
      id: makeId("MSG"),
      createdAt: now(),
      read: false,
      name: text(b.name, 100, "your name"),
      phone: text(b.phone, 40, "your phone"),
      email: text(b.email, 200, "your email", false),
      message: text(b.message, 3000, "your message")
    };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO items (coll, id, data, updated_at) VALUES ('messages', ?, ?, ?)").bind(msg.id, JSON.stringify(msg), now()),
      logStmt(env, { area: "Message", target: msg.id, action: "New message from the contact form", to: msg.name })
    ]);
    return json({ ok: true }, 201);
  }

  /* ===== logging in ===== */
  if (what === "setup" && method === "POST") {
    const b = await body(request, 5000);
    const codeHash = await sha256(String(b.code || ""));
    const invite = await env.DB.prepare("SELECT * FROM invites WHERE code_hash = ? AND expires_at > ?").bind(codeHash, now()).first();
    if (!invite) fail(400, "This setup link is not valid or has expired.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first();
    if (count.n > 0) fail(409, "The owner account already exists. Please log in.");
    const name = text(b.name, 100, "your name");
    const username = checkUsername(b.username);
    const salt = randomHex(16);
    const owner = { id: makeId("U"), name, role: "owner", perms: [], active: true, createdAt: now() };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO accounts (id, username, pass_hash, pass_salt, data) VALUES (?, ?, ?, ?, ?)")
        .bind(owner.id, username, await hashPassword(checkPassword(b.password), salt), salt, JSON.stringify(owner)),
      env.DB.prepare("DELETE FROM invites"),
      logStmt(env, { area: "Employees", target: username, action: "Owner account created", to: name }, owner),
      logStmt(env, { area: "Login", target: username, action: "Logged in" }, owner)
    ]);
    owner.username = username;
    return json({ token: await startSession(env, owner.id), user: owner }, 201);
  }

  if (what === "login" && method === "POST") {
    const b = await body(request, 5000);
    const username = String(b.username || "").trim().toLowerCase().slice(0, 60);
    const password = String(b.password || "").slice(0, 200);
    const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
    const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?").bind(username, since).first();
    if (fails.n >= MAX_FAILS) fail(429, `Too many wrong tries. Please wait ${FAIL_WINDOW_MIN} minutes and try again.`);
    const row = await env.DB.prepare("SELECT * FROM accounts WHERE username = ?").bind(username).first();
    const hash = await hashPassword(password, row ? row.pass_salt : "00".repeat(16));
    if (!row || !sameText(hash, row.pass_hash)) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO login_fails (email, at) VALUES (?, ?)").bind(username, now()),
        env.DB.prepare("DELETE FROM login_fails WHERE at < ?").bind(new Date(Date.now() - 864e5).toISOString())
      ]);
      fail(401, "Wrong username or password.");
    }
    const user = userFromRow(row);
    if (!user.active) fail(403, "This account is switched off. Please ask the owner.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_fails WHERE email = ?").bind(username),
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()),
      logStmt(env, { area: "Login", target: username, action: "Logged in" }, user)
    ]);
    return json({ token: await startSession(env, user.id), user: userOut(user, user) });
  }

  /* ===== everything below needs a signed-in, active account ===== */
  const user = await currentUser(request, env);
  if (!user) fail(401, "Please log in again.");

  if (what === "logout" && method === "POST") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(user.tokenHash),
      logStmt(env, { area: "Login", target: user.username, action: "Logged out" }, user)
    ]);
    return json({ ok: true });
  }

  if (what === "password" && method === "POST") {
    const b = await body(request, 5000);
    const row = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(user.id).first();
    if (!sameText(await hashPassword(String(b.current || ""), row.pass_salt), row.pass_hash)) fail(400, "The current password is wrong.");
    const salt = randomHex(16);
    await env.DB.batch([
      env.DB.prepare("UPDATE accounts SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(await hashPassword(checkPassword(b.next), salt), salt, user.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, user.tokenHash), // sign out other devices
      logStmt(env, { area: "Employees", target: user.username, action: "Changed own password" }, user)
    ]);
    return json({ ok: true });
  }

  /* Everything this person is allowed to see, in one go */
  if (what === "all" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, username, data FROM accounts").all();
    const users = results.map(userFromRow).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const seeOrders = canAny(user, ["orders.view", ...ORDER_PERMS, "orders.export"]);
    const seeMessages = canAny(user, ["messages.view", "messages.manage"]);
    const seeAllLeave = canAny(user, ["hr.approve"]);
    let history = await listItems(env, "history", "at", HISTORY_LIMIT);
    if (user.role !== "owner") {
      history = history.filter(
        (h) =>
          h.byId === user.id ||
          (can(user, "history.view") && h.area !== "HR" && h.area !== "Employees" && h.area !== "Login") ||
          (seeOrders && h.area === "Order") ||
          (seeMessages && h.area === "Message")
      );
    }
    const leave = await listItems(env, "leave", "createdAt");
    const payroll = {};
    if (user.role === "owner") {
      const { results: pay } = await env.DB.prepare("SELECT id, data FROM items WHERE coll = 'payroll'").all();
      pay.forEach((r) => (payroll[r.id] = JSON.parse(r.data)));
    }
    return json({
      me: userOut(user, user),
      users: users.map((u) => userOut(u, user)),
      orders: seeOrders ? await listItems(env, "orders", "createdAt") : [],
      messages: seeMessages ? await listItems(env, "messages", "createdAt") : [],
      history,
      leave: seeAllLeave ? leave : leave.filter((l) => l.userId === user.id),
      payroll
    });
  }

  /* Save one record */
  if (what === "items" && method === "PUT" && id && parts[3]) {
    const coll = id;
    const itemId = decodeURIComponent(parts[3]);
    if (!["orders", "messages", "leave", "payroll"].includes(coll)) fail(400, "Unknown list.");
    if (itemId.length > 80) fail(400, "Bad id.");
    const next = await body(request, 100000);
    if (!next || typeof next !== "object" || Array.isArray(next)) fail(400, "Bad record.");
    if (coll !== "payroll") next.id = itemId;
    const existing = await getItem(env, coll, itemId);
    if (!mayWrite(user, coll, next, existing && existing.data)) fail(403, "You don't have permission to do this. Please ask the owner.");
    await env.DB.prepare(
      "INSERT INTO items (coll, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(coll, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    )
      .bind(coll, itemId, JSON.stringify(next), now())
      .run();
    return json({ ok: true });
  }

  /* History line from the dashboard (who and when are set here) */
  if (what === "history" && method === "POST") {
    const b = await body(request, 10000);
    if (b.area === "Login") fail(400, "Logins are recorded by the server.");
    const h = historyRow(b, user);
    await env.DB.prepare("INSERT INTO items (coll, id, data, updated_at) VALUES ('history', ?, ?, ?)").bind(h.id, JSON.stringify(h), h.at).run();
    return json({ entry: h }, 201);
  }

  /* Owner: add or change an employee */
  if (what === "users" && method === "PUT" && id) {
    if (user.role !== "owner") fail(403, "Only the owner can change accounts.");
    const b = await body(request, 20000);
    const row = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(id).first();
    const username = checkUsername(b.username);
    const taken = await env.DB.prepare("SELECT id FROM accounts WHERE username = ? AND id != ?").bind(username, id).first();
    if (taken) fail(409, "That username is already taken.");
    const old = row ? userFromRow(row) : null;
    const isOwner = old && old.role === "owner";
    const perms = Array.isArray(b.perms) ? b.perms.filter((p) => typeof p === "string").slice(0, 50) : [];
    const data = {
      name: text(b.name, 100, "the name"),
      role: isOwner ? "owner" : "employee",
      perms: isOwner ? [] : perms,
      active: isOwner ? true : b.active !== false,
      createdAt: old ? old.createdAt : now(),
      createdBy: old ? old.createdBy : user.name
    };
    if (b.hr && typeof b.hr === "object") data.hr = b.hr;
    else if (old && old.hr) data.hr = old.hr;
    const stmts = [];
    if (!row) {
      const salt = randomHex(16);
      stmts.push(
        env.DB.prepare("INSERT INTO accounts (id, username, pass_hash, pass_salt, data) VALUES (?, ?, ?, ?, ?)")
          .bind(id, username, await hashPassword(checkPassword(b.password), salt), salt, JSON.stringify(data))
      );
    } else {
      stmts.push(env.DB.prepare("UPDATE accounts SET username = ?, data = ? WHERE id = ?").bind(username, JSON.stringify(data), id));
      if (b.password) {
        const salt = randomHex(16);
        stmts.push(env.DB.prepare("UPDATE accounts SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(await hashPassword(checkPassword(b.password), salt), salt, id));
      }
      // Switched off or new password: sign them out everywhere
      if (b.password || (old.active && !data.active)) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND user_id != ?").bind(id, user.id));
    }
    await env.DB.batch(stmts);
    return json({ user: userOut(Object.assign(data, { id, username }), user) });
  }

  /* Content */
  if (what === "content" && method === "PUT") {
    if (!canAny(user, ["programs.edit", "photos.edit"])) fail(403, "You don't have permission to do this. Please ask the owner.");
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
    await env.DB.prepare(
      "INSERT INTO content (key, data, updated_at) VALUES ('site', ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
    )
      .bind(data, now())
      .run();
    // Remove uploaded photos that are no longer used anywhere (hidden photos are still kept)
    const { results } = await env.DB.prepare("SELECT id FROM photos").all();
    const unused = results.filter((r) => !data.includes(`/photos/${r.id}`));
    if (unused.length) await env.DB.batch(unused.map((r) => env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(r.id)));
    return json({ ok: true });
  }

  /* Photo upload (already made small by the dashboard) */
  if (what === "photos" && method === "POST") {
    if (!can(user, "photos.edit")) fail(403, "You don't have permission to do this. Please ask the owner.");
    const type = (request.headers.get("Content-Type") || "").split(";")[0];
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) fail(400, "Please upload a JPG, PNG or WebP photo.");
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 1500000) fail(413, "This photo is too big.");
    const photoId = randomHex(12);
    await env.DB.prepare("INSERT INTO photos (id, type, bytes, created_at) VALUES (?, ?, ?, ?)").bind(photoId, type, bytes, now()).run();
    return json({ url: `${url.origin}/photos/${photoId}` }, 201);
  }

  /* Owner: start fresh (accounts are kept) */
  if (what === "reset" && method === "POST") {
    if (user.role !== "owner") fail(403, "Only the owner can do this.");
    await env.DB.prepare("DELETE FROM items WHERE coll IN ('orders', 'messages', 'history', 'leave', 'payroll')").run();
    return json({ ok: true });
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
