(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, toast } = App.util;

  const FONT_WHITELIST = ["arial", "georgia", "times-new-roman", "courier-new", "verdana", "tahoma", "trebuchet-ms"];
  const FONT_LABELS = { arial: "Arial", georgia: "Georgia", "times-new-roman": "Times New Roman", "courier-new": "Courier New", verdana: "Verdana", tahoma: "Tahoma", "trebuchet-ms": "Trebuchet MS" };
  const FONT_CSS = { arial: "Arial, sans-serif", georgia: "Georgia, serif", "times-new-roman": "'Times New Roman', serif", "courier-new": "'Courier New', monospace", verdana: "Verdana, sans-serif", tahoma: "Tahoma, sans-serif", "trebuchet-ms": "'Trebuchet MS', sans-serif" };

  // The SAME preset palette the app uses for charts/themes (mirrors reports.js PALETTE),
  // plus neutrals for button text/fill/border. Reused — not a new picker.
  const PRESET_COLORS = ["#5b5bd6", "#3aa675", "#e0a23b", "#c2453f", "#3b82c4", "#8a4fc4", "#d2689a", "#4cae9e", "#9a8a3b", "#6b7280", "#1a1a1e", "#ffffff", "#f5f7fa", "#e3e8ef"];

  // Survey merge token — replaced PER recipient at survey-blast send time. Mirrors
  // src/services/surveyBlastService.SURVEY_LINK_TOKEN.
  const SURVEY_LINK_TOKEN = "{{survey_link}}";

  // Every place this shared composer is mounted (propagation inventory).
  const MOUNT_SITES = [
    "Communication \u2192 Email \u2192 Compose (kind:email)",
    "Communication \u2192 Templates editor (kind:richtext)",
    "Communication \u2192 Surveys \u2192 Send survey (kind:email)",
    "Automations \u2192 Send email action (kind:email)",
    "Contacts \u2192 single-contact email (kind:email)",
    "Contacts \u2192 bulk text / single text (kind:sms, plain)",
    "Settings \u2192 Signature editor (kind:richtext)",
  ];

  // ---------- pure, testable helpers ----------
  function safeParse(s) { try { return JSON.parse(s || "{}") || {}; } catch (e) { return {}; } }

  // Inline style string for a CTA button (email-client-safe inline styles, not a class).
  function buttonStyle(cfg) {
    const radius = Math.max(0, Math.min(40, Number(cfg.radius != null ? cfg.radius : 6)));
    const font = FONT_CSS[cfg.font] || FONT_CSS.arial;
    return [
      "display:inline-block",
      "background:" + (cfg.fill || "#5b5bd6"),
      "color:" + (cfg.color || "#ffffff"),
      "border:1px solid " + (cfg.border || cfg.fill || "#5b5bd6"),
      "border-radius:" + radius + "px",
      "padding:10px 18px",
      "font-family:" + font,
      "font-weight:600",
      "font-size:14px",
      "text-decoration:none",
      "line-height:1.2",
    ].join(";");
  }
  // Full inline-styled anchor markup for the button (round-trips into the email HTML).
  function buildButtonHtml(cfg) {
    cfg = cfg || {};
    return '<a href="' + esc(cfg.url || "#") + '" target="_blank" rel="noopener noreferrer" class="cta-btn" data-cta="' +
      esc(JSON.stringify(cfg)) + '" style="' + buttonStyle(cfg) + '">' + esc(cfg.text || "Button") + "</a>";
  }
  // What a chosen survey contributes as a link value: the per-recipient MERGE TOKEN in a
  // personalizing context, else the survey's generic public link.
  function surveyLinkValue(survey, mode, origin) {
    if (mode === "token") return SURVEY_LINK_TOKEN;
    const base = (origin || (typeof location !== "undefined" ? location.origin : "")) + "/survey.html?s=";
    return base + encodeURIComponent(survey && survey.publicId ? survey.publicId : "");
  }

  let quillReady = false;
  function ensureQuillSetup() {
    if (quillReady || typeof Quill === "undefined") return;
    const Font = Quill.import("formats/font");
    Font.whitelist = FONT_WHITELIST;
    Quill.register(Font, true);
    const Link = Quill.import("formats/link");
    class SmartLink extends Link {
      static sanitize(url) {
        let u = (url || "").trim();
        if (u === SURVEY_LINK_TOKEN) return u; // keep the merge token verbatim
        if (u && !/^(https?:|mailto:|tel:|#|\/|\{\{)/i.test(u)) u = "https://" + u;
        return super.sanitize(u);
      }
    }
    Quill.register(SmartLink, true);

    // CTA button: a self-contained, inline-styled clickable link that survives sending.
    const Embed = Quill.import("blots/embed");
    class CtaButton extends Embed {
      static create(value) {
        const node = super.create();
        const data = typeof value === "string" ? safeParse(value) : (value || {});
        node.setAttribute("href", data.url || "#");
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
        node.setAttribute("data-cta", JSON.stringify(data));
        node.setAttribute("style", buttonStyle(data));
        node.textContent = data.text || "Button";
        return node;
      }
      static value(node) { return safeParse(node.getAttribute("data-cta")); }
    }
    CtaButton.blotName = "ctaButton";
    CtaButton.tagName = "A";
    CtaButton.className = "cta-btn";
    Quill.register(CtaButton, true);

    quillReady = true;
  }

  function customToolbar() {
    const tb = el("div", "email-toolbar wrap");
    tb.innerHTML =
      '<span class="ql-formats">' +
      '<select class="ql-font">' + FONT_WHITELIST.map((f) => '<option value="' + f + '"' + (f === "arial" ? " selected" : "") + "></option>").join("") + "</select>" +
      '<select class="ql-size"><option value="small"></option><option selected></option><option value="large"></option><option value="huge"></option></select>' +
      "</span>" +
      '<span class="ql-formats"><button class="ql-bold"></button><button class="ql-italic"></button><button class="ql-underline"></button></span>' +
      '<span class="ql-formats"><select class="ql-color"></select></span>' +
      '<span class="ql-formats"><select class="ql-align"></select></span>' +
      '<span class="ql-formats"><button class="ql-list" value="ordered"></button><button class="ql-list" value="bullet"></button></span>' +
      '<span class="ql-formats"><button class="ql-link"></button></span>';
    return tb;
  }

  // ---------- link / survey source picker (shared by hyperlink + CTA url) ----------
  // Opens a small modal: type a URL OR pick a survey. Calls back with the chosen value.
  function openLinkPicker(current, surveyLinkMode, onPick) {
    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal"); modal.style.maxWidth = "440px";
    modal.innerHTML = '<div class="modal-head"><h2>Link</h2><button class="icon-btn" id="lp-close">&times;</button></div>';
    const body = el("div", "modal-body");
    body.appendChild(el("label", "field-label", "URL"));
    const urlInput = el("input", "input"); urlInput.type = "text"; urlInput.placeholder = "https://… or pick a survey"; urlInput.value = current && current !== SURVEY_LINK_TOKEN ? current : "";
    if (current === SURVEY_LINK_TOKEN) urlInput.value = SURVEY_LINK_TOKEN;
    body.appendChild(urlInput);
    const pickRow = el("div"); pickRow.style.cssText = "margin-top:10px";
    const pickBtn = el("button", "btn btn-ghost btn-sm", "Pick a survey \u25BE");
    pickRow.appendChild(pickBtn); body.appendChild(pickRow);
    const surveyList = el("div"); surveyList.style.cssText = "margin-top:8px;max-height:180px;overflow:auto;display:none;border:1px solid var(--line-strong);border-radius:6px"; body.appendChild(surveyList);
    const note = el("div", "cell-muted"); note.style.cssText = "font-size:12px;margin-top:8px";
    note.textContent = surveyLinkMode === "token"
      ? "Picking a survey inserts a personal link token so each recipient gets their own."
      : "Picking a survey inserts its shareable link.";
    body.appendChild(note);

    pickBtn.onclick = async () => {
      if (surveyList.style.display === "none") {
        surveyList.style.display = "block"; surveyList.innerHTML = '<div class="cell-muted" style="padding:8px">Loading…</div>';
        try {
          const surveys = await App.portalApi("/api/surveys");
          surveyList.innerHTML = "";
          if (!surveys.length) { surveyList.appendChild(el("div", "cell-muted", "No surveys yet.")).style.padding = "8px"; return; }
          surveys.forEach((s) => {
            const row = el("button", "saved-item"); row.style.cssText = "display:block;width:100%;text-align:left;padding:8px 10px;background:none;border:0;cursor:pointer";
            row.innerHTML = '<span class="cell-strong">' + esc(s.name) + '</span> <span class="cell-muted" style="font-size:11px">' + esc(s.status) + "</span>";
            row.onclick = () => { urlInput.value = surveyLinkValue(s, surveyLinkMode); surveyList.style.display = "none"; };
            surveyList.appendChild(row);
          });
        } catch (e) { surveyList.innerHTML = '<div class="cell-muted" style="padding:8px">' + esc(e.message) + "</div>"; }
      } else { surveyList.style.display = "none"; }
    };

    const foot = el("div", "modal-foot");
    const remove = el("button", "btn btn-ghost btn-sm", "Remove link");
    const apply = el("button", "btn btn-primary btn-sm", "Apply");
    foot.appendChild(remove); foot.appendChild(apply);
    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal); document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    modal.querySelector("#lp-close").onclick = close;
    remove.onclick = () => { onPick(null); close(); };
    apply.onclick = () => { onPick(urlInput.value.trim()); close(); };
  }

  // ---------- CTA button builder ----------
  function openButtonBuilder(existing, surveyLinkMode, onSave, onRemove) {
    const cfg = Object.assign({ text: "Click here", url: "", fill: "#5b5bd6", color: "#ffffff", border: "#5b5bd6", radius: 6, font: "arial" }, existing || {});
    const overlay = el("div", "modal-overlay");
    const modal = el("div", "modal"); modal.style.maxWidth = "460px";
    modal.innerHTML = '<div class="modal-head"><h2>' + (existing ? "Edit button" : "Insert button") + '</h2><button class="icon-btn" id="bb-close">&times;</button></div>';
    const body = el("div", "modal-body");

    body.appendChild(el("label", "field-label", "Button text"));
    const textIn = el("input", "input"); textIn.type = "text"; textIn.value = cfg.text; textIn.oninput = () => { cfg.text = textIn.value; paint(); };
    body.appendChild(textIn);

    body.appendChild(el("label", "field-label", "Font"));
    const fontSel = el("select", "input");
    FONT_WHITELIST.forEach((f) => { const o = el("option", null, FONT_LABELS[f]); o.value = f; if (f === cfg.font) o.selected = true; fontSel.appendChild(o); });
    fontSel.onchange = () => { cfg.font = fontSel.value; paint(); };
    body.appendChild(fontSel);

    function swatches(label, key) {
      body.appendChild(el("label", "field-label", label));
      const row = el("div"); row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
      PRESET_COLORS.forEach((c) => {
        const sw = el("button"); sw.type = "button";
        sw.style.cssText = "width:24px;height:24px;border-radius:5px;border:2px solid " + (cfg[key] === c ? "var(--ink)" : "var(--line-strong)") + ";background:" + c + ";cursor:pointer";
        sw.onclick = () => { cfg[key] = c; paint(); };
        sw.dataset.key = key; sw.dataset.color = c;
        row.appendChild(sw);
      });
      body.appendChild(row);
    }
    swatches("Text color", "color");
    swatches("Fill color", "fill");
    swatches("Outline color", "border");

    body.appendChild(el("label", "field-label", "Corner roundness"));
    const range = el("input"); range.type = "range"; range.min = "0"; range.max = "40"; range.value = String(cfg.radius); range.style.width = "100%";
    range.oninput = () => { cfg.radius = Number(range.value); paint(); };
    body.appendChild(range);

    body.appendChild(el("label", "field-label", "Link"));
    const linkRow = el("div"); linkRow.style.cssText = "display:flex;gap:8px;align-items:center";
    const linkIn = el("input", "input"); linkIn.type = "text"; linkIn.style.flex = "1"; linkIn.placeholder = "https://… or pick a survey"; linkIn.value = cfg.url || "";
    linkIn.oninput = () => { cfg.url = linkIn.value; };
    const linkPick = el("button", "btn btn-ghost btn-sm", "Pick…");
    linkPick.onclick = () => openLinkPicker(cfg.url, surveyLinkMode, (v) => { cfg.url = v || ""; linkIn.value = cfg.url; });
    linkRow.appendChild(linkIn); linkRow.appendChild(linkPick);
    body.appendChild(linkRow);

    body.appendChild(el("label", "field-label", "Preview"));
    const preview = el("div"); preview.style.cssText = "background:#fff;padding:14px;border:1px solid var(--line-strong);border-radius:6px";
    body.appendChild(preview);
    function paint() {
      preview.innerHTML = buildButtonHtml(cfg);
      Array.prototype.forEach.call(body.querySelectorAll("button[data-key]"), (sw) => {
        sw.style.borderColor = cfg[sw.dataset.key] === sw.dataset.color ? "var(--ink)" : "var(--line-strong)";
      });
    }
    paint();

    const foot = el("div", "modal-foot");
    if (existing && onRemove) { const rm = el("button", "btn btn-ghost btn-sm", "Remove"); rm.onclick = () => { onRemove(); close(); }; foot.appendChild(rm); }
    const cancel = el("button", "btn btn-ghost btn-sm", "Cancel");
    const ok = el("button", "btn btn-primary btn-sm", existing ? "Save" : "Insert");
    foot.appendChild(cancel); foot.appendChild(ok);
    modal.appendChild(body); modal.appendChild(foot); overlay.appendChild(modal); document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    modal.querySelector("#bb-close").onclick = close;
    cancel.onclick = close;
    ok.onclick = () => { if (!cfg.text.trim()) { toast("Add button text.", true); return; } onSave(Object.assign({}, cfg)); close(); };
  }

  // Continue an ordered list's numbering from the previous ordered list (sets the
  // standard `start` attribute, which is email-safe HTML).
  function continueNumbering(quill) {
    const range = quill.getSelection(true);
    if (!range) { toast("Put the cursor in a numbered list first.", true); return; }
    const line = quill.getLine(range.index)[0];
    let node = line && line.domNode;
    let ol = node;
    while (ol && ol.tagName !== "OL") ol = ol.parentNode;
    if (!ol) { toast("Put the cursor in a numbered list first.", true); return; }
    let prev = ol.previousElementSibling;
    while (prev && prev.tagName !== "OL") prev = prev.previousElementSibling;
    if (!prev) { toast("There's no earlier numbered list to continue from.", true); return; }
    const prevStart = parseInt(prev.getAttribute("start") || "1", 10);
    const prevCount = prev.querySelectorAll(":scope > li").length;
    ol.setAttribute("start", String(prevStart + prevCount));
    toast("Numbering continued from the previous list.");
  }

  // opts.kind: 'email' | 'sms' | 'richtext' ; opts.surveyLinkMode: 'token' | 'public'
  function mount(host, opts) {
    opts = opts || {};
    const kind = opts.kind || "email";
    const surveyLinkMode = opts.surveyLinkMode || "public";
    host.innerHTML = "";

    if (kind === "sms") {
      const body = el("textarea", "input sms-body"); body.rows = 5; body.placeholder = "Type your message…";
      const counter = el("div", "sms-count muted"); counter.textContent = "0 characters";
      body.oninput = () => { counter.textContent = body.value.length + " characters"; };
      const api = { getSubject: () => "", setSubject: () => {}, getHTML: () => body.value, getText: () => body.value, setBody: (h) => { body.value = h || ""; body.dispatchEvent(new Event("input")); }, focus: () => body.focus() };
      const actions = el("div", "compose-actions"); host.appendChild(actions);
      buildActions(actions, "sms", api, null);
      host.appendChild(body); host.appendChild(counter);
      return api;
    }

    let subjectInput = null;
    if (kind === "email") {
      host.appendChild(el("label", "field-label", "Subject"));
      subjectInput = el("input", "input"); subjectInput.placeholder = "Subject";
      host.appendChild(subjectInput);
    }

    const editorWrap = el("div", "composer-editor");
    let quill = null, plainBody = null;
    if (typeof Quill !== "undefined") {
      ensureQuillSetup();
      const tb = customToolbar();
      const editorDiv = el("div");
      editorWrap.appendChild(tb);
      editorWrap.appendChild(editorDiv);
      host.appendChild(editorWrap);
      quill = new Quill(editorDiv, {
        theme: "snow",
        placeholder: "Write your message…",
        modules: { toolbar: { container: tb, handlers: { link: function () { handleLink(quill, surveyLinkMode); } } } },
      });

      // Round-trip: convert pasted CTA-button anchors back into the embed on setBody.
      const Delta = Quill.import("delta");
      quill.clipboard.addMatcher("A", (node, delta) => {
        if (node.classList && node.classList.contains("cta-btn")) {
          const data = safeParse(node.getAttribute("data-cta")) || { text: node.textContent, url: node.getAttribute("href") };
          return new Delta().insert({ ctaButton: data });
        }
        return delta;
      });

      // Custom toolbar buttons: continue numbering + insert/edit button.
      const custom = el("span", "ql-formats");
      const contBtn = el("button", "ql-continue"); contBtn.type = "button"; contBtn.title = "Continue numbering"; contBtn.innerHTML = "1\u2026";
      contBtn.onclick = () => continueNumbering(quill);
      const ctaBtn = el("button", "ql-cta"); ctaBtn.type = "button"; ctaBtn.title = "Insert button"; ctaBtn.textContent = "Button";
      ctaBtn.onclick = () => {
        const range = quill.getSelection(true);
        openButtonBuilder(null, surveyLinkMode, (data) => {
          const idx = range ? range.index : quill.getLength();
          quill.insertEmbed(idx, "ctaButton", data, "user");
          quill.setSelection(idx + 1, 0);
        });
      };
      custom.appendChild(contBtn); custom.appendChild(ctaBtn);
      tb.appendChild(custom);

      // Click an existing button to edit/delete it.
      quill.root.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest("a.cta-btn");
        if (!a) return;
        e.preventDefault();
        const blot = Quill.find(a);
        if (!blot) return;
        const idx = quill.getIndex(blot);
        const data = safeParse(a.getAttribute("data-cta"));
        openButtonBuilder(data, surveyLinkMode,
          (newData) => { quill.deleteText(idx, 1, "user"); quill.insertEmbed(idx, "ctaButton", newData, "user"); },
          () => { quill.deleteText(idx, 1, "user"); });
      });
    } else {
      plainBody = el("div", "email-body"); plainBody.contentEditable = "true";
      editorWrap.appendChild(plainBody);
      host.appendChild(editorWrap);
    }

    const api = {
      getSubject: () => (subjectInput ? subjectInput.value.trim() : ""),
      setSubject: (s) => { if (subjectInput) subjectInput.value = s || ""; },
      getHTML: () => (quill ? quill.root.innerHTML : plainBody.innerHTML),
      getText: () => (quill ? quill.getText() : plainBody.innerText),
      setBody: (html) => { if (quill) { quill.setContents([]); if (html) quill.clipboard.dangerouslyPasteHTML(0, html); } else plainBody.innerHTML = html || ""; },
      insertHeaderImage: (dataUrl) => { if (quill) quill.insertEmbed(0, "image", dataUrl, "user"); else plainBody.innerHTML = '<img class="email-header-img" src="' + dataUrl + '" style="max-width:100%" />' + plainBody.innerHTML; },
      appendHtml: (html) => { if (quill) quill.clipboard.dangerouslyPasteHTML(quill.getLength(), "<p><br></p>" + html); else plainBody.innerHTML += "<br>" + html; },
      focus: () => (quill ? quill.focus() : plainBody.focus()),
    };

    if (kind === "email") {
      const actions = el("div", "compose-actions");
      host.insertBefore(actions, editorWrap);
      buildActions(actions, "email", api, subjectInput);
    }
    return api;
  }

  // Hyperlink flow using the shared link/survey picker.
  function handleLink(quill, surveyLinkMode) {
    const range = quill.getSelection(true);
    let current = "";
    if (range) { const fmt = quill.getFormat(range); current = fmt && fmt.link ? fmt.link : ""; }
    openLinkPicker(current, surveyLinkMode, (value) => {
      const r = quill.getSelection(true) || range;
      if (value == null || value === "") { if (r) quill.format("link", false, "user"); return; }
      if (r && r.length > 0) { quill.format("link", value, "user"); }
      else if (r) { quill.insertText(r.index, value, { link: value }, "user"); quill.setSelection(r.index + value.length, 0); }
    });
  }

  function buildActions(actions, kind, api, subjectInput) {
    const tplWrap = el("div", "saved-wrap");
    const tplBtn = el("button", "btn btn-ghost btn-sm", "Templates &#9662;");
    const tplMenu = el("div", "saved-menu hidden");
    tplWrap.appendChild(tplBtn); tplWrap.appendChild(tplMenu);
    actions.appendChild(tplWrap);

    let templates = [];
    async function loadTemplates() {
      try { templates = await App.portalApi("/api/templates?kind=" + kind); } catch (e) { templates = []; }
      paint();
    }
    function paint() {
      tplMenu.innerHTML = "";
      if (!templates.length) tplMenu.appendChild(el("div", "saved-empty", "No templates yet"));
      templates.forEach((t) => {
        const row = el("div", "saved-item");
        const name = el("button", "saved-name", esc(t.name));
        name.onclick = () => { if (kind === "email" && subjectInput && t.subject) subjectInput.value = t.subject; api.setBody(t.body || ""); tplMenu.classList.add("hidden"); toast("Loaded \u201c" + t.name + "\u201d"); };
        const del = el("button", "saved-del", "&times;");
        del.onclick = async (e) => { e.stopPropagation(); if (!(await App.ui.confirmModal({ title: "Delete template", message: "Delete template \u201c" + t.name + "\u201d?", confirmText: "Delete template" }))) return; try { await App.portalApi("/api/templates/" + t.id, { method: "DELETE" }); toast("Template deleted"); loadTemplates(); } catch (err) { toast(err.message, true); } };
        row.appendChild(name); row.appendChild(del); tplMenu.appendChild(row);
      });
      tplMenu.appendChild(el("div", "pop-sep"));
      const save = el("button", "saved-save", "+ Save current as template");
      save.onclick = async () => {
        const name = await App.ui.promptModal({ title: "Save template", label: "Template name", okText: "Save" });
        if (!name || !name.trim()) return;
        const payload = kind === "email"
          ? { name: name.trim(), kind: "email", subject: subjectInput ? subjectInput.value : "", body: api.getHTML() }
          : { name: name.trim(), kind: "sms", body: api.getText() };
        try { await App.portalApi("/api/templates", { method: "POST", body: JSON.stringify(payload) }); toast("Template saved"); loadTemplates(); }
        catch (err) { toast(err.message, true); }
      };
      tplMenu.appendChild(save);
    }
    tplBtn.onclick = (e) => { e.stopPropagation(); tplMenu.classList.toggle("hidden"); if (!tplMenu.classList.contains("hidden")) setTimeout(() => document.addEventListener("click", () => tplMenu.classList.add("hidden"), { once: true }), 0); };
    tplMenu.addEventListener("click", (e) => e.stopPropagation());
    loadTemplates();

    if (kind !== "email") return;

    const sigBtn = el("button", "btn btn-ghost btn-sm", "Insert signature");
    sigBtn.onclick = async () => {
      try { const r = await App.portalApi("/api/account/signature"); if (!r || !r.signature) { toast("Set a signature in Settings first", true); return; } api.appendHtml(r.signature); }
      catch (e) { toast(e.message, true); }
    };
    actions.appendChild(sigBtn);

    const hdrBtn = el("button", "btn btn-ghost btn-sm", "Header image");
    const hdrFile = el("input"); hdrFile.type = "file"; hdrFile.accept = "image/*"; hdrFile.style.display = "none";
    hdrBtn.onclick = () => hdrFile.click();
    hdrFile.onchange = () => {
      const f = hdrFile.files[0]; if (!f) return;
      if (f.size > 1024 * 1024) { toast("Image must be under 1 MB", true); hdrFile.value = ""; return; }
      const reader = new FileReader();
      reader.onload = () => api.insertHeaderImage(String(reader.result));
      reader.readAsDataURL(f);
    };
    actions.appendChild(hdrBtn); actions.appendChild(hdrFile);
  }

  App.compose = {
    mount,
    // pure helpers exposed for tests / reuse:
    buildButtonHtml,
    buttonStyle,
    surveyLinkValue,
    SURVEY_LINK_TOKEN,
    FONT_WHITELIST,
    PRESET_COLORS,
    MOUNT_SITES,
  };
})(typeof window !== "undefined" ? window : globalThis);
