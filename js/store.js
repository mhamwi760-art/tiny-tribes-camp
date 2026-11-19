/* ==========================================================
   Tiny Tribes – data store
   One place that reads and saves content, orders, messages,
   dashboard users, leave, payroll and the history of changes.

   Everything is kept online (Cloudflare Worker + D1 database,
   see the api/ folder). The dashboard loads all it may see once
   after logging in and keeps a copy in memory, so reading stays
   instant; every save is sent to the server straight away.
   The server checks the login and permissions on every save.

   Nothing is ever deleted: orders are cancelled, messages are
   archived and photos are hidden, and every change is logged.
   ========================================================== */

(function () {
  const API = "https://tiny-tribes-api.tinytribescamp.workers.dev";
  const CACHE_KEY = "tt-live-content"; // last content seen, so pages still work if the network is slow
  const TOKEN_KEY = "tt-dash-token"; // kept for this browser tab only, like before

  const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
  const safe = (fn, fallback) => {
    try { return fn(); } catch (e) { return fallback; }
  };
  const token = () => safe(() => sessionStorage.getItem(TOKEN_KEY), null);

  function makeId(prefix) {
    const part = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${Date.now().toString().slice(-5)}-${part}`;
  }

  async function call(path, { method = "GET", body, headers = {}, raw = false } = {}) {
    const h = Object.assign({}, headers);
    const t = token();
    if (t) h.Authorization = `Bearer ${t}`;
    if (body !== undefined && !raw) h["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(API + path, { method, headers: h, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw Object.assign(new Error("Could not reach the server. Please check your internet and try again."), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && t && !path.startsWith("/api/password")) {
        safe(() => sessionStorage.removeItem(TOKEN_KEY));
        window.dispatchEvent(new Event("tt-signed-out"));
      }
      throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: res.status });
    }
    return data;
  }

  /* ---------- Saving in the background, one after another ---------- */
  let queue = Promise.resolve();
  let warned = false;
  function send(path, opts) {
    const p = queue.then(() => call(path, opts));
    queue = p.catch((err) => {
      if (err.status === 401) return;
      if (!warned) {
        warned = true;
        alert(`${err.message}\n\nThis change was not saved. The page will reload to show what is saved.`);
        location.reload();
      }
    });
    return p;
  }

  /* ---------- Content (public pages load this first) ---------- */
  let content = null;

  function fromCache() {
    const saved = safe(() => JSON.parse(localStorage.getItem(CACHE_KEY)), null);
    return saved && saved.version === window.TT_DEFAULTS.version ? saved : null;
  }
  function useContent(c) {
    content = c && c.version === window.TT_DEFAULTS.version ? c : clone(window.TT_DEFAULTS);
    safe(() => localStorage.setItem(CACHE_KEY, JSON.stringify(content)));
  }

  // Load the live content once per page (falls back to the last copy after 4 seconds)
  const ready = Promise.race([call("/api/content").then((d) => useContent(d.content)), new Promise((r) => setTimeout(r, 4000))])
    .catch(() => {})
    .then(() => {
      if (!content) content = fromCache() || clone(window.TT_DEFAULTS);
    });

  /* ---------- Dashboard data (in memory after login) ---------- */
  const db = { users: [], orders: [], messages: [], history: [], leave: [], payroll: {} };
  const LISTS = { "tt-leave": "leave", "tt-payroll": "payroll" };

  window.TTStore = {
    mode: "live",
    api: API,
    ready,
    actor: null,
    makeId,

    /* Small version of a site photo for tiles and grids (uploaded photos have none) */
    thumb(src) {
      return src.startsWith("assets/img/gallery/") ? src.replace("assets/img/gallery/", "assets/img/gallery/thumbs/") : src;
    },

    /* ---------- Content (programs, prices, photos) ---------- */
    getContent() {
      return clone(content || fromCache() || window.TT_DEFAULTS);
    },
    saveContent(next) {
      useContent(clone(next));
      send("/api/content", { method: "PUT", body: next });
      return true;
    },
    resetContentToDefaults() {
      return this.saveContent(clone(window.TT_DEFAULTS));
    },
    async uploadPhoto(blob) {
      return (await call("/api/photos", { method: "POST", body: blob, raw: true, headers: { "Content-Type": blob.type } })).url;
    },

    /* ---------- Public site (parents) ---------- */
    // Returns { order, editToken }. The token lets the parent fix the order before paying.
    async submitOrder(order) {
      return call("/api/orders", { method: "POST", body: order });
    },
    async updateOwnOrder(id, editToken, changes) {
      return (await call(`/api/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: changes, headers: { "X-Edit-Token": editToken } })).order;
    },
    async submitMessage(msg) {
      await call("/api/messages", { method: "POST", body: msg });
    },

    /* ---------- Logging in (dashboard) ---------- */
    hasToken() {
      return !!token();
    },
    async status() {
      return call("/api/status");
    },
    async setup(code, name, username, password) {
      const d = await call("/api/setup", { method: "POST", body: { code, name, username, password } });
      safe(() => sessionStorage.setItem(TOKEN_KEY, d.token));
      return this.load();
    },
    async login(username, password) {
      const d = await call("/api/login", { method: "POST", body: { username, password } });
      safe(() => sessionStorage.setItem(TOKEN_KEY, d.token));
      return this.load();
    },
    async logout() {
      await queue;
      try { await call("/api/logout", { method: "POST" }); } catch (e) { /* already logged out */ }
      safe(() => sessionStorage.removeItem(TOKEN_KEY));
    },
    async changePassword(current, next) {
      await call("/api/password", { method: "POST", body: { current, next } });
    },
    // Loads everything this person may see. Returns the logged-in user.
    async load() {
      const [d] = await Promise.all([call("/api/all"), ready]);
      Object.assign(db, { users: d.users, orders: d.orders, messages: d.messages, history: d.history, leave: d.leave, payroll: d.payroll });
      try { useContent((await call("/api/content")).content); } catch (e) { /* keep the copy we have */ }
      return d.me;
    },

    /* ---------- Orders (registrations) ---------- */
    getOrders() {
      return clone(db.orders);
    },
    // Dashboard: test orders
    addOrder(order) {
      const full = Object.assign({ id: makeId("TT"), createdAt: new Date().toISOString(), status: "Awaiting payment" }, order);
      db.orders.unshift(full);
      send(`/api/items/orders/${encodeURIComponent(full.id)}`, { method: "PUT", body: full });
      this.log({
        area: "Order",
        target: full.id,
        action: full.test ? "Created test order" : "New registration",
        to: `${full.parent.name} · ${full.programName} · ${full.children.length} ${full.children.length === 1 ? "child" : "children"}`
      });
      return clone(full);
    },
    updateOrder(id, changes) {
      const o = db.orders.find((x) => x.id === id);
      if (!o) return;
      Object.assign(o, clone(changes));
      send(`/api/items/orders/${encodeURIComponent(id)}`, { method: "PUT", body: o });
    },

    /* ---------- Messages (contact form) ---------- */
    getMessages() {
      return clone(db.messages);
    },
    updateMessage(id, changes) {
      const m = db.messages.find((x) => x.id === id);
      if (!m) return;
      Object.assign(m, clone(changes));
      send(`/api/items/messages/${encodeURIComponent(id)}`, { method: "PUT", body: m });
    },

    /* ---------- Dashboard users (owner and employees) ----------
       To set a password, put it in user.password before saving;
       it is sent once and never kept in the page. */
    getUsers() {
      return clone(db.users);
    },
    saveUsers(users) {
      const jobs = [];
      users.forEach((u) => {
        const before = db.users.find((x) => x.id === u.id);
        const { password, ...rest } = u;
        if (before && !password && JSON.stringify(before) === JSON.stringify(rest)) return;
        const body = { name: u.name, username: u.username, perms: u.perms || [], active: u.active !== false, hr: u.hr, password: password || undefined };
        jobs.push(send(`/api/users/${encodeURIComponent(u.id)}`, { method: "PUT", body }));
        delete u.password;
      });
      db.users = clone(users).map(({ password, ...rest }) => rest);
      return Promise.all(jobs);
    },

    /* ---------- Leave and payroll ---------- */
    getList(key, fallback) {
      const v = db[LISTS[key]];
      return v === undefined ? fallback : clone(v);
    },
    setList(key, value) {
      const name = LISTS[key];
      const before = db[name];
      const entries = Array.isArray(value) ? value.map((x) => [x.id, x]) : Object.entries(value);
      const old = Array.isArray(before) ? new Map(before.map((x) => [x.id, x])) : new Map(Object.entries(before));
      entries.forEach(([id, item]) => {
        if (JSON.stringify(old.get(id)) === JSON.stringify(item)) return;
        send(`/api/items/${name}/${encodeURIComponent(id)}`, { method: "PUT", body: item });
      });
      db[name] = clone(value);
      return true;
    },

    /* ---------- History: who changed what, and when ----------
       entry = { area, target, action, from, to }
       The server records who did it and when. */
    getHistory() {
      return clone(db.history);
    },
    log(entry) {
      const by = this.actor || { id: "website", name: "Website" };
      db.history.unshift(Object.assign({ id: makeId("H"), at: new Date().toISOString(), by: by.name, byId: by.id }, entry));
      send("/api/history", { method: "POST", body: entry });
      return true;
    },

    /* Owner: start fresh. Clears orders, messages, history, leave and payroll; keeps accounts. */
    async resetData(alsoContent) {
      await queue;
      await call("/api/reset", { method: "POST" });
      Object.assign(db, { orders: [], messages: [], history: [], leave: [], payroll: {} });
      if (alsoContent) this.resetContentToDefaults();
    }
  };
})();
