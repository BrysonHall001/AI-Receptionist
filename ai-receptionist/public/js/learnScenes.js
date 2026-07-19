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
  // LC-3 fidelity: the shell scaffold mirrors app.js#buildShell's REAL split — record-type
  // MODULES in the left sidebar; fixed-purpose PAGES across the top portal-pages-row.
  function shell(modules, activeModule, pages, activePage, mainHtml) {
    const side = modules.map((n) => `<span class="nav-item${n === activeModule ? " active" : ""}">${n}</span>`).join("");
    const row = pages.map((n) => `<span class="nav-item${n === activePage ? " active" : ""}">${n}</span>`).join("");
    return `<div class="scene-app"><div class="scene-cols"><div class="scene-side"><span class="scene-dot"></span>${side}</div><div class="scene-maincol"><div class="scene-topbar"><span class="scene-topline"></span><span class="scene-presence"></span><span class="scene-presence scene-presence--b"></span></div><div class="scene-pagesrow">${row}</div><div class="scene-main">${mainHtml}</div></div></div></div>`;
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

  const MODULES = ["Contacts", "Jobs", "Bookings"];
  const PAGES = ["Home", "Calls", "Analytics"];
  const seg = (on) => { let h = '<span class="fun-seg scene-seg">'; for (let i = 0; i < 10; i++) h += `<span class="fun-seg-i${i < on ? " fun-seg-i--on" : ""}"></span>`; return h + "</span>"; };

  register("shell-tour", {
    sourceFn: "app.js#buildShell",
    regions: ["sidebar: brand + MODULE nav", "topbar: title + presence", "portal-pages-row: PAGE nav", "content"],
    frames: [
      { caption: "The LEFT navigation lists your modules — the kinds of records your business keeps.", html: shell(MODULES, "Contacts", PAGES, "Home", miniTable(["Name", "Status"], [["Avery Lane", pill("Open")]])).replace('<div class="scene-side">', '<div class="scene-side scene-focus">') },
      { caption: "The row across the TOP lists your pages — the fixed tools that work with that data.", html: shell(MODULES, "Contacts", PAGES, "Home", miniTable(["Name", "Status"], [["Avery Lane", pill("Open")]])).replace('<div class="scene-pagesrow">', '<div class="scene-pagesrow scene-focus">') },
      { caption: "The top bar shows presence dots for teammates online; the logo (top-left) always takes you Home.", html: shell(MODULES, "Contacts", PAGES, "Home", miniTable(["Name", "Status"], [["Avery Lane", pill("Open")]])).replace('<div class="scene-topbar">', '<div class="scene-topbar scene-focus">') },
    ],
  });

  const miniBars = () => '<div class="widget-card scene-widebar"><div class="scene-bars"><span class="scene-bar"></span><span class="scene-bar scene-bar--2"></span><span class="scene-bar scene-bar--3"></span><span class="scene-bar scene-bar--4"></span></div><div class="kpi-label">Calls by week</div></div>';
  register("home-dashboard", {
    sourceFn: "reports.js#createView",
    regions: ["reports-bar (left: dashboard context, right: + Add widget)", "widget-grid: side-by-side widget cards"],
    frames: [
      { caption: "The Home Dashboard is a bar of controls above a GRID of widget cards, side by side.", html: `<div class="scene-reports-bar"><span class="cell-muted">Home</span>${btn("+ Add widget", true, true)}</div><div class="widget-grid scene-widgetgrid">${kpi("128", "Contacts")}${miniBars()}${kpi("42", "Open jobs")}</div>` },
      { caption: "Press + Add widget to create a new tile; drag any card to reorder the grid.", html: `<div class="scene-reports-bar"><span class="cell-muted">Home</span>${focus(btn("+ Add widget", true, true))}</div><div class="widget-grid scene-widgetgrid">${kpi("128", "Contacts")}${miniBars()}${focus(kpi("42", "Open jobs"))}</div>` },
    ],
  });

  register("record-drawer", {
    sourceFn: "fields.js#renderGroupedEditor",
    regions: ["section heading", "its fields", "next section heading", "its fields"],
    frames: [
      { caption: "A record's panel groups its fields under SECTION headings — the fields-in-sections hierarchy, visible.", html: `<div class="card scene-drawer"><div class="eyebrow">Contact details</div>${fieldRow("Name", input("Avery Lane"))}${fieldRow("Phone", input("(555) 012-3456"))}<div class="eyebrow">Preferences</div>${fieldRow("Status", select("Open"))}${focus(fieldRow("Notes", input("Prefers mornings")))}</div>` },
    ],
  });

  register("views-switcher", {
    sourceFn: "portal.js#renderRecordList",
    regions: ["page-actions (Create/Import/Export)", "view seg-buttons", "the active view: table | kanban-cols | cal-head grid | gallery | map"],
    frames: [
      { caption: "List — the classic table under the page's action buttons.", html: pageTop("List") + miniTable(["Name", "Stage", "Created"], [["Avery Lane", pill("Open"), "Jul 2"], ["Sam Reyes", pill("Done", "success"), "Jul 9"], ["Kai Moss", pill("Hold", "skipped"), "Jul 12"]]) },
      { caption: "Kanban — cards in stage columns; drag a card to change its stage (a Jobs board).", html: pageTop("Kanban") + kanban([["Open", ["Fence repair", "Gutter clean"]], ["Done", ["Deck staining"]]]) },
      { caption: "Calendar — records with a date land on their day.", html: pageTop("Calendar") + `<div class="card scene-calwrap"><div class="cal-head scene-calhead"><span class="cal-dayhead">Mon</span><span class="cal-dayhead">Tue</span><span class="cal-dayhead">Wed</span><span class="cal-dayhead">Thu</span><span class="cal-dayhead">Fri</span></div><div class="scene-cal">${calCells(10, { 3: "Avery" })}</div></div>` },
      { caption: "Gallery — large cards, great for records with images.", html: pageTop("Gallery") + `<div class="scene-row"><div class="card scene-gal"><div class="scene-gal-img"></div>Avery Lane</div><div class="card scene-gal"><div class="scene-gal-img"></div>Sam Reyes</div></div>` },
      { caption: "Map — records with an address appear as pins (a Properties map).", html: pageTop("Map") + `<div class="scene-map"><span class="scene-pin"></span><span class="scene-pin scene-pin--b"></span></div>` },
    ],
  });

  register("kanban-drag", {
    sourceFn: "portal.js#renderBoard",
    regions: ["kanban-col (head + cards) per stage"],
    frames: [
      { caption: "Grab a card in its current stage column\u2026 (a Jobs board)", html: kanban([["Open", ["FOCUS:Fence repair", "Gutter clean"]], ["Done", ["Deck staining"]]]) },
      { caption: "\u2026and drop it in another — the record's stage updates instantly.", html: kanban([["Open", ["Gutter clean"]], ["Done", ["Deck staining", "FOCUS:Fence repair"]]]) },
    ],
  });

  const ruleRow = (f, o, v, foc) => { const r = `<div class="rule-editor scene-rulerow"><span class="rule-field scene-ctl">${f}</span><span class="rule-op scene-ctl">${o}</span><span class="rule-val scene-ctl">${v}</span></div>`; return foc ? focus(r) : r; };
  register("filter-rules", {
    sourceFn: "table.js#ruleEditor",
    regions: ["toolbar with active-filter chip", "rule rows (field | condition | value), stacked", "Add rule", "save"],
    frames: [
      { caption: "The filter rail builds rules as field \u2192 condition \u2192 value rows.", html: `<div class="scene-reports-bar"><span class="chip">1 filter active</span>${btn("Clear", false, true)}</div><div class="card scene-drawer">${ruleRow("Status", "is", "Open", true)}${btn("Add rule", false, true)}</div>` },
      { caption: "Stack as many conditions as you need — the list narrows live, and the set can be saved for reuse.", html: `<div class="scene-reports-bar"><span class="chip">2 filters active</span>${btn("Clear", false, true)}</div><div class="card scene-drawer">${ruleRow("Status", "is", "Open")}${ruleRow("Created", "is within", "This month")}${focus(btn("Save filter", true, true))}</div>` },
    ],
  });

  register("import-mapping", {
    sourceFn: "portal.js#renderMapping",
    regions: ["map-grid rows: FIELD label | CSV-column select", "rows-detected note", "Import N button (full width)"],
    frames: [
      { caption: "For each FIELD, pick which spreadsheet column fills it (or skip it) — then confirm.", html: `<div class="card scene-drawer"><div class="map-grid scene-mapgrid"><span class="field-label">Name</span>${focus(select("full_name"))}<span class="field-label">Phone</span>${select("phone_number")}<span class="field-label">Email</span>${select("email")}</div><span class="cell-muted">24 rows detected.</span>${btn("Import 24 contacts", true, false)}</div>` },
    ],
  });

  const wizModal = (inner) => `<div class="card scene-drawer scene-modal"><div class="scene-modalhead"><span class="scene-modaltitle">Add widget</span><span class="icon-btn scene-x">&times;</span></div>${inner}</div>`;
  register("widget-wizard", {
    sourceFn: "reports.js#openWidgetEditor",
    regions: ["modal-head (title + close)", "Title", "Data source", "Type", "Measure row (op + field)", "Group by", "Filters", "Preview", "Save (full width)"],
    frames: [
      { caption: "Add widget opens a modal: name it, then pick a data source — a module, or Calls.", html: wizModal(`${fieldRow("Title", input("Calls by week"))}${focus(fieldRow("Data source", select("Calls")))}${fieldRow("Type", select("Bar chart"))}`) },
      { caption: "Pick the type — KPI, bar, stacked, line, pie, heat map, or a list.", html: wizModal(`${fieldRow("Title", input("Calls by week"))}${fieldRow("Data source", select("Calls"))}${focus(fieldRow("Type", select("Bar chart")))}`) },
      { caption: "The Measure row: an operation plus its field. Sources with no numeric fields (like Calls) offer Count only.", html: wizModal(`${focus('<div class="scene-row">' + select("Count of calls") + "</div>")}${fieldRow("Group by", select("Time Created \u2192 by week"))}${fieldRow("Filters", select("+ Add rule"))}`) },
      { caption: "A live preview sits above the save button — press it and the widget lands on your dashboard.", html: wizModal(`<div class="widget-card scene-widebar"><div class="kpi"><div class="kpi-value">36</div><div class="kpi-label">Calls by week</div></div></div>${focus(btn("Add widget", true, false))}`) },
    ],
  });

  register("audience-builder", {
    sourceFn: "communication.js#renderEditor",
    regions: ["heading (New audience)", "Audience name field", "\"Who's in this audience\" rule rows", "match-count line", "save bar"],
    frames: [
      { caption: "An Audience is a named, saved filter over your contacts — the count updates live as you build it.", html: `<div class="card scene-drawer"><div class="eyebrow">New audience</div>${fieldRow("Audience name *", input("Leads this month"))}<span class="field-label">Who's in this audience</span>${ruleRow("Status", "is", "Lead")}${ruleRow("Created", "is within", "This month")}<span class="cell-muted">34 contacts match right now.</span>${focus(btn("Save audience", true, true))}</div>` },
    ],
  });

  register("automation-flow", {
    sourceFn: "automations.js#openEditor",
    regions: ["modal-head (New automation)", "Automation name", "trigger (When\u2026)", "actions", "flow preview strip"],
    frames: [
      { caption: "An automation is built in a modal: name it, pick the trigger, add actions — the preview shows the whole chain before you turn it on.", html: `<div class="card scene-drawer scene-modal"><div class="scene-modalhead"><span class="scene-modaltitle">New automation</span><span class="icon-btn scene-x">&times;</span></div>${fieldRow("Automation name", input("Welcome new contacts"))}${focus(fieldRow("When", select("A record is created")))}${fieldRow("Then", select("Send welcome email"))}<div class="scene-row">${'<div class="card scene-node"><div class="eyebrow">When</div>Record created</div>'}<span class="scene-arrow">&rarr;</span><div class="card scene-node"><div class="eyebrow">Then</div>Send welcome email</div></div></div>` },
    ],
  });

  register("calendar-mapping", {
    sourceFn: "portal.js#renderMappings",
    regions: ["connection status", "per-staff mapping rows (staff \u2192 calendar select)", "two-way sync toggle"],
    frames: [
      { caption: "Once Google Calendar is connected, map each calendar to a staff member — and optionally turn on two-way sync.", html: `<div class="card scene-drawer"><div class="scene-row">${pill("Google Calendar connected", "success")}</div>${fieldRow("Jordan", focus(select("jordan@work \u2014 Main calendar")))}${fieldRow("Riley", select("riley@work \u2014 Bookings"))}<div class="scene-row">${pill("Two-way calendar sync: on", "success")}</div></div>` },
    ],
  });

  register("fields-editor", {
    sourceFn: "portal.js#secFields",
    regions: ["mf-modules-row (module picker)", "mf-views-strip (view toggles)", "two columns: Field library | Fields"],
    frames: [
      { caption: "Pick a module along the top, then work in two columns: the field LIBRARY on the left, the module's FIELDS on the right.", html: `<div class="scene-row scene-viewstrip"><span class="seg-btn seg-on">Contacts</span><span class="seg-btn">Jobs</span><span class="seg-btn">Bookings</span></div><div class="scene-row"><div class="card scene-drawer"><div class="eyebrow">Field library</div>${pill("Text")}${pill("Number")}${pill("Date")}</div><div class="card scene-drawer"><div class="eyebrow">Fields</div>${pill("Name")}${pill("Phone")}${focus(pill("Status"))}${btn("Add field", false, true)}</div></div>` },
      { caption: "The views strip decides which of the five views this module offers (calendar needs a date field; map needs an address).", html: `<div class="scene-row scene-viewstrip"><span class="seg-btn seg-on">Contacts</span><span class="seg-btn">Jobs</span></div>${focus('<div class="scene-row">' + pill("List", "success") + pill("Kanban", "success") + pill("Calendar", "success") + pill("Gallery") + pill("Map") + "</div>")}<div class="scene-row"><div class="card scene-drawer"><div class="eyebrow">Field library</div>${pill("Text")}${pill("Date")}</div><div class="card scene-drawer"><div class="eyebrow">Fields</div>${pill("Name")}${pill("Appointment date")}</div></div>` },
    ],
  });

  register("appearance-sliders", {
    sourceFn: "theme.js#render",
    regions: ["intro line", "thc-group-row (group select)", "the carousel (centered card = applied)", "designer: labeled fun-seg slider rows"],
    frames: [
      { caption: "The carousel is the theme picker — the CENTERED card is your applied theme; the group select switches Basic and Fun.", html: `<div class="scene-row">${'<span class="eyebrow">Themes</span>'}${select("Basic")}</div><div class="scene-row scene-carouselrow"><div class="card scene-theme-mini"></div>${focus('<div class="card scene-theme-mini scene-theme-mini--big"></div>')}<div class="card scene-theme-mini"></div></div>` },
      { caption: "Below it, the personality sliders — corners, buttons, shadows, borders, table row height — fine-tune the applied theme.", html: `<div class="card scene-drawer">${fieldRow("Corners", seg(4))}${fieldRow("Buttons", seg(3))}${focus(fieldRow("Shadows", seg(7)))}${fieldRow("Table Row Height", seg(5))}</div>` },
    ],
  });

  // small per-scene builders used above
  function pageTop(activeView) {
    const segs = ["List", "Kanban", "Calendar", "Gallery", "Map"].map((v) => `<span class="seg-btn${v === activeView ? " seg-on" : ""}">${v}</span>`).join("");
    return `<div class="page-actions scene-pageactions">${btn("+ Create Job", true, true)}${btn("Import", false, true)}${btn("Export", false, true)}</div><div class="scene-row scene-viewstrip">${segs}</div>`;
  }
  function kanban(cols) {
    return `<div class="scene-board">${cols.map(([name, cards]) => `<div class="kanban-col scene-kancol"><div class="kanban-col-head">${name}</div><div class="kanban-cards">${cards.map((c) => c.indexOf("FOCUS:") === 0 ? focus(`<div class="kanban-card">${c.slice(6)}</div>`) : `<div class="kanban-card">${c}</div>`).join("")}</div></div>`).join("")}</div>`;
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
