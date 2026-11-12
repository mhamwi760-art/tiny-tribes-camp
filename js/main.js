/* ==========================================================
   Tiny Tribes Kids Camp – site script
   Plain JavaScript, no libraries. Runs on every page and
   only wires up the parts that exist on the current page.
   ========================================================== */

/* ---------- Camp settings: edit here when details change ---------- */
const CAMP = {
  name: "Winter Camp",
  dates: "Dec 20 – Dec 31",
  hours: "4:00 PM – 7:00 PM, Sunday to Thursday",
  currency: "KWD",
  ageGroups: ["2 years", "3 years", "4 years", "5–6 years", "7–8 years", "9–10 years"],
  options: {
    "1-week": { label: "1 Week", dates: "Week 1 · Dec 20 – 24", price: 80 },
    "2-weeks": { label: "2 Weeks", dates: "Dec 20 – 31", price: 140 }
  },
  phone: "+965 60733303"
};

const STORAGE_KEY = "tt-registration";

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const money = (n) => `${CAMP.currency} ${n.toFixed(3)}`;

function saveRegistration(data) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* storage blocked */ }
}

function loadRegistration() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
}

function makeReference() {
  const part = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TT-${Date.now().toString().slice(-5)}-${part}`;
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

/* ---------- Footer year ---------- */
function initYear() {
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
}

/* ---------- Reveal on scroll ---------- */
function initReveal() {
  const items = $$(".reveal");
  if (!items.length) return;
  if (!("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  items.forEach((el) => io.observe(el));
}

/* ---------- Activities lightbox ---------- */
function initLightbox() {
  const dialog = $("#lightbox");
  if (!dialog) return;
  const img = $("img", dialog);
  const title = $("h3", dialog);

  $$(".activity").forEach((card) => {
    card.addEventListener("click", () => {
      const thumb = $("img", card);
      img.src = thumb.src;
      img.alt = thumb.alt;
      title.textContent = card.dataset.title;
      if (typeof dialog.showModal === "function") dialog.showModal();
    });
  });

  $(".lightbox-close", dialog).addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
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
    if (ok && input.type === "tel") ok = validators.phone(input.value);
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

/* ---------- Registration page ---------- */
function initRegistration() {
  const form = $("#registration-form");
  if (!form) return;

  const childList = $("#children");
  const template = $("#child-template");
  const addBtn = $("#add-child");
  const MAX_CHILDREN = 5;

  function renumber() {
    $$(".child-block", childList).forEach((block, i) => {
      $("h3", block).textContent = `Child ${i + 1}`;
      const remove = $(".remove-child", block);
      remove.classList.toggle("hidden", i === 0);
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
    const select = $("select", block);
    CAMP.ageGroups.forEach((age) => select.add(new Option(age, age)));
    $(".remove-child", block).addEventListener("click", () => {
      block.remove();
      renumber();
    });
    childList.appendChild(block);
    renumber();
  }

  function currentOption() {
    const checked = $('input[name="option"]:checked', form);
    return checked ? CAMP.options[checked.value] : null;
  }

  function updateSummary() {
    const option = currentOption();
    const count = $$(".child-block", childList).length;
    $("#sum-option").textContent = option ? `${option.label} (${option.dates})` : "—";
    $("#sum-children").textContent = count;
    $("#sum-price").textContent = option ? money(option.price) : "—";
    $("#sum-total").textContent = option ? money(option.price * count) : "—";
  }

  addBtn.addEventListener("click", addChild);
  form.addEventListener("change", updateSummary);
  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && field.classList.contains("invalid")) validateField(field);
  });
  form.addEventListener("focusout", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.value) validateField(field);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const optionError = $("#option-error");
    const option = currentOption();
    optionError.classList.toggle("hidden", !!option);
    if (!validateForm(form) || !option) {
      if (!option) $('input[name="option"]', form).focus();
      return;
    }

    const optionKey = $('input[name="option"]:checked', form).value;
    const children = $$(".child-block", childList).map((block) => ({
      name: $('[data-name="child-name"]', block).value.trim(),
      age: $('[data-name="child-age"]', block).value,
      notes: $('[data-name="child-notes"]', block).value.trim()
    }));

    saveRegistration({
      reference: makeReference(),
      createdAt: new Date().toISOString(),
      parent: {
        name: form.elements["parent-name"].value.trim(),
        phone: form.elements["parent-phone"].value.trim(),
        email: form.elements["parent-email"].value.trim(),
        emergency: form.elements["emergency-phone"].value.trim()
      },
      children,
      optionKey,
      total: CAMP.options[optionKey].price * children.length
    });

    window.location.href = "payment.html";
  });

  // Pre-fill if the parent came back from the payment page.
  const saved = loadRegistration();
  if (saved) {
    form.elements["parent-name"].value = saved.parent.name;
    form.elements["parent-phone"].value = saved.parent.phone;
    form.elements["parent-email"].value = saved.parent.email;
    form.elements["emergency-phone"].value = saved.parent.emergency;
    const radio = $(`input[name="option"][value="${saved.optionKey}"]`, form);
    if (radio) radio.checked = true;
    saved.children.forEach((child) => {
      addChild();
      const block = childList.lastElementChild;
      $('[data-name="child-name"]', block).value = child.name;
      $('[data-name="child-age"]', block).value = child.age;
      $('[data-name="child-notes"]', block).value = child.notes;
    });
    updateSummary();
  } else {
    addChild();
  }

  // Allow ?option=2-weeks links from the home page.
  const fromUrl = new URLSearchParams(location.search).get("option");
  if (fromUrl && CAMP.options[fromUrl]) {
    $(`input[name="option"][value="${fromUrl}"]`, form).checked = true;
    updateSummary();
  }
}

/* ---------- Payment page ---------- */
function initPayment() {
  const page = $("#payment-page");
  if (!page) return;

  const reg = loadRegistration();
  if (!reg) {
    $("#no-registration").classList.remove("hidden");
    $("#payment-content").classList.add("hidden");
    return;
  }

  const option = CAMP.options[reg.optionKey];
  $("#pay-reference").textContent = reg.reference;
  $("#pay-parent").textContent = reg.parent.name;
  $("#pay-option").textContent = `${option.label} (${option.dates})`;
  $("#pay-children").innerHTML = reg.children
    .map((c) => `<div class="summary-row"><span>${escapeHtml(c.name)}</span><span>${escapeHtml(c.age)}</span></div>`)
    .join("");
  $("#pay-price").textContent = `${money(option.price)} × ${reg.children.length}`;
  $("#pay-total").textContent = money(reg.total);
  $("#pay-button-amount").textContent = money(reg.total);

  const form = $("#payment-form");
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
      $("#payment-content").classList.add("hidden");
      $("#payment-success").classList.remove("hidden");
      $("#success-reference").textContent = reg.reference;
      $("#success-total").textContent = money(reg.total);
      $$(".steps li").forEach((li) => {
        li.classList.remove("active");
        li.classList.add("done");
      });
      try { sessionStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 1200);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Start ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initYear();
  initReveal();
  initLightbox();
  initRegistration();
  initPayment();
});
