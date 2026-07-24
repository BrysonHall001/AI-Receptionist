// Learning Center — categorized, step-by-step how-to guides (REBUILT, batch LC-1).
//
// AUDIENCE: written for the people using this workspace day to day. Guides describe
// only what THIS app can do for YOUR business — plain language, task-oriented.
//
// EDITING: everything lives in the GUIDES array. Each section has items; each guide
// has an id, a title, and ordered "blocks". Block types:
//   { p: "text" }                     → a paragraph
//   { steps: ["do this", "then"] }    → a numbered list
//   { tip: "note" }                   → a highlighted tip
//   { visual: "kebab-id", note: "" }  → a VISUAL: placeholder — NOT rendered; part 2
//                                        of the LC rebuild replaces these with live
//                                        embedded UI demonstrations. id = kebab-case.
// DEEP LINKS: inside p/steps/tip text, [[#/route|Label]] renders as a normal accent
// link that navigates with the app's own hash routing. Every href is verified against
// the real route map by selfTest_learningCenter1.
// RELABELING: titles and text run through App.relabelText, so renamed modules
// (e.g. "Jobs" → "Projects") show the workspace's own words.
(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc } = App.util;

  // LC-3, THE SEEDED-DATA RULE: guide text never enumerates the LIVE portal's nav or
  // names its custom modules/fields/stages — docs ship to every portal. The old dynamic
  // nav sentence (which leaked seeded test modules) is gone; the orientation guide
  // teaches the modules-vs-pages PATTERN with the base modules as examples.

  const GUIDES = [
    {
      cat: "Getting started",
      items: [
        {
          id: "orientation", features: ["always"],
          title: "Finding your way around: Modules and Pages",
          blocks: [
            { p: "Clarity's navigation has two parts, and the split is the key to the whole app. The LEFT navigation lists your MODULES — the kinds of data your business keeps, like [[#/contacts|Contacts]], [[#/jobs|Job Openings]], and [[#/bookings|Bookings]], plus any modules you create. Modules are highly configurable: their fields are grouped into sections, they offer custom views, and you can rename them to your own words." },
            { p: "Across the TOP run your PAGES — fixed-purpose screens that work WITH that data: [[#/dashboard|Home Dashboard]], [[#/calls|Calls]], [[#/reports|Analytics]], [[#/automations|Automations]], [[#/communication|Communication]], the Learning Center, and [[#/feedback|Feedback]]." },
            { steps: [
              "Left navigation = modules: one entry per kind of record. Yours may differ from a teammate's screenshots — modules are renameable and you can add your own.",
              "Top row = pages: the fixed tools. Their names don't change.",
              "The top bar also shows small colored presence dots for teammates who are online — hover one to see who it is.",
              "Click the logo in the top-left corner at any time to return to your [[#/dashboard|Home Dashboard]].",
            ] },
            { tip: "If something named in a guide isn't in your navigation, it may be turned off for your workspace or your role — ask whoever manages your account." },
            { visual: "shell-tour", note: "callout tour: module sidebar, page row, top bar" },
          ],
        },
        {
          id: "home-dashboard", features: ["page:#/dashboard"],
          title: "Your Home Dashboard",
          blocks: [
            { p: "The [[#/dashboard|Home Dashboard]] is a live snapshot of your business built from widgets — the same widgets the [[#/reports|Analytics]] page uses." },
            { steps: [
              "Open [[#/dashboard|Home Dashboard]] from the navigation (or click the logo).",
              "Press Add widget to create a new tile — see the Analytics section's \"Building a widget\" guide for every option.",
              "Drag a widget's card to reorder; use its menu to edit or remove it.",
            ] },
            { visual: "home-dashboard", note: "faithful mini Home Dashboard: reports bar + widget grid" },
          ],
        },
        {
          id: "account-basics", features: ["always"],
          title: "Your account: password and email signature",
          blocks: [
            { p: "Personal settings live under [[#/settings/account|Settings → Your account]]." },
            { steps: [
              "Open [[#/settings/account|Settings → Your account]].",
              "To change your password, enter your current one, then the new one, and save.",
              "Your email signature is appended to messages you send from [[#/communication|Communication]] — edit it here once and every email uses it.",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Calls & your AI receptionist", page: "#/calls",
      items: [
        {
          id: "call-log", features: ["page:#/calls"],
          title: "Reading the call log",
          blocks: [
            { p: "Every call your AI receptionist handles is logged on the [[#/calls|Calls]] page: who called, their number, the reason for the call, its status, and when it happened." },
            { steps: [
              "Open [[#/calls|Calls]] from the navigation.",
              "Use the search box or column filters to find a caller.",
              "Calls are also a data source in [[#/reports|Analytics]], so you can chart call volume over time.",
            ] },
          ],
        },
        {
          id: "receptionist-setup", features: ["page:#/calls", "receptionist"],
          title: "Configuring your receptionist",
          blocks: [
            { p: "How the receptionist greets callers and behaves is configured in [[#/settings/aireceptionist|Settings → AI Receptionist]]." },
            { steps: [
              "Open [[#/settings/aireceptionist|Settings → AI Receptionist]].",
              "Adjust the greeting and behavior options, then save.",
              "Business hours are not set here — the receptionist reads them from [[#/settings/scheduling|Settings → Scheduling & Resources]], so they always match your calendar.",
            ] },
            { tip: "This section is available to owner/admin roles. If you can't see it, ask your workspace owner." },
          ],
        },
        {
          id: "lead-capture", features: ["page:#/calls"],
          title: "Capturing leads with a shareable form",
          blocks: [
            { p: "[[#/settings/leadcapture|Settings → Lead capture]] gives you a form you can share or embed; submissions become new contacts automatically." },
            { steps: [
              "Open [[#/settings/leadcapture|Settings → Lead capture]].",
              "Copy the form link to share it, or use the embed option for your website.",
              "New submissions appear in [[#/contacts|Contacts]].",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Working with records", pagesAll: ["#/contacts", "#/jobs", "#/bookings"],
      items: [
        {
          id: "how-organized", features: ["always"],
          title: "How Clarity is organized: fields \u2192 sections \u2192 modules \u2192 links",
          blocks: [
            { p: "Everything in Clarity hangs off one simple hierarchy. FIELDS are the individual pieces of information — a name, a phone number, a date. Fields live in SECTIONS, which group related fields together on a record's panel (contact details in one section, preferences in another). Sections make up a MODULE — [[#/contacts|Contacts]], [[#/jobs|Job Openings]], [[#/bookings|Bookings]], or any module you create — and each module holds one kind of record." },
            { p: "Modules LINK to each other: a record's panel shows related tabs, so a contact's jobs and bookings are one click away. And alongside the modules sit the PAGES — the fixed tools like [[#/dashboard|Home Dashboard]] and [[#/reports|Analytics]] that read and chart the data your modules hold." },
            { steps: [
              "Open any record in [[#/contacts|Contacts]] and notice its fields grouped under section headings.",
              "Look at the tabs on the record's panel — each links to a related module.",
              "Everything about this shape is yours to change in [[#/settings/fields|Settings \u2192 Modules & Fields]]: add fields, arrange sections, create whole modules.",
            ] },
            { tip: "Modules can be renamed to your own words (see \"Renaming pages\" under Customizing), so your navigation might say Clients or Projects — these guides use your current names automatically." },
          ],
        },
        {
          id: "add-edit-records", features: ["always"],
          title: "Adding and editing records",
          blocks: [
            { steps: [
              "Open a module page, e.g. [[#/contacts|Contacts]], and press the add button in the toolbar.",
              "Click any row to open the record's panel, where every field is editable.",
              "Fields come in types — text, number, percent, date, progress, line items, and more; your workspace chooses them in [[#/settings/fields|Settings → Modules & Fields]].",
            ] },
            { tip: "If a teammate is viewing the same area, you'll see their presence dot in the top bar." },
            { visual: "record-drawer", note: "record panel opening with editable fields" },
          ],
        },
        {
          id: "five-views", features: ["always"],
          title: "The five views: list, kanban, calendar, gallery, map",
          blocks: [
            { p: "Every module can offer up to five ways of seeing the same records. Switch views with the buttons above the table." },
            { steps: [
              "List — the classic table: sort, filter, and manage columns.",
              "Kanban — cards grouped into status columns; drag a card to change its status.",
              "Calendar — appears when the module has a date field; records land on their date.",
            ] },
            { feature: "view:gallery", steps: ["Gallery — large cards, great for records with images."] },
            { featureOff: "view:gallery", p: "(This portal doesn't currently use the gallery view.)" },
            { feature: "view:map", steps: ["Map — appears when the module has an address and mapping is connected."] },
            { featureOff: "view:map", p: "(This portal doesn't currently use the map view.)" },
            { p: "Which views a module offers is controlled in [[#/settings/fields|Settings → Modules & Fields]] under that module's Views panel." },
            { visual: "views-switcher", note: "animated switch between the five views" },
          ],
        },
        {
          id: "related-records", features: ["always"],
          title: "Related records",
          blocks: [
            { p: "A record's panel shows related tabs — one per connected module — so a contact's jobs and bookings are one click away." },
            { steps: [
              "Open any record in [[#/contacts|Contacts]].",
              "Use the tabs in its panel to see related records from other modules.",
              "Add a related record straight from the tab; it links back automatically.",
            ] },
          ],
        },
        {
          id: "statuses-pipelines", features: ["always"],
          title: "Statuses and pipelines",
          blocks: [
            { p: "Modules with a stage field have a pipeline: each record sits in exactly one stage, shown as a colored badge in lists and as columns in kanban." },
            { steps: [
              "Change a record's stage from its panel, or drag its card between kanban columns.",
              "Edit the stages themselves — names, order — in [[#/settings/fields|Settings → Modules & Fields]].",
            ] },
            { visual: "kanban-drag", note: "kanban card dragged between stage columns" },
          ],
        },
      ],
    },
    {
      cat: "Finding & organizing", pagesAll: ["#/contacts", "#/jobs", "#/bookings"],
      items: [
        {
          id: "search-sort-filter", features: ["always"],
          title: "Search, sort, and filters",
          blocks: [
            { steps: [
              "Type in the search box above any list to filter instantly across its columns.",
              "Click a column header to sort; your sort choice is remembered per page.",
              "Open the filter rail to build precise rules (e.g. status is Open AND created this month), combining as many conditions as you need.",
              "Filters you use often can be saved and reapplied from the saved-filters list.",
            ] },
            { visual: "filter-rules", note: "rule builder adding two conditions" },
          ],
        },
        {
          id: "manage-columns", features: ["always"],
          title: "Choosing your columns",
          blocks: [
            { steps: [
              "Open the manage-columns control above a list.",
              "Tick the fields you want as columns and drag to reorder them.",
              "Each column header's menu also offers sort and per-column filtering.",
            ] },
          ],
        },
        {
          id: "bulk-actions", features: ["always"],
          title: "Bulk actions",
          blocks: [
            { steps: [
              "Tick the checkboxes on multiple rows (or the header checkbox for the whole page).",
              "Open the bulk menu that appears in the toolbar.",
              "Apply the action — for example updating a field or deleting — to everything selected at once.",
            ] },
          ],
        },
        {
          id: "import-export", features: ["always"],
          title: "Importing and exporting",
          blocks: [
            { p: "Bring existing data in from a spreadsheet, or take your data out, from any module's toolbar." },
            { steps: [
              "Import: choose your CSV file, then match each spreadsheet column to a field — the preview shows exactly what will be created before you confirm.",
              "Export: choose which records (current filter or all) and download a CSV.",
            ] },
            { tip: "Imported rows that fail validation are reported so you can fix and re-import just those." },
            { visual: "import-mapping", note: "CSV column-to-field mapping screen" },
          ],
        },
        {
          id: "recycle-bin", features: ["always"],
          title: "The recycle bin",
          blocks: [
            { p: "Deleted records aren't gone immediately — they move to the recycle bin in [[#/settings/data/recycle|Settings → Data Administration]]." },
            { steps: [
              "Open [[#/settings/data/recycle|Settings → Data Administration → Recycle bin]].",
              "Restore a record to put it back exactly where it was, or purge to remove it permanently.",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Analytics & dashboards", page: "#/reports",
      items: [
        {
          id: "dashboards-overview", features: ["page:#/reports"],
          title: "Dashboards: Home vs Analytics",
          blocks: [
            { p: "[[#/reports|Analytics]] holds as many dashboards as you like; your [[#/dashboard|Home Dashboard]] is the one that greets you on sign-in. Both are built from the same widgets." },
            { steps: [
              "Open [[#/reports|Analytics]] and use the dashboard picker to switch or create dashboards.",
              "Every dashboard has its own date range control; individual widgets can override it.",
            ] },
          ],
        },
        {
          id: "build-widget", features: ["page:#/reports"],
          title: "Building a widget",
          blocks: [
            { steps: [
              "Press Add widget on [[#/reports|Analytics]] or your [[#/dashboard|Home Dashboard]].",
              "Pick a data source — a module, or Calls.",
              "Pick a type: KPI (one number), bar, stacked bar, line, pie, heat map, or a list/table.",
              "Pick the measure: Count, or Sum/Average of a numeric field. Sources with no numeric fields (like Calls) sensibly offer Count only.",
              "Group by a field to split the result (and stack by a second one for stacked bars or heat maps).",
              "Add filters with the same rule builder lists use, preview live, and save.",
            ] },
            { visual: "widget-wizard", note: "the Add-widget modal walked through" },
          ],
        },
        {
          id: "widget-ranges", features: ["page:#/reports"],
          title: "Filters, grouping, and date ranges",
          blocks: [
            { steps: [
              "The dashboard's date range applies to every widget by default.",
              "Tick \"Use a custom date range for this widget\" in a widget's editor to pin it to its own window.",
              "Filters inside a widget narrow just that widget — great for one dashboard showing several slices side by side.",
            ] },
          ],
        },
        {
          id: "report-templates", features: ["page:#/reports"],
          title: "Starting from a report template",
          blocks: [
            { steps: [
              "Open the templates library from the [[#/reports|Analytics]] toolbar.",
              "Pick a template to add its ready-made widgets to your dashboard, then tweak them like any other widget.",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Communication", page: "#/communication",
      items: [
        {
          id: "send-email", features: ["page:#/communication"],
          title: "Sending email",
          blocks: [
            { steps: [
              "Open [[#/communication|Communication]] → Email.",
              "Choose recipients: pick contacts directly, or select a saved Audience to email everyone it currently matches.",
              "Write your message (your signature from [[#/settings/account|Your account]] is added automatically) and send.",
            ] },
          ],
        },
        {
          id: "email-templates", features: ["page:#/communication"],
          title: "Email templates",
          blocks: [
            { steps: [
              "Open [[#/communication|Communication]] → Email Templates.",
              "Create a template once; reuse it from the composer whenever you write a message.",
            ] },
          ],
        },
        {
          id: "audiences", features: ["page:#/communication"],
          title: "Audiences: reusable recipient lists",
          blocks: [
            { p: "An Audience is a named, dynamic filter over your contacts — \"Leads from this month\", \"Everyone with an open job\". It's resolved to its CURRENT matches each time you use it." },
            { steps: [
              "Open [[#/communication|Communication]] → Audiences and press New.",
              "Build the filter with the same rule builder lists use, name it, save.",
              "Pick the Audience anywhere you send: email, surveys, and drips.",
            ] },
            { visual: "audience-builder", note: "audience rule builder + live match count" },
          ],
        },
        {
          id: "surveys", features: ["page:#/communication"],
          title: "Surveys",
          blocks: [
            { steps: [
              "Open [[#/communication|Communication]] → Surveys and create a survey with your questions.",
              "Send it to contacts or an Audience.",
              "Watch responses arrive on the survey's Results view.",
            ] },
          ],
        },
        {
          id: "drips", features: ["page:#/communication"],
          title: "Drip sequences",
          blocks: [
            { p: "A drip sends a series of messages on a schedule — day 1 welcome, day 3 follow-up — to everyone enrolled." },
            { feature: "sms", p: "Steps can be emails or text messages — mix both in one sequence." },
            { featureOff: "sms", p: "(Texting isn't enabled on this platform, so drip steps send as email.)" },
            { steps: [
              "Open [[#/communication|Communication]] → Drips and create a sequence of timed messages.",
              "Enroll contacts or an Audience; each person moves through the steps automatically.",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Automations", page: "#/automations",
      items: [
        {
          id: "automations-basics", features: ["page:#/automations"],
          title: "How automations work",
          blocks: [
            { p: "An automation is a trigger (something happens — a record is created, a stage changes) plus one or more actions (send an email, update a field). Once on, it runs by itself." },
            { steps: [
              "Open [[#/automations|Automations]] and press New.",
              "Pick the trigger, add actions, and use the preview to see the flow before turning it on.",
            ] },
            { visual: "automation-flow", note: "trigger→action flow preview" },
          ],
        },
        {
          id: "automation-presets", features: ["page:#/automations"],
          title: "Starting from a preset",
          blocks: [
            { steps: [
              "Open the preset library on [[#/automations|Automations]] — recipes are grouped by category.",
              "Pick one to load it pre-built, adjust the details, and enable it.",
            ] },
            { tip: "Presets that include a text-message step are hidden while texting is turned off for your workspace." },
          ],
        },
        {
          // Customer Comms batch. Copy deliberately avoids every seeded
          // stage/subtype/field label as a lowercase substring (the LC-3 DB
          // scan), hence the careful phrasing around statuses and work types.
          id: "customer-updates", features: ["page:#/automations"],
          title: "Keeping customers in the loop",
          blocks: [
            { p: "The library ships five ready-made customer-update recipes for field work: a visit heads-up the day before, another two hours out, an instant \u201cwe got it\u201d note the moment a work order is created, a thank-you with a review ask when the work wraps up, and an internal nudge when a brand-new work order sits three days untouched. Nothing is pre-installed — each one exists only after you apply it, arrives as a draft, and does nothing until you switch it on." },
            { steps: [
              "Open the library on [[#/automations|Automations]] and apply the recipes you want — they load as drafts.",
              "Open each draft and make the words yours. Handy tags: {{name}}, {{appointment}}, {{technician|our technician}}, {{service}}, {{record_title}}, {{business}} — an empty value simply drops out, and the bit after the | is the stand-in.",
              "Turn each one on when the copy reads right. Times follow your business\u2019s wall clock.",
            ] },
            { feature: "sms", tip: "The two visit heads-up recipes send texts, and every text respects the app-wide texting switch — if it\u2019s ever off, the run records the step as skipped rather than quietly pretending." },
            { featureOff: "sms", tip: "Texting is currently off for your workspace, so the text-based recipes are hidden. The email ones (the instant acknowledgment and the review ask) work today." },
            { p: "Every recipe is also buildable by hand, piece by piece: the \u201cBefore an appointment\u201d trigger now has a module picker (Bookings or Work Orders) with real hour-level timing, \u201cRecord created\u201d is a trigger of its own, the \u201cMessage the customer\u201d action emails or texts the record\u2019s linked contact — skipping politely when there\u2019s nobody linked or no number on file — and a \u201crecord type\u201d condition keeps a flow scoped to one module." },
            { p: "On a work order\u2019s page there\u2019s also a one-tap On my way button — it texts the linked customer that the technician is en route, at most once a day, and leaves a note on the work order. In fact every customer message sent about a record leaves one, so \u201cdid anyone tell the customer?\u201d is answered right on the record." },
          ],
        },
      ],
    },
    {
      cat: "Scheduling & team",
      items: [
        {
          id: "staff-resources", features: ["always"],
          title: "Staff and resources",
          blocks: [
            { steps: [
              "Open [[#/settings/scheduling|Settings → Scheduling & Resources]].",
              "Add each bookable person or resource; bookings can then be assigned to them.",
            ] },
          ],
        },
        {
          // Work Orders foundation batch. Copy deliberately never names seeded
          // stage/subtype/field labels (the LC-3 DB scan forbids them) — it
          // teaches the flow in generic words, like every other guide.
          id: "work-orders", features: ["rt:work_order"],
          title: "Work orders: create, plan, and hand off",
          blocks: [
            { p: "A work order is a visit-ready job for your field team: what needs doing, where, and who's going. Open [[#/records/work_order|Work Orders]] to see them all — each one moves through its statuses from first request to done, and can be typed when you create it (both the types and the statuses are yours to rename in [[#/settings/fields|Settings → Modules & Fields]])." },
            { steps: [
              "Press Create on the [[#/records/work_order|Work Orders]] page, give it a clear title, pick its type, and fill in the details.",
              "To put it on the module's calendar, set a start — and optionally an end — in the date and time boxes.",
              "To hand it to someone, pick a person in the Assigned dropdown — the same staff list bookings use.",
              "Link each staff member to their sign-in account in [[#/settings/scheduling|Settings → Scheduling & Resources]] (the Link account button on their row).",
              "Anyone with a linked account gets a My work orders entry under Saved Filters on the [[#/records/work_order|Work Orders]] list — one click shows just their own work.",
              "For dispatch-style planning, the module's calendar can add staff lanes, a tray of not-yet-dated work, and drag-to-plan — two switches under the Calendar tile in [[#/settings/fields|Settings → Modules & Fields]].",
            ] },
            { tip: "Status changes on a work order can kick off [[#/automations|Automations]] — a follow-up email when the work wraps up, for example — using the \"Record updated / status changed\" trigger. The library\u2019s customer-update recipes (visit heads-ups, an instant acknowledgment, a review ask) are pre-built for exactly this, and a one-tap On my way button on each work order\u2019s page texts the linked customer that help is en route." },
          ],
        },
        {
          // Scheduling Calendar batch. Copy deliberately avoids every seeded
          // stage/subtype/field label (the LC-3 DB scan forbids them as
          // substrings — which is why this guide never uses the word for
          // records that are, well, not yet on the calendar).
          id: "dispatch-calendar", features: ["calopt:scheduling"],
          title: "Dispatch on the calendar",
          blocks: [
            { p: "Two options on a module's Views tile turn its calendar into a dispatch board. LANES splits the day into one column per staff member. The TRAY is a sidebar of the module's records that have no date yet, so brand-new work is visible instead of invisible. Both live in [[#/settings/fields|Settings → Modules & Fields]] under the Calendar tile, and both are off until you turn them on." },
            { steps: [
              "Drag a tray record onto the grid to give it a time — drop it inside a staff column to hand it to that person in the same motion.",
              "Drag a block up or down to change its time, or into another column to hand it to someone else. Everything snaps to a tidy 15 minutes.",
              "Use Undo on the confirmation message if a drop landed wrong.",
              "With lanes on, time a staff member is taken by the OTHER schedule (their bookings here, their field work on the booking page) appears as shaded blocks you can't touch — so nothing gets dropped into a gap that only looks free.",
            ] },
            { tip: "A drag saves through exactly the same path as editing the record by hand, so permissions, history, and automations behave identically — and teammates with view-only access simply don't get drag handles." },
          ],
        },
        {
          id: "business-hours", features: ["always"],
          title: "Business hours",
          blocks: [
            { p: "Your hours live in [[#/settings/scheduling|Settings → Scheduling & Resources]] and are the single source of truth — the AI receptionist reads them from here too." },
          ],
        },
        {
          id: "google-calendar", features: ["google"],
          title: "Connecting Google Calendar",
          blocks: [
            { steps: [
              "Open [[#/settings/scheduling|Settings → Scheduling & Resources]] and press Connect under Google Calendar.",
              "Approve access — busy times are read so double-booking is avoided.",
              "Map each calendar to a staff member so availability lines up per person.",
              "Optionally enable two-way sync to push bookings onto the calendar as well.",
            ] },
            { visual: "calendar-mapping", note: "per-resource calendar mapping selects" },
          ],
        },
        {
          id: "invite-team", features: ["always"],
          title: "Inviting your team & permissions",
          blocks: [
            { steps: [
              "Open [[#/settings/team|Settings → Team & Permissions]].",
              "Invite a teammate by email and choose their role — roles control what they can see and change.",
              "Pending invites can be revoked; members can be removed any time.",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Customizing your workspace",
      items: [
        {
          id: "modules-fields", features: ["always"],
          title: "Modules & Fields",
          blocks: [
            { p: "[[#/settings/fields|Settings → Modules & Fields]] is where your workspace takes shape: create modules, add fields of any type, adjust each module's Terms (the words it uses) and which of the five views it offers." },
            { steps: [
              "Open [[#/settings/fields|Settings → Modules & Fields]] and pick a module.",
              "Add or edit fields — drag to reorder; the field library offers ready-made ones.",
              "Use the Views panel to enable list, kanban, calendar, gallery, or map (calendar needs a date field; map needs an address).",
            ] },
            { visual: "fields-editor", note: "field list with drag reorder + views toggles" },
          ],
        },
        {
          id: "appearance", features: ["always"],
          title: "Appearance: themes, sliders, and your logo",
          blocks: [
            { steps: [
              "Open [[#/settings/appearance|Settings → Appearance]].",
              "Browse the theme carousel — Basic and Fun collections — and click a card to apply it.",
              "Fine-tune with the personality sliders: corners, buttons, shadows, borders, and table row height; pick custom shadow/border colors or press Neutral to return to the theme's own.",
              "Upload your logo to replace the default mark everywhere, including the sign-in screen.",
            ] },
            { visual: "appearance-sliders", note: "theme carousel + a slider moving live" },
          ],
        },
        {
          id: "rename-pages", features: ["always"],
          title: "Renaming pages and hiding pages",
          blocks: [
            { steps: [
              "Open [[#/settings/labels|Settings → Pages]].",
              "Rename any module — the navigation, buttons, and even these guides update to your words.",
              "Owners can also hide pages a workspace doesn't use; hidden pages leave the navigation entirely.",
            ] },
          ],
        },
      ],
    },
    {
      cat: "Housekeeping",
      items: [
        {
          id: "integrations", features: ["always"],
          title: "Integrations at a glance",
          blocks: [
            { p: "[[#/settings/integrations|Settings → Integrations]] shows the connection status of the services your workspace uses: phone/text (Twilio), AI (OpenAI), Google Calendar, and maps (Mapbox)." },
          ],
        },
        {
          id: "billing", features: ["page:#/billing"],
          title: "Billing & invoices",
          blocks: [
            { steps: [
              "Open [[#/settings/billing|Settings → Billing]] to see your invoices.",
              "Pay any outstanding invoice online with the Pay now button.",
            ] },
          ],
        },
        {
          id: "data-admin", features: ["always"],
          title: "Data Administration",
          blocks: [
            { p: "[[#/settings/data|Settings → Data Administration]] gathers your data housekeeping in one place — including the [[#/settings/data/recycle|recycle bin]] covered under Finding & organizing." },
          ],
        },
        {
          id: "send-feedback", features: ["page:#/feedback"], page: "#/feedback",
          title: "Sending feedback",
          blocks: [
            { steps: [
              "Open [[#/feedback|Feedback]] from the navigation.",
              "Tell us what's working and what isn't — feedback goes straight to the people building the product.",
            ] },
          ],
        },
      ],
    },
  ];

  // ---- deep links: [[#/route|Label]] inside p/steps/tip. Rendered as normal accent
  // links; text around them stays fully escaped. Invalid-looking tokens render as text.
  const LINK_RE = /\[\[(#\/[a-z0-9/_-]+)\|([^\]]+)\]\]/g;
  function richText(text) {
    const t = App.relabelText(text);
    let html = "";
    let last = 0;
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(t))) {
      html += esc(t.slice(last, m.index));
      html += `<a href="${esc(m[1])}" class="learn-deep-link">${esc(m[2])}</a>`;
      last = m.index + m[0].length;
    }
    html += esc(t.slice(last));
    return html;
  }

  function renderBlock(b) {
    // feature-lc passage granularity: feature-tagged blocks render only when the
    // tag is ON; featureOff blocks are the soft alternates shown when it is OFF.
    if (b.feature && !featureOn(b.feature)) return "";
    if (b.featureOff && featureOn(b.featureOff)) return "";
    if (b.p) { const p = el("p", "learn-p"); p.innerHTML = richText(b.p); return p; }
    if (b.tip) { const d = el("div", "learn-tip"); d.innerHTML = `<strong>Tip:</strong> ${richText(b.tip)}`; return d; }
    // LC-2: VISUAL markers resolve through the scene registry — a single inert
    // themed figure, or the shared stepper for multi-frame sequences. An id missing
    // from the registry renders nothing (and fails selfTest_learningCenter2, so a
    // future guide edit can't dangle silently). { shot } is the retired ancestor.
    if (b.visual) {
      const scene = App.learnScenes && App.learnScenes.get(b.visual);
      if (!scene || !scene.frames || !scene.frames.length) return null;
      const frameEl = (f) => { const d = el("div", "scene-frame"); const inert = el("div", "scene-inert"); inert.setAttribute("aria-hidden", "true"); inert.innerHTML = f.html; d.appendChild(inert); return d; };
      const wrap = el("figure", "learn-scene");
      if (scene.frames.length === 1) {
        wrap.appendChild(frameEl(scene.frames[0]));
        if (scene.frames[0].caption) { const c = el("figcaption", "scene-caption", scene.frames[0].caption); wrap.appendChild(c); }
      } else {
        wrap.appendChild(App.ui.stepper(scene.frames.map((f) => ({ el: frameEl(f), caption: f.caption })), { label: "Illustration: " + (b.note || b.visual) }));
      }
      return wrap;
    }
    if (b.shot) return null;
    if (b.steps) {
      const ol = el("ol", "learn-steps");
      b.steps.forEach((s) => { const li = el("li"); li.innerHTML = richText(s); ol.appendChild(li); });
      return ol;
    }
    return null;
  }

  // searchable body text per guide (titles + every block's prose, links flattened)
  function guideBody(it) {
    const parts = [];
    (it.blocks || []).forEach((b) => {
      if (b.p) parts.push(b.p);
      if (b.tip) parts.push(b.tip);
      if (b.steps) parts.push(b.steps.join(" "));
    });
    return parts.join(" ").replace(LINK_RE, "$2").toLowerCase();
  }

  // ---- the feature-tag vocabulary + LIVE resolver (feature-lc batch) ----
  // Every tag maps to a REAL toggle surface; the validator makes an unknown
  // (e.g. renamed) tag FAIL the self-test rather than silently always-show.
  const KNOWN_FEATURE_TAGS = ["always", "receptionist", "sms", "google"];
  const KNOWN_FEATURE_PREFIXES = ["page:", "rt:", "view:", "calopt:"];
  function isKnownFeatureTag(t) {
    if (KNOWN_FEATURE_TAGS.indexOf(t) !== -1) return true;
    for (let i = 0; i < KNOWN_FEATURE_PREFIXES.length; i++) if (t.indexOf(KNOWN_FEATURE_PREFIXES[i]) === 0) return true;
    return false;
  }
  function validateGuideFeatureTags(guideCats) {
    const problems = [];
    (guideCats || []).forEach((g) => (g.items || []).forEach((it) => {
      if (!Array.isArray(it.features) || !it.features.length) problems.push(it.id + ': missing features tag (use ["always"] explicitly)');
      else it.features.forEach((t) => { if (!isKnownFeatureTag(t)) problems.push(it.id + ': unknown feature tag "' + t + '"'); });
    }));
    return problems;
  }
  // Live per-render state. Google needs the ONE lightweight lookup (it is not in
  // boot state); everything else reads what the SPA already loaded.
  let _googleConnected = null; // per page view only — reset on every render()
  const pageAvailable = (href) => !(App.isPageLocked && App.isPageLocked(href)) && !(App.navConfig && App.navConfig().hidden.indexOf(href) !== -1);
  const viewOnAnyModule = (v) => ((App.state && App.state.recordTypes) || []).some((t) => !(App.isRecordTypeLocked && App.isRecordTypeLocked(t.key)) && Array.isArray(t.enabledViews) && t.enabledViews.indexOf(v) !== -1);
  function featureOn(tag) {
    if (tag === "always") return true;
    if (tag === "receptionist") return !!(App.state && App.state.receptionistEnabled);
    if (tag === "sms") return !!(App.state && App.state.features && App.state.features.smsEnabled);
    if (tag === "google") return _googleConnected === true;
    if (tag.indexOf("page:") === 0) return pageAvailable(tag.slice(5));
    if (tag.indexOf("rt:") === 0) return !(App.isRecordTypeLocked && App.isRecordTypeLocked(tag.slice(3)));
    if (tag.indexOf("view:") === 0) return viewOnAnyModule(tag.slice(5));
    // Scheduling-calendar options (Scheduling Calendar batch): "calopt:scheduling"
    // is on when ANY non-locked module has lanes or the tray turned on — so the
    // dispatch guide appears once a workspace actually uses the capability.
    if (tag === "calopt:scheduling") {
      return ((App.state && App.state.recordTypes) || []).some((t) =>
        !(App.isRecordTypeLocked && App.isRecordTypeLocked(t.key)) && (t.calendarLanes === true || t.calendarTray === true));
    }
    if (tag.indexOf("calopt:") === 0) return false; // unknown calopt values stay hidden
    return false; // unknown tags NEVER silently show (the validator catches them in tests)
  }

  async function render(host) {
    // LIVE resolution inputs, fresh each view: the current module roster (for
    // view: tags) and the one lightweight google lookup (absent from boot state).
    _googleConnected = null;
    if (App.loadRecordTypes) { try { await App.loadRecordTypes(); } catch (e) { /* fallback kept */ } }
    try { const g = await App.portalApi("/api/google/status"); _googleConnected = !!(g && g.connected); } catch (e) { _googleConnected = false; }
    host.innerHTML = "";
    const wrap = el("div", "fade-in learn-wrap");
    const head = el("div", "learn-head");
    head.innerHTML = `<p class="cell-muted">Step-by-step guides for using ${esc(App.BRAND || "the app")}.</p>`;
    wrap.appendChild(head);

    const layout = el("div", "learn-layout");
    const nav = el("aside", "learn-nav");
    const content = el("div", "learn-content");
    layout.appendChild(nav);
    layout.appendChild(content);
    wrap.appendChild(layout);
    host.innerHTML = "";
    host.appendChild(wrap);

    // The LC search rides THE shared search box (icon + C mark) — no bespoke input.
    const search = el("input", "search-input learn-search");
    search.type = "search";
    search.placeholder = "Search guides…";
    nav.appendChild(App.util.searchBox(search));
    const navList = el("div", "learn-nav-list");
    nav.appendChild(navList);

    // Owner page-lock: hide guides for pages locked for this workspace — a locked page
    // must not appear (or be openable) here. A section/guide is hidden when its `page`
    // is locked, or (for cross-cutting guides) when EVERY page in its `pagesAll` is
    // locked. Sections with neither tag always show. Filtering runs at BOTH the
    // section and the individual-guide level.
    // FEATURE-AWARE (feature-lc batch): guides also carry features: [...] tags,
    // ANDed against the portal's LIVE toggle state (resolved fresh per render —
    // zero caching beyond this page view, zero migration: flip a toggle, reopen
    // the LC, and the list reflects it by construction).
    const blocked = (x) => {
      if (App.isPageLocked) {
        if (x.page && App.isPageLocked(x.page)) return true;
        if (x.pagesAll && x.pagesAll.length && x.pagesAll.every((h) => App.isPageLocked(h))) return true;
      }
      const tags = x.features || [];
      return !tags.every((t) => featureOn(t));
    };
    const guides = GUIDES
      .filter((g) => !blocked(g))
      .map((g) => Object.assign({}, g, { items: (g.items || []).filter((it) => !blocked(it)) }))
      .filter((g) => g.items.length);
    // precompute searchable bodies once
    guides.forEach((g) => g.items.forEach((it) => { it._body = guideBody(it); }));

    let currentId = guides[0] && guides[0].items[0] && guides[0].items[0].id;

    function showGuide(id) {
      // feature-lc: a deep link into a guide this portal has HIDDEN degrades to a
      // graceful note — never a 404, never a leak of the hidden content.
      const visible = guides.some((g) => g.items.some((it) => it.id === id));
      const existsAtAll = GUIDES.some((g) => (g.items || []).some((it) => it.id === id));
      if (!visible && existsAtAll) {
        currentId = null;
        paintNav();
        content.innerHTML = "";
        const note = el("div", "card learn-unavailable");
        note.appendChild(el("h2", null, "Not available in this portal"));
        note.appendChild(el("p", "cell-muted", "This guide covers a feature that isn't currently turned on for this workspace. If it gets enabled later, the guide appears here automatically."));
        content.appendChild(note);
        return;
      }
      let found = null, cat = null;
      guides.forEach((g) => g.items.forEach((it) => { if (it.id === id) { found = it; cat = g.cat; } }));
      if (!found) { content.innerHTML = `<div class="card"><p class="cell-muted">Pick a guide from the left.</p></div>`; return; }
      currentId = id;
      paintNav();
      const card = el("div", "card learn-article");
      card.appendChild(el("div", "learn-eyebrow", esc(App.relabelText(cat))));
      card.appendChild(el("h2", "learn-article-title", esc(App.relabelText(found.title))));
      (found.blocks || []).forEach((b) => { const node = renderBlock(b); if (node) card.appendChild(node); });
      content.innerHTML = "";
      content.appendChild(card);
      content.scrollTop = 0;
    }

    function paintNav() {
      // Search covers TITLES + section names + full BODY text (the rebuilt content).
      const term = (search.value || "").trim().toLowerCase();
      navList.innerHTML = "";
      guides.forEach((g) => {
        const items = g.items.filter((it) => !term || it.title.toLowerCase().includes(term) || g.cat.toLowerCase().includes(term) || (it._body && it._body.includes(term)));
        if (!items.length) return;
        navList.appendChild(el("div", "learn-cat", esc(App.relabelText(g.cat))));
        items.forEach((it) => {
          const b = el("button", "learn-link" + (it.id === currentId ? " active" : ""), esc(App.relabelText(it.title)));
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

  App.learn = { render, GUIDES, validateGuideFeatureTags, isKnownFeatureTag };
})(typeof window !== "undefined" ? window : globalThis);
