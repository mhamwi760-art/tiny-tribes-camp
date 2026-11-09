/* ==========================================================
   Tiny Tribes – data store
   One place that reads and saves content, orders, messages,
   dashboard users and the history of changes.

   DEMO MODE: everything is kept in this browser (localStorage).
   To go live, replace the bodies of the functions below with
   calls to an online database (for example Supabase). The rest
   of the site only talks to TTStore, so nothing else changes.

   Nothing is ever deleted: orders are cancelled, messages are
   archived and photos are hidden, and every change is logged.
   ========================================================== */

(function () {
  const KEYS = {
    content: "tt-content",
    orders: "tt-orders",
    messages: "tt-messages",
    users: "tt-users",
    history: "tt-history"
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // Usually the browser storage is full (too many uploaded photos).
      alert("Could not save: the browser storage is full. Hide some uploaded photos and try again.");
      return false;
    }
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function makeId(prefix) {
    const part = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${Date.now().toString().slice(-5)}-${part}`;
  }

  window.TTStore = {
    mode: "demo",

    /* Small version of a site photo for tiles and grids (uploaded photos have none) */
    thumb(src) {
      return src.startsWith("assets/img/gallery/") ? src.replace("assets/img/gallery/", "assets/img/gallery/thumbs/") : src;
    },

    /* ---------- Content (programs, prices, photos) ---------- */
    getContent() {
      const saved = read(KEYS.content, null);
      if (!saved) return clone(window.TT_DEFAULTS);
      if (saved.version === 2) {
        // Photos moved from .jpg to the lighter .webp format; keep the saved changes
        saved.categories.forEach((c) => {
          c.photos = c.photos.map((p) => (p.startsWith("assets/img/gallery/") ? p.replace(/\.jpg$/, ".webp") : p));
        });
        saved.version = 3;
      }
      if (saved.version === window.TT_DEFAULTS.version) return saved;
      return clone(window.TT_DEFAULTS);
    },
    saveContent(content) {
      return write(KEYS.content, content);
    },

    /* ---------- Orders (registrations) ---------- */
    getOrders() {
      return read(KEYS.orders, []);
    },
    addOrder(order) {
      const orders = this.getOrders();
      const full = Object.assign(
        { id: makeId("TT"), createdAt: new Date().toISOString(), status: "Awaiting payment" },
        order
      );
      orders.unshift(full);
      write(KEYS.orders, orders);
      this.log({
        area: "Order",
        target: full.id,
        action: full.test ? "Created test order" : "New registration",
        to: `${full.parent.name} · ${full.programName} · ${full.children.length} ${full.children.length === 1 ? "child" : "children"}`
      });
      return full;
    },
    updateOrder(id, changes) {
      const orders = this.getOrders().map((o) => (o.id === id ? Object.assign(o, changes) : o));
      write(KEYS.orders, orders);
    },

    /* ---------- Messages (contact form) ---------- */
    getMessages() {
      return read(KEYS.messages, []);
    },
    addMessage(msg) {
      const messages = this.getMessages();
      const full = Object.assign({ id: makeId("MSG"), createdAt: new Date().toISOString(), read: false }, msg);
      messages.unshift(full);
      const ok = write(KEYS.messages, messages);
      if (ok) this.log({ area: "Message", target: full.id, action: "New message from the contact form", to: full.name });
      return ok;
    },
    updateMessage(id, changes) {
      write(KEYS.messages, this.getMessages().map((m) => (m.id === id ? Object.assign(m, changes) : m)));
    },

    /* ---------- Dashboard users (owner and employees) ---------- */
    getUsers() {
      return read(KEYS.users, []);
    },
    saveUsers(users) {
      return write(KEYS.users, users);
    },

    /* ---------- History: who changed what, and when ----------
       entry = { area, target, action, from, to }
       "by" is the person logged in to the dashboard, or "Website"
       for things parents do on the public site. */
    actor: null,
    getHistory() {
      return read(KEYS.history, []);
    },
    log(entry) {
      const list = this.getHistory();
      const by = this.actor || { id: "website", name: "Website" };
      list.unshift(Object.assign({ id: makeId("H"), at: new Date().toISOString(), by: by.name, byId: by.id }, entry));
      return write(KEYS.history, list);
    },
    makeId
  };
})();
