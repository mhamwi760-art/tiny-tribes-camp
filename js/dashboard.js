/* ==========================================================
   Tiny Tribes – dashboard
   Login, orders, cancelled orders, messages, programs & prices,
   photos, history and employees.
   All reads and saves go through TTStore (js/store.js).

   Rules:
   - The owner can do everything and creates employee logins.
   - Employees can only do what the owner ticked for them.
   - Nothing is deleted. Every change is written to the history
     with who did it, what it was before, what it became and when.
   ========================================================== */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const store = window.TTStore;
  let content = store.getContent();
  const money = (n) => `${content.currency} ${Number(n || 0).toFixed(3)}`;
  const fmtDate = (iso) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const nowIso = () => new Date().toISOString();

  // Cancelling has its own button (with a reason), so it is not in the status list
  const STATUSES = ["Awaiting payment", "Paid", "Paid (demo)"];
  const isCancelled = (o) => o.status === "Cancelled";
  const activeOrders = () => store.getOrders().filter((o) => !isCancelled(o));
  const cancelledOrders = () =>
    store.getOrders().filter(isCancelled).sort((a, b) => String(b.cancelledAt || b.createdAt).localeCompare(String(a.cancelledAt || a.createdAt)));
  const statusClass = (s) => (s.startsWith("Paid") ? "paid" : s === "Cancelled" ? "cancelled" : "");
  const phoneDigits = (p) => String(p || "").replace(/[^\d]/g, "");
  const norm = (v) => String(v ?? "").toLowerCase();
  const dayKey = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  /* ==========================================================
     Accounts, login and permissions
     ========================================================== */
  const PERMS = [
    ["orders.view", "See orders and cancelled orders"],
    ["orders.status", "Change order status"],
    ["orders.cancel", "Cancel orders"],
    ["orders.restore", "Restore cancelled orders"],
    ["orders.refund", "Mark orders refunded / not refunded"],
    ["orders.test", "Create test orders"],
    ["orders.export", "Download Excel files"],
    ["messages.view", "See messages"],
    ["messages.manage", "Mark messages read and archive them"],
    ["programs.edit", "Edit programs and prices"],
    ["photos.edit", "Add, hide and reorder photos"],
    ["history.view", "See the history of changes"]
  ];
  const permLabel = (k) => (PERMS.find(([p]) => p === k) || [k, k])[1];
  const SESSION_KEY = "tt-dash-session";
  let me = null;

  // Passwords are never saved as typed: only a salted PBKDF2 hash is kept
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  async function hashPassword(password, salt) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 150000 },
      key,
      256
    );
    return hex(bits);
  }
  async function makePassword(password) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return { salt, hash: await hashPassword(password, salt) };
  }

  const can = (perm) => !!me && (me.role === "owner" || (perm !== "owner" && (me.perms || []).includes(perm)));
  const findUser = (id) => store.getUsers().find((u) => u.id === id);

  function setActor(user) {
    me = user;
    store.actor = user ? { id: user.id, name: user.name } : null;
  }

  function showScreen(name) {
    $("#setup").classList.toggle("hidden", name !== "setup");
    $("#login").classList.toggle("hidden", name !== "login");
    $("#app").classList.toggle("hidden", name !== "app");
    ["#who", "#logout", "#my-password"].forEach((s) => $(s).classList.toggle("hidden", name !== "app"));
    document.body.classList.toggle("locked", name !== "app");
    const first = { setup: "#s-name", login: "#l-user" }[name];
    if (first) $(first).focus();
  }

  function formError(id, text) {
    $(id).textContent = text || "";
    $(id).classList.toggle("hidden", !text);
  }

  $("#setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (store.getUsers().length) return location.reload();
    const name = $("#s-name").value.trim();
    const username = $("#s-user").value.trim().toLowerCase();
    const pass = $("#s-pass").value;
    if (!name || !username) return formError("#setup-error", "Please fill in your name and a username.");
    if (pass.length < 6) return formError("#setup-error", "The password needs at least 6 characters.");
    if (pass !== $("#s-pass2").value) return formError("#setup-error", "The two passwords are not the same.");
    const owner = Object.assign(
      { id: store.makeId("U"), name, username, role: "owner", perms: [], active: true, createdAt: nowIso() },
      await makePassword(pass)
    );
    store.saveUsers([owner]);
    setActor(owner);
    store.log({ area: "Employees", target: owner.username, action: "Owner account created", to: owner.name });
    startSession(owner);
  });

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#l-user").value.trim().toLowerCase();
    const pass = $("#l-pass").value;
    const user = store.getUsers().find((u) => u.username === username);
    const ok = user && (await hashPassword(pass, user.salt)) === user.hash;
    if (!ok) return formError("#login-error", "Wrong username or password.");
    if (!user.active) return formError("#login-error", "This account is switched off. Please ask the owner.");
    formError("#login-error", "");
    $("#l-pass").value = "";
    setActor(user);
    store.log({ area: "Login", target: user.username, action: "Logged in" });
    startSession(user);
  });

  $("#logout").addEventListener("click", () => {
    store.log({ area: "Login", target: me.username, action: "Logged out" });
    try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
    setActor(null);
    showScreen("login");
  });

  function startSession(user) {
    try { sessionStorage.setItem(SESSION_KEY, user.id); } catch (err) { /* ignore */ }
    $("#who").innerHTML = `${esc(user.name)} <small>${user.role === "owner" ? "Owner" : "Employee"}</small>`;
    applyPermissions();
    showScreen("app");
    const start = location.hash.slice(1);
    const allowed = $$(".dash-nav button:not(.hidden)").map((b) => b.dataset.tab);
    showTab(allowed.includes(start) ? start : "overview");
  }

  // Hide every button and tab this person is not allowed to use
  function applyPermissions() {
    $$("[data-need]").forEach((el) => el.classList.toggle("hidden", !can(el.dataset.need)));
  }

  // Re-check the account on every action, in case the owner changed it
  function refreshMe() {
    if (!me) return false;
    const fresh = findUser(me.id);
    if (!fresh || !fresh.active) {
      alert("Your account was switched off. Please log in again.");
      try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
      setActor(null);
      showScreen("login");
      return false;
    }
    setActor(fresh);
    applyPermissions();
    return true;
  }

  function guard(perm) {
    if (!refreshMe()) return false;
    if (can(perm)) return true;
    alert("You don't have permission to do this. Please ask the owner.");
    return false;
  }

  /* Change my own password (a small pop-up) */
  $("#my-password").addEventListener("click", () => {
    const dlg = document.createElement("dialog");
    dlg.className = "dash-dialog";
    dlg.innerHTML = `
      <form method="dialog" class="pw-form">
        <h2>Change my password</h2>
        <div class="field"><label for="pw-old">Current password</label><input id="pw-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">New password (at least 6 characters)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="pw-new2">Repeat new password</label><input id="pw-new2" type="password" autocomplete="new-password"></div>
        <p class="form-error hidden" id="pw-error" role="alert"></p>
        <div class="cancel-actions"><button class="btn btn-primary btn-sm" value="save">Save password</button><button class="link-btn" value="cancel" formnovalidate>Close</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    $("form", dlg).addEventListener("submit", async (e) => {
      if (e.submitter && e.submitter.value === "cancel") return;
      e.preventDefault();
      const user = findUser(me.id);
      if ((await hashPassword($("#pw-old", dlg).value, user.salt)) !== user.hash) return formError("#pw-error", "The current password is wrong.");
      const pass = $("#pw-new", dlg).value;
      if (pass.length < 6) return formError("#pw-error", "The new password needs at least 6 characters.");
      if (pass !== $("#pw-new2", dlg).value) return formError("#pw-error", "The two new passwords are not the same.");
      const pw = await makePassword(pass);
      store.saveUsers(store.getUsers().map((u) => (u.id === user.id ? Object.assign(u, pw) : u)));
      store.log({ area: "Employees", target: user.username, action: "Changed own password" });
      dlg.close();
      alert("Password changed.");
    });
    dlg.showModal();
  });

  /* ==========================================================
     Tabs
     ========================================================== */
  function showTab(name) {
    if (!refreshMe()) return;
    const btn = $(`.dash-nav button[data-tab="${name}"]`);
    if (!btn || btn.classList.contains("hidden")) name = "overview";
    $$(".dash-nav button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === name)));
    $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== `tab-${name}`));
    history.replaceState(null, "", `#${name}`);
    render(name);
  }

  $(".dash-nav").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) showTab(b.dataset.tab);
  });

  function render(name) {
    updateCounts();
    ({
      overview: renderOverview,
      orders: renderOrders,
      cancelled: renderCancelled,
      messages: renderMessages,
      programs: renderPrograms,
      photos: renderPhotos,
      history: renderHistory,
      employees: renderEmployees
    })[name]();
  }

  function updateCounts() {
    const pending = activeOrders().filter((o) => o.status === "Awaiting payment" && !o.test).length;
    const unread = store.getMessages().filter((m) => !m.read && !m.archived).length;
    const toRefund = cancelledOrders().filter((o) => !o.refunded && !o.test).length;
    $("#count-orders").textContent = pending || "";
    $("#count-cancelled").textContent = toRefund || "";
    $("#count-cancelled").title = toRefund ? `${toRefund} not refunded` : "";
    $("#count-messages").textContent = unread || "";
  }

  // History entries for one item (shown inside order details)
  function itemHistory(target) {
    const rows = store.getHistory().filter((h) => h.target === target);
    if (!rows.length) return "";
    return `<div class="item-history"><strong>History</strong><ul>${rows
      .map((h) => `<li><span>${fmtDate(h.at)}</span> · <strong>${esc(h.by)}</strong>: ${esc(h.action)}${changeText(h)}</li>`)
      .join("")}</ul></div>`;
  }
  const changeText = (h) =>
    h.from || h.to
      ? ` <span class="change">${h.from ? `<del>${esc(h.from)}</del>` : ""}${h.from && h.to ? " → " : ""}${h.to ? `<ins>${esc(h.to)}</ins>` : ""}</span>`
      : "";

  /* ==========================================================
     Overview
     ========================================================== */
  function renderOverview() {
    const orders = activeOrders().filter((o) => !o.test);
    const paid = orders.filter((o) => o.status.startsWith("Paid"));
    const stats = [];
    if (can("orders.view")) {
      stats.push(["Orders", orders.length]);
      stats.push(["Paid total", money(paid.reduce((n, o) => n + o.total, 0))]);
      stats.push(["Children registered", paid.reduce((n, o) => n + o.children.length, 0)]);
    }
    if (can("messages.view")) stats.push(["Unread messages", store.getMessages().filter((m) => !m.read && !m.archived).length]);
    $("#stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><small>${k}</small><strong>${esc(v)}</strong></div>`).join("");
    $("#overview-note").textContent = can("orders.view")
      ? "Test orders and cancelled orders are not counted here."
      : stats.length ? "" : `Welcome, ${me.name}. Use the menu to get started.`;

    const latest = activeOrders().slice(0, 5);
    $("#latest-orders").innerHTML = latest.length
      ? `<table class="table"><tbody>${latest
          .map(
            (o) => `<tr><td>${fmtDate(o.createdAt)}</td><td>${esc(o.parent.name)}${o.test ? `<span class="test-badge">Test</span>` : ""}</td><td>${esc(o.programName)}</td><td>${money(o.total)}</td><td><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="empty" style="padding:0">No orders yet.</p>`;
  }

  /* ==========================================================
     Orders
     ========================================================== */
  const F = (id) => $(`#f-${id}`);

  // Every piece of text in an order, so the search finds anything
  function orderText(o) {
    return norm([
      o.id, o.status, o.method, o.programName, o.optionLabel, o.total, money(o.total), fmtDate(o.createdAt),
      o.parent.name, o.parent.phone, phoneDigits(o.parent.phone), o.parent.email, o.parent.emergency, phoneDigits(o.parent.emergency),
      ...o.children.flatMap((c) => [c.name, c.age, c.notes]),
      o.test ? "test" : ""
    ].join(" "));
  }

  // Fill a filter list, keeping what was picked before
  function fillSelect(sel, allLabel, values) {
    const keep = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
    sel.value = values.some(([v]) => v === keep) ? keep : "";
  }
  const uniq = (arr) => [...new Map(arr.map((x) => [x[0], x])).values()];

  function fillFilters(orders) {
    fillSelect(F("status"), "All statuses", uniq([...STATUSES, ...orders.map((o) => o.status)].map((s) => [s, s])));
    fillSelect(F("program"), "All programs", uniq([
      ...Object.entries(content.programs).map(([id, p]) => [id, p.name]),
      ...orders.map((o) => [o.programId, o.programName])
    ]));
    const prog = F("program").value;
    fillSelect(F("option"), "All options", uniq([
      ...Object.entries(content.programs).filter(([id]) => !prog || id === prog).flatMap(([, p]) => p.options.map((op) => [op.id, `${op.label} (${op.dates})`])),
      ...orders.filter((o) => !prog || o.programId === prog).map((o) => [o.optionId, o.optionLabel])
    ]));
    fillSelect(F("age"), "All ages", uniq([
      ...Object.values(content.programs).flatMap((p) => p.ages),
      ...orders.flatMap((o) => o.children.map((c) => c.age))
    ].filter(Boolean).map((a) => [a, a])));
  }

  function filteredOrders(orders) {
    const words = norm(F("search").value).split(/\s+/).filter(Boolean);
    const status = F("status").value, program = F("program").value, option = F("option").value;
    const age = F("age").value, from = F("from").value, to = F("to").value, type = F("type").value;
    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (program && o.programId !== program) return false;
      if (option && o.optionId !== option) return false;
      if (age && !o.children.some((c) => c.age === age)) return false;
      if (from && dayKey(o.createdAt) < from) return false;
      if (to && dayKey(o.createdAt) > to) return false;
      if (type === "test" && !o.test) return false;
      if (type === "real" && o.test) return false;
      if (words.length) {
        const text = orderText(o);
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
  }

  function renderOrders() {
    content = store.getContent();
    const all = activeOrders();
    fillFilters(all);
    const orders = filteredOrders(all);
    const tbody = $("#orders-table tbody");
    $("#orders-empty").classList.toggle("hidden", all.length > 0);
    $("#orders-nomatch").classList.toggle("hidden", !all.length || orders.length > 0);
    const total = orders.reduce((n, o) => n + (Number(o.total) || 0), 0);
    $("#orders-shown").textContent = all.length ? `Showing ${orders.length} of ${all.length} orders · ${money(total)}` : "";
    const showHistory = can("history.view");
    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr data-id="${esc(o.id)}">
        <td>${fmtDate(o.createdAt)}</td>
        <td><code>${esc(o.id)}</code>${o.test ? `<span class="test-badge">Test</span>` : ""}</td>
        <td>${esc(o.parent.name)}<small><a href="tel:${esc(o.parent.phone)}">${esc(o.parent.phone)}</a></small></td>
        <td>${esc(o.programName)}<small>${esc(o.optionLabel)}</small></td>
        <td>${o.children.length}</td>
        <td><strong>${money(o.total)}</strong></td>
        <td>${
          can("orders.status")
            ? `<select class="order-status" aria-label="Order status">${[...new Set([...STATUSES, o.status])].map((s) => `<option ${s === o.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`
            : `<span class="status ${statusClass(o.status)}">${esc(o.status)}</span>`
        }</td>
        <td style="white-space:nowrap"><button class="link-btn toggle-details">Details</button>${can("orders.cancel") ? `<button class="link-btn cancel-order">Cancel</button>` : ""}</td>
      </tr>
      <tr class="cancel-bar hidden" data-cancel="${esc(o.id)}">
        <td colspan="8">
          <form class="cancel-form">
            <label for="reason-${esc(o.id)}">Why is order <strong>${esc(o.id)}</strong> (${esc(o.parent.name)}) being cancelled?</label>
            <textarea id="reason-${esc(o.id)}" class="cancel-reason" rows="2" placeholder="For example: child is sick, family travelling, asked by phone…"></textarea>
            <span class="error cancel-error hidden">Please write the reason.</span>
            <div class="cancel-actions">
              <button type="submit" class="btn btn-primary btn-sm">Cancel order</button>
              <button type="button" class="link-btn keep-order">Keep order</button>
            </div>
          </form>
        </td>
      </tr>
      <tr class="details hidden" data-for="${esc(o.id)}">
        <td colspan="8">
          <strong>Children</strong>
          <ul>${o.children.map((c) => `<li>${esc(c.name)}, ${esc(c.age)}${c.notes ? ` · <em>${esc(c.notes)}</em>` : ""}</li>`).join("")}</ul>
          <strong>Contact</strong>: ${esc(o.parent.phone)}${o.parent.email ? ` · ${esc(o.parent.email)}` : ""} · Emergency: ${esc(o.parent.emergency)}
          ${o.method ? `<br><strong>Payment</strong>: ${esc(o.method)}${o.paidAt ? ` on ${fmtDate(o.paidAt)}` : ""}` : ""}
          ${showHistory ? itemHistory(o.id) : ""}
        </td>
      </tr>`
      )
      .join("");
  }

  $("#f-search").addEventListener("input", renderOrders);
  $("#order-filters").addEventListener("change", (e) => {
    if (e.target.id === "f-search") return;
    if (e.target.id === "f-program") F("option").value = "";
    renderOrders();
  });
  $("#clear-filters").addEventListener("click", () => {
    ["search", "status", "program", "option", "age", "from", "to", "type"].forEach((k) => (F(k).value = ""));
    renderOrders();
  });

  /* Test orders: made-up orders, marked "Test", for trying the dashboard.
     Use the "Order type" filter to hide them. */
  const TEST_PARENTS = ["Sara Al-Ahmad", "Fatma Al-Sabah", "Noura Al-Mutairi", "Dana Al-Kandari", "Mariam Al-Enezi", "Hessa Al-Rashidi", "Ahmad Al-Ali", "Yousef Al-Hajri"];
  const TEST_KIDS = ["Ali", "Omar", "Lulwa", "Jana", "Hamad", "Fajer", "Salem", "Dalal", "Abdullah", "Shahad", "Bader", "Reem"];
  const TEST_NOTES = ["", "", "", "Nut allergy", "Shy at first", "Needs a nap at 5", "Asthma inhaler in bag"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const kwPhone = () => `+965 ${pick(["5", "6", "9"])}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

  $("#add-test-order").addEventListener("click", () => {
    if (!guard("orders.test")) return;
    content = store.getContent();
    const priced = Object.entries(content.programs).filter(([, p]) => p.options.length);
    if (!priced.length) {
      alert("Add at least one price in Programs & prices first.");
      return;
    }
    const open = priced.filter(([, p]) => p.open);
    const [programId, p] = pick(open.length ? open : priced);
    const option = pick(p.options);
    const ages = p.ages.length ? p.ages : ["—"];
    const name = pick(TEST_PARENTS);
    const family = name.split(" ").slice(1).join(" ");
    const children = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => ({
      name: `${pick(TEST_KIDS)} ${family}`,
      age: pick(ages),
      notes: pick(TEST_NOTES)
    }));
    const order = store.addOrder({
      test: true,
      programId,
      programName: p.name,
      optionId: option.id,
      optionLabel: `${option.label} (${option.dates})`,
      unitPrice: option.price,
      parent: { name, phone: kwPhone(), email: `${name.split(" ")[0].toLowerCase()}@example.com`, emergency: kwPhone() },
      children,
      total: option.price * children.length
    });
    if (Math.random() < 0.6) {
      const method = pick(["KNET", "CARD"]);
      store.updateOrder(order.id, { status: "Paid (demo)", method, paidAt: nowIso() });
      store.log({ area: "Order", target: order.id, action: "Status changed", from: "Awaiting payment", to: `Paid (demo) by ${method}` });
    }
    renderOrders();
    updateCounts();
  });

  $("#orders-table").addEventListener("change", (e) => {
    if (!e.target.matches(".order-status")) return;
    e.stopPropagation();
    const id = e.target.closest("tr").dataset.id;
    const before = store.getOrders().find((o) => o.id === id);
    if (!guard("orders.status")) {
      e.target.value = before.status;
      return;
    }
    store.updateOrder(id, { status: e.target.value });
    store.log({ area: "Order", target: id, action: "Status changed", from: before.status, to: e.target.value });
    updateCounts();
    renderOrders();
  });

  $("#orders-table").addEventListener("click", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    if (e.target.matches(".toggle-details")) {
      $(`tr[data-for="${row.dataset.id}"]`).classList.toggle("hidden");
    }
    if (e.target.matches(".cancel-order")) {
      const bar = $(`tr[data-cancel="${row.dataset.id}"]`);
      bar.classList.toggle("hidden");
      if (!bar.classList.contains("hidden")) $(".cancel-reason", bar).focus();
    }
    if (e.target.matches(".keep-order")) {
      row.classList.add("hidden");
      $(".cancel-reason", row).value = "";
      $(".cancel-error", row).classList.add("hidden");
    }
  });

  $("#orders-table").addEventListener("submit", (e) => {
    if (!e.target.matches(".cancel-form")) return;
    e.preventDefault();
    if (!guard("orders.cancel")) return;
    const bar = e.target.closest("tr");
    const reason = $(".cancel-reason", bar).value.trim();
    $(".cancel-error", bar).classList.toggle("hidden", !!reason);
    if (!reason) {
      $(".cancel-reason", bar).focus();
      return;
    }
    const id = bar.dataset.cancel;
    const order = store.getOrders().find((o) => o.id === id);
    store.updateOrder(id, {
      status: "Cancelled",
      statusBeforeCancel: order.status,
      cancelReason: reason,
      cancelledAt: nowIso(),
      cancelledBy: me.name,
      refunded: false
    });
    store.log({ area: "Order", target: id, action: `Cancelled order. Reason: ${reason}`, from: order.status, to: "Cancelled" });
    renderOrders();
    updateCounts();
  });

  // Words describing the search and filters, written on the Excel summary
  function filterText(pairs) {
    return pairs
      .filter(([, el]) => el.value)
      .map(([label, el]) => `${label}: ${el.tagName === "SELECT" ? el.options[el.selectedIndex].text : el.value}`)
      .join(" · ");
  }

  async function excelDownload(btn, kind, list, filters) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      await window.TTExcel.download(kind, {
        orders: list,
        currency: content.currency,
        filters,
        by: me.name,
        history: can("history.view") ? store.getHistory() : null,
        fileName: `tiny-tribes-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx`
      });
      store.log({ area: "Order", target: "Excel", action: `Downloaded ${kind === "cancelled" ? "cancelled orders" : "orders"} Excel file`, to: `${list.length} orders` });
    } catch (err) {
      alert(err.message || "Could not make the Excel file.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // Downloads the orders you can see (search and filters apply)
  $("#export-orders").addEventListener("click", (e) => {
    if (!guard("orders.export")) return;
    const filters = filterText([
      ["Search", F("search")], ["Status", F("status")], ["Program", F("program")], ["Option", F("option")],
      ["Child age", F("age")], ["From", F("from")], ["To", F("to")], ["Type", F("type")]
    ]);
    excelDownload(e.currentTarget, "orders", filteredOrders(activeOrders()), filters);
  });

  /* ==========================================================
     Cancelled orders
     ========================================================== */
  function filteredCancelled() {
    const words = norm($("#c-search").value).split(/\s+/).filter(Boolean);
    const refund = $("#c-refund").value;
    return cancelledOrders().filter((o) => {
      if (refund === "yes" && !o.refunded) return false;
      if (refund === "no" && o.refunded) return false;
      if (words.length) {
        const text = orderText(o) + " " + norm(o.cancelReason) + " " + norm(o.cancelledBy);
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
  }

  function renderCancelled() {
    content = store.getContent();
    const all = cancelledOrders();
    const list = filteredCancelled();
    $("#cancelled-empty").classList.toggle("hidden", all.length > 0);
    $("#cancelled-nomatch").classList.toggle("hidden", !all.length || list.length > 0);
    const notRefunded = list.filter((o) => !o.refunded);
    $("#cancelled-shown").textContent = all.length
      ? `Showing ${list.length} of ${all.length} cancelled · ${notRefunded.length} not refunded (${money(notRefunded.reduce((n, o) => n + (Number(o.total) || 0), 0))})`
      : "";
    const showHistory = can("history.view");
    $("#cancelled-list").innerHTML = list
      .map(
        (o) => `
      <article class="message cancelled-card ${o.refunded ? "refunded" : ""}" data-id="${esc(o.id)}">
        <div class="message-head">
          <strong>${esc(o.parent.name)} <code>${esc(o.id)}</code>${o.test ? `<span class="test-badge">Test</span>` : ""}</strong>
          <small>Cancelled ${o.cancelledAt ? fmtDate(o.cancelledAt) : ""}${o.cancelledBy ? ` by ${esc(o.cancelledBy)}` : ""}</small>
        </div>
        <small>${esc(o.programName)} · ${esc(o.optionLabel)} · ${o.children.length} ${o.children.length === 1 ? "child" : "children"} · <strong>${money(o.total)}</strong>
          ${o.statusBeforeCancel ? ` · Was: ${esc(o.statusBeforeCancel)}` : ""}${o.method ? ` (${esc(o.method)})` : ""}</small>
        <p class="cancel-reason-text"><strong>Reason:</strong> ${o.cancelReason ? esc(o.cancelReason) : "<em>No reason written</em>"}</p>
        <small>${esc(o.parent.phone)}${o.parent.email ? ` · ${esc(o.parent.email)}` : ""} · Children: ${o.children.map((c) => esc(c.name)).join(", ")}</small>
        <div class="message-actions">
          ${
            can("orders.refund")
              ? `<label class="refund-pick">Refund:
            <select class="refund-status" aria-label="Refund status for ${esc(o.id)}">
              <option value="no" ${o.refunded ? "" : "selected"}>Not refunded</option>
              <option value="yes" ${o.refunded ? "selected" : ""}>Refunded</option>
            </select>
          </label>`
              : `<span class="status ${o.refunded ? "paid" : "cancelled"}">${o.refunded ? "Refunded" : "Not refunded"}</span>`
          }
          ${o.refunded && o.refundedAt ? `<small>on ${fmtDate(o.refundedAt)}${o.refundedBy ? ` by ${esc(o.refundedBy)}` : ""}</small>` : ""}
          ${can("orders.restore") ? `<button class="link-btn restore-order">Restore order</button>` : ""}
          ${showHistory ? `<button class="link-btn toggle-history">History</button>` : ""}
        </div>
        ${showHistory ? `<div class="card-history hidden">${itemHistory(o.id)}</div>` : ""}
      </article>`
      )
      .join("");
  }

  $("#c-search").addEventListener("input", renderCancelled);
  $("#c-refund").addEventListener("change", renderCancelled);

  $("#cancelled-list").addEventListener("change", (e) => {
    if (!e.target.matches(".refund-status")) return;
    const id = e.target.closest(".cancelled-card").dataset.id;
    if (!guard("orders.refund")) return renderCancelled();
    const yes = e.target.value === "yes";
    store.updateOrder(id, { refunded: yes, refundedAt: yes ? nowIso() : null, refundedBy: yes ? me.name : null });
    store.log({ area: "Order", target: id, action: "Refund changed", from: yes ? "Not refunded" : "Refunded", to: yes ? "Refunded" : "Not refunded" });
    renderCancelled();
    updateCounts();
  });

  $("#cancelled-list").addEventListener("click", (e) => {
    const card = e.target.closest(".cancelled-card");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.matches(".toggle-history")) {
      $(".card-history", card).classList.toggle("hidden");
      return;
    }
    if (e.target.matches(".restore-order")) {
      if (!guard("orders.restore")) return;
      const o = store.getOrders().find((x) => x.id === id);
      const back = o.statusBeforeCancel || "Awaiting payment";
      if (!confirm(`Restore order ${id}? It goes back to Orders as "${back}".`)) return;
      store.updateOrder(id, { status: back, restoredAt: nowIso() });
      store.log({ area: "Order", target: id, action: "Restored cancelled order", from: "Cancelled", to: back });
      renderCancelled();
      updateCounts();
    }
  });

  $("#export-cancelled").addEventListener("click", (e) => {
    if (!guard("orders.export")) return;
    const filters = filterText([["Search", $("#c-search")], ["Refund", $("#c-refund")]]);
    excelDownload(e.currentTarget, "cancelled", filteredCancelled(), filters);
  });

  /* ==========================================================
     Messages (archived instead of deleted)
     ========================================================== */
  let messageBox = "inbox";

  function renderMessages() {
    const messages = store.getMessages().filter((m) => (messageBox === "archived" ? m.archived : !m.archived));
    const manage = can("messages.manage");
    $$("#message-box .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.box === messageBox)));
    $("#messages-empty").classList.toggle("hidden", messages.length > 0);
    $("#messages-list").innerHTML = messages
      .map(
        (m) => `
      <article class="message ${m.read ? "" : "unread"}" data-id="${esc(m.id)}">
        <div class="message-head">
          <strong>${esc(m.name)}</strong>
          <small>${fmtDate(m.createdAt)}</small>
        </div>
        <small>${esc(m.phone)}${m.email ? ` · ${esc(m.email)}` : ""}</small>
        <p>${esc(m.message)}</p>
        <div class="message-actions">
          <a class="btn btn-secondary btn-sm" href="https://wa.me/${phoneDigits(m.phone)}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn btn-secondary btn-sm" href="tel:${esc(m.phone)}">Call</a>
          ${m.email ? `<a class="btn btn-secondary btn-sm" href="mailto:${esc(m.email)}">Email</a>` : ""}
          ${manage ? `<button class="link-btn toggle-read">${m.read ? "Mark unread" : "Mark read"}</button>` : ""}
          ${manage ? `<button class="link-btn toggle-archive">${m.archived ? "Move to inbox" : "Archive"}</button>` : ""}
        </div>
      </article>`
      )
      .join("");
  }

  $("#message-box").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    messageBox = b.dataset.box;
    renderMessages();
  });

  $("#messages-list").addEventListener("click", (e) => {
    const card = e.target.closest(".message");
    if (!card) return;
    const id = card.dataset.id;
    const m = store.getMessages().find((x) => x.id === id);
    if (e.target.matches(".toggle-read")) {
      if (!guard("messages.manage")) return;
      store.updateMessage(id, { read: !m.read });
      store.log({ area: "Message", target: id, action: `Message from ${m.name}`, from: m.read ? "Read" : "Unread", to: m.read ? "Unread" : "Read" });
    } else if (e.target.matches(".toggle-archive")) {
      if (!guard("messages.manage")) return;
      store.updateMessage(id, { archived: !m.archived });
      store.log({ area: "Message", target: id, action: `Message from ${m.name}`, from: m.archived ? "Archived" : "Inbox", to: m.archived ? "Inbox" : "Archived" });
    } else return;
    renderMessages();
    updateCounts();
  });

  /* ==========================================================
     Programs & prices
     ========================================================== */
  function optionRow(o = { id: "", label: "", dates: "", price: "" }) {
    return `
      <div class="option-row" data-id="${esc(o.id)}">
        <div class="field"><label>Name</label><input data-k="label" value="${esc(o.label)}" placeholder="1 Week"></div>
        <div class="field"><label>Dates</label><input data-k="dates" value="${esc(o.dates)}" placeholder="Week 1 · Dec 20 – 24"></div>
        <div class="field"><label>Price (${esc(content.currency)})</label><input data-k="price" type="number" min="0" step="0.5" value="${esc(o.price)}"></div>
        <button type="button" class="link-btn remove-option">Remove</button>
      </div>`;
  }

  function renderPrograms() {
    content = store.getContent();
    $("#programs-saved").classList.add("hidden");
    $("#programs-editor").innerHTML = Object.entries(content.programs)
      .map(
        ([id, p]) => `
      <div class="dash-card program-editor" data-program="${id}">
        <h2>${esc(p.name)}
          <label class="switch"><input type="checkbox" data-k="open" ${p.open ? "checked" : ""}> Registration open</label>
        </h2>
        <div class="grid-2">
          <div class="field"><label>Program name</label><input data-k="name" value="${esc(p.name)}"></div>
          <div class="field"><label>Dates</label><input data-k="dates" value="${esc(p.dates)}" placeholder="e.g. Dec 20 – Dec 31"></div>
          <div class="field"><label>Hours</label><input data-k="hours" value="${esc(p.hours)}" placeholder="e.g. 4:00 PM – 7:00 PM"></div>
          <div class="field"><label>Days</label><input data-k="days" value="${esc(p.days)}" placeholder="e.g. Sunday to Thursday"></div>
          <div class="field"><label>Location</label><input data-k="location" value="${esc(p.location)}"></div>
          <div class="field"><label>Age groups (comma separated)</label><input data-k="ages" value="${esc(p.ages.join(", "))}" placeholder="2 years, 3 years, 4 years"></div>
        </div>
        <h3 style="margin-top:1.5rem;font-size:1rem;color:var(--ink)">Options and prices (per child)</h3>
        <div class="options">${p.options.map(optionRow).join("")}</div>
        <button type="button" class="btn btn-secondary btn-sm add-option">+ Add option</button>
      </div>`
      )
      .join("");
  }

  $("#programs-editor").addEventListener("click", (e) => {
    if (e.target.matches(".add-option")) {
      e.target.previousElementSibling.insertAdjacentHTML("beforeend", optionRow());
    }
    if (e.target.matches(".remove-option")) e.target.closest(".option-row").remove();
  });

  // Write one history line for every field that changed
  function logProgramChanges(before, after) {
    const FIELDS = [["name", "Name"], ["dates", "Dates"], ["hours", "Hours"], ["days", "Days"], ["location", "Location"]];
    const optText = (o) => `${o.label} · ${o.dates} · ${money(o.price)}`;
    Object.entries(after.programs).forEach(([id, p]) => {
      const old = before.programs[id];
      const target = p.name;
      FIELDS.forEach(([k, label]) => {
        if ((old[k] || "") !== (p[k] || "")) store.log({ area: "Programs", target, action: `${label} changed`, from: old[k], to: p[k] });
      });
      if (old.open !== p.open) store.log({ area: "Programs", target, action: "Registration", from: old.open ? "Open" : "Closed", to: p.open ? "Open" : "Closed" });
      if (old.ages.join(", ") !== p.ages.join(", ")) store.log({ area: "Programs", target, action: "Age groups changed", from: old.ages.join(", "), to: p.ages.join(", ") });
      const oldOpts = new Map(old.options.map((o) => [o.id, o]));
      const newOpts = new Map(p.options.map((o) => [o.id, o]));
      p.options.forEach((o) => {
        const was = oldOpts.get(o.id);
        if (!was) return store.log({ area: "Programs", target, action: "Option added", to: optText(o) });
        if (was.label !== o.label) store.log({ area: "Programs", target, action: `Option name changed`, from: was.label, to: o.label });
        if (was.dates !== o.dates) store.log({ area: "Programs", target, action: `${o.label}: dates changed`, from: was.dates, to: o.dates });
        if (Number(was.price) !== Number(o.price)) store.log({ area: "Programs", target, action: `${o.label}: price changed`, from: money(was.price), to: money(o.price) });
      });
      old.options.forEach((o) => {
        if (!newOpts.has(o.id)) store.log({ area: "Programs", target, action: "Option removed", from: optText(o) });
      });
    });
  }

  $("#save-programs").addEventListener("click", () => {
    if (!guard("programs.edit")) return;
    const before = store.getContent();
    const next = store.getContent();
    let problem = "";
    $$(".program-editor").forEach((card) => {
      const p = next.programs[card.dataset.program];
      const val = (k) => $(`[data-k="${k}"]`, card).value.trim();
      p.name = val("name") || p.name;
      p.open = $('[data-k="open"]', card).checked;
      p.dates = val("dates");
      p.hours = val("hours");
      p.days = val("days");
      p.location = val("location");
      p.ages = val("ages").split(",").map((s) => s.trim()).filter(Boolean);
      p.options = $$(".option-row", card)
        .map((row, i) => {
          const label = $('[data-k="label"]', row).value.trim();
          const price = parseFloat($('[data-k="price"]', row).value);
          if (!label) return null;
          if (isNaN(price)) problem = `Please enter a price for "${label}".`;
          return {
            id: row.dataset.id || `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}-${i}`,
            label,
            dates: $('[data-k="dates"]', row).value.trim(),
            price: isNaN(price) ? 0 : price
          };
        })
        .filter(Boolean);
      if (p.open && !p.options.length) problem = `${p.name} is open for registration but has no prices.`;
      if (p.open && !p.ages.length) problem = `${p.name} is open for registration but has no age groups.`;
    });
    if (problem) {
      alert(problem);
      return;
    }
    if (store.saveContent(next)) {
      logProgramChanges(before, next);
      content = next;
      renderPrograms();
      $("#programs-saved").classList.remove("hidden");
    }
  });

  /* ==========================================================
     Photos (hidden instead of deleted)
     ========================================================== */
  let photoCat = null;
  const photoName = (src) => (src.startsWith("data:") ? "uploaded photo" : src.split("/").pop());
  const photoRef = (src) => (src.startsWith("data:") ? "" : src);

  function photoTile(src, i, hidden) {
    return `
      <div class="dash-photo ${!hidden && i === 0 ? "cover" : ""} ${hidden ? "is-hidden" : ""}" data-index="${i}">
        <img src="${esc(window.TTStore.thumb(src))}" alt="" loading="lazy">
        <div class="tools">
          ${hidden
            ? `<button class="show-photo" title="Put back on the site" aria-label="Put back on the site">↩</button>`
            : `${i > 0 ? `<button class="make-cover" title="Make cover photo" aria-label="Make cover photo">★</button>` : ""}
               <button class="hide-photo" title="Hide from the site" aria-label="Hide from the site">✕</button>`}
        </div>
      </div>`;
  }

  function renderPhotos() {
    content = store.getContent();
    if (!content.categories.some((c) => c.id === photoCat)) photoCat = content.categories[0]?.id;
    $("#photo-cats").innerHTML = content.categories
      .map((c) => `<button class="chip" data-id="${esc(c.id)}" aria-pressed="${c.id === photoCat}">${esc(c.name)} (${c.photos.length})</button>`)
      .join("");
    const cat = content.categories.find((c) => c.id === photoCat);
    $("#photo-grid").innerHTML = cat
      ? cat.photos.map((src, i) => photoTile(src, i, false)).join("") || `<p class="empty">No photos in this category yet.</p>`
      : "";
    const hidden = (cat && cat.hidden) || [];
    $("#hidden-photos-wrap").classList.toggle("hidden", !hidden.length);
    $("#hidden-photos").innerHTML = hidden.map((src, i) => photoTile(src, i, true)).join("");
  }

  $("#photo-cats").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    photoCat = b.dataset.id;
    renderPhotos();
  });

  function updateCategory(fn) {
    const next = store.getContent();
    const cat = next.categories.find((c) => c.id === photoCat);
    cat.hidden = cat.hidden || [];
    const entry = fn(cat, next);
    if (store.saveContent(next)) {
      if (entry) store.log(Object.assign({ area: "Photos", target: cat.name }, entry));
      renderPhotos();
    }
  }

  $("#tab-photos").addEventListener("click", (e) => {
    const tile = e.target.closest(".dash-photo");
    if (!tile) return;
    const i = Number(tile.dataset.index);
    if (e.target.matches(".make-cover")) {
      if (!guard("photos.edit")) return;
      updateCategory((cat) => {
        const oldCover = cat.photos[0];
        cat.photos.unshift(cat.photos.splice(i, 1)[0]);
        return { action: "Cover photo changed", from: photoName(oldCover), to: photoName(cat.photos[0]), photo: photoRef(cat.photos[0]) };
      });
    }
    if (e.target.matches(".hide-photo") && confirm("Hide this photo from the site? It stays saved and can be put back.")) {
      if (!guard("photos.edit")) return;
      updateCategory((cat) => {
        const src = cat.photos.splice(i, 1)[0];
        cat.hidden.unshift(src);
        return { action: `Photo hidden: ${photoName(src)}`, from: "On the site", to: "Hidden", photo: photoRef(src) };
      });
    }
    if (e.target.matches(".show-photo")) {
      if (!guard("photos.edit")) return;
      updateCategory((cat) => {
        const src = cat.hidden.splice(i, 1)[0];
        cat.photos.push(src);
        return { action: `Photo put back: ${photoName(src)}`, from: "Hidden", to: "On the site", photo: photoRef(src) };
      });
    }
  });

  $("#add-category").addEventListener("click", () => {
    if (!guard("photos.edit")) return;
    const name = prompt("Name of the new category (for example: Arts & Crafts)");
    if (!name || !name.trim()) return;
    const next = store.getContent();
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    next.categories.push({ id, name: name.trim(), photos: [], hidden: [] });
    if (store.saveContent(next)) {
      store.log({ area: "Photos", target: name.trim(), action: "Category added", to: name.trim() });
      photoCat = id;
      renderPhotos();
    }
  });

  // Shrink photos before saving so the site stays fast
  function resize(file, max = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  $("#photo-upload").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !photoCat) return;
    if (!guard("photos.edit")) return;
    const urls = [];
    const names = [];
    for (const f of files) {
      try {
        urls.push(await resize(f));
        names.push(f.name);
      } catch (err) {
        alert(`Could not read ${f.name}.`);
      }
    }
    if (urls.length) {
      updateCategory((cat) => {
        cat.photos.push(...urls);
        return { action: `${urls.length} photo${urls.length === 1 ? "" : "s"} added`, to: names.join(", ") };
      });
    }
    e.target.value = "";
  });

  /* ==========================================================
     History
     ========================================================== */
  function renderHistory() {
    const all = store.getHistory();
    fillSelect($("#h-who"), "Everyone", uniq(all.map((h) => [h.byId || h.by, h.by])));
    fillSelect($("#h-area"), "All sections", uniq(all.map((h) => [h.area, h.area])));
    const words = norm($("#h-search").value).split(/\s+/).filter(Boolean);
    const who = $("#h-who").value, area = $("#h-area").value, from = $("#h-from").value, to = $("#h-to").value;
    const list = all.filter((h) => {
      if (who && (h.byId || h.by) !== who) return false;
      if (area && h.area !== area) return false;
      if (from && dayKey(h.at) < from) return false;
      if (to && dayKey(h.at) > to) return false;
      if (words.length) {
        const text = norm([h.by, h.area, h.target, h.action, h.from, h.to, fmtDate(h.at)].join(" "));
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
    $("#history-shown").textContent = all.length ? `Showing ${list.length} of ${all.length} changes` : "";
    $("#history-empty").classList.toggle("hidden", list.length > 0);
    const shown = list.slice(0, 1000);
    $("#history-table tbody").innerHTML = shown
      .map(
        (h) => `
      <tr>
        <td style="white-space:nowrap">${fmtDate(h.at)}</td>
        <td><strong>${esc(h.by)}</strong></td>
        <td>${esc(h.area)}</td>
        <td>${h.photo ? `<img class="history-thumb" src="${esc(window.TTStore.thumb(h.photo))}" alt="">` : ""}<code>${esc(h.target)}</code></td>
        <td>${esc(h.action)}</td>
        <td>${h.from ? `<del>${esc(h.from)}</del>` : ""}</td>
        <td>${h.to ? `<ins>${esc(h.to)}</ins>` : ""}</td>
      </tr>`
      )
      .join("");
  }

  $("#h-search").addEventListener("input", renderHistory);
  $("#history-filters").addEventListener("change", (e) => {
    if (e.target.id !== "h-search") renderHistory();
  });

  /* ==========================================================
     Employees (owner only). Accounts are switched off, never deleted.
     ========================================================== */
  $("#perm-grid").innerHTML = PERMS.map(
    ([k, label]) => `<label class="perm"><input type="checkbox" value="${k}"> ${esc(label)}</label>`
  ).join("");

  // Doing something with orders or messages needs seeing them too
  $("#perm-grid").addEventListener("change", (e) => {
    const k = e.target.value;
    const box = (v) => $(`#perm-grid input[value="${v}"]`);
    if (e.target.checked && k.startsWith("orders.") && k !== "orders.view") box("orders.view").checked = true;
    if (e.target.checked && k === "messages.manage") box("messages.view").checked = true;
    if (!e.target.checked && k === "orders.view") $$('#perm-grid input[value^="orders."]').forEach((b) => (b.checked = false));
    if (!e.target.checked && k === "messages.view") box("messages.manage").checked = false;
  });

  function resetEmployeeForm() {
    $("#employee-form").reset();
    $("#e-id").value = "";
    $("#employee-form-title").textContent = "Add an employee";
    $("#employee-save").textContent = "Add employee";
    $("#e-pass-label").textContent = "Password (at least 6 characters)";
    $("#employee-cancel").classList.add("hidden");
    formError("#employee-error", "");
  }

  function renderEmployees() {
    const users = store.getUsers();
    $("#employee-list").innerHTML = users
      .map(
        (u) => `
      <article class="dash-card employee ${u.active ? "" : "off"}" data-id="${esc(u.id)}">
        <div class="message-head">
          <strong>${esc(u.name)} <small>@${esc(u.username)}</small></strong>
          <span class="status ${u.active ? "paid" : "cancelled"}">${u.role === "owner" ? "Owner" : u.active ? "Active" : "Switched off"}</span>
        </div>
        <p class="perm-list">${
          u.role === "owner"
            ? "Can do everything."
            : (u.perms || []).length
              ? (u.perms || []).map((p) => `<span class="chip-sm">${esc(permLabel(p))}</span>`).join("")
              : "<em>No permissions yet.</em>"
        }</p>
        <small>Added ${u.createdAt ? fmtDate(u.createdAt) : ""}${u.createdBy ? ` by ${esc(u.createdBy)}` : ""}</small>
        ${
          u.role === "owner"
            ? ""
            : `<div class="message-actions">
                 <button class="link-btn edit-employee">Edit name, password or permissions</button>
                 <button class="link-btn toggle-employee">${u.active ? "Switch off login" : "Switch on login"}</button>
               </div>`
        }
      </article>`
      )
      .join("");
  }

  $("#employee-cancel").addEventListener("click", resetEmployeeForm);

  $("#employee-list").addEventListener("click", (e) => {
    const card = e.target.closest(".employee");
    if (!card || !guard("owner")) return;
    const users = store.getUsers();
    const u = users.find((x) => x.id === card.dataset.id);
    if (e.target.matches(".edit-employee")) {
      $("#e-id").value = u.id;
      $("#e-name").value = u.name;
      $("#e-user").value = u.username;
      $("#e-pass").value = "";
      $$("#perm-grid input").forEach((b) => (b.checked = (u.perms || []).includes(b.value)));
      $("#employee-form-title").textContent = `Edit ${u.name}`;
      $("#employee-save").textContent = "Save changes";
      $("#e-pass-label").textContent = "New password (leave empty to keep the old one)";
      $("#employee-cancel").classList.remove("hidden");
      $("#employee-form").scrollIntoView({ behavior: "smooth" });
    }
    if (e.target.matches(".toggle-employee")) {
      const turnOn = !u.active;
      if (!confirm(`${turnOn ? "Switch on" : "Switch off"} the login for ${u.name}?`)) return;
      u.active = turnOn;
      store.saveUsers(users);
      store.log({ area: "Employees", target: u.username, action: `Login for ${u.name}`, from: turnOn ? "Switched off" : "Active", to: turnOn ? "Active" : "Switched off" });
      renderEmployees();
    }
  });

  $("#employee-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!guard("owner")) return;
    const users = store.getUsers();
    const id = $("#e-id").value;
    const name = $("#e-name").value.trim();
    const username = $("#e-user").value.trim().toLowerCase();
    const pass = $("#e-pass").value;
    const perms = $$("#perm-grid input:checked").map((b) => b.value);
    if (!name || !username) return formError("#employee-error", "Please fill in the name and username.");
    if (!/^[a-z0-9._-]{3,}$/.test(username)) return formError("#employee-error", "Username: at least 3 letters or numbers, no spaces.");
    if (users.some((u) => u.username === username && u.id !== id)) return formError("#employee-error", "That username is already taken.");
    if ((!id || pass) && pass.length < 6) return formError("#employee-error", "The password needs at least 6 characters.");
    formError("#employee-error", "");

    if (!id) {
      const user = Object.assign(
        { id: store.makeId("U"), name, username, role: "employee", perms, active: true, createdAt: nowIso(), createdBy: me.name },
        await makePassword(pass)
      );
      users.push(user);
      store.saveUsers(users);
      store.log({ area: "Employees", target: username, action: `Employee added: ${name}`, to: perms.map(permLabel).join(", ") || "No permissions" });
    } else {
      const u = users.find((x) => x.id === id);
      if (u.name !== name) store.log({ area: "Employees", target: username, action: "Name changed", from: u.name, to: name });
      if (u.username !== username) store.log({ area: "Employees", target: username, action: "Username changed", from: u.username, to: username });
      const added = perms.filter((p) => !(u.perms || []).includes(p));
      const removed = (u.perms || []).filter((p) => !perms.includes(p));
      if (added.length || removed.length) {
        store.log({ area: "Employees", target: username, action: `Permissions changed for ${name}`, from: removed.map(permLabel).join(", "), to: added.map(permLabel).join(", ") });
      }
      if (pass) {
        Object.assign(u, await makePassword(pass));
        store.log({ area: "Employees", target: username, action: `Password changed for ${name}` });
      }
      Object.assign(u, { name, username, perms });
      store.saveUsers(users);
    }
    resetEmployeeForm();
    renderEmployees();
  });

  /* ==========================================================
     Start
     ========================================================== */
  (function boot() {
    const users = store.getUsers();
    if (!users.length) return showScreen("setup");
    let id = null;
    try { id = sessionStorage.getItem(SESSION_KEY); } catch (err) { /* ignore */ }
    const user = users.find((u) => u.id === id && u.active);
    if (user) {
      setActor(user);
      startSession(user);
    } else {
      showScreen("login");
    }
  })();
})();
