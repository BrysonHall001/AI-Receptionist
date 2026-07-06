// Animated background SCENES for the two overhauled fun themes (dusk, aero).
// A fixed, full-viewport, z-index:-1 stack of layered SVG/CSS layers sits BEHIND
// all app content (content surfaces are solid, so scenery only shows in the
// margins/gutters — never behind text). Every layer's visibility/animation is
// driven by the --fun CSS variable (0..1, set by theme.js from the Fun-intensity
// slider): at --fun 0 every layer is opacity 0, so the theme looks EXACTLY as
// before; elements fade/animate in smoothly as --fun rises. Shapes are generated
// procedurally here (varied buildings, stars, windows, bubbles…) so the source
// stays small while the scene stays dense. Animation lives on inline SVG/DOM so it
// actually plays (SMIL/CSS inside a background-image would not).
(function (global) {
  const App = global.App || (global.App = {});
  const R = (a, b) => a + Math.random() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = (arr) => arr[RI(0, arr.length - 1)];

  function ensure() {
    let sc = document.getElementById("theme-scene");
    if (!sc) {
      sc = document.createElement("div");
      sc.id = "theme-scene";
      sc.setAttribute("aria-hidden", "true");
      // Insert as the FIRST body child so it sits behind everything in paint order too.
      document.body.insertBefore(sc, document.body.firstChild);
    }
    return sc;
  }
  function layer(cls, inner) {
    return `<div class="sc ${cls}">${inner || ""}</div>`;
  }
  function svg(vb, inner, extra) {
    return `<svg class="sc-svg" viewBox="0 0 ${vb}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg"${extra || ""}>${inner}</svg>`;
  }

  /* =====================================================================
     NEON DUSK — cyberpunk megacity at dusk, in the rain
     ===================================================================== */
  function duskStars() {
    let s = "";
    for (let i = 0; i < 54; i++) {
      const x = R(0, 1600), y = R(0, 300), r = R(0.5, 1.7);
      const tw = i % 4 === 0;
      const cls = tw ? ' class="tw"' : "";
      const st = tw ? ` style="--d:${(R(0, 4)).toFixed(2)}s"` : "";
      const op = (R(0.35, 0.95)).toFixed(2);
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#eae6ff" opacity="${op}"${cls}${st}/>`;
    }
    return svg("1600 340", s, ' style="--fun-fade:.25"');
  }
  function duskMoon() {
    return svg("1600 480",
      `<defs>
         <radialGradient id="mglow" cx="50%" cy="50%" r="50%">
           <stop offset="0%" stop-color="#ffd9f2" stop-opacity="0.9"/>
           <stop offset="35%" stop-color="#ff9fe6" stop-opacity="0.4"/>
           <stop offset="70%" stop-color="#ff5cf3" stop-opacity="0.08"/>
           <stop offset="100%" stop-color="#ff5cf3" stop-opacity="0"/>
         </radialGradient>
         <radialGradient id="mbody" cx="42%" cy="38%" r="70%">
           <stop offset="0%" stop-color="#fff4fb"/><stop offset="70%" stop-color="#f4d3ec"/><stop offset="100%" stop-color="#e6b8e0"/>
         </radialGradient>
       </defs>
       <circle cx="1230" cy="250" r="230" fill="url(#mglow)"/>
       <circle cx="1230" cy="250" r="92" fill="url(#mbody)"/>
       <circle cx="1266" cy="228" r="90" fill="#0d0a26" opacity="0.9"/>`);
  }
  // Procedural skyline generator: varied towers with setbacks, spires, antennae,
  // lit-window grids (only lit windows are emitted, keeping the DOM light) + neon strips.
  function skyline(opts) {
    const { w, h, count, minH, maxH, body, rim, winDensity, neon, flicker, spires } = opts;
    const winCols = ["#ffcf6a", "#ffb347", "#22e0ff", "#ff5cf3"];
    let out = "";
    let x = -20;
    let flickN = 0;
    for (let i = 0; i < count; i++) {
      const bw = R(w / count * 0.7, w / count * 1.25);
      const bh = R(minH, maxH);
      const top = h - bh;
      const cx = x + bw / 2;
      // Body (with an optional narrower setback near the top)
      out += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="${body}"/>`;
      out += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${bw.toFixed(0)}" height="2.5" fill="${rim}" opacity="0.5"/>`;
      let capTop = top;
      if (Math.random() < 0.5) {
        const sw = bw * R(0.45, 0.72), sh = R(18, 60), sx = cx - sw / 2, sy = top - sh;
        out += `<rect x="${sx.toFixed(0)}" y="${sy.toFixed(0)}" width="${sw.toFixed(0)}" height="${sh.toFixed(0)}" fill="${body}"/>`;
        out += `<rect x="${sx.toFixed(0)}" y="${sy.toFixed(0)}" width="${sw.toFixed(0)}" height="2" fill="${rim}" opacity="0.5"/>`;
        capTop = sy;
      }
      // Spire or antenna
      if (spires && Math.random() < 0.55) {
        if (Math.random() < 0.5) out += `<polygon points="${(cx - 7).toFixed(0)},${capTop.toFixed(0)} ${cx.toFixed(0)},${(capTop - R(26, 70)).toFixed(0)} ${(cx + 7).toFixed(0)},${capTop.toFixed(0)}" fill="${body}"/>`;
        else { const ah = R(20, 64); out += `<rect x="${(cx - 1).toFixed(0)}" y="${(capTop - ah).toFixed(0)}" width="2" height="${ah.toFixed(0)}" fill="${body}"/><circle cx="${cx.toFixed(0)}" cy="${(capTop - ah).toFixed(0)}" r="2.4" fill="#ff5d7a"><animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite"/></circle>`; }
      }
      // Lit window grid (emit only lit ones)
      if (winDensity > 0) {
        const stepX = 13, stepY = 15;
        for (let wy = top + 10; wy < h - 6; wy += stepY) {
          for (let wx = x + 6; wx < x + bw - 6; wx += stepX) {
            if (Math.random() > winDensity) continue;
            const col = pick(winCols);
            const fl = flicker && flickN < 22 && Math.random() < 0.08;
            if (fl) { flickN++; out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="6" fill="${col}" class="flick" style="--d:${R(0, 5).toFixed(2)}s"/>`; }
            else out += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="5" height="6" fill="${col}" opacity="${R(0.55, 0.95).toFixed(2)}"/>`;
          }
        }
      }
      // Neon strip on the face
      for (let n = 0; n < (neon || 0); n++) {
        if (Math.random() < 0.5) {
          const ny = R(top + 20, h - 40), nc = Math.random() < 0.5 ? "#22e0ff" : "#ff3df0";
          out += `<rect x="${(x + 4).toFixed(0)}" y="${ny.toFixed(0)}" width="${(bw - 8).toFixed(0)}" height="3.5" rx="1.5" fill="${nc}" opacity="0.9"><animate attributeName="opacity" values="0.9;0.5;0.9" dur="${R(2, 4).toFixed(1)}s" repeatCount="indefinite"/></rect>`;
        }
      }
      x += bw * R(0.82, 1.05);
      if (x > w + 40) break;
    }
    return svg(`${w} ${h}`, out);
  }
  function duskNear() {
    // Two big foreground faces cropped at the left & right edges (framing/parallax).
    const face = (x, wd, dir) => {
      let o = `<rect x="${x}" y="40" width="${wd}" height="600" fill="#080511"/>`;
      o += `<rect x="${dir > 0 ? x + wd - 4 : x}" y="40" width="4" height="600" fill="#ff3df0" opacity="0.35"/>`;
      for (let wy = 70; wy < 620; wy += 22) for (let wx = x + 10; wx < x + wd - 10; wx += 20) {
        if (Math.random() < 0.5) o += `<rect x="${wx}" y="${wy}" width="7" height="9" fill="${Math.random() < 0.5 ? "#ffcf6a" : "#22e0ff"}" opacity="${R(0.4, 0.9).toFixed(2)}"/>`;
      }
      o += `<rect x="${x + 8}" y="${RI(120, 400)}" width="${wd - 16}" height="4" fill="#22e0ff" opacity="0.85"/>`;
      return o;
    };
    return svg("1600 640", face(0, 150, 1) + face(1450, 150, -1), ' preserveAspectRatio="none"');
  }
  function duskDrones() {
    let o = "";
    for (let i = 0; i < 3; i++) {
      const y = R(6, 26), dur = R(26, 46), delay = R(-30, 0);
      o += `<span class="drone" style="--y:${y.toFixed(0)}%;--dur:${dur.toFixed(1)}s;--d:${delay.toFixed(1)}s"></span>`;
    }
    return o;
  }
  function buildDusk(sc) {
    sc.innerHTML =
      layer("sc-dusk-sky") +
      layer("sc-dusk-stars", duskStars()) +
      layer("sc-dusk-moon", duskMoon()) +
      layer("sc-dusk-far", skyline({ w: 1600, h: 340, count: 26, minH: 70, maxH: 210, body: "#0b0820", rim: "#7a3a8e", winDensity: 0.03, neon: 0, flicker: false, spires: false })) +
      layer("sc-dusk-mid", skyline({ w: 1600, h: 470, count: 15, minH: 180, maxH: 450, body: "#0a0714", rim: "#ff3df0", winDensity: 0.3, neon: 3, flicker: true, spires: true })) +
      layer("sc-dusk-near", duskNear()) +
      layer("sc-dusk-haze") +
      layer("sc-dusk-drones", duskDrones()) +
      layer("sc-dusk-rain");
  }

  /* =====================================================================
     FRUTIGER AERO — utopian clean-tech nature dreamscape
     ===================================================================== */
  function aeroSun() {
    let rays = "";
    for (let a = 0; a < 12; a++) { const ang = (a / 12) * Math.PI * 2; rays += `<line x1="${(1260 + Math.cos(ang) * 60).toFixed(0)}" y1="${(120 + Math.sin(ang) * 60).toFixed(0)}" x2="${(1260 + Math.cos(ang) * 140).toFixed(0)}" y2="${(120 + Math.sin(ang) * 140).toFixed(0)}" stroke="#fff6d8" stroke-width="6" stroke-linecap="round" opacity="0.5"/>`; }
    return svg("1600 900",
      `<defs><radialGradient id="sun" cx="50%" cy="50%" r="50%">
         <stop offset="0%" stop-color="#ffffff"/><stop offset="30%" stop-color="#fff4c2"/>
         <stop offset="60%" stop-color="#ffe08a" stop-opacity="0.5"/><stop offset="100%" stop-color="#ffe08a" stop-opacity="0"/>
       </radialGradient></defs>
       <g class="sun-rays" style="transform-origin:1260px 120px">${rays}</g>
       <circle cx="1260" cy="120" r="230" fill="url(#sun)"/>
       <circle cx="1260" cy="120" r="66" fill="#fffef4"/>`, ' preserveAspectRatio="xMidYMin slice"');
  }
  function cloud(cx, cy, s) {
    return `<g transform="translate(${cx} ${cy}) scale(${s})">
      <ellipse cx="0" cy="18" rx="120" ry="30" fill="#dceefc"/>
      <circle cx="-56" cy="6" r="34" fill="#ffffff"/><circle cx="-18" cy="-14" r="44" fill="#ffffff"/>
      <circle cx="30" cy="-8" r="40" fill="#ffffff"/><circle cx="70" cy="10" r="30" fill="#ffffff"/>
      <ellipse cx="0" cy="20" rx="118" ry="22" fill="#ffffff"/></g>`;
  }
  function aeroClouds(which) {
    let o = "";
    if (which === 1) { o += cloud(300, 150, 1.1) + cloud(900, 90, 0.8) + cloud(1400, 200, 1.0); }
    else { o += cloud(150, 260, 0.6) + cloud(650, 220, 0.55) + cloud(1150, 300, 0.7) + cloud(1550, 160, 0.5); }
    return svg("1600 900", o, ' preserveAspectRatio="xMidYMin slice"');
  }
  function aeroCity() {
    let o = "";
    let x = 380;
    const cols = ["#bfe6f7", "#a9dcf0", "#cdeefb", "#9fd4ea"];
    for (let i = 0; i < 14; i++) {
      const bw = R(26, 60), bh = R(60, 210), y = 520 - bh;
      o += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" rx="3" fill="${pick(cols)}"/>`;
      o += `<rect x="${(x + 3).toFixed(0)}" y="${y.toFixed(0)}" width="4" height="${bh.toFixed(0)}" fill="#ffffff" opacity="0.7"/>`;
      if (Math.random() < 0.5) o += `<polygon points="${x.toFixed(0)},${y.toFixed(0)} ${(x + bw / 2).toFixed(0)},${(y - R(14, 40)).toFixed(0)} ${(x + bw).toFixed(0)},${y.toFixed(0)}" fill="${pick(cols)}"/>`;
      x += bw * R(1.02, 1.5);
      if (x > 1240) break;
    }
    return svg("1600 560", o, ' preserveAspectRatio="xMidYMax slice"');
  }
  function aeroField() {
    // Layered rolling hills + highlight edges + a winding path + grass tufts + wildflowers.
    const hill = (d, fill, hl) => `<path d="${d}" fill="${fill}"/><path d="${d}" fill="none" stroke="${hl}" stroke-width="3" opacity="0.5"/>`;
    let tufts = "";
    for (let i = 0; i < 60; i++) { const x = R(0, 1600), y = R(360, 590); tufts += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} l-3 -8 M${x.toFixed(0)} ${y.toFixed(0)} l0 -10 M${x.toFixed(0)} ${y.toFixed(0)} l3 -8" stroke="#3f9e52" stroke-width="1.4" opacity="0.55"/>`; }
    let flowers = "";
    for (let i = 0; i < 26; i++) { const x = R(0, 1600), y = R(380, 590); flowers += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="2.4" fill="${pick(["#fff2a8", "#ffb3d1", "#ffffff", "#ffd27a"])}"/>`; }
    return svg("1600 620",
      `<defs>
         <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7ed957"/><stop offset="100%" stop-color="#57bf46"/></linearGradient>
         <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#66cc4e"/><stop offset="100%" stop-color="#3fa83c"/></linearGradient>
         <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4fb840"/><stop offset="100%" stop-color="#2f8f34"/></linearGradient>
       </defs>
       ${hill("M0 360 q 400 -70 800 -20 q 400 50 800 -30 V620 H0 Z", "url(#g1)", "#c6f5b0")}
       ${hill("M0 430 q 350 -60 720 -10 q 500 60 880 -20 V620 H0 Z", "url(#g2)", "#a6e894")}
       <path d="M760 620 q -40 -120 40 -190 q 70 -60 20 -140" fill="none" stroke="#eaf7d8" stroke-width="18" opacity="0.55" stroke-linecap="round"/>
       ${hill("M0 500 q 300 -50 640 -6 q 520 60 960 -18 V620 H0 Z", "url(#g3)", "#8ada78")}
       ${tufts}${flowers}`);
  }
  function aeroOrb() {
    return svg("1600 900",
      `<defs>
         <radialGradient id="orb" cx="38%" cy="32%" r="72%">
           <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="22%" stop-color="#d7f2ff" stop-opacity="0.55"/>
           <stop offset="60%" stop-color="#8fd6f5" stop-opacity="0.28"/><stop offset="100%" stop-color="#4aa8e0" stop-opacity="0.14"/>
         </radialGradient>
       </defs>
       <g transform="translate(520 470)">
         <circle r="150" fill="url(#orb)" stroke="#ffffff" stroke-opacity="0.4" stroke-width="1.5"/>
         <clipPath id="oc"><circle r="150"/></clipPath>
         <g clip-path="url(#oc)" opacity="0.4">
           <rect x="-150" y="70" width="300" height="90" fill="#bfe6f7"/>
           <rect x="-70" y="30" width="22" height="90" fill="#a9dcf0"/><rect x="-30" y="10" width="20" height="110" fill="#cdeefb"/>
           <rect x="8" y="40" width="24" height="80" fill="#a9dcf0"/><rect x="48" y="20" width="18" height="100" fill="#cdeefb"/>
         </g>
         <ellipse cx="-52" cy="-58" rx="46" ry="26" fill="#ffffff" opacity="0.7" transform="rotate(-28 -52 -58)"/>
         <circle cx="70" cy="72" r="10" fill="#ffffff" opacity="0.5"/>
       </g>`, ' preserveAspectRatio="xMidYMax slice"');
  }
  function aeroBubbles() {
    let o = "";
    for (let i = 0; i < 14; i++) {
      const sz = RI(14, 66), left = R(0, 98), dur = R(12, 27), delay = R(-27, 0), sway = RI(-42, 42);
      o += `<span class="bubble" style="--sz:${sz}px;--l:${left.toFixed(1)}%;--dur:${dur.toFixed(1)}s;--d:${delay.toFixed(1)}s;--sway:${sway}px"></span>`;
    }
    return o;
  }
  function aeroButterfly() {
    return `<svg class="sc-svg sc-bfly-svg" viewBox="0 0 60 50" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#5cc8ff"/><stop offset="100%" stop-color="#2f6ad6"/></linearGradient></defs>
      <g transform="translate(30 25)">
        <g class="wingL"><path d="M0 0 C -26 -22 -30 -4 -20 4 C -28 10 -14 20 0 6 Z" fill="url(#wing)" stroke="#1f4aa0" stroke-width="0.6"/></g>
        <g class="wingR"><path d="M0 0 C 26 -22 30 -4 20 4 C 28 10 14 20 0 6 Z" fill="url(#wing)" stroke="#1f4aa0" stroke-width="0.6"/></g>
        <ellipse cx="0" cy="2" rx="2" ry="8" fill="#22314f"/>
        <line x1="0" y1="-6" x2="-4" y2="-12" stroke="#22314f" stroke-width="0.8"/><line x1="0" y1="-6" x2="4" y2="-12" stroke="#22314f" stroke-width="0.8"/>
      </g></svg>`;
  }
  function aeroSparkles() {
    let o = "";
    for (let i = 0; i < 20; i++) { const x = R(0, 1600), y = R(300, 600), s = R(3, 7); o += `<path class="tw" style="--d:${R(0, 4).toFixed(2)}s" d="M${x.toFixed(0)} ${(y - s).toFixed(0)} L${(x + s * 0.28).toFixed(0)} ${(y - s * 0.28).toFixed(0)} L${(x + s).toFixed(0)} ${y.toFixed(0)} L${(x + s * 0.28).toFixed(0)} ${(y + s * 0.28).toFixed(0)} L${x.toFixed(0)} ${(y + s).toFixed(0)} L${(x - s * 0.28).toFixed(0)} ${(y + s * 0.28).toFixed(0)} L${(x - s).toFixed(0)} ${y.toFixed(0)} L${(x - s * 0.28).toFixed(0)} ${(y - s * 0.28).toFixed(0)} Z" fill="#ffffff"/>`; }
    return svg("1600 620", o, ' preserveAspectRatio="none"');
  }
  function buildAero(sc) {
    sc.innerHTML =
      layer("sc-aero-sky") +
      layer("sc-aero-sun", aeroSun()) +
      layer("sc-aero-clouds-far", aeroClouds(2)) +
      layer("sc-aero-city", aeroCity()) +
      layer("sc-aero-field", aeroField()) +
      layer("sc-aero-orb", aeroOrb()) +
      layer("sc-aero-clouds-near", aeroClouds(1)) +
      layer("sc-aero-bubbles", aeroBubbles()) +
      layer("sc-aero-sparkles", aeroSparkles()) +
      layer("sc-aero-bfly", `<div class="bfly-path">${aeroButterfly()}</div>`);
  }

  let current = null;
  function mount(themeId) {
    const sc = ensure();
    if (themeId === current) return;
    current = themeId;
    if (themeId === "dusk") buildDusk(sc);
    else if (themeId === "aero") buildAero(sc);
    else { sc.innerHTML = ""; } // no scene for other themes
  }

  App.scene = { mount };
})(typeof window !== "undefined" ? window : globalThis);
