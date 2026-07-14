// <scene-exempt> Golden Hour scenic renderer (WebGL) — same treatment as themeScene.js:
// its inline styles are the feature. Marker honored by designAudit.ts.
// ============================================================================
// EXPERIMENTAL, ISOLATED, REVERSIBLE: a WebGL (Three.js) volumetric Golden Hour
// sky for the "sunset" theme ONLY. This is a separate, self-contained module.
// Deleting this file + /js/vendor/three.min.js + the two hook lines in
// themeScene.js (App.webglSunset.activate / .deactivate) restores today's exact
// behavior (the hand-drawn SVG sunset scene, which is left completely untouched
// and also serves as the fallback below).
//
// Guarantees:
//  - Graceful fallback: if WebGL is unsupported, Three fails to load, the canvas
//    won't init, or ANY runtime error occurs, we simply don't show a canvas and
//    the existing SVG sunset scene remains visible. Never blank/black/broken.
//  - Perf ceiling: ~30fps cap; loop pauses on tab-hide (visibilitychange) and when
//    leaving the sunset theme (deactivate disposes GL); prefers-reduced-motion
//    renders a single static frame with no loop. DPR capped to 1.75.
//  - Legibility: the canvas is a full-viewport BACKGROUND layer inside #theme-scene
//    (z-index:-1), behind all content; panels stay solid, so it never sits under text.
//  - Honors the fun slider: reads the same --fun (0..1) and feeds it to the shader.
// ============================================================================
(function (global) {
  const App = global.App || (global.App = {});
  const THREE_URL = "/js/vendor/three.min.js";
  const FRAME_MS = 1000 / 30;

  let active = false, container = null, canvas = null, birds = null, styleEl = null;
  let renderer = null, scene = null, camera = null, geo = null, mat = null, mesh = null;
  let rafId = 0, lastT = 0, startT = 0, threeLoading = null;
  const reduce = () => global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function webglSupported() {
    try {
      const c = document.createElement("canvas");
      return !!(global.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  function loadThree() {
    if (global.THREE) return Promise.resolve();
    if (threeLoading) return threeLoading;
    threeLoading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = THREE_URL; s.async = true;
      s.onload = () => global.THREE ? res() : rej(new Error("THREE missing"));
      s.onerror = () => rej(new Error("three load failed"));
      document.head.appendChild(s);
    });
    return threeLoading;
  }
  function getFun() {
    const v = parseFloat(getComputedStyle(document.body).getPropertyValue("--fun"));
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  }

  const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const FRAG = [
    "precision highp float;",
    "varying vec2 vUv; uniform vec2 u_res; uniform float u_time; uniform float u_fun;",
    "float hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }",
    "float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);",
    " float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));",
    " return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }",
    "float fbm(vec2 p){ float v=0.0,amp=0.5; mat2 m=mat2(1.6,1.2,-1.2,1.6);",
    " for(int i=0;i<6;i++){ v+=amp*noise(p); p=m*p; amp*=0.5; } return v; }",
    "void main(){",
    " vec2 uv=vUv; float aspect=u_res.x/max(u_res.y,1.0); vec2 p=vec2(uv.x*aspect,uv.y);",
    " float fun=clamp(u_fun,0.0,1.0); float y=uv.y;",
    " vec3 top=vec3(0.23,0.16,0.20), midU=vec3(0.79,0.30,0.16), midL=vec3(0.95,0.55,0.20), gold=vec3(1.0,0.80,0.45), hot=vec3(1.0,0.95,0.85);",
    " vec3 sky=mix(hot,gold,smoothstep(0.0,0.22,y)); sky=mix(sky,midL,smoothstep(0.18,0.42,y)); sky=mix(sky,midU,smoothstep(0.40,0.66,y)); sky=mix(sky,top,smoothstep(0.62,1.0,y));",
    " vec3 grey=vec3(dot(sky,vec3(0.299,0.587,0.114))); sky=mix(mix(grey,sky,0.82),sky,fun);",
    " vec2 sun=vec2(0.5*aspect,0.05); float sd=distance(p,sun);",
    " float bloom=exp(-sd*3.5)*(0.5+0.7*fun); vec3 col=sky+hot*bloom;",
    " col=mix(col,hot,smoothstep(0.25,0.0,y)*(0.35+0.3*fun));",
    " float t=u_time*0.02; vec2 cuv=vec2(uv.x*aspect*1.8,uv.y*1.4);",
    " float dens=fbm(cuv*1.2+vec2(t,t*0.3))+0.5*fbm(cuv*2.5+vec2(-t*1.5,t*0.2)); dens/=1.5;",
    " float cov=mix(0.72,0.34,fun); float cloud=smoothstep(cov,cov+0.28,dens); cloud*=smoothstep(0.02,0.28,y);",
    " float lit=smoothstep(0.0,0.5,dens-cov); vec3 cloudLo=vec3(1.0,0.75,0.42), cloudHi=vec3(0.35,0.22,0.26);",
    " vec3 cloudCol=mix(cloudHi,cloudLo,smoothstep(0.10,0.0,y)+0.5*lit); cloudCol+=hot*bloom*0.4;",
    " col=mix(col,cloudCol,cloud*(0.6+0.4*fun));",
    " vec2 dir=p-sun; float ang=atan(dir.y,dir.x);",
    " float rays=pow(fbm(vec2(ang*6.0,t*2.0))*0.6+fbm(vec2(ang*14.0,t*1.3))*0.4,1.5);",
    " float god=rays*exp(-sd*1.6)*smoothstep(-0.2,0.4,dir.y)*(0.25+1.1*fun);",
    " col+=vec3(1.0,0.85,0.6)*god;",
    " col+=(hash(uv*u_res+t)*0.04-0.02)*(0.4+0.6*fun);",
    " float vig=smoothstep(1.3,0.3,length((uv-0.5)*vec2(aspect,1.0))); col*=mix(0.90,1.0,vig);",
    " gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function injectStyle() {
    if (styleEl) return;
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-webgl-sunset", "");
    styleEl.textContent =
      "#theme-scene .wgl-sunset-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}" +
      "#theme-scene .wgl-birds{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;animation:wglBirdDrift 90s ease-in-out infinite;}" +
      "#theme-scene .wgl-birds .b{transform-box:fill-box;transform-origin:center;animation:wglBirdFlap .7s ease-in-out infinite;}" +
      "@keyframes wglBirdDrift{0%,100%{transform:translateX(-3%)}50%{transform:translateX(3%)}}" +
      "@keyframes wglBirdFlap{0%,100%{transform:scaleY(1)}50%{transform:scaleY(0.5)}}" +
      "@media (prefers-reduced-motion: reduce){#theme-scene .wgl-birds,#theme-scene .wgl-birds .b{animation:none!important}}";
    document.head.appendChild(styleEl);
  }
  function makeBirds() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "wgl-birds");
    svg.setAttribute("viewBox", "0 0 1600 620");
    svg.setAttribute("preserveAspectRatio", "none");
    let inner = "";
    for (let i = 0; i < 7; i++) {
      const x = 300 + Math.random() * 1000, y = 150 + Math.random() * 210, s = 0.7 + Math.random() * 0.6, d = (Math.random() * 0.6).toFixed(2);
      inner += '<g class="b" style="animation-delay:' + d + 's" transform="translate(' + x.toFixed(0) + ' ' + y.toFixed(0) + ')"><path d="M' + (-10 * s).toFixed(0) + ' 0 Q ' + (-5 * s).toFixed(0) + ' ' + (-6 * s).toFixed(0) + ' 0 0 Q ' + (5 * s).toFixed(0) + ' ' + (-6 * s).toFixed(0) + ' ' + (10 * s).toFixed(0) + ' 0" fill="none" stroke="#3a2530" stroke-width="2.4" stroke-linecap="round"/></g>';
    }
    svg.innerHTML = inner;
    return svg;
  }

  function sizeRenderer() {
    if (!renderer || !container) return;
    const w = container.clientWidth || global.innerWidth, h = container.clientHeight || global.innerHeight;
    const dpr = Math.min(global.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    if (mat) mat.uniforms.u_res.value.set(w * dpr, h * dpr);
  }
  function onResize() { sizeRenderer(); if (!loopRunning()) renderOnce(); }
  function loopRunning() { return rafId !== 0; }

  function initGL() {
    const THREE = global.THREE;
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
    canvas = renderer.domElement;
    canvas.className = "wgl-sunset-canvas";
    scene = new THREE.Scene();
    camera = new THREE.Camera();
    geo = new THREE.PlaneGeometry(2, 2);
    mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { u_time: { value: 0 }, u_fun: { value: getFun() }, u_res: { value: new THREE.Vector2(1, 1) } },
      depthTest: false, depthWrite: false
    });
    mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    container.appendChild(canvas);
    birds = makeBirds();
    container.appendChild(birds);
    sizeRenderer();
    global.addEventListener("resize", onResize);
  }

  function renderOnce() {
    if (!renderer) return;
    mat.uniforms.u_fun.value = getFun();
    mat.uniforms.u_time.value = (performance.now() - startT) / 1000;
    if (birds) birds.style.opacity = String(Math.max(0, Math.min(1, (getFun() - 0.4) * 1.8)));
    renderer.render(scene, camera);
  }
  function frame(now) {
    if (!active) return;
    rafId = requestAnimationFrame(frame);
    if (now - lastT < FRAME_MS) return;
    lastT = now;
    renderOnce();
  }
  function startLoop() {
    if (reduce()) { renderOnce(); return; }      // static single frame
    if (rafId) return;
    startT = performance.now(); lastT = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } }
  function onVis() { if (document.hidden) stopLoop(); else if (active && !reduce()) startLoop(); }

  function cleanup() {
    stopLoop();
    global.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVis);
    try { if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch (e) {}
    try { if (birds && birds.parentNode) birds.parentNode.removeChild(birds); } catch (e) {}
    try { if (geo) geo.dispose(); } catch (e) {}
    try { if (mat) mat.dispose(); } catch (e) {}
    try { if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } } catch (e) {}
    renderer = scene = camera = geo = mat = mesh = canvas = birds = null;
  }

  async function activate(sc) {
    container = sc || document.getElementById("theme-scene");
    if (active || !container) return;
    if (!webglSupported()) return;             // -> SVG scene stays visible (fallback)
    active = true;
    try {
      await loadThree();
      if (!active) return;                     // deactivated mid-load
      injectStyle();
      initGL();
      document.addEventListener("visibilitychange", onVis);
      startLoop();
    } catch (e) {
      active = false;
      cleanup();                               // -> SVG scene stays visible (fallback)
    }
  }
  function deactivate() {
    if (!active && !renderer) { return; }
    active = false;
    cleanup();
    if (styleEl && styleEl.parentNode) { styleEl.parentNode.removeChild(styleEl); styleEl = null; }
  }

  App.webglSunset = { activate, deactivate, _supported: webglSupported };
})(typeof window !== "undefined" ? window : globalThis);
