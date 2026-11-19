/* ==========================================================
   Tiny Tribes – data store
   One place that reads and saves content, orders and messages.
   Everything is kept online (Cloudflare Worker + D1 database,
   see the api/ folder). The rest of the site only talks to TTStore.
   ========================================================== */

(function () {
  const API = "https://tiny-tribes-api.tinytribescamp.workers.dev";
  const CACHE_KEY = "tt-live-content"; // last content seen, so pages still work if the network is slow
  const TOKEN_KEY = "tt-admin-token";

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const safe = (fn, fallback) => {
    try { return fn(); } catch (e) { return fallback; }
  };

  function token() {
    return safe(() => localStorage.getItem(TOKEN_KEY), null);
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
      if (res.status === 401 && t) {
        safe(() => localStorage.removeItem(TOKEN_KEY));
        window.dispatchEvent(new Event("tt-signed-out"));
      }
      throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: res.status });
    }
    return data;
  }

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
  const ready = Promise.race([
    call("/api/content").then((d) => useContent(d.content)),
    new Promise((resolve) => setTimeout(resolve, 4000))
  ])
    .catch(() => {})
    .then(() => {
      if (!content) content = fromCache() || clone(window.TT_DEFAULTS);
    });

  window.TTStore = {
    mode: "live",
    api: API,
    ready,

    /* Small version of a site photo for tiles and grids (uploaded photos have none) */
    thumb(src) {
      return src.startsWith("assets/img/gallery/") ? src.replace("assets/img/gallery/", "assets/img/gallery/thumbs/") : src;
    },

    /* ---------- Content (programs, prices, photos) ---------- */
    getContent() {
      return clone(content || fromCache() || window.TT_DEFAULTS);
    },
    async reloadContent() {
      useContent((await call("/api/content")).content);
      return this.getContent();
    },
    async saveContent(next) {
      await call("/api/content", { method: "PUT", body: next });
      useContent(next);
    },
    async uploadPhoto(blob) {
      return (await call("/api/photos", { method: "POST", body: blob, raw: true, headers: { "Content-Type": blob.type } })).url;
    },

    /* ---------- Orders (registrations) ---------- */
    // Parents: returns { order, editToken }. The token lets them fix the order before paying.
    async addOrder(order) {
      return call("/api/orders", { method: "POST", body: order });
    },
    async updateOwnOrder(id, editToken, changes) {
      return (await call(`/api/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: changes, headers: { "X-Edit-Token": editToken } })).order;
    },
    // Dashboard
    async getOrders() {
      return (await call("/api/orders")).orders;
    },
    async updateOrder(id, changes) {
      return (await call(`/api/orders/${encodeURIComponent(id)}`, { method: "PATCH", body: changes })).order;
    },
    async deleteOrder(id) {
      await call(`/api/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    /* ---------- Messages (contact form) ---------- */
    async addMessage(msg) {
      await call("/api/messages", { method: "POST", body: msg });
    },
    async getMessages() {
      return (await call("/api/messages")).messages;
    },
    async updateMessage(id, changes) {
      await call(`/api/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: changes });
    },
    async deleteMessage(id) {
      await call(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    /* ---------- Dashboard accounts ---------- */
    isSignedIn() {
      return !!token();
    },
    async signIn(email, password) {
      const d = await call("/api/login", { method: "POST", body: { email, password } });
      safe(() => localStorage.setItem(TOKEN_KEY, d.token));
      return d.user;
    },
    async acceptInvite(code, name, email, password) {
      const d = await call("/api/accept-invite", { method: "POST", body: { code, name, email, password } });
      safe(() => localStorage.setItem(TOKEN_KEY, d.token));
      return d.user;
    },
    async me() {
      return (await call("/api/me")).user;
    },
    async signOut() {
      try { await call("/api/logout", { method: "POST" }); } catch (e) { /* already signed out */ }
      safe(() => localStorage.removeItem(TOKEN_KEY));
    },
    async changePassword(current, next) {
      await call("/api/password", { method: "POST", body: { current, next } });
    },
    async getUsers() {
      return call("/api/users");
    },
    async removeUser(id) {
      await call(`/api/users/${id}`, { method: "DELETE" });
    },
    async createInvite() {
      return call("/api/invites", { method: "POST" });
    }
  };
})();
