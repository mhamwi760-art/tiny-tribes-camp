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

  const STATUSES = ["Awaiting payment", "Paid", "Paid (demo)", "Cancelled"];
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
    ({ overview: renderOverview, orders: renderOrders, messages: renderMessages, programs: renderPrograms, photos: renderPhotos })[name]();
  }

  function updateCounts() {
    const pending = store.getOrders().filter((o) => o.status === "Awaiting payment").length;
    const unread = store.getMessages().filter((m) => !m.read).length;
    $("#count-orders").textContent = pending || "";
    $("#count-messages").textContent = unread || "";
  }

  /* ---------- Overview ---------- */
  function renderOverview() {
    const orders = store.getOrders();
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
            (o) => `<tr><td>${fmtDate(o.createdAt)}</td><td>${esc(o.parent.name)}</td><td>${esc(o.programName)}</td><td>${money(o.total)}</td><td><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="empty" style="padding:0">No orders yet.</p>`;
  }

  /* ---------- Orders ---------- */
  function renderOrders() {
    const orders = store.getOrders();
    const tbody = $("#orders-table tbody");
    $("#orders-empty").classList.toggle("hidden", orders.length > 0);
    tbody.innerHTML = orders
      .map(
        (o) => `
      <tr data-id="${esc(o.id)}">
        <td>${fmtDate(o.createdAt)}</td>
        <td><code>${esc(o.id)}</code></td>
        <td>${esc(o.parent.name)}<small><a href="tel:${esc(o.parent.phone)}">${esc(o.parent.phone)}</a></small></td>
        <td>${esc(o.programName)}<small>${esc(o.optionLabel)}</small></td>
        <td>${o.children.length}</td>
        <td><strong>${money(o.total)}</strong></td>
        <td><select class="order-status" aria-label="Order status">${STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td style="white-space:nowrap"><button class="link-btn toggle-details">Details</button><button class="link-btn delete-order">Delete</button></td>
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

  $("#orders-table").addEventListener("change", (e) => {
    if (!e.target.matches(".order-status")) return;
    store.updateOrder(e.target.closest("tr").dataset.id, { status: e.target.value });
    updateCounts();
  });
  $("#orders-table").addEventListener("click", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    if (e.target.matches(".toggle-details")) {
      $(`tr[data-for="${row.dataset.id}"]`).classList.toggle("hidden");
    }
    if (e.target.matches(".delete-order") && confirm("Delete this order? This cannot be undone.")) {
      store.deleteOrder(row.dataset.id);
      renderOrders();
      updateCounts();
    }
  });

  $("#export-orders").addEventListener("click", () => {
    const rows = [["Date", "Reference", "Parent", "Phone", "Email", "Emergency", "Program", "Option", "Children", "Child names and ages", "Total", "Status"]];
    store.getOrders().forEach((o) =>
      rows.push([
        o.createdAt, o.id, o.parent.name, o.parent.phone, o.parent.email, o.parent.emergency,
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
          <img src="${esc(src)}" alt="" loading="lazy">
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
  showTab(["overview", "orders", "messages", "programs", "photos"].includes(start) ? start : "overview");
})();
