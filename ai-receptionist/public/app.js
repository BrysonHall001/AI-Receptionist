"use strict";

/* ---------- tiny helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${time}`;
}

function statusBadge(status) {
  const map = {
    COMPLETED: ["badge-completed", "Completed"],
    FAILED: ["badge-failed", "Missed"],
    COLLECTING_INFO: ["badge-progress", "In progress"],
    GREETING: ["badge-progress", "In progress"],
    INIT: ["badge-neutral", "New"],
  };
  const [cls, label] = map[status] || ["badge-neutral", status || "—"];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function toast(message, isError) {
  const t = el("div", "toast" + (isError ? " error" : ""));
  t.appendChild(el("span", "toast-dot"));
  t.appendChild(el("span", null, esc(message)));
  $("#toasts").appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .2s ease";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 200);
  }, 2800);
}

/* ---------- state ---------- */
const state = { route: "dashboard", highlightCallId: null };

/* ---------- views ---------- */
const view = $("#view");
const titles = {
  dashboard: ["Dashboard", "An overview of your call activity"],
  calls: ["Calls", "Every call your receptionist has handled"],
  contacts: ["Contacts", "People who have called in"],
};

function setActiveNav() {
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("active", n.dataset.route === state.route),
  );
  const [t, s] = titles[state.route] || titles.dashboard;
  $("#page-title").textContent = t;
  $("#page-sub").textContent = s;
}

function loading() {
  view.innerHTML = `<div class="card fade-in"><div class="skeleton">Loading…</div></div>`;
}

async function renderDashboard() {
  loading();
  const [stats, calls] = await Promise.all([api("/api/stats"), api("/api/calls")]);

  const wrap = el("div", "fade-in");
  const cards = [
    ["Total calls", stats.totalCalls],
    ["Completed", stats.completed],
    ["Leads captured", stats.leads],
    ["Today", stats.today],
  ];
  const statsEl = el("div", "stats stagger");
  cards.forEach(([label, val]) => {
    const c = el("div", "stat-card");
    c.appendChild(el("div", "stat-label", esc(label)));
    c.appendChild(el("div", "stat-value", String(val)));
    statsEl.appendChild(c);
  });
  wrap.appendChild(statsEl);

  const head = el("div", "section-head");
  head.appendChild(el("h2", null, "Recent calls"));
  head.appendChild(el("span", "muted", `${calls.length} total`));
  wrap.appendChild(head);

  wrap.appendChild(calls.length ? callsTable(calls.slice(0, 8)) : emptyState());
  view.innerHTML = "";
  view.appendChild(wrap);
}

async function renderCalls() {
  loading();
  const calls = await api("/api/calls");
  const wrap = el("div", "fade-in");
  wrap.appendChild(calls.length ? callsTable(calls) : emptyState());
  view.innerHTML = "";
  view.appendChild(wrap);
}

async function renderContacts() {
  loading();
  const contacts = await api("/api/contacts");
  const wrap = el("div", "fade-in");

  if (!contacts.length) {
    wrap.appendChild(emptyState());
  } else {
    const card = el("div", "card");
    const table = el("table");
    table.innerHTML = `<thead><tr>
      <th>Name</th><th>Phone</th><th>Email</th><th>Last reason</th><th>Calls</th><th>Added</th>
    </tr></thead>`;
    const tb = el("tbody");
    contacts.forEach((c) => {
      const tr = el("tr");
      tr.innerHTML = `
        <td class="cell-strong">${esc(c.name || "Unknown")}</td>
        <td class="cell-mono">${esc(c.phone)}</td>
        <td class="cell-muted">${esc(c.email || "—")}</td>
        <td class="cell-muted cell-truncate">${esc(c.intent || "—")}</td>
        <td>${c.callCount}</td>
        <td class="cell-muted">${fmtDate(c.createdAt)}</td>`;
      tr.addEventListener("click", () => openContact(c.id));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    card.appendChild(table);
    wrap.appendChild(card);
  }
  view.innerHTML = "";
  view.appendChild(wrap);
}

function callsTable(calls) {
  const card = el("div", "card");
  const table = el("table");
  table.innerHTML = `<thead><tr>
    <th>Caller</th><th>Phone</th><th>Reason</th><th>Status</th><th>When</th>
  </tr></thead>`;
  const tb = el("tbody");
  calls.forEach((c) => {
    const tr = el("tr");
    if (c.id === state.highlightCallId) tr.classList.add("row-new");
    tr.innerHTML = `
      <td class="cell-strong">${esc(c.name || "Unknown caller")}</td>
      <td class="cell-mono">${esc(c.phone || c.fromNumber)}</td>
      <td class="cell-muted cell-truncate">${esc(c.intent || "—")}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="cell-muted">${fmtDate(c.createdAt)}</td>`;
    tr.addEventListener("click", () => openCall(c.id));
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  card.appendChild(table);
  return card;
}

function emptyState() {
  const e = el("div", "card");
  e.innerHTML = `<div class="empty">
    <div class="empty-emoji">&#128222;</div>
    <h3>No calls yet</h3>
    <p>Run a simulated call to see how leads flow into your dashboard.</p>
    <button class="btn btn-primary" id="empty-sim"><span class="btn-icon">&#9654;</span> Simulate call</button>
  </div>`;
  e.querySelector("#empty-sim").addEventListener("click", simulate);
  return e;
}

/* ---------- drawer ---------- */
function showDrawer() {
  $("#overlay").classList.remove("hidden");
  $("#drawer").classList.remove("hidden");
  requestAnimationFrame(() => {
    $("#overlay").classList.add("show");
    $("#drawer").classList.add("show");
  });
}
function hideDrawer() {
  $("#overlay").classList.remove("show");
  $("#drawer").classList.remove("show");
  setTimeout(() => {
    $("#overlay").classList.add("hidden");
    $("#drawer").classList.add("hidden");
  }, 220);
}

function field(label, value, mono) {
  return `<div class="field">
    <span class="field-label">${esc(label)}</span>
    <span class="field-value ${mono ? "mono" : ""}">${esc(value || "—")}</span>
  </div>`;
}

async function openCall(id) {
  $("#drawer-eyebrow").textContent = "Call detail";
  $("#drawer-title").textContent = "Loading…";
  $("#drawer-body").innerHTML = `<div class="skeleton">Loading…</div>`;
  showDrawer();
  try {
    const c = await api(`/api/calls/${id}`);
    $("#drawer-title").textContent = c.name || "Unknown caller";
    const grid = `<div class="field-grid">
      ${field("Phone", c.phone || c.fromNumber, true)}
      ${field("Status", { COMPLETED: "Completed", FAILED: "Missed" }[c.status] || "In progress")}
      ${field("Email", c.email)}
      ${field("Turns", String(c.turnCount))}
      <div class="field field-full"><span class="field-label">Reason for calling</span>
        <span class="field-value">${esc(c.intent || "—")}</span></div>
      ${field("Received", fmtDate(c.createdAt))}
      ${field("Notified", c.emailSentAt ? fmtDate(c.emailSentAt) : "—")}
    </div>`;

    const turns = Array.isArray(c.transcript) ? c.transcript : [];
    let transcriptHtml = `<div class="drawer-section-title">Transcript</div>`;
    if (!turns.length) {
      transcriptHtml += `<p class="cell-muted">No transcript recorded.</p>`;
    } else {
      transcriptHtml += `<div class="transcript">`;
      turns.forEach((t) => {
        const who = t.role === "caller" ? "Caller" : t.role === "assistant" ? "Receptionist" : "System";
        transcriptHtml += `<div class="bubble-row ${esc(t.role)}">
          <div class="bubble"><div class="bubble-who">${esc(who)}</div>${esc(t.text)}</div>
        </div>`;
      });
      transcriptHtml += `</div>`;
    }
    $("#drawer-body").innerHTML = grid + transcriptHtml;
  } catch (err) {
    $("#drawer-body").innerHTML = `<p class="cell-muted">${esc(err.message)}</p>`;
  }
}

async function openContact(id) {
  $("#drawer-eyebrow").textContent = "Contact";
  $("#drawer-title").textContent = "Loading…";
  $("#drawer-body").innerHTML = `<div class="skeleton">Loading…</div>`;
  showDrawer();
  try {
    const c = await api(`/api/contacts/${id}`);
    $("#drawer-title").textContent = c.name || "Unknown";
    const grid = `<div class="field-grid">
      ${field("Phone", c.phone, true)}
      ${field("Email", c.email)}
      <div class="field field-full"><span class="field-label">Most recent reason</span>
        <span class="field-value">${esc(c.intent || "—")}</span></div>
      ${field("First seen", fmtDate(c.createdAt))}
      ${field("Last activity", fmtDate(c.updatedAt))}
    </div>`;

    let history = `<div class="drawer-section-title">Call history (${c.calls.length})</div>`;
    if (!c.calls.length) {
      history += `<p class="cell-muted">No calls.</p>`;
    } else {
      c.calls.forEach((call) => {
        history += `<div class="mini-call" data-call="${esc(call.id)}">
          <div>
            <div class="mini-reason">${esc(call.intent || "—")}</div>
            <div class="mini-date">${fmtDate(call.createdAt)}</div>
          </div>
          ${statusBadge(call.status)}
        </div>`;
      });
    }
    $("#drawer-body").innerHTML = grid + history;
    $("#drawer-body").querySelectorAll(".mini-call").forEach((row) => {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => openCall(row.dataset.call));
    });
  } catch (err) {
    $("#drawer-body").innerHTML = `<p class="cell-muted">${esc(err.message)}</p>`;
  }
}

/* ---------- simulate ---------- */
async function simulate() {
  const btn = $("#simulate-btn");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="btn-icon">&#8987;</span> Simulating…`;
  try {
    const result = await api("/api/simulate", { method: "POST" });
    state.highlightCallId = result.id;
    toast("Call simulated — lead captured");
    if (state.route === "contacts") await renderContacts();
    else if (state.route === "calls") await renderCalls();
    else await renderDashboard();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ---------- router ---------- */
async function route() {
  const hash = (location.hash || "#/dashboard").replace("#/", "");
  state.route = ["dashboard", "calls", "contacts"].includes(hash) ? hash : "dashboard";
  setActiveNav();
  try {
    if (state.route === "calls") await renderCalls();
    else if (state.route === "contacts") await renderContacts();
    else await renderDashboard();
  } catch (err) {
    view.innerHTML = `<div class="card"><div class="empty"><h3>Couldn't load data</h3><p>${esc(err.message)}</p></div></div>`;
  }
  state.highlightCallId = null;
}

async function loadMode() {
  try {
    const mode = await api("/api/mode");
    if (mode.mockAI || mode.mockEmail) {
      const badge = $("#mode-badge");
      badge.textContent = "Demo mode (mock keys)";
      badge.classList.remove("hidden");
    }
  } catch (_) {}
}

/* ---------- wire up ---------- */
$("#simulate-btn").addEventListener("click", simulate);
$("#refresh-btn").addEventListener("click", route);
$("#drawer-close").addEventListener("click", hideDrawer);
$("#overlay").addEventListener("click", hideDrawer);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideDrawer(); });
window.addEventListener("hashchange", route);

loadMode();
route();
