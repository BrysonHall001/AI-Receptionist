// Learning Center — categorized, step-by-step how-to guides.
//
// AUDIENCE: written for END USERS working inside a portal (the default, as
// requested). A few admin-only features are clearly marked "(Admin)".
//
// EDITING: everything lives in the GUIDES array below. Each category has items;
// each guide has a title and an ordered list of "blocks". Block types:
//   { p: "paragraph text" }                  → a paragraph
//   { steps: ["do this", "then this"] }       → a numbered list
//   { shot: "what the screenshot shows" }     → a labeled screenshot placeholder
//   { tip: "a helpful note" }                 → a highlighted tip
// To add a guide: copy an item, change the title/blocks. To add a category:
// add a new { cat, items } entry. No other wiring needed.
(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc } = App.util;

  const GUIDES = [
    {
      cat: "Getting started",
      items: [
        {
          id: "layout",
          title: "Signing in and finding your way around",
          blocks: [
            { p: "After you sign in, the screen has three parts: the left navigation, the top bar, and the main area." },
            { steps: [
              "The left navigation lists the main sections: Dashboard, Calls, Contacts, Fields, Reports, Automations, Learning Center, and Settings.",
              "Near the bottom-left you'll find the Recycle Bin link and your user box with a Sign out button.",
              "The top bar shows where you are and any context (for example, which portal you're viewing).",
            ] },
            { shot: "Full app with the left navigation and top bar labelled" },
            { tip: "Your theme, column layout, and saved preferences are tied to your own account, so they follow you when you sign in." },
          ],
        },
        {
          id: "today",
          title: "Using the Today dashboard",
          blocks: [
            { p: "The Dashboard is your 'Today' overview — a quick snapshot when you log in." },
            { steps: [
              "The top row shows simple counts: Contacts, Total calls, Completed calls, and Calls today. Click any card to jump to that section.",
              "Recent contacts lists your newest contacts — click one to open its profile.",
              "Recent calls lists the latest calls — click one to see the call detail.",
              "Use 'Open Reports & dashboards' at the bottom for deeper, customizable charts.",
            ] },
            { shot: "Dashboard showing the KPI cards, Recent contacts, and Recent calls" },
          ],
        },
      ],
    },
    {
      cat: "Contacts",
      items: [
        {
          id: "view-contacts",
          title: "Viewing contacts and opening a profile",
          blocks: [
            { p: "The Contacts tab shows everyone in your portal in a table." },
            { steps: [
              "Click Contacts in the left navigation.",
              "Click any row to open that contact's profile page.",
              "Click a column header to sort by it; click again to reverse the order.",
            ] },
            { shot: "Contacts table with a row hovered" },
          ],
        },
        {
          id: "edit-contact",
          title: "Editing a contact's details",
          blocks: [
            { steps: [
              "Open a contact by clicking their row.",
              "On the 'All fields' tab, change any values (name, phone, email, and any custom fields).",
              "Click 'Save changes'.",
            ] },
            { shot: "Contact profile, All fields tab, with the Save changes button" },
            { tip: "Edits are recorded — see the Timeline tab to review what changed and when." },
          ],
        },
        {
          id: "timeline",
          title: "Reading a contact's timeline",
          blocks: [
            { p: "The Timeline tab shows a history of activity for that contact." },
            { steps: [
              "Open a contact and click the 'Timeline' tab.",
              "You'll see events such as field changes, emails sent, and calls, newest first.",
            ] },
            { shot: "Contact Timeline tab with a few activity entries" },
          ],
        },
        {
          id: "email-text-one",
          title: "Emailing or texting one contact",
          blocks: [
            { steps: [
              "Open a contact.",
              "For email: click the 'Email' tab, write a subject and message, then click 'Send email'. (The contact needs an email address.)",
              "For text: click the 'Text' tab, write your message, then click 'Send text'. (The contact needs a phone number.)",
            ] },
            { shot: "Contact Email tab with the composer and Send email button" },
            { tip: "In local/demo mode with placeholder keys, emails are logged rather than actually sent — that's expected until real keys are configured." },
          ],
        },
      ],
    },
    {
      cat: "Finding & organizing",
      items: [
        {
          id: "search",
          title: "Searching contacts",
          blocks: [
            { steps: [
              "On the Contacts tab, type in the Search box on the right of the toolbar.",
              "The table narrows as you type, matching across the visible columns.",
            ] },
            { shot: "Contacts toolbar with the Search box" },
          ],
        },
        {
          id: "filters",
          title: "Filtering with rules",
          blocks: [
            { p: "Filters let you narrow contacts by specific conditions." },
            { steps: [
              "Click the 'Filters' button (top-left of the table) to open the filter panel.",
              "Add a rule: pick a field, an operator (such as is, contains, is empty, between, in the previous N days), and a value.",
              "Add more rules to narrow further; a chip shows how many filters are active.",
              "You can also click the small arrow on a column header to filter or sort just that column.",
            ] },
            { shot: "Filter panel open with one or two rules" },
          ],
        },
        {
          id: "saved-filters",
          title: "Saving and reusing filters",
          blocks: [
            { steps: [
              "Set up the filters you want.",
              "Open the 'Saved Filters' dropdown and choose '+ Save current filter…', then give it a name.",
              "Later, open 'Saved Filters' and click a name to re-apply it. Use the × to delete one.",
            ] },
            { shot: "Saved Filters dropdown showing a saved entry" },
            { tip: "Saved filters are shared across your portal, so your teammates can use them too." },
          ],
        },
        {
          id: "manage-columns",
          title: "Showing, hiding, and reordering columns",
          blocks: [
            { p: "You can choose which columns appear on the Contacts table and in what order." },
            { steps: [
              "Click 'Manage columns' next to the Search box.",
              "Check a column to show it, uncheck to hide it.",
              "Drag a row by its handle to reorder.",
              "Click 'Save columns'.",
            ] },
            { shot: "Manage columns popup with checkboxes and drag handles" },
            { tip: "This layout is saved to your account and stays after you reload or sign in again. The Recycle Bin uses the same layout." },
          ],
        },
      ],
    },
    {
      cat: "Bulk actions",
      items: [
        {
          id: "select",
          title: "Selecting multiple contacts",
          blocks: [
            { steps: [
              "On the Contacts table, use the checkbox at the left of each row to select contacts.",
              "Use the checkbox in the header to select everything currently shown by your search/filter.",
              "A count (e.g. '3 selected') appears next to the Bulk Actions button.",
            ] },
            { shot: "Contacts table with several rows checked and the selected count" },
          ],
        },
        {
          id: "bulk",
          title: "Bulk email, text, export, or delete",
          blocks: [
            { steps: [
              "Select one or more contacts.",
              "Open the 'Bulk Actions' dropdown.",
              "Choose 'Email selected' or 'Text selected' to write one message and send it to everyone selected; 'Export selected' to download just those rows; or 'Delete selected' to move them to the Recycle Bin.",
            ] },
            { shot: "Bulk Actions menu open with the four options" },
            { tip: "If you open Bulk Actions with nothing selected, it gently reminds you to select a contact first." },
          ],
        },
      ],
    },
    {
      cat: "Importing & exporting",
      items: [
        {
          id: "import",
          title: "Importing contacts",
          blocks: [
            { steps: [
              "On the Contacts tab, click 'Import contacts'.",
              "Provide your contact rows as prompted and confirm the import.",
              "Imported people appear in the Contacts table.",
            ] },
            { shot: "Import contacts dialog" },
          ],
        },
        {
          id: "export",
          title: "Exporting contacts",
          blocks: [
            { steps: [
              "Click 'Export contacts' (or select rows and use Bulk Actions → Export selected).",
              "Give the export a name and choose which columns to include.",
              "Optionally narrow which contacts are included using the same rule builder as Filters.",
              "Export to download the file; past exports are listed for re-download.",
            ] },
            { shot: "Export dialog showing column checkboxes and the match count" },
          ],
        },
      ],
    },
    {
      cat: "Custom fields",
      items: [
        {
          id: "fields",
          title: "Creating and managing custom fields",
          blocks: [
            { p: "Custom fields let you track information that matters to your business (e.g. Status, Source, Budget)." },
            { steps: [
              "Click 'Fields' in the left navigation.",
              "Add a field with a label and a type (such as text, number, date, or a select list with options).",
              "Drag fields to reorder them; edit or delete fields as needed.",
              "New fields then appear on contact profiles and can be added as columns via 'Manage columns'.",
            ] },
            { shot: "Fields page with the add-field form and the list of fields" },
            { tip: "(Admin) Managing fields is typically a portal-admin task." },
          ],
        },
      ],
    },
    {
      cat: "Reports & dashboards",
      items: [
        {
          id: "reports",
          title: "Building reports and dashboards",
          blocks: [
            { p: "The Reports page hosts customizable dashboards built from your contacts data." },
            { steps: [
              "Click 'Reports' in the left navigation.",
              "Create a dashboard, then click 'Add widget'.",
              "Pick a widget type (KPI number, bar/line series, stacked, or heatmap), a measure (count, sum, or average of a field), and how to group it.",
              "Drag widgets to reorder and resize them to arrange your dashboard.",
            ] },
            { shot: "Reports page with a dashboard of a KPI and a chart" },
          ],
        },
      ],
    },
    {
      cat: "Automations",
      items: [
        {
          id: "automations",
          title: "Setting up an automation",
          blocks: [
            { p: "Automations run actions automatically when something happens. Each one is: a trigger (what happens) → conditions (optional filters) → actions (what to do)." },
            { steps: [
              "Click 'Automations' in the left navigation (Workflows tab).",
              "Create an automation: give it a name, choose a trigger, add any conditions, and add one or more actions (such as send email, send SMS, update a field, add/remove a tag, create a note, or assign an owner).",
              "Turn it on with the enabled toggle.",
              "Use 'Test' to dry-run it against a contact, and check the Execution log and Event log tabs to see what ran.",
            ] },
            { shot: "Automations builder showing trigger, conditions, and actions" },
            { tip: "(Admin) Automations are usually configured by a portal admin." },
          ],
        },
      ],
    },
    {
      cat: "Recycle Bin",
      items: [
        {
          id: "recycle",
          title: "Deleting, restoring, and the 30-day window",
          blocks: [
            { p: "Deleting a contact is a 'soft delete' — it's moved to the Recycle Bin, not erased, and disappears from Contacts, search, filters, and exports." },
            { steps: [
              "To delete: select contacts and choose Bulk Actions → Delete selected.",
              "To view deleted contacts: click the Recycle Bin link near the bottom-left.",
              "Each deleted contact shows how many days remain before permanent deletion.",
              "To restore: select contacts in the Recycle Bin and click 'Restore selected' — they return to Contacts.",
            ] },
            { shot: "Recycle Bin page with the days-until-deletion countdown" },
            { tip: "Deleted contacts are kept for 30 days, then permanently removed. Once permanently removed they can't be recovered." },
          ],
        },
      ],
    },
    {
      cat: "Appearance",
      items: [
        {
          id: "theming",
          title: "Choosing or designing a theme",
          blocks: [
            { p: "Your theme is personal to your account and applies wherever you sign in." },
            { steps: [
              "Go to Settings → Appearance.",
              "Pick a ready-made look from the 'Basic' or 'Fun' dropdowns (a colour preview appears beside each).",
              "Or use 'Design your own' to set background, content panel, top bar, sidebar, and font colours, plus a font.",
              "Click 'Save as new theme…', give it a name, and it appears in your 'Your saved themes' dropdown to switch back to anytime.",
            ] },
            { shot: "Settings → Appearance with the theme dropdowns and the designer" },
            { tip: "You can keep several named themes and switch between them whenever you like." },
          ],
        },
      ],
    },
    {
      cat: "Your account",
      items: [
        {
          id: "account",
          title: "Password and email signature",
          blocks: [
            { steps: [
              "Go to Settings to change your password.",
              "Set a personal email signature there too — it's used when you send emails from a contact.",
            ] },
            { shot: "Settings page with password and signature sections" },
          ],
        },
      ],
    },
  ];

  function renderBlock(b) {
    if (b.p) return el("p", "learn-p", esc(b.p));
    if (b.tip) { const d = el("div", "learn-tip"); d.innerHTML = `<strong>Tip:</strong> ${esc(b.tip)}`; return d; }
    if (b.shot) return el("div", "learn-shot", `[Screenshot: ${esc(b.shot)}]`);
    if (b.steps) {
      const ol = el("ol", "learn-steps");
      b.steps.forEach((s) => ol.appendChild(el("li", null, esc(s))));
      return ol;
    }
    return el("div");
  }

  function render(host) {
    host.innerHTML = "";
    const wrap = el("div", "fade-in learn-wrap");
    const head = el("div", "learn-head");
    head.innerHTML = `<h1 class="learn-title">Learning Center</h1><p class="cell-muted">Step-by-step guides for using ${esc(App.BRAND || "the app")}.</p>`;
    wrap.appendChild(head);

    const layout = el("div", "learn-layout");
    const nav = el("aside", "learn-nav");
    const content = el("div", "learn-content");
    layout.appendChild(nav);
    layout.appendChild(content);
    wrap.appendChild(layout);
    host.innerHTML = "";
    host.appendChild(wrap);

    const search = el("input", "search-input learn-search");
    search.type = "search";
    search.placeholder = "Search guides…";
    nav.appendChild(search);
    const navList = el("div", "learn-nav-list");
    nav.appendChild(navList);

    let currentId = GUIDES[0] && GUIDES[0].items[0] && GUIDES[0].items[0].id;

    function showGuide(id) {
      let found = null, cat = null;
      GUIDES.forEach((g) => g.items.forEach((it) => { if (it.id === id) { found = it; cat = g.cat; } }));
      if (!found) { content.innerHTML = `<div class="card"><p class="cell-muted">Pick a guide from the left.</p></div>`; return; }
      currentId = id;
      paintNav();
      const card = el("div", "card learn-article");
      card.appendChild(el("div", "learn-eyebrow", esc(cat)));
      card.appendChild(el("h2", "learn-article-title", esc(found.title)));
      (found.blocks || []).forEach((b) => card.appendChild(renderBlock(b)));
      content.innerHTML = "";
      content.appendChild(card);
      content.scrollTop = 0;
    }

    function paintNav() {
      const term = (search.value || "").trim().toLowerCase();
      navList.innerHTML = "";
      GUIDES.forEach((g) => {
        const items = g.items.filter((it) => !term || it.title.toLowerCase().includes(term) || g.cat.toLowerCase().includes(term));
        if (!items.length) return;
        navList.appendChild(el("div", "learn-cat", esc(g.cat)));
        items.forEach((it) => {
          const b = el("button", "learn-link" + (it.id === currentId ? " active" : ""), esc(it.title));
          b.onclick = () => showGuide(it.id);
          navList.appendChild(b);
        });
      });
      if (!navList.children.length) navList.appendChild(el("div", "cell-muted", "No guides match."));
    }

    search.oninput = App.util.debounce(paintNav, 150);
    paintNav();
    showGuide(currentId);
  }

  App.learn = { render, GUIDES };
})(typeof window !== "undefined" ? window : globalThis);
