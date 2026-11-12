/* ==========================================================
   Tiny Tribes – cartoon kids on the Winter / Summer cards
   Their eyes follow the mouse (or a finger on a phone).
   ========================================================== */

(function () {
  // Shared face parts. Each eye is a white, a pupil that moves, and a lid that blinks.
  function eye(cx, cy) {
    return `
      <g class="eye" data-cx="${cx}" data-cy="${cy}">
        <ellipse cx="${cx}" cy="${cy}" rx="8" ry="9.5" fill="#fff"/>
        <g class="pupil"><circle cx="${cx}" cy="${cy + 1}" r="4.6" fill="#2b1d17"/><circle cx="${cx + 1.6}" cy="${cy - 1}" r="1.5" fill="#fff"/></g>
        <ellipse class="lid" cx="${cx}" cy="${cy}" rx="8.6" ry="10" fill="var(--skin)"/>
      </g>`;
  }

  const face = (mouth) => `
    ${eye(66, 98)}
    ${eye(94, 98)}
    <circle cx="55" cy="113" r="6.5" fill="#f4978e" opacity=".55"/>
    <circle cx="105" cy="113" r="6.5" fill="#f4978e" opacity=".55"/>
    <path d="${mouth}" stroke="#2b1d17" stroke-width="3" fill="none" stroke-linecap="round"/>`;

  // Small brand feather tucked into each hat
  const feather = (x, y, r, fill) => `
    <g transform="translate(${x} ${y}) rotate(${r})">
      <path d="M0 0 C-6 -12 -6 -26 0 -38 C6 -26 6 -12 0 0Z" fill="${fill}"/>
      <path d="M0 -3 V-34" stroke="#fff3d8" stroke-width="1.6" stroke-linecap="round"/>
    </g>`;

  const winter = `
  <svg class="kid kid-winter" viewBox="0 0 160 200" style="--skin:#f6cfa6" role="img" aria-label="Cartoon child in a winter hat and scarf">
    <path d="M26 200 C26 152 48 136 80 136 C112 136 134 152 134 200Z" fill="#db2126"/>
    <path d="M80 140 V200" stroke="#a3171b" stroke-width="3"/>
    <circle cx="80" cy="160" r="3" fill="#fff3d8"/><circle cx="80" cy="178" r="3" fill="#fff3d8"/>
    <circle cx="40" cy="96" r="8" fill="var(--skin)"/><circle cx="120" cy="96" r="8" fill="var(--skin)"/>
    <circle cx="80" cy="94" r="40" fill="var(--skin)"/>
    ${face("M71 114 Q80 123 89 114")}
    <path d="M40 84 C40 50 60 38 80 38 C100 38 120 50 120 84Z" fill="#f36c21"/>
    <path d="M56 46 L56 80 M70 40 L70 80 M90 40 L90 80 M104 46 L104 80" stroke="#e05a15" stroke-width="3"/>
    <rect x="35" y="76" width="90" height="16" rx="8" fill="#fbaa1e"/>
    <path d="M42 84 h76" stroke="#f36c21" stroke-width="3" stroke-dasharray="6 6"/>
    <circle class="pompom" cx="80" cy="34" r="11" fill="#fff3d8"/>
    ${feather(114, 80, 22, "#db2126")}
    <path d="M46 130 h68 a9 9 0 0 1 0 18 h-68 a9 9 0 0 1 0 -18Z" fill="#fbaa1e"/>
    <path d="M60 130 v18 M74 130 v18 M88 130 v18 M102 130 v18" stroke="#f36c21" stroke-width="4"/>
    <path class="scarf-tail" d="M92 144 h16 l3 38 h-20Z" fill="#fbaa1e"/>
    <path d="M91 170 h20 M92 160 h18" stroke="#f36c21" stroke-width="4"/>
  </svg>`;

  const summer = `
  <svg class="kid kid-summer" viewBox="0 0 160 200" style="--skin:#e8b88a" role="img" aria-label="Cartoon child in a sun hat and summer top">
    <path d="M30 200 C30 154 50 138 80 138 C110 138 130 154 130 200Z" fill="var(--skin)"/>
    <path d="M44 200 C44 162 56 150 62 148 L98 148 C104 150 116 162 116 200Z" fill="#fff3d8"/>
    <path d="M46 176 h68 M45 188 h70" stroke="#db2126" stroke-width="6"/>
    <path d="M62 148 V140 M98 148 V140" stroke="#fff3d8" stroke-width="6" stroke-linecap="round"/>
    <circle cx="40" cy="98" r="8" fill="var(--skin)"/><circle cx="120" cy="98" r="8" fill="var(--skin)"/>
    <circle cx="80" cy="96" r="40" fill="var(--skin)"/>
    <path d="M42 92 C38 66 56 56 80 56 C104 56 122 66 118 92 C110 80 98 76 80 78 C64 76 50 80 42 92Z" fill="#4a2f22"/>
    ${face("M69 113 Q80 126 91 113")}
    <path d="M46 66 C46 36 114 36 114 66Z" fill="#f8b864"/>
    <ellipse cx="80" cy="66" rx="62" ry="12" fill="#f8b864"/>
    <ellipse cx="80" cy="64" rx="50" ry="7" fill="#ef9f45" opacity=".5"/>
    <rect x="46" y="52" width="68" height="10" rx="3" fill="#db2126"/>
    ${feather(106, 56, 30, "#f36c21")}
  </svg>`;

  window.TT_CHARACTERS = { winter, summer };

  /* ---------- Eyes follow the pointer ---------- */
  function initEyes() {
    let eyes = [];
    let target = null;
    let queued = false;

    function collect() {
      eyes = Array.from(document.querySelectorAll(".kid .eye")).map((g) => ({
        g,
        pupil: g.querySelector(".pupil"),
        svg: g.ownerSVGElement,
        cx: Number(g.dataset.cx),
        cy: Number(g.dataset.cy)
      }));
    }

    function update() {
      queued = false;
      if (!target) return;
      eyes.forEach((e) => {
        const box = e.svg.getBoundingClientRect();
        if (!box.width) return;
        const scale = box.width / 160;
        const ex = box.left + e.cx * scale;
        const ey = box.top + e.cy * scale;
        const dx = target.x - ex;
        const dy = target.y - ey;
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(3.6, dist / 25); // look further when the pointer is further away
        e.pupil.setAttribute("transform", `translate(${((dx / dist) * reach).toFixed(2)} ${((dy / dist) * reach * 0.9).toFixed(2)})`);
      });
    }

    function onMove(e) {
      target = { x: e.clientX, y: e.clientY };
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    }

    collect();
    if (!eyes.length) return;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    window.addEventListener("scroll", () => { if (!queued && target) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  }

  window.TT_initEyes = initEyes;
})();
