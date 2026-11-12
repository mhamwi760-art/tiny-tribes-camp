/* ==========================================================
   Tiny Tribes – data store
   One place that reads and saves content, orders and messages.

   DEMO MODE: everything is kept in this browser (localStorage).
   To go live, replace the bodies of the functions below with
   calls to an online database (for example Supabase). The rest
   of the site only talks to TTStore, so nothing else changes.
   ========================================================== */

(function () {
  const KEYS = {
    content: "tt-content",
    orders: "tt-orders",
    messages: "tt-messages"
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
      alert("Could not save: the browser storage is full. Remove some uploaded photos and try again.");
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

    /* ---------- Content (programs, prices, photos) ---------- */
    getContent() {
      const saved = read(KEYS.content, null);
      if (saved && saved.version === window.TT_DEFAULTS.version) return saved;
      return clone(window.TT_DEFAULTS);
    },
    saveContent(content) {
      return write(KEYS.content, content);
    },
    resetContent() {
      localStorage.removeItem(KEYS.content);
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
      return full;
    },
    updateOrder(id, changes) {
      const orders = this.getOrders().map((o) => (o.id === id ? Object.assign(o, changes) : o));
      write(KEYS.orders, orders);
    },
    deleteOrder(id) {
      write(KEYS.orders, this.getOrders().filter((o) => o.id !== id));
    },

    /* ---------- Messages (contact form) ---------- */
    getMessages() {
      return read(KEYS.messages, []);
    },
    addMessage(msg) {
      const messages = this.getMessages();
      messages.unshift(Object.assign({ id: makeId("MSG"), createdAt: new Date().toISOString(), read: false }, msg));
      return write(KEYS.messages, messages);
    },
    updateMessage(id, changes) {
      write(KEYS.messages, this.getMessages().map((m) => (m.id === id ? Object.assign(m, changes) : m)));
    },
    deleteMessage(id) {
      write(KEYS.messages, this.getMessages().filter((m) => m.id !== id));
    }
  };
})();
