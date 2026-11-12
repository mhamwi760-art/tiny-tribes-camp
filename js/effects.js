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
      raf = requestAnimationFrame(frame);
    }

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

    function frame() {
      t += 0.004;
      const w = section.clientWidth;
      const h = section.clientHeight;
      const size = sun.offsetWidth;
      // A slow looping path across the top part of the section
      const x = (0.5 + 0.42 * Math.sin(t) + tilt.x * 0.06) * (w - size);
      const y = (0.22 + 0.18 * Math.sin(t * 2.1 + 1) + tilt.y * 0.08) * (h - size);
      sun.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
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
