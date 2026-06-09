// Lead Capture Links (admin-facing settings UI). Lets admins create a secure
// link to hand to a website form / Zapier / another tool so new leads land in
// this portal, match incoming info to fields, pause/resume, reset the key, and
// see recent activity. PRESENTATION ONLY — it calls the same /api/inbound
// endpoints as before; none of the receiving/security/data logic lives here.
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
      .ib-label{font-size:12px;color:var(--muted);width:90px;flex:0 0 auto}
      .ib-mono{flex:1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;border:1px solid var(--line);border-radius:6px;padding:7px 9px;background:var(--gray-soft);color:inherit;overflow-x:auto;white-space:nowrap}
      .ib-hint{font-size:12px;color:var(--muted);margin:2px 0 8px 98px}
      .ib-map{margin:12px 0 0;border-top:1px solid var(--line);padding-top:10px}
      .ib-map-h{font-size:13px;font-weight:600;margin-bottom:2px}
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
      .ib-adv{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}
      .ib-adv summary{cursor:pointer;font-size:12px;color:var(--muted)}
      .ib-adv .ib-adv-body{font-size:12px;color:var(--muted);margin-top:8px}
      .ib-adv pre{background:var(--gray-soft);border-radius:var(--radius-sm);padding:8px;overflow:auto;font-size:11px;margin:6px 0}
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
    const k = el("input", "ib-in k"); k.placeholder = "their info's name (e.g. email, utm_source)"; k.value = incoming || "";
    const arrow = el("span", "ib-arrow", "&rarr;");
    const sel = el("select", "ib-in");
    const blank = el("option"); blank.value = ""; blank.textContent = "— choose one of your fields —"; sel.appendChild(blank);
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

    // header: name + on/off
    const head = el("div", "ib-head");
    const name = el("input", "ib-name"); name.value = ep.name || ""; name.title = "Name this link"; name.placeholder = "e.g. Website contact form";
    const toggleWrap = el("label", "ib-toggle");
    const toggle = el("input"); toggle.type = "checkbox"; toggle.checked = !!ep.enabled;
    const toggleTxt = el("span", "", ep.enabled ? "Accepting leads" : "Paused");
    toggle.onchange = () => { toggleTxt.textContent = toggle.checked ? "Accepting leads" : "Paused"; };
    toggleWrap.appendChild(toggle); toggleWrap.appendChild(toggleTxt);
    head.appendChild(name); head.appendChild(toggleWrap);
    card.appendChild(head);

    // shareable link
    const urlRow = el("div", "ib-row");
    urlRow.appendChild(el("span", "ib-label", "Link to share"));
    const urlBox = el("div", "ib-mono"); urlBox.textContent = fullUrl;
    urlRow.appendChild(urlBox); urlRow.appendChild(copyBtn(() => fullUrl));
    card.appendChild(urlRow);

    // secret key
    const secRow = el("div", "ib-row");
    secRow.appendChild(el("span", "ib-label", "Secret key"));
    const secBox = el("div", "ib-mono"); secBox.textContent = ep.token;
    const regen = el("button", "btn btn-ghost btn-sm", "Reset key");
    regen.onclick = async () => {
      if (!(await App.ui.confirmModal({ title: "Reset secret key", message: "Reset the secret key? The current link stops working right away, and you'll need to give the new link to any tool that uses it.", confirmText: "Reset key" }))) return;
      try { const r = await App.portalApi(`/api/inbound/${ep.id}/regenerate`, { method: "POST" }); ep.token = r.token; rerender(); toast("New key generated."); }
      catch (e) { toast(e.message, true); }
    };
    secRow.appendChild(secBox); secRow.appendChild(copyBtn(() => ep.token)); secRow.appendChild(regen);
    card.appendChild(secRow);
    card.appendChild(el("div", "ib-hint", "Keep this private. Anyone with this link can add leads to this portal, so don't post it publicly."));

    // field matching
    const map = el("div", "ib-map");
    map.appendChild(el("div", "ib-map-h", "Match incoming info to your fields"));
    map.appendChild(el("p", "muted", "When a lead comes in, which piece of their info goes into which field?"));
    const rowsHost = el("div");
    const entries = Object.entries(ep.mapping || {});
    if (entries.length === 0) mappingRow(rowsHost, "", "", fieldOptions);
    else entries.forEach(([inc, tgt]) => mappingRow(rowsHost, inc, tgt, fieldOptions));
    map.appendChild(rowsHost);
    const addRow = el("button", "btn btn-ghost btn-sm", "+ Add another match");
    addRow.onclick = () => mappingRow(rowsHost, "", "", fieldOptions);
    map.appendChild(addRow);
    map.appendChild(el("p", "muted", "Anything you don't match here is simply ignored. To capture campaign tags like utm_source, first add matching custom fields under Fields, then match them here."));
    card.appendChild(map);

    // footer: Save / Recent activity / Delete
    const foot = el("div", "ib-foot");
    const save = el("button", "btn btn-primary btn-sm", "Save");
    save.onclick = async () => {
      const mapping = {};
      Array.from(rowsHost.children).forEach((r) => { const v = r._get(); if (v.incoming && v.target) mapping[v.incoming] = v.target; });
      try {
        await App.portalApi(`/api/inbound/${ep.id}`, { method: "PATCH", body: JSON.stringify({ name: name.value.trim() || "Lead capture link", mapping, enabled: toggle.checked }) });
        ep.mapping = mapping; ep.name = name.value.trim(); ep.enabled = toggle.checked;
        toast("Saved.");
      } catch (e) { toast(e.message, true); }
    };
    const viewCalls = el("button", "btn btn-ghost btn-sm", "Recent activity");
    const callsBox = el("div", "ib-calls"); callsBox.style.display = "none";
    viewCalls.onclick = async () => {
      if (callsBox.style.display === "none") {
        callsBox.style.display = "block"; callsBox.innerHTML = "<div class='muted'>Loading…</div>";
        try {
          const calls = await App.portalApi(`/api/inbound/${ep.id}/calls`);
          callsBox.innerHTML = "";
          if (!calls.length) { callsBox.appendChild(el("div", "muted", "No leads received yet.")); }
          calls.forEach((c) => {
            const row = el("div", "ib-call");
            const saved = c.status === "accepted";
            const pill = el("span", "ib-pill " + (saved ? "ok" : "no"), saved ? "Saved" : "Skipped");
            const when = new Date(c.createdAt).toLocaleString();
            const txt = el("span", "", `${esc(when)} — ${esc(c.reason || "")}${c.sourceIp ? " — " + esc(c.sourceIp) : ""}`);
            row.appendChild(pill); row.appendChild(txt); callsBox.appendChild(row);
          });
        } catch (e) { callsBox.innerHTML = ""; callsBox.appendChild(el("div", "muted", esc(e.message))); }
      } else { callsBox.style.display = "none"; }
    };
    const del = el("button", "btn btn-ghost btn-sm", "Delete link");
    del.style.marginLeft = "auto";
    del.onclick = async () => {
      if (!(await App.ui.confirmModal({ title: "Delete link", message: "Delete this lead capture link? It will stop working immediately.", confirmText: "Delete link" }))) return;
      try { await App.portalApi(`/api/inbound/${ep.id}`, { method: "DELETE" }); rerender(); toast("Link deleted."); }
      catch (e) { toast(e.message, true); }
    };
    foot.appendChild(save); foot.appendChild(viewCalls); foot.appendChild(del);
    card.appendChild(foot);
    card.appendChild(callsBox);

    // For developers (collapsed): the technical mechanics, tucked away.
    const adv = el("details", "ib-adv");
    const sum = el("summary", "", "For developers"); adv.appendChild(sum);
    const body = el("div", "ib-adv-body");
    body.innerHTML = `Send an HTTPS <code>POST</code> with a JSON body to the link above. Use the left-hand names from your matches as the JSON keys. A successful call returns <code>{ "ok": true }</code>; a missing/disabled link returns an error and is ignored. Example:`;
    const pre = el("pre");
    pre.textContent = `curl -X POST "${fullUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"email":"jane@example.com","name":"Jane Doe","utm_source":"google"}'`;
    body.appendChild(pre);
    adv.appendChild(body);
    card.appendChild(adv);

    return card;
  }

  async function render(host) {
    ensureStyles();
    const me = App.state.me;
    if (me && me.role === "CLIENT_USER") {
      host.innerHTML = `<p class="muted">Lead capture links are managed by your administrator.</p>`;
      return;
    }
    host.innerHTML = `<div class="skeleton">Loading…</div>`;
    let endpoints, fields;
    try {
      [endpoints, fields] = await Promise.all([App.portalApi("/api/inbound"), App.portalApi("/api/fields")]);
    } catch (e) { host.innerHTML = ""; host.appendChild(el("p", "muted", esc(e.message))); return; }

    const fieldOptions = (fields || []).filter((f) => f.key !== "createdAt").map((f) => ({ key: f.key, label: f.label, system: !!f.system }));

    const wrap = el("div");
    const add = el("button", "btn btn-primary btn-sm", "+ New lead capture link");
    add.style.marginBottom = "12px";
    add.onclick = async () => {
      try { await App.portalApi("/api/inbound", { method: "POST", body: JSON.stringify({ name: "New lead capture link", mapping: {} }) }); render(host); }
      catch (e) { toast(e.message, true); }
    };
    wrap.appendChild(add);

    if (!endpoints.length) {
      wrap.appendChild(el("p", "muted", "No links yet. Create one to get a secure link you can give to a website form or another tool."));
    } else {
      const rerender = () => render(host);
      endpoints.forEach((ep) => wrap.appendChild(endpointCard(ep, fieldOptions, rerender)));
    }

    host.innerHTML = "";
    host.appendChild(wrap);
  }

  App.inbound = { render };
})();
