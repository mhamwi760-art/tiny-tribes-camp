/* ==========================================================
   Tiny Tribes – dashboard
   Orders, messages, programs & prices, and photos.
   All reads and saves go through TTStore (js/store.js).
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

  // Cancelling has its own button (with a reason), so it is not in the status list
  const STATUSES = ["Awaiting payment", "Paid", "Paid (demo)"];
  const isCancelled = (o) => o.status === "Cancelled";
  const activeOrders = () => store.getOrders().filter((o) => !isCancelled(o));
  const cancelledOrders = () =>
    store.getOrders().filter(isCancelled).sort((a, b) => String(b.cancelledAt || b.createdAt).localeCompare(String(a.cancelledAt || a.createdAt)));
  const statusClass = (s) => (s.startsWith("Paid") ? "paid" : s === "Cancelled" ? "cancelled" : "");
  const phoneDigits = (p) => String(p || "").replace(/[^\d]/g, "");

  /* ---------- Tabs ---------- */
  function showTab(name) {
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
    ({ overview: renderOverview, orders: renderOrders, cancelled: renderCancelled, messages: renderMessages, programs: renderPrograms, photos: renderPhotos })[name]();
  }

  function updateCounts() {
    const pending = store.getOrders().filter((o) => o.status === "Awaiting payment").length;
    const unread = store.getMessages().filter((m) => !m.read).length;
    const toRefund = cancelledOrders().filter((o) => !o.refunded).length;
    $("#count-orders").textContent = pending || "";
    $("#count-cancelled").textContent = toRefund || "";
    $("#count-cancelled").title = toRefund ? `${toRefund} not refunded` : "";
    $("#count-messages").textContent = unread || "";
  }

  /* ---------- Overview ---------- */
  function renderOverview() {
    const orders = activeOrders();
    const messages = store.getMessages();
    const paid = orders.filter((o) => o.status.startsWith("Paid"));
    const children = paid.reduce((n, o) => n + o.children.length, 0);
    const stats = [
      ["Orders", orders.length],
      ["Paid total", money(paid.reduce((n, o) => n + o.total, 0))],
      ["Children registered", children],
      ["Unread messages", messages.filter((m) => !m.read).length]
    ];
    $("#stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><small>${k}</small><strong>${esc(v)}</strong></div>`).join("");

    const latest = orders.slice(0, 5);
    $("#latest-orders").innerHTML = latest.length
      ? `<table class="table"><tbody>${latest
          .map(
            (o) => `<tr><td>${fmtDate(o.createdAt)}</td><td>${esc(o.parent.name)}${o.test ? `<span class="test-badge">Test</span>` : ""}</td><td>${esc(o.programName)}</td><td>${money(o.total)}</td><td><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="empty" style="padding:0">No orders yet.</p>`;
  }

  /* ---------- Orders ---------- */
  const F = (id) => $(`#f-${id}`);
  const norm = (v) => String(v ?? "").toLowerCase();
  const dayKey = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

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

  function fillFilters(orders) {
    const uniq = (arr) => [...new Map(arr.map((x) => [x[0], x])).values()];
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
        <td><select class="order-status" aria-label="Order status">${[...new Set([...STATUSES, o.status])].map((s) => `<option ${s === o.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></td>
        <td style="white-space:nowrap"><button class="link-btn toggle-details">Details</button><button class="link-btn cancel-order">Cancel</button><button class="link-btn delete-order">Delete</button></td>
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

  /* Test orders: made-up orders, marked "Test", for trying the dashboard */
  const TEST_PARENTS = ["Sara Al-Ahmad", "Fatma Al-Sabah", "Noura Al-Mutairi", "Dana Al-Kandari", "Mariam Al-Enezi", "Hessa Al-Rashidi", "Ahmad Al-Ali", "Yousef Al-Hajri"];
  const TEST_KIDS = ["Ali", "Omar", "Lulwa", "Jana", "Hamad", "Fajer", "Salem", "Dalal", "Abdullah", "Shahad", "Bader", "Reem"];
  const TEST_NOTES = ["", "", "", "Nut allergy", "Shy at first", "Needs a nap at 5", "Asthma inhaler in bag"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const kwPhone = () => `+965 ${pick(["5", "6", "9"])}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

  $("#add-test-order").addEventListener("click", () => {
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
      parent: {
        name,
        phone: kwPhone(),
        email: `${name.split(" ")[0].toLowerCase()}@example.com`,
        emergency: kwPhone()
      },
      children,
      total: option.price * children.length
    });
    if (Math.random() < 0.6) {
      store.updateOrder(order.id, { status: "Paid (demo)", method: pick(["KNET", "CARD"]), paidAt: new Date().toISOString() });
    }
    renderOrders();
    updateCounts();
  });

  $("#delete-test-orders").addEventListener("click", () => {
    const tests = store.getOrders().filter((o) => o.test);
    if (!tests.length) {
      alert("There are no test orders.");
      return;
    }
    if (!confirm(`Delete all ${tests.length} test orders? Real orders are not touched.`)) return;
    tests.forEach((o) => store.deleteOrder(o.id));
    renderOrders();
    updateCounts();
  });

  $("#orders-table").addEventListener("change", (e) => {
    if (!e.target.matches(".order-status")) return;
    e.stopPropagation();
    store.updateOrder(e.target.closest("tr").dataset.id, { status: e.target.value });
    updateCounts();
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
    if (e.target.matches(".delete-order") && confirm("Delete this order? This cannot be undone.")) {
      store.deleteOrder(row.dataset.id);
      renderOrders();
      updateCounts();
    }
  });

  $("#orders-table").addEventListener("submit", (e) => {
    if (!e.target.matches(".cancel-form")) return;
    e.preventDefault();
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
      cancelledAt: new Date().toISOString(),
      refunded: false
    });
    renderOrders();
    updateCounts();
  });

  /* ---------- Cancelled orders ---------- */
  function filteredCancelled() {
    const words = norm($("#c-search").value).split(/\s+/).filter(Boolean);
    const refund = $("#c-refund").value;
    return cancelledOrders().filter((o) => {
      if (refund === "yes" && !o.refunded) return false;
      if (refund === "no" && o.refunded) return false;
      if (words.length) {
        const text = orderText(o) + " " + norm(o.cancelReason);
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
    $("#cancelled-list").innerHTML = list
      .map(
        (o) => `
      <article class="message cancelled-card ${o.refunded ? "refunded" : ""}" data-id="${esc(o.id)}">
        <div class="message-head">
          <strong>${esc(o.parent.name)} <code>${esc(o.id)}</code>${o.test ? `<span class="test-badge">Test</span>` : ""}</strong>
          <small>Cancelled ${o.cancelledAt ? fmtDate(o.cancelledAt) : ""}</small>
        </div>
        <small>${esc(o.programName)} · ${esc(o.optionLabel)} · ${o.children.length} ${o.children.length === 1 ? "child" : "children"} · <strong>${money(o.total)}</strong>
          ${o.statusBeforeCancel ? ` · Was: ${esc(o.statusBeforeCancel)}` : ""}${o.method ? ` (${esc(o.method)})` : ""}</small>
        <p class="cancel-reason-text"><strong>Reason:</strong> ${o.cancelReason ? esc(o.cancelReason) : "<em>No reason written</em>"}</p>
        <small>${esc(o.parent.phone)}${o.parent.email ? ` · ${esc(o.parent.email)}` : ""} · Children: ${o.children.map((c) => esc(c.name)).join(", ")}</small>
        <div class="message-actions">
          <label class="refund-pick">Refund:
            <select class="refund-status" aria-label="Refund status for ${esc(o.id)}">
              <option value="no" ${o.refunded ? "" : "selected"}>Not refunded</option>
              <option value="yes" ${o.refunded ? "selected" : ""}>Refunded</option>
            </select>
          </label>
          ${o.refunded && o.refundedAt ? `<small>on ${fmtDate(o.refundedAt)}</small>` : ""}
          <button class="link-btn restore-order">Restore order</button>
          <button class="link-btn delete-cancelled">Delete</button>
        </div>
      </article>`
      )
      .join("");
  }

  $("#c-search").addEventListener("input", renderCancelled);
  $("#c-refund").addEventListener("change", renderCancelled);

  $("#cancelled-list").addEventListener("change", (e) => {
    if (!e.target.matches(".refund-status")) return;
    const yes = e.target.value === "yes";
    store.updateOrder(e.target.closest(".cancelled-card").dataset.id, { refunded: yes, refundedAt: yes ? new Date().toISOString() : null });
    renderCancelled();
    updateCounts();
  });

  $("#cancelled-list").addEventListener("click", (e) => {
    const card = e.target.closest(".cancelled-card");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.matches(".restore-order")) {
      const o = store.getOrders().find((x) => x.id === id);
      if (!confirm(`Restore order ${id}? It goes back to Orders as "${o.statusBeforeCancel || "Awaiting payment"}".`)) return;
      store.updateOrder(id, { status: o.statusBeforeCancel || "Awaiting payment", restoredAt: new Date().toISOString() });
    } else if (e.target.matches(".delete-cancelled")) {
      if (!confirm("Delete this order? This cannot be undone.")) return;
      store.deleteOrder(id);
    } else return;
    renderCancelled();
    updateCounts();
  });

  $("#export-cancelled").addEventListener("click", () => {
    const rows = [["Cancelled on", "Reference", "Test order", "Parent", "Phone", "Email", "Program", "Option", "Children", "Total", "Status before", "Reason", "Refunded", "Refunded on"]];
    filteredCancelled().forEach((o) =>
      rows.push([
        o.cancelledAt, o.id, o.test ? "Yes" : "", o.parent.name, o.parent.phone, o.parent.email,
        o.programName, o.optionLabel, o.children.map((c) => `${c.name} (${c.age})`).join("; "),
        o.total, o.statusBeforeCancel, o.cancelReason, o.refunded ? "Yes" : "No", o.refundedAt
      ])
    );
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `tiny-tribes-cancelled-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  // Downloads the orders you can see (search and filters apply)
  $("#export-orders").addEventListener("click", () => {
    const rows = [["Date", "Reference", "Test order", "Parent", "Phone", "Email", "Emergency", "Program", "Option", "Children", "Child names and ages", "Total", "Status"]];
    filteredOrders(activeOrders()).forEach((o) =>
      rows.push([
        o.createdAt, o.id, o.test ? "Yes" : "", o.parent.name, o.parent.phone, o.parent.email, o.parent.emergency,
        o.programName, o.optionLabel, o.children.length,
        o.children.map((c) => `${c.name} (${c.age})`).join("; "), o.total, o.status
      ])
    );
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `tiny-tribes-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  /* ---------- Messages ---------- */
  function renderMessages() {
    const messages = store.getMessages();
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
          <button class="link-btn toggle-read">${m.read ? "Mark unread" : "Mark read"}</button>
          <button class="link-btn delete-message">Delete</button>
        </div>
      </article>`
      )
      .join("");
  }

  $("#messages-list").addEventListener("click", (e) => {
    const card = e.target.closest(".message");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.matches(".toggle-read")) {
      const m = store.getMessages().find((x) => x.id === id);
      store.updateMessage(id, { read: !m.read });
    } else if (e.target.matches(".delete-message")) {
      if (!confirm("Delete this message?")) return;
      store.deleteMessage(id);
    } else return;
    renderMessages();
    updateCounts();
  });

  /* ---------- Programs & prices ---------- */
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

  $("#save-programs").addEventListener("click", () => {
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
            id: row.dataset.id || `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i}`,
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
      content = next;
      renderPrograms();
      $("#programs-saved").classList.remove("hidden");
    }
  });

  /* ---------- Photos ---------- */
  let photoCat = null;

  function renderPhotos() {
    content = store.getContent();
    if (!content.categories.some((c) => c.id === photoCat)) photoCat = content.categories[0]?.id;
    $("#photo-cats").innerHTML = content.categories
      .map((c) => `<button class="chip" data-id="${esc(c.id)}" aria-pressed="${c.id === photoCat}">${esc(c.name)} (${c.photos.length})</button>`)
      .join("");
    const cat = content.categories.find((c) => c.id === photoCat);
    $("#photo-grid").innerHTML = cat
      ? cat.photos
          .map(
            (src, i) => `
        <div class="dash-photo ${i === 0 ? "cover" : ""}" data-index="${i}">
          <img src="${esc(window.TTStore.thumb(src))}" alt="" loading="lazy">
          <div class="tools">
            ${i > 0 ? `<button class="make-cover" title="Make cover photo" aria-label="Make cover photo">★</button>` : ""}
            <button class="remove-photo" title="Remove photo" aria-label="Remove photo">✕</button>
          </div>
        </div>`
          )
          .join("") || `<p class="empty">No photos in this category yet.</p>`
      : "";
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
    fn(cat, next);
    if (store.saveContent(next)) renderPhotos();
  }

  $("#photo-grid").addEventListener("click", (e) => {
    const tile = e.target.closest(".dash-photo");
    if (!tile) return;
    const i = Number(tile.dataset.index);
    if (e.target.matches(".make-cover")) {
      updateCategory((cat) => cat.photos.unshift(cat.photos.splice(i, 1)[0]));
    }
    if (e.target.matches(".remove-photo") && confirm("Remove this photo from the site?")) {
      updateCategory((cat) => cat.photos.splice(i, 1));
    }
  });

  $("#add-category").addEventListener("click", () => {
    const name = prompt("Name of the new category (for example: Arts & Crafts)");
    if (!name || !name.trim()) return;
    const next = store.getContent();
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
    next.categories.push({ id, name: name.trim(), photos: [] });
    if (store.saveContent(next)) {
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
    const urls = [];
    for (const f of files) {
      try { urls.push(await resize(f)); } catch (err) { alert(`Could not read ${f.name}.`); }
    }
    updateCategory((cat) => cat.photos.push(...urls));
    e.target.value = "";
  });

  /* ---------- Reset ---------- */
  $("#reset-demo").addEventListener("click", () => {
    if (!confirm("Reset all demo data? This removes demo orders, messages, price changes and uploaded photos in this browser.")) return;
    ["tt-content", "tt-orders", "tt-messages"].forEach((k) => localStorage.removeItem(k));
    content = store.getContent();
    showTab("overview");
  });

  /* ---------- Start ---------- */
  const start = location.hash.slice(1);
  showTab(["overview", "orders", "cancelled", "messages", "programs", "photos"].includes(start) ? start : "overview");
})();
