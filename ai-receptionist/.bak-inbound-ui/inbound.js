// Inbound webhooks management page. Admins (PORTAL_ADMIN / SUPER_ADMIN) create
// endpoints, see the public URL + secret token, edit the field mapping, toggle
// on/off, regenerate the token, and view the recent inbound-call log.
(function () {
  const App = window.App;
  const { el, esc, toast } = App.util;

  function ensureStyles() {
    if (document.getElementById("inbound-styles")) return;
    const s = document.createElement("style");
    s.id = "inbound-styles";
    s.textContent = `
      .ib-card{border:1px solid var(--line);border-radius:var(--radius-sm);padding:16px;margin:0 0 14px;background:var(--panel)}
      .ib-head{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:10px}
      .ib-name{font-weight:600;font-size:15px;border:1px solid transparent;border-radius:6px;padding:4px 6px;background:transparent;color:inherit;min-width:200px}
      .ib-name:focus{border-color:var(--line);background:var(--gray-soft);outline:none}
      .ib-row{display:flex;align-items:center;gap:8px;margin:6px 0}
      .ib-label{font-size:12px;color:var(--muted);width:64px;flex:0 0 auto}
      .ib-mono{flex:1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;border:1px solid var(--line);border-radius:6px;padding:7px 9px;background:var(--gray-soft);color:inherit;overflow-x:auto;white-space:nowrap}
      .ib-map{margin:12px 0 0;border-top:1px solid var(--line);padding-top:10px}
      .ib-map-row{display:flex;align-items:center;gap:8px;margin:6px 0}
      .ib-in{border:1px solid var(--line);border-radius:6px;padding:7px 9px;background:var(--panel);color:inherit;font-size:13px}
      .ib-in.k{flex:1}
      .ib-arrow{color:var(--muted)}
      .ib-x{cursor:pointer;color:var(--muted);border:none;background:none;font-size:16px;padding:2px 6px}
      .ib-foot{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
      .ib-toggle{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
      .ib-calls{margin-top:10px;border-top:1px dashed var(--line);padding-top:8px;font-size:12px}
      .ib-call{display:flex;gap:8px;align-items:center;padding:3px 0;color:var(--muted)}
      .ib-pill{font-size:11px;padding:1px 7px;border-radius:999px;font-weight:600}
      .ib-pill.ok{background:color-mix(in srgb,var(--green) 18%,transparent);color:var(--green)}
      .ib-pill.no{background:color-mix(in srgb,var(--amber) 20%,transparent);color:var(--amber)}
    `;
    document.head.appendChild(s);
  }

  function copyBtn(getText) {
    const b = el("button", "btn btn-ghost btn-sm", "Copy");
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(getText()); b.textContent = "Copied!"; setTimeout(() => (b.textContent = "Copy"), 1200); }
      catch { toast("Couldn't copy — select and copy manually.", true); }
    };
    return b;
  }

  function mappingRow(host, incoming, target, fieldOptions) {
    const row = el("div", "ib-map-row");
    const k = el("input", "ib-in k"); k.placeholder = "incoming JSON field (e.g. utm_source)"; k.value = incoming || "";
    const arrow = el("span", "ib-arrow", "&rarr;");
    const sel = el("select", "ib-in");
    const blank = el("option"); blank.value = ""; blank.textContent = "— map to —"; sel.appendChild(blank);
    fieldOptions.forEach((f) => { const o = el("option"); o.value = f.key; o.textContent = f.label + (f.system ? "" : " (custom)"); if (f.key === target) o.selected = true; sel.appendChild(o); });
    const x = el("button", "ib-x", "&times;"); x.title = "Remove"; x.onclick = () => row.remove();
    row.appendChild(k); row.appendChild(arrow); row.appendChild(sel); row.appendChild(x);
    row._get = () => ({ incoming: k.value.trim(), target: sel.value });
    host.appendChild(row);
    return row;
  }

  function endpointCard(ep, fieldOptions, rerender) {
    const card = el("div", "ib-card");
    const fullUrl = `${location.origin}/hooks/in/${ep.token}`;

    // header: name + enabled toggle
    const head = el("div", "ib-head");
    const name = el("input", "ib-name"); name.value = ep.name || ""; name.title = "Endpoint name";
    const toggleWrap = el("label", "ib-toggle");
    const toggle = el("input"); toggle.type = "checkbox"; toggle.checked = !!ep.enabled;
    const toggleTxt = el("span", "", ep.enabled ? "Enabled" : "Disabled");
    toggle.onchange = () => { toggleTxt.textContent = toggle.checked ? "Enabled" : "Disabled"; };
    toggleWrap.appendChild(toggle); toggleWrap.appendChild(toggleTxt);
    head.appendChild(name); head.appendChild(toggleWrap);
    card.appendChild(head);

    // URL row
    const urlRow = el("div", "ib-row");
    urlRow.appendChild(el("span", "ib-label", "URL"));
    const urlBox = el("div", "ib-mono"); urlBox.textContent = fullUrl;
    urlRow.appendChild(urlBox); urlRow.appendChild(copyBtn(() => fullUrl));
    card.appendChild(urlRow);

    // secret/token row
    const secRow = el("div", "ib-row");
    secRow.appendChild(el("span", "ib-label", "Secret"));
    const secBox = el("div", "ib-mono"); secBox.textContent = ep.token;
    const regen = el("button", "btn btn-ghost btn-sm", "Regenerate");
    regen.onclick = async () => {
      if (!confirm("Regenerate the secret? The old URL stops working immediately and you'll need to update any system that posts here.")) return;
      try { const r = await App.portalApi(`/api/inbound/${ep.id}/regenerate`, { method: "POST" }); ep.token = r.token; rerender(); toast("New secret generated."); }
      catch (e) { toast(e.message, true); }
    };
    secRow.appendChild(secBox); secRow.appendChild(copyBtn(() => ep.token)); secRow.appendChild(regen);
    card.appendChild(secRow);

    // mapping editor
    const map = el("div", "ib-map");
    map.appendChild(el("div", "ib-label", "Field mapping"));
    const rowsHost = el("div");
    const entries = Object.entries(ep.mapping || {});
    if (entries.length === 0) mappingRow(rowsHost, "", "", fieldOptions);
    else entries.forEach(([inc, tgt]) => mappingRow(rowsHost, inc, tgt, fieldOptions));
    map.appendChild(rowsHost);
    const addRow = el("button", "btn btn-ghost btn-sm", "+ Add mapping");
    addRow.onclick = () => mappingRow(rowsHost, "", "", fieldOptions);
    map.appendChild(addRow);
    map.appendChild(el("p", "muted", "Map incoming JSON keys to CRM fields. Unmapped keys are ignored. To capture UTM tags, first create custom fields (e.g. utm_source) under Fields, then map them here."));
    card.appendChild(map);

    // footer: Save / View calls / Delete
    const foot = el("div", "ib-foot");
    const save = el("button", "btn btn-primary btn-sm", "Save");
    save.onclick = async () => {
      const mapping = {};
      Array.from(rowsHost.children).forEach((r) => { const v = r._get(); if (v.incoming && v.target) mapping[v.incoming] = v.target; });
      try {
        await App.portalApi(`/api/inbound/${ep.id}`, { method: "PATCH", body: JSON.stringify({ name: name.value.trim() || "Inbound endpoint", mapping, enabled: toggle.checked }) });
        ep.mapping = mapping; ep.name = name.value.trim(); ep.enabled = toggle.checked;
        toast("Saved.");
      } catch (e) { toast(e.message, true); }
    };
    const viewCalls = el("button", "btn btn-ghost btn-sm", "View recent calls");
    const callsBox = el("div", "ib-calls"); callsBox.style.display = "none";
    viewCalls.onclick = async () => {
      if (callsBox.style.display === "none") {
        callsBox.style.display = "block"; callsBox.innerHTML = "<div class='muted'>Loading…</div>";
        try {
          const calls = await App.portalApi(`/api/inbound/${ep.id}/calls`);
          callsBox.innerHTML = "";
          if (!calls.length) { callsBox.appendChild(el("div", "muted", "No calls yet.")); }
          calls.forEach((c) => {
            const row = el("div", "ib-call");
            const pill = el("span", "ib-pill " + (c.status === "accepted" ? "ok" : "no"), esc(c.status));
            const when = new Date(c.createdAt).toLocaleString();
            const txt = el("span", "", `${esc(when)} — ${esc(c.reason || "")}${c.sourceIp ? " — " + esc(c.sourceIp) : ""}`);
            row.appendChild(pill); row.appendChild(txt); callsBox.appendChild(row);
          });
        } catch (e) { callsBox.innerHTML = ""; callsBox.appendChild(el("div", "muted", esc(e.message))); }
      } else { callsBox.style.display = "none"; }
    };
    const del = el("button", "btn btn-ghost btn-sm", "Delete");
    del.style.marginLeft = "auto";
    del.onclick = async () => {
      if (!confirm("Delete this inbound endpoint? Its URL will stop working.")) return;
      try { await App.portalApi(`/api/inbound/${ep.id}`, { method: "DELETE" }); rerender(); toast("Endpoint deleted."); }
      catch (e) { toast(e.message, true); }
    };
    foot.appendChild(save); foot.appendChild(viewCalls); foot.appendChild(del);
    card.appendChild(foot);
    card.appendChild(callsBox);
    return card;
  }

  async function render(host) {
    ensureStyles();
    const me = App.state.me;
    if (me && me.role === "CLIENT_USER") {
      host.innerHTML = `<div class="card"><p class="muted">Inbound webhooks are managed by your administrator.</p></div>`;
      return;
    }
    host.innerHTML = `<div class="card"><div class="skeleton">Loading…</div></div>`;
    let endpoints, fields;
    try {
      [endpoints, fields] = await Promise.all([App.portalApi("/api/inbound"), App.portalApi("/api/fields")]);
    } catch (e) { host.innerHTML = ""; host.appendChild(el("div", "card", `<p class="muted">${esc(e.message)}</p>`)); return; }

    // Target options: system fields first, then custom. (createdAt is read-only.)
    const fieldOptions = (fields || []).filter((f) => f.key !== "createdAt").map((f) => ({ key: f.key, label: f.label, system: !!f.system }));

    const wrap = el("div", "fade-in");
    const bar = el("div", "page-actions");
    const add = el("button", "btn btn-primary btn-sm", "+ New inbound endpoint");
    add.onclick = async () => {
      try { await App.portalApi("/api/inbound", { method: "POST", body: JSON.stringify({ name: "New endpoint", mapping: {} }) }); render(host); }
      catch (e) { toast(e.message, true); }
    };
    bar.appendChild(add);
    wrap.appendChild(bar);
    wrap.appendChild(el("p", "muted", "A public URL that external systems (a website lead form, Zapier, etc.) POST JSON to, creating or updating a contact in this portal. The portal is fixed by the secret in the URL — a payload can never choose a different portal."));

    if (!endpoints.length) {
      wrap.appendChild(el("div", "card", `<p class="muted">No inbound endpoints yet. Create one to get a public URL you can post leads to.</p>`));
    } else {
      const rerender = () => render(host);
      endpoints.forEach((ep) => wrap.appendChild(endpointCard(ep, fieldOptions, rerender)));
    }

    host.innerHTML = "";
    host.appendChild(wrap);
  }

  App.inbound = { render };
})();
