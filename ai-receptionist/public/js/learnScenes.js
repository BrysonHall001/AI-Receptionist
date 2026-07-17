// Learning Center — scene registry (LC rebuild, part 2).
//
// A "scene" is a miniature, STATIC illustration of a real UI area, composed from the
// app's existing component classes (cards, tables, buttons, pills, nav slivers, the
// widget accent bar, form controls) — the theme-carousel mock generalized. Scenes
// render in the user's CURRENT theme (no scoped token sets), so a guide's picture
// always matches their portal.
//
// INERT BY CONSTRUCTION: scene markup carries no event handlers and makes no fetches;
// each frame is wrapped aria-hidden + pointer-events:none (see .scene-inert), so the
// interactive-LOOKING elements inside are invisible to assistive tech and untouchable.
//
// SHAPE: SCENES[id] = { frames: [{ caption, html }] }. One frame renders as a single
// figure; 2–5 frames render through the shared stepper (App.ui.stepper). The `focus()`
// helper draws the subtle accent ring where a guide references a specific control.
//
// VOICE RULE (absolute, inherited from LC-1): nothing in any scene or caption may
// reference the master hub, other workspaces, or platform administration.
(function (global) {
  const App = global.App || (global.App = {});

  // ---- shared builder helpers ----
  function focus(innerHtml) { return `<span class="scene-focus">${innerHtml}</span>`; }
  function shell(sideItems, activeIdx, mainHtml) {
    const side = sideItems.map((n, i) => `<span class="nav-item${i === activeIdx ? " active" : ""}">${n}</span>`).join("");
    return `<div class="scene-app"><div class="scene-topbar"><span class="scene-dot"></span><span class="scene-topline"></span></div><div class="scene-cols"><div class="scene-side">${side}</div><div class="scene-main">${mainHtml}</div></div></div>`;
  }
  function miniTable(headers, rows) {
    const th = headers.map((h) => `<th>${h}</th>`).join("");
    const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
    return `<div class="card scene-table"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
  }
  function pill(text, kind) { return `<span class="pill${kind ? " " + kind : ""}">${text}</span>`; }
  function kpi(value, label) { return `<div class="widget-card scene-kpi"><div class="kpi"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div></div>`; }
  function fieldRow(label, control) { return `<div class="scene-field"><label class="field-label">${label}</label>${control}</div>`; }
  function input(placeholderText) { return `<span class="input scene-ctl">${placeholderText}</span>`; }
  function select(text) { return `<span class="input scene-ctl scene-sel">${text}</span>`; }
  function btn(text, primary, small) { return `<span class="btn${primary ? " btn-primary" : " btn-ghost"}${small ? " btn-sm" : ""}">${text}</span>`; }

  // ---- the registry ----
  const SCENES = {};
  function register(id, def) { SCENES[id] = def; }

  // ============================ THE SCENES ============================
  // (ids match LC-1's VISUAL markers 1:1 — selfTest_learningCenter2 enforces it)

  const NAVS = ["Home", "Calls", "Contacts", "Jobs", "Analytics"];
  const seg = (on) => { let h = '<span class="fun-seg scene-seg">'; for (let i = 0; i < 10; i++) h += `<span class="fun-seg-i${i < on ? " fun-seg-i--on" : ""}"></span>`; return h + "</span>"; };

  register("shell-tour", { frames: [
    { caption: "The left navigation lists your main sections — the highlighted item is the page you're on.", html: shell(NAVS, 0, kpi("128", "Clients") + miniTable(["Name", "Status"], [["Avery Lane", pill("Done", "success")], ["Sam Reyes", pill("Open")]])).replace('<div class="scene-side">', '<div class="scene-side scene-focus">') },
    { caption: "The top bar carries the page's actions and your teammates' presence dots.", html: shell(NAVS, 0, miniTable(["Name", "Status"], [["Avery Lane", pill("Done", "success")], ["Sam Reyes", pill("Open")]])).replace('<div class="scene-topbar">', '<div class="scene-topbar scene-focus">') },
    { caption: "Click the logo (top-left) any time to jump back to your Home Dashboard.", html: shell(NAVS, 0, kpi("128", "Clients")).replace('<span class="scene-dot">', focus('<span class="scene-dot">') ) },
  ] });

  register("home-widgets", { frames: [
    { caption: "Your Home Dashboard is built from widgets — press Add widget to create a new tile.", html: shell(NAVS, 0, `<div class="scene-row">${kpi("128", "Clients")}${kpi("42", "Open jobs")}</div>` + focus(btn("Add widget", true, true))) },
    { caption: "Drag a widget's card to reorder the dashboard however you like.", html: shell(NAVS, 0, `<div class="scene-row">${focus(kpi("42", "Open jobs"))}${kpi("128", "Clients")}</div>`) },
  ] });

  register("record-drawer", { frames: [
    { caption: "Click any row to open the record's panel — every field is editable right there.", html: `<div class="scene-row">${miniTable(["Name", "Status"], [[focus("Avery Lane"), pill("Open")], ["Sam Reyes", pill("Done", "success")]])}<div class="card scene-drawer">${fieldRow("Name", input("Avery Lane"))}${fieldRow("Status", select("Open"))}${fieldRow("Notes", input("Prefers mornings"))}</div></div>` },
  ] });

  register("views-switcher", { frames: [
    { caption: "List — the classic table: sort, filter, and manage columns.", html: viewStrip("List") + miniTable(["Name", "Stage", "Created"], [["Avery Lane", pill("Open"), "Jul 2"], ["Sam Reyes", pill("Done", "success"), "Jul 9"], ["Kai Moss", pill("Hold", "skipped"), "Jul 12"]]) },
    { caption: "Kanban — cards grouped into stage columns; drag a card to change its stage.", html: viewStrip("Kanban") + `<div class="scene-board"><div class="scene-col"><div class="eyebrow">Open</div><div class="card">Avery Lane</div><div class="card">Kai Moss</div></div><div class="scene-col"><div class="eyebrow">Done</div><div class="card">Sam Reyes</div></div></div>` },
    { caption: "Calendar — records with a date land on their day.", html: viewStrip("Calendar") + `<div class="scene-cal">${calCells(10, { 4: "Avery" })}</div>` },
    { caption: "Gallery — large cards, great for records with images.", html: viewStrip("Gallery") + `<div class="scene-row"><div class="card scene-gal"><div class="scene-gal-img"></div>Avery Lane</div><div class="card scene-gal"><div class="scene-gal-img"></div>Sam Reyes</div></div>` },
    { caption: "Map — records with an address appear as pins.", html: viewStrip("Map") + `<div class="scene-map"><span class="scene-pin"></span><span class="scene-pin scene-pin--b"></span></div>` },
  ] });

  register("kanban-drag", { frames: [
    { caption: "Grab a card in its current stage column…", html: `<div class="scene-board"><div class="scene-col"><div class="eyebrow">Open</div>${focus('<div class="card">Avery Lane</div>')}<div class="card">Kai Moss</div></div><div class="scene-col"><div class="eyebrow">Done</div><div class="card">Sam Reyes</div></div></div>` },
    { caption: "…and drop it in another — the record's stage updates instantly.", html: `<div class="scene-board"><div class="scene-col"><div class="eyebrow">Open</div><div class="card">Kai Moss</div></div><div class="scene-col"><div class="eyebrow">Done</div><div class="card">Sam Reyes</div>${focus('<div class="card">Avery Lane</div>')}</div></div>` },
  ] });

  register("filter-rules", { frames: [
    { caption: "Open the filter rail and add your first rule.", html: `<div class="card scene-drawer">${fieldRow("Field", select("Status"))}${fieldRow("Condition", select("is"))}${fieldRow("Value", select("Open"))}${focus(btn("Add rule", false, true))}</div>` },
    { caption: "Stack as many conditions as you need — the list narrows live, and the whole set can be saved for reuse.", html: `<div class="card scene-drawer"><div class="scene-row">${pill("Status is Open")}${pill("Created this month")}</div>${focus(btn("Save filter", true, true))}</div>` },
  ] });

  register("import-mapping", { frames: [
    { caption: "Match each spreadsheet column to a field — the preview shows exactly what will be created before you confirm.", html: miniTable(["CSV column", "Becomes field"], [["full_name", focus(select("Name"))], ["phone_number", select("Phone")], ["stage", select("Status")]]) + btn("Import 24 rows", true, true) },
  ] });

  register("widget-wizard", { frames: [
    { caption: "Pick a data source — a module, or Calls.", html: `<div class="card scene-drawer">${fieldRow("Data source", focus(select("Contacts")))}</div>` },
    { caption: "Pick a widget type — KPI, bar, stacked, line, pie, heat map, or a list.", html: `<div class="card scene-drawer">${fieldRow("Type", focus(select("Bar chart")))}</div>` },
    { caption: "Choose the measure and group-by; sources with no numeric fields offer Count only.", html: `<div class="card scene-drawer">${fieldRow("Measure", select("Count of contacts"))}${fieldRow("Group by", focus(select("Status")))}</div>` },
    { caption: "Preview live, then save — the widget lands on your dashboard.", html: `<div class="scene-row">${kpi("36", "This month")}${focus(btn("Add widget", true, true))}</div>` },
  ] });

  register("audience-builder", { frames: [
    { caption: "An Audience is a named, saved filter — it resolves to its CURRENT matches every time you use it.", html: `<div class="card scene-drawer">${fieldRow("Audience name", input("Leads this month"))}<div class="scene-row">${pill("Status is Lead")}${pill("Created this month")}</div><div class="scene-row">${pill("34 matches right now", "success")}${focus(btn("Save audience", true, true))}</div></div>` },
  ] });

  register("automation-flow", { frames: [
    { caption: "A trigger starts the flow; actions run by themselves — preview the whole chain before turning it on.", html: `<div class="scene-row">${focus('<div class="card scene-node"><div class="eyebrow">Trigger</div>Record created</div>')}<span class="scene-arrow">&rarr;</span><div class="card scene-node"><div class="eyebrow">Action</div>Send welcome email</div><span class="scene-arrow">&rarr;</span><div class="card scene-node"><div class="eyebrow">Action</div>Update status</div></div>` },
  ] });

  register("calendar-mapping", { frames: [
    { caption: "Once Google Calendar is connected, map each calendar to a staff member so availability lines up per person.", html: `<div class="card scene-drawer"><div class="scene-row">${pill("Google Calendar connected", "success")}</div>${fieldRow("Jordan (stylist)", focus(select("jordan@work — Main calendar")))}${fieldRow("Riley (barber)", select("riley@work — Bookings"))}</div>` },
  ] });

  register("fields-editor", { frames: [
    { caption: "Each module's fields are listed here — drag to reorder, or add new ones from the field library.", html: `<div class="card scene-drawer"><div class="scene-row">${pill("Name")}${pill("Phone")}${focus(pill("Status"))}${pill("Appointment date")}</div>${btn("Add field", false, true)}</div>` },
    { caption: "The Views panel decides which of the five views the module offers (calendar needs a date field; map needs an address).", html: `<div class="card scene-drawer"><div class="scene-row">${pill("List", "success")}${pill("Kanban", "success")}${focus(pill("Calendar", "success"))}${pill("Gallery")}${pill("Map")}</div></div>` },
  ] });

  register("appearance-sliders", { frames: [
    { caption: "Browse the theme carousel — Basic and Fun collections — and click a card to apply it.", html: `<div class="scene-row"><div class="card scene-theme-mini"></div>${focus('<div class="card scene-theme-mini scene-theme-mini--big"></div>')}<div class="card scene-theme-mini"></div></div>` },
    { caption: "Fine-tune with the personality sliders — corners, buttons, shadows, borders, and table row height.", html: `<div class="card scene-drawer">${fieldRow("Corners", seg(4))}${fieldRow("Shadows", focus(seg(7)))}${fieldRow("Table Row Height", seg(5))}</div>` },
  ] });

  // small per-scene builders used above
  function viewStrip(active) {
    return `<div class="scene-row scene-viewstrip">${["List", "Kanban", "Calendar", "Gallery", "Map"].map((v) => btn(v, v === active, true)).join("")}</div>`;
  }
  function calCells(n, events) {
    let h = "";
    for (let i = 0; i < n; i++) h += `<span class="scene-cal-cell">${events[i] ? pill(events[i]) : ""}</span>`;
    return h;
  }

  App.learnScenes = {
    has: (id) => Object.prototype.hasOwnProperty.call(SCENES, id),
    get: (id) => SCENES[id] || null,
    ids: () => Object.keys(SCENES),
    helpers: { focus, shell, miniTable, pill, kpi, fieldRow, input, select, btn }, // exposed for part-2 scene builds + tests
    register,
  };
})(typeof window !== "undefined" ? window : globalThis);
