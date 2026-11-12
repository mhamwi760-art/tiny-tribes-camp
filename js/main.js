/* ==========================================================
   Tiny Tribes Kids Camp – site script
   Plain JavaScript, no libraries. Runs on every page and only
   wires up the parts that exist on the current page.
   Needs js/data.js and js/store.js loaded first.
   ========================================================== */

const DRAFT_KEY = "tt-registration";

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const content = window.TTStore.getContent();
const money = (n) => `${content.currency} ${Number(n).toFixed(3)}`;
const shortMoney = (n) => `${content.currency} ${Number(n)}`;
const thumb = (src) => window.TTStore.thumb(src);

function findOption(programId, optionId) {
  const program = content.programs[programId];
  return program ? program.options.find((o) => o.id === optionId) : null;
}

function openPrograms() {
  return Object.entries(content.programs).filter(([, p]) => p.open && p.options.length);
}

function saveDraft(data) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
}
function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch (e) { return null; }
}

/* ---------- Navigation ---------- */
function initNav() {
  const toggle = $(".nav-toggle");
  const links = $(".nav-links");
  if (!toggle || !links) return;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    links.classList.toggle("open", !open);
  });
  $$("a", links).forEach((a) =>
    a.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      links.classList.remove("open");
    })
  );
}

function initYear() {
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
}

/* ---------- Reveal on scroll ---------- */
function initReveal() {
  const items = $$(".reveal:not(.visible)");
  if (!items.length) return;
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      }),
    { threshold: 0.1 }
  );
  items.forEach((el) => io.observe(el));
}

/* ---------- Home: quick facts ---------- */
function initFacts() {
  const box = $("#facts");
  if (!box) return;
  const w = content.programs.winter;
  const facts = [
    ["Dates", w.dates],
    ["Hours", w.hours],
    ["Days", w.days],
    ["Ages", "2 – 10 years"]
  ].filter(([, v]) => v);
  box.innerHTML = facts.map(([k, v]) => `<div class="fact"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join("");
}

/* ---------- Home: activity categories ---------- */
function initCategories() {
  const grid = $("#category-grid");
  if (!grid) return;
  grid.innerHTML = content.categories
    .map(
      (c) => `
      <a class="category reveal" href="gallery.html?c=${encodeURIComponent(c.id)}">
        <img src="${esc(thumb(c.photos[0] || ""))}" alt="" width="400" height="300" loading="lazy" decoding="async">
        <span class="category-body">
          <strong>${esc(c.name)}</strong>
          <small>${c.photos.length} photos</small>
        </span>
      </a>`
    )
    .join("");
}

/* ---------- Home: program teasers ---------- */
function initProgramTeasers() {
  const box = $("#program-teasers");
  if (!box) return;
  box.innerHTML = Object.entries(content.programs)
    .map(([id, p]) => {
      const from = p.options.length ? Math.min(...p.options.map((o) => o.price)) : null;
      return `
      <a class="program-teaser ${id} reveal" href="program.html#${id}">
        <span class="badge">${p.open ? "Registration open" : "Coming soon"}</span>
        <h3>${esc(p.name)}</h3>
        <p>${p.dates ? esc(p.dates) : "Dates to be announced"}</p>
        ${from !== null ? `<p class="from">From <strong>${shortMoney(from)}</strong></p>` : ""}
        <span class="link">View program →</span>
        ${(window.TT_CHARACTERS && window.TT_CHARACTERS[id]) || ""}
      </a>`;
    })
    .join("");
  if (window.TT_initEyes) window.TT_initEyes();
}

/* ---------- Contact form (messages) ---------- */
function initContactForm() {
  const form = $("#contact-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    window.TTStore.addMessage({
      name: form.elements["c-name"].value.trim(),
      phone: form.elements["c-phone"].value.trim(),
      email: form.elements["c-email"].value.trim(),
      message: form.elements["c-message"].value.trim()
    });
    form.reset();
    $("#contact-sent").classList.remove("hidden");
  });
}

/* ---------- Gallery page ---------- */
function initGallery() {
  const page = $("#gallery-page");
  if (!page) return;

  const tabs = $("#gallery-tabs");
  const grid = $("#gallery-grid");
  const title = $("#gallery-title");
  let current = new URLSearchParams(location.search).get("c");
  if (!content.categories.some((c) => c.id === current)) current = "all";

  tabs.innerHTML =
    `<button class="chip" data-id="all">All</button>` +
    content.categories.map((c) => `<button class="chip" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join("");

  let list = [];

  function render() {
    $$(".chip", tabs).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === current)));
    if (current === "all") {
      list = content.categories.flatMap((c) => c.photos.map((src) => ({ src, name: c.name })));
      title.textContent = "All activities";
    } else {
      const cat = content.categories.find((c) => c.id === current);
      list = cat.photos.map((src) => ({ src, name: cat.name }));
      title.textContent = cat.name;
    }
    $("#gallery-count").textContent = `${list.length} photos`;
    grid.innerHTML = list
      .map(
        (p, i) => `<button class="photo" data-index="${i}" aria-label="Open photo ${i + 1} of ${list.length}">
          <img src="${esc(thumb(p.src))}" alt="${esc(p.name)} at Tiny Tribes camp" loading="lazy" decoding="async" width="300" height="300">
        </button>`
      )
      .join("");
  }

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    current = btn.dataset.id;
    history.replaceState(null, "", current === "all" ? "gallery.html" : `gallery.html?c=${current}`);
    render();
  });

  // Lightbox with previous / next, arrow keys and swipe
  const box = $("#lightbox");
  const img = $("img", box);
  const caption = $(".lightbox-caption", box);
  let index = 0;

  const loaded = new Set(); // full-size photos already downloaded

  function preload(src) {
    if (loaded.has(src)) return Promise.resolve();
    const im = new Image();
    im.decoding = "async";
    im.src = src;
    return (im.decode ? im.decode() : new Promise((r) => (im.onload = r)))
      .then(() => loaded.add(src))
      .catch(() => {});
  }

  /* ----- Zoom and pan inside the photo (the page itself never moves) ----- */
  const view = { s: 1, x: 0, y: 0 };
  function apply(animate) {
    img.style.transition = animate ? "transform .2s ease" : "none";
    img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  }
  function clampPan() {
    const r = img.getBoundingClientRect();
    const w = r.width / view.s;
    const h = r.height / view.s;
    const maxX = (w * view.s - w) / 2;
    const maxY = (h * view.s - h) / 2;
    view.x = Math.max(-maxX, Math.min(maxX, view.x));
    view.y = Math.max(-maxY, Math.min(maxY, view.y));
  }
  function resetZoom(animate) {
    view.s = 1; view.x = 0; view.y = 0;
    apply(animate);
  }

  function show(i) {
    index = (i + list.length) % list.length;
    const { src, name } = list[index];
    const current = index;
    resetZoom(false);
    img.alt = name;
    caption.textContent = `${name} · ${index + 1} / ${list.length}`;
    if (loaded.has(src)) {
      img.src = src; // already downloaded: instant
    } else {
      img.src = thumb(src); // the small version is already on screen, show it straight away
      preload(src).then(() => { if (index === current) img.src = src; });
    }
    // Get the next and previous photos ready in the background
    [1, -1, 2].forEach((d) => preload(list[(index + d + list.length) % list.length].src));
  }

  function openViewer(i) {
    show(i);
    document.documentElement.classList.add("lb-open"); // lock the page behind
    box.showModal();
  }
  function unlock() {
    document.documentElement.classList.remove("lb-open");
    resetZoom(false);
  }
  function closeViewer() {
    if (box.open) box.close();
    unlock();
  }
  box.addEventListener("close", unlock); // also covers the Esc key / phone back gesture

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".photo");
    if (!btn) return;
    openViewer(Number(btn.dataset.index));
  });
  $(".lb-prev", box).addEventListener("click", () => show(index - 1));
  $(".lb-next", box).addEventListener("click", () => show(index + 1));
  $(".lightbox-close", box).addEventListener("click", closeViewer);
  box.addEventListener("click", (e) => { if (e.target === box && view.s === 1) closeViewer(); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  });

  // Gestures on the photo: one finger swipes (or pans when zoomed), two fingers pinch-zoom,
  // double-tap zooms in and out. Mouse wheel zooms on a computer.
  const pointers = new Map();
  let gesture = null;
  let lastTap = 0;

  img.addEventListener("pointerdown", (e) => {
    try { img.setPointerCapture(e.pointerId); } catch (err) { /* not needed for this pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
    } else if (pointers.size === 1) {
      gesture = { type: "drag", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, t: Date.now(), moved: false };
    }
  });

  img.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      view.s = Math.max(1, Math.min(4, gesture.s * (d / gesture.dist)));
      clampPan();
      apply(false);
    } else if (gesture.type === "drag") {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
      if (view.s > 1) {
        view.x = gesture.vx + dx;
        view.y = gesture.vy + dy;
        clampPan();
        apply(false);
      } else {
        img.style.transition = "none";
        img.style.transform = `translateX(${dx * 0.6}px)`; // follow the finger a little while swiping
      }
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;

    if (gesture.type === "pinch") {
      if (pointers.size === 0) {
        gesture = null;
        if (view.s < 1.05) resetZoom(true);
      }
      return; // lifting one finger after a pinch never counts as a swipe
    }

    // single finger
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    const quick = Date.now() - gesture.t < 600;
    const g = gesture;
    gesture = null;

    if (!g.moved) {
      // tap on a phone: double-tap zooms in, or back out
      if (e.pointerType === "mouse") return; // computers use double-click below
      const now = Date.now();
      if (now - lastTap < 300) {
        if (view.s > 1) resetZoom(true);
        else { view.s = 2.5; apply(true); }
        lastTap = 0;
      } else {
        lastTap = now;
      }
      return;
    }

    if (view.s > 1) return; // was moving around a zoomed photo
    if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      show(index + (dx < 0 ? 1 : -1));
    } else {
      apply(true); // snap back
    }
  }
  img.addEventListener("pointerup", endPointer);
  img.addEventListener("pointercancel", endPointer);

  let lastType = "mouse";
  img.addEventListener("pointerdown", (e) => (lastType = e.pointerType));
  img.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (lastType !== "mouse") return; // phones handled by double-tap above
    if (view.s > 1) resetZoom(true);
    else { view.s = 2.5; apply(true); }
  });
  img.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.s = Math.max(1, Math.min(4, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (view.s === 1) { view.x = 0; view.y = 0; }
    clampPan();
    apply(false);
  }, { passive: false });

  render();
}

/* ---------- Program page ---------- */
function initProgramPage() {
  const page = $("#program-page");
  if (!page) return;

  Object.entries(content.programs).forEach(([id, p]) => {
    const box = $(`#${id}-details`);
    if (!box) return;

    const rows = [
      ["Dates", p.dates],
      ["Time", p.hours],
      ["Days", p.days],
      ["Location", p.location]
    ].filter(([, v]) => v);

    const details = rows.length
      ? `<ul class="detail-list">${rows.map(([k, v]) => `<li><span>${k}</span><span>${esc(v)}</span></li>`).join("")}
          ${p.ages.length ? `<li><span>Age groups</span><ul class="ages">${p.ages.map((a) => `<li>${esc(a.replace(" years", ""))}</li>`).join("")}</ul></li>` : ""}
         </ul>`
      : `<p class="program-soon">Dates, times and prices will be announced soon. Follow us on Instagram or call <a href="tel:${content.contact.phone.replace(/\s/g, "")}">${esc(content.contact.phone)}</a> to hear first.</p>`;

    const prices = p.options.length
      ? `<div class="price-cards">${p.options
          .map(
            (o, i) => `
          <div class="price-card ${i === p.options.length - 1 ? "featured" : ""}">
            <h3>${esc(o.label)}</h3>
            <div class="price">${esc(o.price)} <small>${esc(content.currency)}</small></div>
            <p>${esc(o.dates)}</p>
            ${p.open ? `<a class="btn ${i === p.options.length - 1 ? "btn-primary" : "btn-secondary"}" href="register.html?program=${id}&option=${encodeURIComponent(o.id)}">Register</a>` : ""}
          </div>`
          )
          .join("")}</div>`
      : "";

    box.innerHTML = `
      <span class="badge">${p.open ? "Registration open" : "Coming soon"}</span>
      ${details}
      ${prices}`;
  });
}

/* ---------- Form validation ---------- */
const validators = {
  required: (v) => v.trim() !== "",
  email: (v) => v.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
  phone: (v) => /^\+?[\d\s-]{8,15}$/.test(v.trim())
};

function validateField(field) {
  const input = $("input, select, textarea", field);
  if (!input) return true;
  let ok = true;
  if (input.type === "checkbox") {
    ok = !input.required || input.checked;
  } else {
    if (input.required && !validators.required(input.value)) ok = false;
    if (ok && input.type === "email") ok = validators.email(input.value);
    if (ok && input.type === "tel" && (input.required || input.value)) ok = validators.phone(input.value);
  }
  field.classList.toggle("invalid", !ok);
  input.setAttribute("aria-invalid", String(!ok));
  return ok;
}

function validateForm(form) {
  const fields = $$(".field", form);
  const results = fields.map(validateField);
  const firstBad = fields[results.indexOf(false)];
  if (firstBad) {
    $("input, select, textarea", firstBad).focus();
    return false;
  }
  return true;
}

function liveValidation(form) {
  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && field.classList.contains("invalid")) validateField(field);
  });
  form.addEventListener("focusout", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.value) validateField(field);
  });
}

/* ---------- Registration page ---------- */
function initRegistration() {
  const form = $("#registration-form");
  if (!form) return;

  const programs = openPrograms();
  if (!programs.length) {
    form.innerHTML = `<h2>Registration is closed</h2><p>There is no program open for registration right now. Please call <a href="tel:${content.contact.phone.replace(/\s/g, "")}">${esc(content.contact.phone)}</a>.</p>`;
    return;
  }

  const childList = $("#children");
  const template = $("#child-template");
  const addBtn = $("#add-child");
  const optionBox = $("#option-cards");
  const programSelect = $("#program");
  const MAX_CHILDREN = 5;

  programSelect.innerHTML = programs.map(([id, p]) => `<option value="${id}">${esc(p.name)} · ${esc(p.dates)}</option>`).join("");
  $("#program-field").classList.toggle("hidden", programs.length < 2);

  function currentProgram() {
    return content.programs[programSelect.value];
  }

  function renderOptions(selected) {
    const p = currentProgram();
    optionBox.innerHTML = p.options
      .map(
        (o, i) => `
      <div class="option-card">
        <input type="radio" name="option" id="opt-${i}" value="${esc(o.id)}" ${o.id === selected ? "checked" : ""}>
        <label for="opt-${i}">
          <strong>${esc(o.label)}</strong>
          <span class="meta">${esc(o.dates)}</span>
          <span class="amount">${shortMoney(o.price)}</span> <span class="meta inline">per child</span>
        </label>
      </div>`
      )
      .join("");
    $("#page-subtitle").textContent = [p.dates, p.hours, p.days].filter(Boolean).join(" · ");
    $("#page-title").textContent = `${p.name} registration`;
    // refresh age lists
    $$(".child-block select").forEach((sel) => fillAges(sel, sel.value));
    updateSummary();
  }

  function fillAges(select, value) {
    select.innerHTML = `<option value="">Select age group</option>`;
    currentProgram().ages.forEach((age) => select.add(new Option(age, age)));
    if (value) select.value = value;
  }

  function renumber() {
    $$(".child-block", childList).forEach((block, i) => {
      $("h3", block).textContent = `Child ${i + 1}`;
      $(".remove-child", block).classList.toggle("hidden", i === 0);
      $$("[data-name]", block).forEach((el) => {
        const id = `${el.dataset.name}-${i}`;
        el.id = id;
        el.name = id;
        const label = el.closest(".field")?.querySelector("label");
        if (label) label.htmlFor = id;
      });
    });
    addBtn.disabled = $$(".child-block", childList).length >= MAX_CHILDREN;
    updateSummary();
  }

  function addChild() {
    const block = template.content.firstElementChild.cloneNode(true);
    fillAges($("select", block));
    $(".remove-child", block).addEventListener("click", () => {
      block.remove();
      renumber();
    });
    childList.appendChild(block);
    renumber();
  }

  function currentOption() {
    const checked = $('input[name="option"]:checked', form);
    return checked ? findOption(programSelect.value, checked.value) : null;
  }

  function updateSummary() {
    const option = currentOption();
    const count = $$(".child-block", childList).length;
    $("#sum-program").textContent = currentProgram().name;
    $("#sum-option").textContent = option ? `${option.label} (${option.dates})` : "—";
    $("#sum-children").textContent = count;
    $("#sum-price").textContent = option ? money(option.price) : "—";
    $("#sum-total").textContent = option ? money(option.price * count) : "—";
  }

  addBtn.addEventListener("click", addChild);
  programSelect.addEventListener("change", () => renderOptions());
  form.addEventListener("change", updateSummary);
  liveValidation(form);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const option = currentOption();
    $("#option-error").classList.toggle("hidden", !!option);
    if (!validateForm(form) || !option) {
      if (!option) optionBox.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const children = $$(".child-block", childList).map((block) => ({
      name: $('[data-name="child-name"]', block).value.trim(),
      age: $('[data-name="child-age"]', block).value,
      notes: $('[data-name="child-notes"]', block).value.trim()
    }));

    const draft = loadDraft();
    const order = {
      programId: programSelect.value,
      programName: currentProgram().name,
      optionId: option.id,
      optionLabel: `${option.label} (${option.dates})`,
      unitPrice: option.price,
      parent: {
        name: form.elements["parent-name"].value.trim(),
        phone: form.elements["parent-phone"].value.trim(),
        email: form.elements["parent-email"].value.trim(),
        emergency: form.elements["emergency-phone"].value.trim()
      },
      children,
      total: option.price * children.length
    };

    // Update the same order if the parent came back to edit it
    if (draft && draft.id && window.TTStore.getOrders().some((o) => o.id === draft.id)) {
      window.TTStore.updateOrder(draft.id, order);
      saveDraft(Object.assign({ id: draft.id }, order));
    } else {
      saveDraft(window.TTStore.addOrder(order));
    }
    window.location.href = "payment.html";
  });

  // Start state: saved draft, or link from program page, or defaults
  const params = new URLSearchParams(location.search);
  const draft = loadDraft();
  if (draft && content.programs[draft.programId]) {
    programSelect.value = draft.programId;
    renderOptions(draft.optionId);
    form.elements["parent-name"].value = draft.parent.name;
    form.elements["parent-phone"].value = draft.parent.phone;
    form.elements["parent-email"].value = draft.parent.email;
    form.elements["emergency-phone"].value = draft.parent.emergency;
    draft.children.forEach((child) => {
      addChild();
      const block = childList.lastElementChild;
      $('[data-name="child-name"]', block).value = child.name;
      $('[data-name="child-age"]', block).value = child.age;
      $('[data-name="child-notes"]', block).value = child.notes;
    });
  } else {
    if (params.get("program") && programs.some(([id]) => id === params.get("program"))) {
      programSelect.value = params.get("program");
    }
    renderOptions(params.get("option"));
    addChild();
  }
  updateSummary();
}

/* ---------- Payment page ---------- */
function initPayment() {
  const page = $("#payment-page");
  if (!page) return;

  const reg = loadDraft();
  if (!reg) {
    $("#no-registration").classList.remove("hidden");
    $("#payment-content").classList.add("hidden");
    return;
  }

  $("#pay-reference").textContent = reg.id;
  $("#pay-parent").textContent = reg.parent.name;
  $("#pay-program").textContent = reg.programName;
  $("#pay-option").textContent = reg.optionLabel;
  $("#pay-children").innerHTML = reg.children
    .map((c) => `<div class="summary-row"><span>${esc(c.name)}</span><span>${esc(c.age)}</span></div>`)
    .join("");
  $("#pay-price").textContent = `${money(reg.unitPrice)} × ${reg.children.length}`;
  $("#pay-total").textContent = money(reg.total);
  $("#pay-button-amount").textContent = money(reg.total);

  const form = $("#payment-form");
  liveValidation(form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateForm(form)) return;
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    btn.textContent = "Processing…";

    /* DEMO ONLY: no payment is taken.
       Replace this block with the chosen payment provider
       (for example KNET via Tap or MyFatoorah): send the amount
       to your server, create a payment, then redirect to the
       provider's hosted payment page. */
    setTimeout(() => {
      const method = $('input[name="method"]:checked', form).value.toUpperCase();
      window.TTStore.updateOrder(reg.id, { status: "Paid (demo)", method, paidAt: new Date().toISOString() });
      $("#payment-content").classList.add("hidden");
      $("#payment-success").classList.remove("hidden");
      $("#success-reference").textContent = reg.id;
      $("#success-total").textContent = money(reg.total);
      $$(".steps li").forEach((li) => {
        li.classList.remove("active");
        li.classList.add("done");
      });
      try { sessionStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 1200);
  });
}

/* ---------- Page-change hat ----------
   A feathered tribe hat drops in when moving to another page.
   It also covers the wait while the next page loads. */
const HAT_SVG = `
<svg viewBox="0 0 200 150" aria-hidden="true">
  <g class="hat">
    <g transform="translate(62 104) rotate(-28)"><g class="feather f2">
      <path d="M0 0 C-12 -26 -13 -58 0 -88 C13 -58 12 -26 0 0Z" fill="#f36c21"/>
      <path d="M0 -6 V-82 M0 -30 L-8 -38 M0 -48 L8 -56 M0 -62 L-7 -68" stroke="#fbaa1e" stroke-width="3" stroke-linecap="round" fill="none"/>
    </g></g>
    <g transform="translate(138 104) rotate(28)"><g class="feather f3">
      <path d="M0 0 C-12 -26 -13 -58 0 -88 C13 -58 12 -26 0 0Z" fill="#fbaa1e"/>
      <path d="M0 -6 V-82 M0 -30 L8 -38 M0 -48 L-8 -56 M0 -62 L7 -68" stroke="#f36c21" stroke-width="3" stroke-linecap="round" fill="none"/>
    </g></g>
    <g transform="translate(100 98)"><g class="feather f1">
      <path d="M0 0 C-16 -32 -18 -74 0 -112 C18 -74 16 -32 0 0Z" fill="#db2126"/>
      <path d="M0 -6 V-104 M0 -36 L-10 -46 M0 -56 L10 -66 M0 -76 L-9 -84" stroke="#f36c21" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    </g></g>
    <path d="M28 104 Q100 84 172 104 L172 132 Q100 112 28 132Z" fill="#f36c21" stroke="#db2126" stroke-width="4" stroke-linejoin="round"/>
    <path d="M40 124 L50 108 L60 121 L70 105 L80 118 L90 102 L100 116 L110 102 L120 118 L130 105 L140 121 L150 108 L160 124" fill="none" stroke="#fbaa1e" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
  </g>
</svg>
<div class="dots"><span></span><span></span><span></span></div>`;

function initHat() {
  const loader = document.createElement("div");
  loader.className = "hat-loader";
  loader.setAttribute("aria-hidden", "true");
  loader.innerHTML = `<div>${HAT_SVG}</div>`;
  document.body.appendChild(loader);

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === "_blank" || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    // Same page (just a #section): no hat
    if (url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    loader.classList.add("show");
    setTimeout(() => (location.href = url.href), 420);
  });

  // Coming back with the browser's Back button: hide the hat again
  window.addEventListener("pageshow", () => loader.classList.remove("show"));
}

/* ---------- Start ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initHat();
  initNav();
  initYear();
  initFacts();
  initCategories();
  initProgramTeasers();
  initContactForm();
  initGallery();
  initProgramPage();
  initRegistration();
  initPayment();
  initReveal();
});
