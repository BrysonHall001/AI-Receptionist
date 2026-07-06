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

  /* =====================================================================
     COTTAGE WARM — storybook village in rolling hills at golden hour
     ===================================================================== */
  function cotSun() {
    return svg("1600 900",
      `<defs><radialGradient id="cotsun" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff7e0"/><stop offset="30%" stop-color="#ffe6ad" stop-opacity="0.9"/>
        <stop offset="62%" stop-color="#ffd08a" stop-opacity="0.35"/><stop offset="100%" stop-color="#ffd08a" stop-opacity="0"/>
      </radialGradient></defs>
      <circle cx="540" cy="430" r="300" fill="url(#cotsun)"/>
      <circle cx="540" cy="446" r="94" fill="#fff3d6"/>`, ' preserveAspectRatio="xMidYMax slice"');
  }
  function cotHills() {
    const hill = (d, f, hl) => `<path d="${d}" fill="${f}"/><path d="${d}" fill="none" stroke="${hl}" stroke-width="3" opacity="0.5"/>`;
    let trees = "";
    for (let i = 0; i < 10; i++) { const x = R(120, 1500), y = R(250, 344), s = R(0.4, 0.8); trees += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${s.toFixed(2)})"><rect x="-2" y="0" width="4" height="14" fill="#6b5a3e"/><circle cx="0" cy="-6" r="14" fill="#6f9a5e"/><circle cx="-9" cy="2" r="10" fill="#7ba869"/><circle cx="9" cy="2" r="10" fill="#7ba869"/></g>`; }
    return svg("1600 560",
      `<defs>
        <linearGradient id="ch1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#a7c98d"/><stop offset="100%" stop-color="#8bb673"/></linearGradient>
        <linearGradient id="ch2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8fbf76"/><stop offset="100%" stop-color="#6fa257"/></linearGradient>
        <linearGradient id="ch3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#79ad61"/><stop offset="100%" stop-color="#578a45"/></linearGradient>
      </defs>
      ${hill("M0 300 q 260 -60 520 -30 q 300 34 560 -20 q 300 -40 520 10 V560 H0 Z", "url(#ch1)", "#c9e6b0")}
      ${trees}
      ${hill("M0 380 q 300 -50 620 -14 q 320 40 980 -24 V560 H0 Z", "url(#ch2)", "#acd992")}
      ${hill("M0 460 q 340 -46 700 -8 q 360 40 900 -18 V560 H0 Z", "url(#ch3)", "#8fce76")}`);
  }
  function cotVillage() {
    let o = "";
    for (let i = 0; i < 6; i++) { const x = 890 + i * 44 + R(-6, 6), y = 305 + R(-6, 6), w = R(16, 24), h = R(12, 18); o += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})"><rect x="${(-w / 2).toFixed(0)}" y="0" width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="2" fill="#e9dcc2"/><path d="M${(-w / 2 - 2).toFixed(0)} 0 L0 ${(-h * 0.7).toFixed(0)} L${(w / 2 + 2).toFixed(0)} 0 Z" fill="#b07a5c"/></g>`; }
    o += `<path d="M960 380 q -30 -40 10 -76" fill="none" stroke="#e0d3b8" stroke-width="6" opacity="0.7"/>`;
    return svg("1600 560", o, ' preserveAspectRatio="xMidYMax slice"');
  }
  function cotTrees() {
    const tree = (x, g, s) => `<g transform="translate(${x.toFixed(0)} ${g.toFixed(0)}) scale(${s.toFixed(2)})"><rect x="-7" y="-40" width="14" height="52" rx="5" fill="#6e5636"/><circle cx="0" cy="-56" r="40" fill="#5f9a4e"/><circle cx="-30" cy="-40" r="28" fill="#6fab5c"/><circle cx="30" cy="-40" r="28" fill="#6fab5c"/><circle cx="0" cy="-40" r="34" fill="#79b866"/><circle cx="-14" cy="-64" r="22" fill="#8ac877" opacity="0.85"/></g>`;
    let o = "";
    for (const [x, g, s] of [[120, 522, 1.35], [300, 542, 0.9], [1360, 516, 1.4], [1180, 546, 0.85], [720, 545, 0.66]]) o += tree(x, g, s);
    return svg("1600 620", o, ' preserveAspectRatio="xMidYMax slice"');
  }
  function cottage(x, g, s, wall, roof, roofDark) {
    const lit = Math.random() < 0.6;
    return `<g transform="translate(${x.toFixed(0)} ${g.toFixed(0)}) scale(${s.toFixed(2)}) rotate(${R(-2, 2).toFixed(1)})">
      <ellipse cx="0" cy="4" rx="52" ry="9" fill="#00000018"/>
      <path d="M-46 4 q-6 -54 46 -58 q52 4 46 58 Z" fill="${wall}"/>
      <path d="M-58 -44 Q0 -104 58 -44 Q30 -58 0 -58 Q-30 -58 -58 -44 Z" fill="${roof}"/>
      <path d="M-58 -44 Q0 -104 58 -44" fill="none" stroke="${roofDark}" stroke-width="3" opacity="0.6"/>
      <rect x="26" y="-72" width="12" height="26" rx="2" fill="${roofDark}"/>
      <rect x="-12" y="-30" width="24" height="34" rx="11" fill="#5a4632"/>
      <circle cx="0" cy="-14" r="3.6" fill="#e9d6a8"/>
      <circle cx="-30" cy="-24" r="7" fill="${lit ? "#ffdf9e" : "#cdbfa0"}"/><circle cx="30" cy="-24" r="7" fill="${lit ? "#ffdf9e" : "#cdbfa0"}"/>
      <g class="smoke" style="--d:0s"><circle cx="32" cy="-74" r="5" fill="#efe7dd"/></g>
      <g class="smoke" style="--d:1.3s"><circle cx="32" cy="-74" r="6" fill="#efe7dd"/></g>
      <g class="smoke" style="--d:2.6s"><circle cx="32" cy="-74" r="7" fill="#efe7dd"/></g>
    </g>`;
  }
  function cotCottages() {
    const walls = ["#f3e4c8", "#efdcc0", "#f6ead2"];
    const roofs = [["#c98a6a", "#a86a4c"], ["#8fa9b0", "#6f8990"], ["#c9a34a", "#a5822f"], ["#b96f8a", "#985068"]];
    let o = "";
    for (const [x, y, s] of [[430, 470, 1.15], [655, 500, 1.0], [860, 486, 1.25], [1080, 505, 0.95], [1255, 478, 1.1]]) { const r = pick(roofs); o += cottage(x, y, s, pick(walls), r[0], r[1]); }
    return svg("1600 620", o, ' preserveAspectRatio="xMidYMax slice"');
  }
  function cotPath() {
    let stones = "";
    for (let t = 0; t <= 1; t += 0.03) {
      const y = 620 - t * 360, cx = 800 + Math.sin(t * 4) * 120 * (1 - t) * 0.6 - t * 30, w = (1 - t) * 120 + 20;
      for (let k = -1; k <= 1; k++) { const sx = cx + k * (w / 3); stones += `<ellipse cx="${sx.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(9 * (1 - t) + 3).toFixed(1)}" ry="${(5 * (1 - t) + 2).toFixed(1)}" fill="${pick(["#d9cdb6", "#cfc2a8", "#e2d8c4"])}" stroke="#b9a988" stroke-width="0.6"/>`; }
    }
    return svg("1600 620", stones, ' preserveAspectRatio="xMidYMax slice"');
  }
  function cotForeground() {
    let o = "";
    for (let i = 0; i < 66; i++) { const x = R(0, 1600), y = R(430, 600); o += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} l-3 -9 M${x.toFixed(0)} ${y.toFixed(0)} l0 -12 M${x.toFixed(0)} ${y.toFixed(0)} l3 -9" stroke="#4f8f43" stroke-width="1.5" opacity="0.6"/>`; }
    for (let i = 0; i < 22; i++) { const x = R(0, 1600), y = R(470, 600); o += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})"><circle r="3.4" fill="${pick(["#e6a3d0", "#f2d06a", "#c79be0", "#ffffff"])}"/><circle r="1.3" fill="#fff4c0"/></g>`; }
    return svg("1600 620", o, ' preserveAspectRatio="none"');
  }
  function cotFireflies() {
    let o = "";
    for (let i = 0; i < 12; i++) { const l = R(6, 94), t = R(42, 86), dur = R(6, 12), d = R(-10, 0); o += `<span class="firefly" style="--l:${l.toFixed(1)}%;--t:${t.toFixed(1)}%;--dur:${dur.toFixed(1)}s;--d:${d.toFixed(1)}s"></span>`; }
    return o;
  }
  function buildCottage(sc) {
    sc.innerHTML =
      layer("sc-cot-sky") +
      layer("sc-cot-sun", cotSun()) +
      layer("sc-cot-hills", cotHills()) +
      layer("sc-cot-village", cotVillage()) +
      layer("sc-cot-trees", cotTrees()) +
      layer("sc-cot-cottages", cotCottages()) +
      layer("sc-cot-path", cotPath()) +
      layer("sc-cot-fg", cotForeground()) +
      layer("sc-cot-fireflies", cotFireflies());
  }

  /* =====================================================================
     VAPORWAVE — 80s synthwave sunset with a glowing perspective grid
     ===================================================================== */
  function vapStars() {
    let s = "";
    for (let i = 0; i < 48; i++) { const x = R(0, 1600), y = R(0, 300), r = R(0.6, 1.8); const tw = i % 3 === 0; s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#ffffff" opacity="${R(0.4, 0.95).toFixed(2)}"${tw ? ` class="tw" style="--d:${R(0, 4).toFixed(2)}s"` : ""}/>`; }
    return svg("1600 340", s, ' preserveAspectRatio="none"');
  }
  function vapSun() {
    let slits = "", y = 604, th = 2;
    while (y < 842) { slits += `<rect x="590" y="${y.toFixed(0)}" width="420" height="${th.toFixed(1)}" fill="#1a1130"/>`; y += th + Math.max(3, 15 - (y - 604) / 22); th += 1.05; }
    return svg("1600 900",
      `<defs>
        <linearGradient id="vsun" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff2b0"/><stop offset="42%" stop-color="#ff8a3d"/><stop offset="100%" stop-color="#ff2d95"/></linearGradient>
        <radialGradient id="vbloom" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ff8ad0" stop-opacity="0.7"/><stop offset="55%" stop-color="#ff5cc0" stop-opacity="0.14"/><stop offset="100%" stop-color="#ff5cc0" stop-opacity="0"/></radialGradient>
        <clipPath id="vclip"><circle cx="800" cy="648" r="196"/></clipPath>
      </defs>
      <circle cx="800" cy="648" r="330" fill="url(#vbloom)"/>
      <g clip-path="url(#vclip)"><rect x="590" y="452" width="420" height="392" fill="url(#vsun)"/>${slits}</g>`, ' preserveAspectRatio="xMidYMax slice"');
  }
  function vapMountains() {
    let p = "M0 560 ", x = 0;
    while (x < 1600) { const nx = x + R(90, 210); p += `L${((x + nx) / 2).toFixed(0)} ${R(360, 470).toFixed(0)} L${nx.toFixed(0)} ${R(500, 558).toFixed(0)} `; x = nx; }
    const ridge = p;
    p += "L1600 620 L0 620 Z";
    return svg("1600 620",
      `<path d="${p}" fill="#2a1a52"/><path d="${ridge}" fill="none" stroke="#ff5cc0" stroke-width="2" opacity="0.5"/>`, ' preserveAspectRatio="xMidYMax slice"');
  }
  function palm(x, g, s, flip) {
    let fr = "";
    for (let i = 0; i < 7; i++) { const a = (-90 + (i - 3) * 27) * Math.PI / 180, len = R(58, 92), ex = Math.cos(a) * len, ey = Math.sin(a) * len; fr += `<path d="M0 0 Q ${(ex * 0.5 - 8).toFixed(0)} ${(ey * 0.5 - 8).toFixed(0)} ${ex.toFixed(0)} ${ey.toFixed(0)}" fill="none" stroke="#0d0820" stroke-width="6" stroke-linecap="round"/>`; }
    return `<g transform="translate(${x.toFixed(0)} ${g.toFixed(0)}) scale(${(flip ? -s : s).toFixed(2)} ${s.toFixed(2)})"><path d="M0 0 Q -14 -120 6 -230" fill="none" stroke="#0d0820" stroke-width="12" stroke-linecap="round"/><g transform="translate(6 -230)">${fr}</g></g>`;
  }
  function vapPalms() {
    return svg("1600 620", palm(120, 620, 1.0, false) + palm(1500, 620, 1.1, true) + palm(400, 620, 0.66, false) + palm(1180, 620, 0.74, true), ' preserveAspectRatio="xMidYMax slice"');
  }
  function buildVaporwave(sc) {
    sc.innerHTML =
      layer("sc-vap-sky") +
      layer("sc-vap-scan") +
      layer("sc-vap-stars", vapStars()) +
      layer("sc-vap-sun", vapSun()) +
      layer("sc-vap-mtn", vapMountains()) +
      layer("sc-vap-palms", vapPalms()) +
      layer("sc-vap-glow") +
      `<div class="sc sc-vap-grid"><div class="vap-plane"></div></div>` +
      layer("sc-vap-shoot", `<span class="shoot"></span>`);
  }

  let current = null;
  function mount(themeId) {
    const sc = ensure();
    if (themeId === current) return;
    current = themeId;
    if (themeId === "dusk") buildDusk(sc);
    else if (themeId === "aero") buildAero(sc);
    else if (themeId === "cottage") buildCottage(sc);
    else if (themeId === "vaporwave") buildVaporwave(sc);
    else { sc.innerHTML = ""; } // no scene for other themes
  }

  App.scene = { mount };
})(typeof window !== "undefined" ? window : globalThis);
