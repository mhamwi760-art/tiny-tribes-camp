/* ==========================================================
   Tiny Tribes – program page effects
   - Winter: falling snow that moves away from the mouse or
     finger, and drifts with the phone's tilt.
   - Summer: a sun that wanders around the sky.
   Both pause when off screen to keep the page fast.
   ========================================================== */

(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Phone tilt (shared) ---------- */
  const tilt = { x: 0, y: 0 }; // -1 .. 1
  let tiltListening = false;

  function onOrientation(e) {
    if (e.gamma == null) return;
    tilt.x = Math.max(-1, Math.min(1, e.gamma / 45)); // left / right
    tilt.y = Math.max(-1, Math.min(1, (e.beta - 40) / 45)); // forward / back
  }

  function startTilt() {
    if (tiltListening) return;
    tiltListening = true;
    window.addEventListener("deviceorientation", onOrientation);
  }

  function initTiltButton() {
    const btn = document.getElementById("tilt-button");
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    const needsPermission =
      typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";

    if (!isTouch || reduceMotion) return;
    if (!needsPermission) {
      startTilt(); // Android and most browsers: no permission needed
      return;
    }
    // iPhone / iPad: motion needs a tap to allow it
    if (!btn) return;
    btn.classList.remove("hidden");
    btn.addEventListener("click", async () => {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state === "granted") {
          startTilt();
          btn.textContent = "Tilt your phone ❄";
          btn.disabled = true;
        }
      } catch (e) {
        btn.classList.add("hidden");
      }
    });
  }

  /* ---------- Run a loop only while an element is on screen ---------- */
  function whileVisible(el, start, stop) {
    if (!("IntersectionObserver" in window)) return start();
    new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? start() : stop()));
    }).observe(el);
  }

  /* ---------- Snow ---------- */
  function initSnow() {
    const section = document.getElementById("winter");
    const canvas = document.getElementById("snow");
    if (!section || !canvas) return;
    const ctx = canvas.getContext("2d");

    let w = 0;
    let h = 0;
    let dpr = 1;
    let flakes = [];
    let raf = null;
    const pointer = { x: -9999, y: -9999, active: false };

    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = section.clientWidth;
      h = section.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff"; // resizing the canvas resets this
      if (front) {
        front.width = w * dpr;
        front.height = h * dpr;
        front.style.width = w + "px";
        front.style.height = h + "px";
        fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        fctx.fillStyle = "#ffffff";
      }
      const target = Math.min(220, Math.round((w * h) / 6000));
      while (flakes.length < target) flakes.push(makeFlake(true));
      flakes.length = target;
    }

    function makeFlake(anywhere) {
      const r = Math.random() * 2.6 + 1;
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : -10,
        r,
        speed: r * 0.35 + 0.3,
        vx: 0,
        vy: 0,
        phase: Math.random() * Math.PI * 2,
        alpha: Math.random() * 0.5 + 0.5
      };
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      const wind = tilt.x * 2.2;
      const gravity = 1 + tilt.y * 0.8;

      for (const f of flakes) {
        f.phase += 0.01;

        // Push away from the mouse or finger
        if (pointer.active) {
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          const radius = 110;
          if (dist < radius && dist > 0.1) {
            const force = (1 - dist / radius) * 1.6;
            f.vx += (dx / dist) * force;
            f.vy += (dy / dist) * force;
          }
        }

        f.vx *= 0.94;
        f.vy *= 0.94;
        f.x += Math.sin(f.phase) * 0.4 + wind * (f.r / 2.5) + f.vx;
        f.y += f.speed * Math.max(0.2, gravity) + f.vy;

        if (f.y > h + 10) Object.assign(f, makeFlake(false));
        if (f.y < -20) f.y = h + 5;
        if (f.x > w + 10) f.x = -10;
        if (f.x < -10) f.x = w + 10;

        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Snow knocked off the price cards (drawn in front of the cards)
      if (front && (chunks.length || frontDirty)) {
        fctx.clearRect(0, 0, w, h);
        frontDirty = chunks.length > 0;
        for (let i = chunks.length - 1; i >= 0; i--) {
          const c = chunks[i];
          c.vy += 0.22;
          c.vx = c.vx * 0.99 + tilt.x * 0.05;
          c.x += c.vx;
          c.y += c.vy;
          if (c.y > h + 10) {
            chunks.splice(i, 1);
            continue;
          }
          fctx.globalAlpha = c.alpha;
          fctx.beginPath();
          fctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          fctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    }

    /* ----- Snow piles on top of the price cards ----- */
    const front = document.getElementById("snow-front");
    const fctx = front ? front.getContext("2d") : null;
    const chunks = [];
    let frontDirty = false;
    const CAP_SVG =
      '<svg viewBox="0 0 200 50" preserveAspectRatio="none" width="100%" height="100%">' +
      '<defs><linearGradient id="snowShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".65" stop-color="#f3f8ff"/><stop offset="1" stop-color="#cfe0f5"/></linearGradient></defs>' +
      '<path fill="url(#snowShade)" stroke="#b3cbe8" stroke-width="1.2" vector-effect="non-scaling-stroke" d="M1 40 C1 28 8 22 18 22 C22 12 34 8 44 14 C52 4 70 2 80 10 C90 1 110 0 120 9 C130 2 150 4 158 13 C168 8 182 12 186 22 C196 22 199 30 199 40 C196 46 190 44 186 48 C180 42 172 46 166 49 C158 43 150 47 140 46 C130 42 120 48 108 46 C98 42 88 48 76 46 C66 42 56 48 46 46 C36 42 28 48 18 47 C12 43 6 46 1 40 Z"/></svg>';

    function knockOff(cap) {
      if (cap.classList.contains("fallen")) return;
      const s = section.getBoundingClientRect();
      const r = cap.getBoundingClientRect();
      const count = reduceMotion ? 0 : Math.round(r.width / 2.5);
      for (let i = 0; i < count; i++) {
        chunks.push({
          x: r.left - s.left + Math.random() * r.width,
          y: r.top - s.top + Math.random() * r.height * 0.7,
          r: Math.random() * 3 + 1.5,
          vx: (Math.random() - 0.5) * 3,
          vy: -Math.random() * 3,
          alpha: Math.random() * 0.3 + 0.7
        });
      }
      cap.classList.add("fallen");
      setTimeout(() => cap.classList.remove("fallen"), 6000); // the snow piles up again
    }

    document.querySelectorAll("#winter-details .price-card").forEach((card) => {
      const cap = document.createElement("div");
      cap.className = "snow-cap";
      cap.setAttribute("aria-hidden", "true");
      cap.innerHTML = CAP_SVG;
      card.prepend(cap);
      // Wave the mouse over it, or tap it on a phone
      card.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") knockOff(cap); });
      card.addEventListener("pointerdown", () => knockOff(cap));
    });

    ctx.fillStyle = "#ffffff";

    function setPointer(clientX, clientY) {
      const rect = section.getBoundingClientRect();
      pointer.x = clientX - rect.left;
      pointer.y = clientY - rect.top;
      pointer.active = true;
    }
    section.addEventListener("pointermove", (e) => setPointer(e.clientX, e.clientY));
    section.addEventListener("pointerdown", (e) => setPointer(e.clientX, e.clientY));
    section.addEventListener("pointerleave", () => (pointer.active = false));
    section.addEventListener("touchend", () => (pointer.active = false), { passive: true });

    size();
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        size();
        ctx.fillStyle = "#ffffff";
      }, 150);
    });

    if (reduceMotion) {
      // Draw one still frame
      flakes.forEach((f) => {
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    whileVisible(
      section,
      () => { if (!raf) raf = requestAnimationFrame(frame); },
      () => { cancelAnimationFrame(raf); raf = null; }
    );
  }

  /* ---------- Sun ---------- */
  function initSun() {
    const section = document.getElementById("summer");
    const sun = document.getElementById("sun");
    if (!section || !sun || reduceMotion) return;

    let raf = null;
    let t = Math.random() * 100;
    let pos = null; // where the sun is now
    const pointer = { x: 0, y: 0, active: false };
    let releaseTimer;

    // The sun follows the mouse, or the finger on a phone
    function setPointer(e) {
      const rect = section.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
      clearTimeout(releaseTimer);
    }
    section.addEventListener("pointermove", setPointer);
    section.addEventListener("pointerdown", setPointer);
    section.addEventListener("pointerleave", () => (pointer.active = false));
    section.addEventListener("pointerup", (e) => {
      // On touch, stay where the finger lifted for a moment, then wander again
      if (e.pointerType !== "mouse") releaseTimer = setTimeout(() => (pointer.active = false), 2500);
    });

    function frame() {
      t += 0.004;
      const w = section.clientWidth;
      const h = section.clientHeight;
      const size = sun.offsetWidth;
      let tx;
      let ty;
      if (pointer.active) {
        tx = pointer.x - size / 2;
        ty = pointer.y - size / 2;
      } else {
        // A slow looping path across the top part of the section
        tx = (0.5 + 0.42 * Math.sin(t) + tilt.x * 0.06) * (w - size);
        ty = (0.22 + 0.18 * Math.sin(t * 2.1 + 1) + tilt.y * 0.08) * (h - size);
      }
      tx = Math.max(-size * 0.2, Math.min(w - size * 0.8, tx));
      ty = Math.max(-size * 0.2, Math.min(h - size * 0.8, ty));
      if (!pos) pos = { x: tx, y: ty };
      const ease = pointer.active ? 0.12 : 0.03;
      pos.x += (tx - pos.x) * ease;
      pos.y += (ty - pos.y) * ease;
      sun.style.transform = `translate3d(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px, 0)`;
      raf = requestAnimationFrame(frame);
    }

    whileVisible(
      section,
      () => { if (!raf) raf = requestAnimationFrame(frame); },
      () => { cancelAnimationFrame(raf); raf = null; }
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTiltButton();
    initSnow();
    initSun();
  });
})();
