(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc, toast } = App.util;

  const FONT_WHITELIST = ["arial", "georgia", "times-new-roman", "courier-new", "verdana", "tahoma", "trebuchet-ms"];
  let quillReady = false;
  function ensureQuillSetup() {
    if (quillReady || typeof Quill === "undefined") return;
    const Font = Quill.import("formats/font");
    Font.whitelist = FONT_WHITELIST;
    Quill.register(Font, true);
    // Make bare links (e.g. "google.com") absolute so they don't resolve back to the app.
    const Link = Quill.import("formats/link");
    class SmartLink extends Link {
      static sanitize(url) {
        let u = (url || "").trim();
        if (u && !/^(https?:|mailto:|tel:|#|\/)/i.test(u)) u = "https://" + u;
        return super.sanitize(u);
      }
    }
    Quill.register(SmartLink, true);
    quillReady = true;
  }

  function toolbarConfig() {
    return [
      [{ font: FONT_WHITELIST }],
      [{ size: ["small", false, "large", "huge"] }],
      ["bold", "italic", "underline"],
      [{ color: [] }],
      [{ align: [] }],
      [{ list: "ordered" }, { list: "bullet" }],
      ["link"],
    ];
  }

  // opts.kind: 'email' | 'sms' | 'richtext'
  function mount(host, opts) {
    opts = opts || {};
    const kind = opts.kind || "email";
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
      const editorDiv = el("div");
      editorWrap.appendChild(editorDiv);
      host.appendChild(editorWrap);
      quill = new Quill(editorDiv, { theme: "snow", placeholder: "Write your message…", modules: { toolbar: toolbarConfig() } });
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

  App.compose = { mount };
})(typeof window !== "undefined" ? window : globalThis);
