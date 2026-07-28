// Learning Center — categorized, step-by-step how-to guides (REBUILT, batch LC-1).
//
// AUDIENCE: written for the people using this tenant portal day to day. Guides describe
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
// (e.g. "Jobs" → "Projects") show the tenant portal's own words.
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
            { p: "Clarity's navigation has two parts, and the split is the key to the whole app. The LEFT navigation lists your MODULES — the kinds of data your business keeps, like [[#/contacts|Contacts]], [[#/jobs|Job Openings]], and [[#/bookings|Bookings]], plus any modules you create. Each item carries a small icon so you can spot it at a glance \u2014 icons stay put even when you rename things. Modules are highly configurable: their fields are grouped into sections, they offer custom views, and you can rename them to your own words." },
            { p: "Across the TOP run your PAGES — fixed-purpose screens that work WITH that data: [[#/dashboard|Home Dashboard]], [[#/calls|Calls]], [[#/reports|Analytics]], [[#/automations|Automations]], [[#/communication|Communication]], the Learning Center, and [[#/feedback|Feedback]]." },
            { steps: [
              "Left navigation = modules: one entry per kind of record. Yours may differ from a teammate's screenshots — modules are renameable and you can add your own.",
              "Top row = pages: the fixed tools. Their names don't change.",
              "The top bar also shows small colored presence dots for teammates who are online — hover one to see who it is.",
              "Click the logo in the top-left corner at any time to return to your [[#/dashboard|Home Dashboard]].",
            ] },
            { tip: "If something named in a guide isn't in your navigation, it may be turned off for your portal or your role — ask whoever manages your account." },
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
          id: "search", features: ["always"],
          title: "Finding anything: the search box",
          blocks: [
            { p: "The search box sits at the top of every screen, between your page tabs and the bell. It looks through what is actually inside your data \u2014 not just names. A phrase typed into a work order's notes, a caller's own words in a call transcript, a customer's email address, a sentence from one of these guides: all of it is searchable." },
            { p: "Press Ctrl-K (Cmd-K on a Mac) from anywhere to jump straight into it, start typing, and results appear as you go. Two letters is enough to begin." },
            { steps: [
              "Type at least two characters \u2014 results appear grouped by what they are: each module, then Contacts, then Calls, then Guides.",
              "Use the arrow keys to move through the results and Enter to open one, or just click it.",
              "Press Escape to close the results and carry on with what you were doing.",
            ] },
            { p: "It reaches further than records: automations by name or by the words inside their steps, email templates and surveys by their wording, dashboards by name, and the settings pages themselves \u2014 type \u201cscheduling\u201d or \u201cteam\u201d and jump straight there." },
            { p: "Each result shows the sentence it matched, with your words picked out, so you can tell two similar-looking results apart before you open either." },
            { p: "If there is more than a handful, open the full results page from the bottom of the box: the same matches, filterable by kind, with more loaded as you need them." },
            { p: "Click into the empty search box and it offers what you searched for recently in this portal \u2014 click one to run it again, or Clear to forget them. Those are yours alone, and each portal keeps its own." },
            { p: "Results only ever include things you can already open. If a module is switched off for your portal, or a page is closed to your role, nothing from it appears here \u2014 search never becomes a side door." },
            { tip: "A distinctive phrase works better than a common word: several words from the thing you remember will find the one you mean, where a single ordinary word may find dozens." },
          ],
        },
        {
          id: "suggestions", features: ["always"],
          title: "Suggestions: what Clarity notices",
          blocks: [
            { p: "Every night, Clarity looks over your own data — nothing else — for patterns worth mentioning: the same wording typed into records again and again, a step you keep doing by hand, a module nobody has touched in months, a status where work sits far longer than anywhere else. What it finds appears under SUGGESTIONS in the bell." },
            { p: "It never changes anything on its own. A suggestion is a proposal with a button; until you press that button, nothing in your portal moves." },
            { steps: [
              "Open the bell and switch to the Suggestions tab.",
              "Each card says what it noticed, and — in plain numbers — what it looked at, so you can judge it: \u201cBased on 14 work orders in the last 30 days.\u201d",
              "Press the button to accept it and the change happens exactly as if you'd made it yourself: a new field appears in Modules & Fields, an automation arrives as a switched-OFF draft for you to read, a module tucks itself out of the nav. Nothing is deleted when a module is tucked away \u2014 its records are kept, and whoever manages your account can switch it back on.",
              "Press Dismiss if it's not for you. You get an Undo for a moment, and every dismissed suggestion stays listed in your settings — nothing is ever hidden from you quietly.",
            ] },
            { p: "Suggestions wait until you deal with them, then step aside. A dismissed one stays away for a couple of months before it can come back, and only if the pattern is still true." },
            { p: "You control all of it in [[#/settings/account|Settings \u2192 Your account]]: one switch turns suggestions off entirely, and each kind can be turned off on its own. Each one also tells you how much evidence it needs before it will speak at all." },
            { tip: "Clarity only proposes things it can do through the ordinary screens \u2014 which is why accepting one is exactly the same as doing it by hand, permissions and all. If you couldn't make a change yourself, you won't be shown a suggestion to make it." },
          ],
        },
        {
          id: "notifications", features: ["always"],
          title: "The bell: what Clarity tells you",
          blocks: [
            { p: "The bell at the top right is how your portal gets your attention. A number on it means there's something you haven't looked at; no number means nothing new." },
            { steps: [
              "Click the bell to open the panel. ACTIVITY lists what's happened — a lead arriving, a booking made or cancelled, an import finishing, a reply on your feedback.",
              "Click any line to jump straight to the thing it's about; that also marks it read.",
              "MARK ALL READ clears the count in one go. SEE ALL opens the full history, where you can filter by kind, show only unread, and search.",
              "The SUGGESTIONS tab is where Clarity will start proposing things worth doing as it notices patterns. It's empty for now, and it will say so honestly.",
            ] },
            { p: "Read state is yours alone: marking something read never marks it read for anybody else on your team." },
            { p: "A few things are urgent enough to pop up a small message as well as the badge \u2014 a new lead, a cancellation, a problem with an automation, a missed call. Everything else waits quietly on the bell." },
            { p: "You decide all of it in [[#/settings/account|Settings \u2192 Your account]]: each kind of notification has a switch for whether you're told at all, and the urgent ones have a second switch for whether they pop up." },
            { tip: "Notifications never carry the contents of a message or a call \u2014 just enough to say what happened. The link takes you to the real thing, where your usual permissions apply." },
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
            { tip: "This section is available to owner/admin roles. If you can't see it, ask an owner or admin here." },
          ],
        },
        {
          id: "service-request-intake", features: ["receptionist", "rt:work_order"],
          title: "Callers with a problem become work orders",
          blocks: [
            { p: "When a caller describes a problem that needs someone out \u2014 \u201cmy AC stopped cooling\u201d \u2014 without booking a time, the receptionist gathers the essentials (what\u2019s wrong, where, how urgent) and, when the call ends, files it as a dateless work order in your dispatch tray, linked to the caller. Nothing is created mid-call, and the receptionist never promises an arrival time or price \u2014 dispatch stays your team\u2019s call." },
            { steps: [
              "Open the record from the tray: the problem is the title, the caller\u2019s words are the description, and urgency set the priority.",
              "The record\u2019s Activity notes who created it \u2014 \u201cCreated by the AI receptionist from a phone call\u201d \u2014 and the call\u2019s own page shows the captured request.",
              "Turn this on or off under [[#/settings/aireceptionist|Settings \u2192 AI Receptionist]] \u2192 AI can create. A caller who lands on a real time slot gets a scheduled visit instead \u2014 one artifact per call, never both.",
              "Under the same card, Schedules into decides WHERE timed visits land: Bookings (the default), straight into Work Orders \u2014 dated, with a technician, honestly blocking that tech's other openings \u2014 or Nothing, for a receptionist that only takes messages and requests. The visit length it blocks is set on [[#/settings/scheduling|Settings \u2192 Scheduling & Resources]]. One honest note: the Google Calendar sync pushes bookings only, so visits scheduled into Work Orders don\u2019t sync out.",
            ] },
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
              "Fields come in types — text, number, percent, date, progress, line items, and more; you choose them in [[#/settings/fields|Settings → Modules & Fields]].",
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
              "List — the classic table: sort, filter, and manage columns. However you arrange it is remembered for you, on any device.",
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
        {
          // Estimates Lifecycle batch. Copy avoids live seeded field labels
          // (e.g. the expiry-date field's name) per the LC-3 scan; "line items"
          // is the built-in field TYPE name and is allowlisted as such.
          id: "estimates-lifecycle", features: ["rt:estimate"],
          title: "From estimate to job",
          blocks: [
            { p: "An estimate can go straight to the customer: open it and tap Send to customer. That creates a private online page \u2014 no sign-in needed \u2014 showing your business name and logo, the line items, the amount, and any note, with Accept and Decline buttons and room for a short comment. You can email the link in one tap or copy it and send it however you like." },
            { steps: [
              "Building the line items is quicker now: with a price list kept in your catalog module, typing in a row\u2019s description searches it \u2014 pick an entry and its wording and price drop in, ready to adjust. Typed-by-hand rows work exactly as before.",
              "Sending stamps how long the page stays open (30 days unless the estimate\u2019s expiry-date field already says otherwise) and marks it Sent.",
              "The estimate\u2019s page in Clarity shows where things stand: not viewed yet, viewed, the customer\u2019s decision with their comment, or link expired.",
              "The decision writes itself onto the estimate and the customer\u2019s timeline the moment it happens \u2014 and the [[#/automations|Automations]] library has an opt-in recipe that emails you the outcome instantly.",
              "Once accepted, a Convert button creates the work order (customer, notes, and address carried over) and, if you leave the box ticked, an invoice with the billed lines \u2014 once only, never duplicated.",
              "Re-sending replaces the old link, and a decided or expired page becomes read-only on its own.",
            ] },
            { tip: "Honesty note: collecting payment isn\u2019t part of this yet \u2014 the page shows amounts and takes a decision, nothing more. Invoicing is created for you; getting paid still happens wherever it happens today." },
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
            { p: "[[#/reports|Analytics]] holds as many dashboards as you like; your [[#/dashboard|Home Dashboard]] is the one that greets you on sign-in. Both are built from the same widgets. Some portals come with a few dashboards already set up — they're ordinary dashboards, yours to edit, rearrange, or delete like any you'd build yourself." },
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
              "Open the preset library on [[#/automations|Automations]] — recipes are grouped by category, with the ones most relevant to how you work sorted toward the top.",
              "Pick one to load it pre-built, adjust the details, and enable it.",
            ] },
            { tip: "Presets that include a text-message step are hidden while texting is turned off for your portal." },
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
            { featureOff: "sms", tip: "Texting is currently off for your portal, so the text-based recipes are hidden. The email ones (the instant acknowledgment and the review ask) work today." },
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
            { p: "A work order is a visit-ready job for your field team: what needs doing, where, and who's going. Open [[#/records/work_order|Work Orders]] to see them all — each one moves through its statuses from first request to done, and can be typed when you create it (both the types and the statuses are yours to rename in [[#/settings/fields|Settings → Modules & Fields]]). The page shows off out of the box: switch views with the tabs on the list page — List, a Board (one column per status; drag a card to update it, with an Undo on the confirmation), a Calendar, and a Map — and each optional view can be switched off on the module's Views tile. On a work order's page, open Related and use the Serviced equipment tab to link the unit you serviced — the unit's own Related section then carries its full Service history, newest visit first, with each visit's status and date at a glance. And with the receptionist on, callers who describe a problem needing service arrive here on their own — as dateless records in the dispatch tray." },
            { p: "Real jobs sometimes take more than one trip — diagnose, wait on parts, come back and install. A work order can carry several VISITS for exactly that: press + Add visit on the job's page and a Visits list appears, each visit with its own window, its own technician, and its own Schedule, Complete, and Cancel. The date boxes at the top always edit the job's ACTIVE visit (the next one coming up), the calendar draws one block per scheduled visit (labeled \u201cvisit 2 of 3\u201d so nobody double-reads them), and finishing a visit never closes the job — the status stays yours. A one-visit job looks and works exactly as it always has." },
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
            { p: "Two options on a module's Views tile turn its calendar into a dispatch board. LANES splits the day into one column per staff member. The TRAY is a sidebar of the module's records that have no date yet, so brand-new work is visible instead of invisible. Both live in [[#/settings/fields|Settings → Modules & Fields]] under the Calendar tile — on from the start for Work Orders, off until you choose them everywhere else. For work orders with several visits, every scheduled visit gets its own block (labeled with its ordinal), each drags independently, and a job stays in the tray as long as ANY visit still needs a date — dragging its tray card schedules the oldest waiting visit." },
            { steps: [
              "Open the module's Calendar tab on its list page — lanes and the tray live inside the calendar's day and week layouts.",
              "Drag a tray record onto the grid to give it a time — drop it inside a staff column to hand it to that person in the same motion.",
              "Drag a block up or down to change its time, or into another column to hand it to someone else. Everything snaps to a tidy 15 minutes.",
              "Use Undo on the confirmation message if a drop landed wrong.",
              "With lanes on, time a staff member is taken by the OTHER schedule (their bookings here, their field work on the booking page) appears as shaded blocks you can't touch — so nothing gets dropped into a gap that only looks free.",
            ] },
            { tip: "A drag saves through exactly the same path as editing the record by hand, so permissions, history, and automations behave identically — and teammates with view-only access simply don't get drag handles." },
          ],
        },
        {
          // Recurring Work batch. Copy avoids every seeded stage/subtype/field
          // label as a substring (LC-3) — including the seeded work-type word
          // this guide is conceptually about, hence "repeat plans" throughout.
          id: "repeat-plans", features: ["rt:work_order"],
          title: "Work that comes back",
          blocks: [
            { p: "Some work isn\u2019t one-and-done \u2014 the same visit, every month or every quarter, for years. Open a work order and give it a repeat plan in its Repeats card: how often (every N days, weeks, or months), optionally pinned to a weekday, optionally ending on a date. The plain-language line under the controls always tells you exactly what you\u2019ve set." },
            { steps: [
              "When a visit that carries a plan is marked done, the next one appears on its own: a fresh work order, no date yet, straight into the calendar\u2019s tray for the dispatcher to place.",
              "What carries over: the title, the work type, the write-up, the address, the customer, and the plan itself. What never does: old pictures, old notes, the previously assigned staff member, or dates \u2014 every visit starts clean.",
              "The new visit is an ordinary work order \u2014 drag it from the tray, assign it, message the customer about it; everything works exactly as usual.",
              "Records that are part of a plan show a small \u21BB next to their name in lists and the tray.",
              "Calling a visit off ends its plan \u2014 nothing more spawns. Setting an end date does the same, politely, when the date passes.",
            ] },
            { tip: "The [[#/automations|Automations]] library has an opt-in recipe that emails the business the moment a plan drops its next visit into the tray." },
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
      cat: "Customizing your portal",
      items: [
        {
          id: "modules-fields", features: ["always"],
          title: "Modules & Fields",
          blocks: [
            { p: "[[#/settings/fields|Settings → Modules & Fields]] is where your portal takes shape: create modules, add fields of any type, adjust each module's Terms (the words it uses) and which of the five views it offers." },
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
              "Owners can also hide pages a portal doesn't use; hidden pages leave the navigation entirely.",
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
            { p: "[[#/settings/integrations|Settings → Integrations]] shows the connection status of the services your portal uses: phone/text (Twilio), AI (OpenAI), Google Calendar, and maps (Mapbox)." },
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

  // ======================= PER-TEMPLATE LC VARIANTS =======================
  // (lc-field-services batch) A VARIANT re-organizes the tree for a template.
  // Variants are code-shipped data like GUIDES. ONE SOURCE OF TRUTH per guide
  // body: a variant item is either { ref: "<stock-id>" } — resolved to the
  // SAME stock guide object (placement/order owned by the variant, body owned
  // by stock) — or a full variant-only guide (fs-* ids, registered below in
  // FS_GUIDES). Which variant applies is decided by THE SERVER (the flag
  // contract in /api/auth/me -> features.lcVariant); the client only reads it.
  // No variant -> activeGuides() returns the GUIDES array ITSELF (reference
  // equality = byte-identical stock, provable).
  const FS_GUIDES = {}; // id -> variant-only guide (assigned below)
  const RM_GUIDES = {}; // RM-3: the recruitment-marketing variant's own guides
  // Every variant map, in one place: assembly + deep-link resolution read this
  // list, so a future variant is one entry — no new machinery.
  const VARIANT_GUIDE_MAPS = [FS_GUIDES, RM_GUIDES];
  function variantGuideById(id) {
    for (const m of VARIANT_GUIDE_MAPS) { if (m[id]) return m[id]; }
    return null;
  }
  // -------- FS variant guides, part 1: getting started + your modules --------
  // Voice rule everywhere: tenant-facing, field-service vocabulary; never the
  // hub, templates, or platform administration. Bodies live HERE only (stock
  // guides are referenced, never copied).
  FS_GUIDES["fs-home-dashboard"] = {
    id: "fs-home-dashboard", features: ["page:#/dashboard"],
    title: "Your Home Dashboard: the four tiles",
    blocks: [
      { p: "Your [[#/dashboard|Home Dashboard]] starts with four widgets built for a service business. They're ordinary widgets — edit, rearrange, or remove any of them, and add your own." },
      { steps: [
        "NEW REQUESTS counts work orders still waiting to be scheduled — your dispatch inbox at a glance.",
        "TODAY'S SCHEDULE lists every visit booked for today: the job, its time, and who's assigned.",
        "JOBS BY STATUS shows where all your work sits — new, scheduled, in progress, completed.",
        "INVOICED (LAST 30 DAYS) totals what you've billed this month, straight from your invoices' totals.",
      ] },
      { tip: "Press Add widget to build more — the Analytics section's \"Building a widget\" guide covers every option." },
      { visual: "home-dashboard", note: "faithful mini Home Dashboard: reports bar + widget grid" },
    ],
  };
  FS_GUIDES["fs-contacts"] = {
    id: "fs-contacts", features: ["always"],
    title: "Contacts: the customers you serve",
    blocks: [
      { p: "[[#/contacts|Contacts]] holds every customer — name, phone, email, and address. Everything else in your portal hangs off a customer: their work orders, equipment, estimates, and invoices all LINK back to the contact, so one open record shows the whole relationship." },
      { steps: [
        "Open [[#/contacts|Contacts]] and press Create to add a customer; the phone number matters most — it's how calls match to the right person.",
        "Open any customer and scroll to Related: their equipment, jobs, and paperwork, each under its own tab.",
        "Use the view switcher for a table, board, or map of your customers.",
      ] },
      { visual: "related-tabs", note: "a customer record's Related tabs" },
    ],
  };
  FS_GUIDES["fs-work-orders"] = {
    id: "fs-work-orders", features: ["rt:work_order"],
    title: "Work Orders: the jobs themselves",
    blocks: [
      { p: "A [[#/records/work_order|Work Order]] is one job at one place: what's wrong, what kind of visit it is, when it's scheduled, and who's going. Its STATUS carries it from new request through scheduled, in progress, and completed — the same statuses your dashboard and board views read." },
      { p: "Jobs that take more than one trip carry several VISITS: + Add visit on the job's page lists each trip with its own window, tech, and Schedule / Complete / Cancel. The top date boxes always edit the ACTIVE visit, the dispatch calendar draws one block per scheduled visit (\u201cvisit 2 of 3\u201d), and completing a visit never completes the job — the status stays in your hands." },
      { steps: [
        "Key fields: the title (what the customer asked for), the appointment, the assigned tech, and the job type.",
        "A work order with no appointment yet sits in NEW REQUEST — that's your to-be-scheduled tray.",
        "Switch views: List for the full table, Kanban to drag jobs between statuses, Calendar to see the week.",
        "Open a work order's Related tabs for the customer, their equipment, and any tasks on the job.",
      ] },
      { visual: "views-switcher", note: "the same record list, five ways" },
    ],
  };
  FS_GUIDES["fs-equipment"] = {
    id: "fs-equipment", features: ["rt:equipment"],
    title: "Equipment: what you service at each address",
    blocks: [
      { p: "[[#/records/equipment|Equipment]] tracks the machines you look after — a furnace, a water heater, a rooftop unit. Link each piece to its customer, and its service history builds itself: every job on that unit shows in its Related tabs." },
      { steps: [
        "Key fields: type, brand and model, serial number, install date, and the service dates.",
        "NEXT SERVICE DUE is the useful one — an automation can watch it and remind you (or the customer) before it comes up.",
        "From a customer's record, the equipment at their address lives under its own Related tab.",
      ] },
      { visual: "related-tabs", note: "equipment under a customer's Related tabs" },
    ],
  };
  FS_GUIDES["fs-estimates"] = {
    id: "fs-estimates", features: ["rt:estimate"],
    title: "Estimates: quoting the job",
    blocks: [
      { p: "An [[#/records/estimate|Estimate]] is your quote: line items priced from your [[#/records/product|Products]] catalog, a total that computes itself, a Status (Draft, Sent, Accepted, Declined, Expired), and a 'Valid until' date so old quotes don't linger." },
      { steps: [
        "Build the line items — pick from your catalog or type one-offs; the Total updates as you go.",
        "Send it: the customer gets a clean page where they can accept with one click.",
        "Acceptance flips the Status for you. The \"From estimate to invoice\" workflow guide picks it up from there.",
      ] },
      { visual: "record-drawer", note: "a record's grouped field panel" },
    ],
  };
  FS_GUIDES["fs-invoices"] = {
    id: "fs-invoices", features: ["rt:invoice"],
    title: "Invoices: getting paid",
    blocks: [
      { p: "An [[#/records/invoice|Invoice]] mirrors the estimate's shape — line items, an auto-computed Total — plus the dates that matter for money: Invoice date, Due date, and Paid date. Your dashboard's Invoiced tile and the Revenue analytics read straight from these." },
      { steps: [
        "Key fields: line items, Total, Status, Due date, Paid date, and how they paid.",
        "Marking an invoice paid fills the Paid date — that's the field your reports and reminders trust.",
        "The automation library has a ready-made \"Invoice unpaid\" reminder that nudges you a few days past due.",
      ] },
      { visual: "record-drawer", note: "a record's grouped field panel" },
    ],
  };
  FS_GUIDES["fs-products"] = {
    id: "fs-products", features: ["rt:product"],
    title: "Products: your price book",
    blocks: [
      { p: "[[#/records/product|Products]] is your catalog — the services and parts you sell, each with a price and description. Estimates and invoices pull their line items from here, so a price change in one place flows into every new quote." },
      { steps: [
        "Add each service you offer as a product with its standard price.",
        "When building an estimate or invoice, pick from the catalog — the description and price fill in; adjust freely per job (your catalog copy never changes).",
      ] },
      { visual: "record-drawer", note: "a record's grouped field panel" },
    ],
  };
  // -------- FS variant guides, part 2: workflows --------
  FS_GUIDES["fs-dispatch-day"] = {
    id: "fs-dispatch-day", features: ["rt:work_order"],
    title: "A day of dispatch: tray to done",
    blocks: [
      { p: "Dispatch is one motion, repeated: a request lands, you drag it onto a tech's day, the customer hears you're coming, and the job rolls to done. The calendar's per-tech lanes plus the Unscheduled tray make it a drag-and-drop. Multi-visit jobs play the same game: each scheduled visit is its own block (labeled \u201cvisit 2 of 3\u201d) you can drag on its own, and the job waits in the tray while any visit still needs a date." },
      { steps: [
        "New requests (calls the receptionist captured, or ones you add) sit in the UNSCHEDULED tray beside the calendar.",
        "Drag a request onto a tech's lane at a time — one move schedules it and assigns them.",
        "An automation can text the customer an on-my-way note when the visit starts (see the library's customer-update recipes).",
        "When the work's done, drag the job to Completed on the board — your dashboard and reports update themselves.",
      ] },
      { tip: "Don't see lanes on your calendar? Turn on scheduling display in the calendar's options (an owner/admin setting)." },
      { visual: "dispatch-lanes", note: "stepper: tray \u2192 drag to a lane \u2192 on-my-way \u2192 completed" },
    ],
  };
  FS_GUIDES["fs-estimate-to-invoice"] = {
    id: "fs-estimate-to-invoice", features: ["rt:estimate", "rt:invoice"],
    title: "From estimate to invoice",
    blocks: [
      { p: "Money follows one path: quote it, they accept, you do the work, you bill it. Each step is a record that links to the next, so the paper trail builds itself." },
      { steps: [
        "Build the [[#/records/estimate|estimate]] from your price book and send it — the customer gets a page with the line items, the total, and an Accept button.",
        "Acceptance flips the estimate's Status to Accepted (declines and expiries are honest too — 'Valid until' keeps quotes from living forever).",
        "Convert the accepted estimate to an [[#/records/invoice|invoice]] — the line items carry over.",
        "When they pay, mark it paid: the Paid date fills, and that's the field your Revenue analytics and the unpaid-reminder automation both trust.",
      ] },
      { visual: "estimate-public", note: "the customer's accept page" },
    ],
  };
  FS_GUIDES["fs-maintenance-plans"] = {
    id: "fs-maintenance-plans", features: ["rt:work_order"],
    title: "Maintenance plans: work that repeats",
    blocks: [
      { p: "Seasonal tune-ups and service contracts are the same job on a rhythm. Put a REPEAT PLAN on the work order and Clarity spawns the next visit on schedule — each one an ordinary work order that lands in your tray to be dispatched." },
      { steps: [
        "Open a work order and set its repeat rule — every month, every spring, whatever the contract says.",
        "Spawned visits arrive as new requests (marked with the repeat sign), ready to drag onto a lane.",
        "End the plan any time; what's already spawned stays put.",
      ] },
      { tip: "The stock \"Repeat plans\" guide under Scheduling & team goes deeper on the rules." },
      { visual: "kanban-drag", note: "spawned visits ride the same board as everything else" },
    ],
  };
  FS_GUIDES["fs-phone-rings"] = {
    id: "fs-phone-rings", features: ["receptionist", "rt:work_order"],
    title: "When the phone rings",
    blocks: [
      { p: "Your receptionist answers, finds out what's wrong, and writes it down as work: the caller becomes (or matches) a [[#/contacts|contact]], and their problem becomes a [[#/records/work_order|work order]] in your Unscheduled tray — with the call transcript a click away." },
      { steps: [
        "Every call lands in [[#/calls|Calls]] with its transcript and outcome.",
        "A problem call creates a work order titled with what the caller described, linked to their contact record.",
        "If you've pointed scheduling at your calendar, the receptionist can book the visit too — otherwise it stays a new request for you to dispatch.",
        "Tune what it says and captures under Settings \u2192 AI Receptionist (the \"Configuring your receptionist\" guide walks through it).",
      ] },
      { visual: "automation-flow", note: "a call flowing into records" },
    ],
  };
  FS_GUIDES["fs-tasks"] = {
    id: "fs-tasks", features: ["rt:task"],
    title: "Tasks: the punch list",
    blocks: [
      { p: "[[#/records/task|Tasks]] are the small to-dos that orbit a job — pick up the part, call the customer back, pull the permit. Give each a due date and link it to its work order so nothing rides in anyone's head." },
      { steps: [
        "Create a task with a title and due date; link it to the job it belongs to.",
        "Work the board view like a punch list — drag tasks across statuses as they get done.",
        "A task's due date can drive reminders, the same as any date field.",
      ] },
      { visual: "kanban-drag", note: "dragging a card across a board" },
    ],
  };
  // ===== RM-3: the RECRUITMENT MARKETING variant's own guides =====
  // Voice: candidates, sources, campaigns, interviews, clients. Content is
  // GENERIC + structural — it describes what the tenant portal ships with, never a
  // tenant's own seeded values (the seeded-data scan), and never mentions
  // templates, other tenants, or administration of the platform.
  RM_GUIDES["rm-home-dashboard"] = {
    id: "rm-home-dashboard", features: ["page:#/dashboard"],
    title: "Your Home Dashboard: the recruiting numbers",
    blocks: [
      { p: "Your [[#/dashboard|Home Dashboard]] opens with a set of widgets built for recruitment marketing. They're ordinary widgets \u2014 edit them, rearrange them, remove any you don't want, and add your own." },
      { steps: [
        "NEW CANDIDATES counts the people who arrived in the last week \u2014 your top of funnel at a glance.",
        "CANDIDATES BY SOURCE is the one to watch: it splits those arrivals by where they came from, so you can see which ads and boards are actually working.",
        "INTERVIEWS counts the interviews on the calendar for the same window.",
        "PIPELINE SNAPSHOT breaks your candidates down by the stage they're sitting in.",
        "HIRED counts the candidates who made it all the way through.",
      ] },
      { tip: "Every tile is editable: open the widget's menu to change what it counts, or press Add widget to build another. The Analytics section's \"Building a widget\" guide covers every option." },
      { visual: "home-dashboard", note: "faithful mini Home Dashboard: reports bar + widget grid" },
    ],
  };
  RM_GUIDES["rm-candidates"] = {
    id: "rm-candidates", features: ["always"],
    title: "Candidates: everyone in your funnel",
    blocks: [
      { p: "[[#/contacts|Candidates]] holds every person who has raised a hand \u2014 from the first ad click to a hire. Each one carries the usual name, phone, and email, plus the recruiting fields your portal starts with." },
      { steps: [
        "CANDIDATE SOURCE records where they came from (an ad channel, a job board, a referral, or organic). It's what the source widgets and reports count.",
        "ROLE INTEREST is the job they're asking about, in their words or yours.",
        "CANDIDATE STAGE is the funnel itself \u2014 a new lead becomes contacted, prescreened, interview scheduled, interviewed, submitted to client, and finally hired (or not a fit). Move a candidate along by changing this field.",
        "PRESCREEN CHECKS is a tick-list for the things you verify before submitting anyone \u2014 licence, work eligibility, experience, availability, background.",
        "RESUME LINK and LINKEDIN URL keep their documents one click away.",
        "DESIRED PAY and AVAILABILITY DATE are the two answers a client always asks for.",
      ] },
      { p: "Open any candidate to edit these; use the view switcher on the list for a table, a board grouped by stage, or a map. Every field is yours \u2014 rename them, add your own, or remove what you don't use in [[#/settings/fields|Settings \u2192 Modules & Fields]]." },
      { visual: "rm-candidate-stages", note: "the candidate list: view switcher + a stage column" },
      { tip: "Their Related section gathers everything attached to that person \u2014 interviews, notes, and files \u2014 in one place." },
    ],
  };
  RM_GUIDES["rm-job-openings"] = {
    id: "rm-job-openings", features: ["rt:job"],
    title: "Job Openings: the roles you're marketing",
    blocks: [
      { p: "[[#/jobs|Job Openings]] is one record per role you're advertising \u2014 what it is, who it's for, and what it pays. Keeping them here means every candidate conversation has something to point at." },
      { steps: [
        "DEPARTMENT and LOCATION place the role; WORK MODE says on-site, remote, or hybrid.",
        "EMPLOYMENT TYPE covers full-time, part-time, contract, or temp.",
        "PAY RANGE and OPENINGS COUNT are the two numbers candidates and clients both ask about.",
        "CLIENT OR HIRING MANAGER records who you're filling it for.",
        "AD CAMPAIGN ties the role to the campaign that's promoting it \u2014 so when a source looks strong, you know which role it fed.",
        "TARGET START is the date the client wants somebody in the seat.",
      ] },
      { p: "Job Openings carry a pipeline of their own, so a role moves through its stages as you work it. Use the board view to see every open role side by side." },
      { visual: "views-switcher", note: "the list views: table, board, and the rest" },
    ],
  };
  RM_GUIDES["rm-interviews"] = {
    id: "rm-interviews", features: ["rt:booking"],
    title: "Interviews: the appointments themselves",
    blocks: [
      { p: "[[#/bookings|Interviews]] is your appointment book. Each interview holds who it's with, when it is, and which of your interviewers is taking it \u2014 and it's the module your receptionist books into when a candidate calls." },
      { steps: [
        "Press Create on [[#/bookings|Interviews]] to add one by hand: pick the candidate, the time, and the interviewer.",
        "Add your interviewers in [[#/settings/scheduling|Settings \u2192 Scheduling & Resources]] \u2014 each one gets their own availability, and the calendar keeps their day straight.",
        "Open the Calendar view to see the week; drag an interview to move it, and it's rescheduled.",
        "An interview's STATUS carries it from requested to confirmed, completed, no-show, or cancelled \u2014 which is what the interview reports count.",
      ] },
      { p: "Your business hours (also in [[#/settings/scheduling|Settings \u2192 Scheduling & Resources]]) decide when interviews can be offered at all, so nobody gets booked at 10pm." },
      { visual: "calendar-mapping", note: "a module's calendar view, mapped to its date field" },
    ],
  };

  RM_GUIDES["rm-ad-to-candidate"] = {
    id: "rm-ad-to-candidate", features: ["always"],
    title: "From ad click to candidate",
    blocks: [
      { p: "This is the front door. Someone sees your ad, clicks it, lands on a form, and fills it in \u2014 and a candidate appears in your portal, already tagged with where they came from. Nobody retypes anything." },
      { steps: [
        "Open [[#/settings/leadcapture|Settings \u2192 Lead capture]] and create a link. That's the form your landing page points at (share the link, or embed it).",
        "Map the form's fields to your candidate fields \u2014 the answer about where they heard about you maps to Candidate source, so every arrival is labelled automatically.",
        "Use one link per campaign when you want clean numbers: the source that comes in on each submission is exactly what your source widgets and reports count.",
        "Submissions land in [[#/contacts|Candidates]] as new records, ready to work \u2014 stage New lead, source filled in.",
        "From there the nurture takes over: a welcome goes out, and the candidate moves along the funnel as you talk to them.",
      ] },
      { visual: "rm-ad-to-candidate", note: "the journey: form \u2192 captured candidate \u2192 tagged by source \u2192 nurture" },
      { visual: "rm-lead-capture-links", note: "the lead-capture settings page: one card per link" },
      { tip: "Callers arrive the same way: your receptionist captures the person and the role they're asking about, and books the interview \u2014 same funnel, different door." },
    ],
  };
  RM_GUIDES["rm-nurturing"] = {
    id: "rm-nurturing", features: ["page:#/automations"],
    title: "Nurturing candidates automatically",
    blocks: [
      { p: "[[#/automations|Automations]] does the chasing you'd otherwise do by hand. Your portal starts with a shelf of recruiting recipes in the library \u2014 ready to use, and switched OFF until you say so." },
      { steps: [
        "Open [[#/automations|Automations]] and browse the library. The recruiting recipes sit at the top: a welcome for every new candidate, interview reminders, a nudge when somebody's gone quiet, an alert when a candidate is submitted to a client, and a post-interview follow-up.",
        "Press Use on one and it's added to your flows as a DRAFT \u2014 disabled, doing nothing.",
        "Open the draft and read it: the trigger (what starts it), any conditions (who it applies to), and the actions (what it sends). Change the wording to sound like you.",
        "When you're happy, switch it on. Turn it off any time \u2014 nothing about it is permanent.",
      ] },
      { p: "The recipes are ordinary flows, not special ones: anything they do you can build yourself, and anything you don't like you can delete." },
      { visual: "preset-library", note: "the automation library: recipe cards you can add" },
      { tip: "Texts need a phone number connected and emails need your email service connected; until then a switched-on flow simply skips those sends and says so in its run history." },
    ],
  };
  RM_GUIDES["rm-booking-interviews"] = {
    id: "rm-booking-interviews", features: ["page:#/calls"],
    title: "Booking interviews",
    blocks: [
      { p: "When a candidate calls, your receptionist can book the interview itself \u2014 straight into [[#/bookings|Interviews]], on a real slot, with a real interviewer." },
      { steps: [
        "Add your interviewers in [[#/settings/scheduling|Settings \u2192 Scheduling & Resources]] and set each one's availability; set your business hours in the same place.",
        "The receptionist offers only times that are actually free: hours, the interviewer's own availability, and anything already on the calendar all narrow what it can say.",
        "A booked interview appears on the Interviews calendar immediately, with the candidate attached.",
        "Add the interview-reminder recipes from the library if you want the day-before and hour-before texts to go out on their own.",
        "If a candidate needs to move, drag the interview on the calendar \u2014 the record follows.",
      ] },
      { visual: "calendar-mapping", note: "the calendar view interviews land on" },
      { tip: "Interview statuses (confirmed, completed, no-show, cancelled) are what the interview reports count \u2014 keeping them current keeps your numbers honest." },
    ],
  };
  RM_GUIDES["rm-client-reporting"] = {
    id: "rm-client-reporting", features: ["page:#/reports"],
    title: "Reporting to your client",
    blocks: [
      { p: "[[#/reports|Analytics]] is where you answer the two questions clients ask: how's the pipeline, and where are these people coming from? Your portal starts with dashboards for both." },
      { steps: [
        "CANDIDATE PIPELINE shows the funnel \u2014 how candidates are spread across the stages, how many arrive each week, and how the stages fill over time.",
        "WHERE CANDIDATES COME FROM breaks arrivals down by source, over time and as a share, with a grid that crosses source against stage \u2014 so you can see not just which channel sends the most people, but which sends the ones who get hired.",
        "HIRES BY SOURCE is the ad-ROI view: spend follows the sources that actually produce hires.",
        "INTERVIEWS & CALLS tracks interviews booked per week alongside your call volume, plus cancellations and no-shows.",
      ] },
      { p: "Moving a candidate to SUBMITTED TO CLIENT is what makes your submission numbers real \u2014 the stage is the record of what you sent them, and an automation recipe can alert you the moment it happens." },
      { visual: "widget-wizard", note: "the widget editor behind every tile" },
      { tip: "Every dashboard is yours: change a widget, add your own, or build a fresh dashboard for a single client." },
    ],
  };
  RM_GUIDES["rm-receptionist-knowledge"] = {
    id: "rm-receptionist-knowledge", features: ["page:#/calls", "receptionist"],
    title: "What your receptionist knows \u2014 and what it won't say",
    blocks: [
      { p: "Your receptionist answers with what you've told it. Its instructions live in [[#/settings/aireceptionist|Settings \u2192 AI Receptionist]], and your portal starts with a short recruiting section already in there for you to edit." },
      { steps: [
        "Fill in what you recruit for \u2014 the kinds of roles, the areas you cover \u2014 so it can answer the first question every caller asks.",
        "Say how candidates usually reach you (most callers are ringing about an ad they've seen), so the conversation starts in the right place.",
        "Leave the booking instruction alone unless you mean to change it: the receptionist books callers into Interviews and confirms the time back to them.",
        "Keep the promises list honest \u2014 no job offers, no pay rates, no start dates, and no client names unless you've said it may share them.",
        "Set the tone you want. Candidates are job hunting; warm and plain beats pushy.",
      ] },
      { p: "You can also point it at pages of your own for background \u2014 it reads what you give it and nothing else, so it never invents a role or a rate." },
      { tip: "Everything it says on a call is in the transcript on [[#/calls|Calls]] \u2014 the fastest way to spot an instruction worth tightening." },
    ],
  };

  const LC_VARIANTS = {
    field_services: {
      sections: [
        { cat: "Getting started", items: [{ ref: "orientation" }, { id: "fs-home-dashboard" }, { ref: "notifications" }, { ref: "suggestions" }, { ref: "account-basics" }] },
        { cat: "Your modules", items: [{ id: "fs-contacts" }, { id: "fs-work-orders" }, { id: "fs-equipment" }, { id: "fs-estimates" }, { id: "fs-invoices" }, { id: "fs-products" }, { id: "fs-tasks" }] },
        { cat: "Workflows", items: [{ id: "fs-dispatch-day" }, { id: "fs-estimate-to-invoice" }, { id: "fs-maintenance-plans" }, { id: "fs-phone-rings" }] },
        { cat: "Your receptionist", page: "#/calls", items: [{ ref: "receptionist-setup" }, { ref: "service-request-intake" }, { ref: "call-log" }, { ref: "lead-capture" }] },
        { cat: "Admin", items: [{ ref: "staff-resources" }, { ref: "business-hours" }, { ref: "invite-team" }, { ref: "modules-fields" }, { ref: "appearance" }, { ref: "rename-pages" }, { ref: "integrations" }, { ref: "billing" }, { ref: "data-admin" }] },
        // R1-approved: the remaining stock sections ride along BY REFERENCE so
        // no capability loses its help in the variant.
        { stockCat: "Working with records" },
        { stockCat: "Finding & organizing" },
        { stockCat: "Analytics & dashboards" },
        { stockCat: "Communication" },
        { stockCat: "Automations" },
        { stockCat: "Scheduling & team" },
        { stockCat: "Housekeeping" },
      ],
    },
    // RM-3: the RECRUITMENT MARKETING variant. Same assembly rules as
    // field_services — stock guides ride BY REFERENCE, only the genuinely
    // different surfaces get their own guide.
    recruitment_marketing: {
      sections: [
        { cat: "Getting started", items: [{ ref: "orientation" }, { id: "rm-home-dashboard" }, { ref: "notifications" }, { ref: "suggestions" }, { ref: "account-basics" }] },
        { cat: "Your modules", items: [{ id: "rm-candidates" }, { id: "rm-job-openings" }, { id: "rm-interviews" }] },
        { cat: "Workflows", items: [{ id: "rm-ad-to-candidate" }, { id: "rm-nurturing" }, { id: "rm-booking-interviews" }, { id: "rm-client-reporting" }] },
        { cat: "Your receptionist", page: "#/calls", items: [{ ref: "receptionist-setup" }, { id: "rm-receptionist-knowledge" }, { ref: "call-log" }, { ref: "lead-capture" }] },
        { cat: "Admin", items: [{ ref: "staff-resources" }, { ref: "business-hours" }, { ref: "invite-team" }, { ref: "modules-fields" }, { ref: "appearance" }, { ref: "rename-pages" }, { ref: "integrations" }, { ref: "billing" }, { ref: "data-admin" }] },
        { stockCat: "Working with records" },
        { stockCat: "Finding & organizing" },
        { stockCat: "Analytics & dashboards" },
        { stockCat: "Communication" },
        { stockCat: "Automations" },
        { stockCat: "Scheduling & team" },
        { stockCat: "Housekeeping" },
      ],
    },
  };
  let _stockById = null;
  function stockById(id) {
    if (!_stockById) { _stockById = {}; GUIDES.forEach((g) => (g.items || []).forEach((it) => { _stockById[it.id] = it; })); }
    return _stockById[id];
  }
  const _assembled = {};
  function activeVariantKey() {
    return (App.state && App.state.features && App.state.features.lcVariant) || null;
  }
  function activeGuides() {
    const key = activeVariantKey();
    if (!key || !LC_VARIANTS[key]) return GUIDES; // stock: the ARRAY ITSELF (byte-identical)
    if (_assembled[key]) return _assembled[key];
    const out = [];
    LC_VARIANTS[key].sections.forEach((sec) => {
      if (sec.stockCat) {
        const stockSec = GUIDES.find((g) => g.cat === sec.stockCat);
        if (stockSec) out.push(stockSec); // the SAME section object — zero forking
        return;
      }
      const items = [];
      (sec.items || []).forEach((it) => {
        if (it.ref) { const g = stockById(it.ref); if (g) items.push(g); return; } // same object
        const vg = variantGuideById(it.id);
        if (vg) items.push(vg);
      });
      if (items.length) out.push({ cat: sec.cat, ...(sec.page ? { page: sec.page } : {}), ...(sec.pagesAll ? { pagesAll: sec.pagesAll } : {}), items });
    });
    _assembled[key] = out;
    return out;
  }
  // Deep links: an id that exists in stock OR any variant gets the graceful
  // "not available" note when the ACTIVE tree lacks it — never a 404, never a
  // leak of the other tree's content.
  function idKnownAnywhere(id) {
    if (stockById(id)) return true;
    if (variantGuideById(id)) return true;
    return false;
  }
  App._lc = { activeGuides, activeVariantKey, LC_VARIANTS, FS_GUIDES, RM_GUIDES, idKnownAnywhere }; // suite hooks


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
    // dispatch guide appears once a tenant portal actually uses the capability.
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

    // Owner page-lock: hide guides for pages locked for this tenant portal — a locked page
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
    const guides = activeGuides() // the variant seam: stock tenants get the GUIDES array itself
      .filter((g) => !blocked(g))
      .map((g) => Object.assign({}, g, { items: (g.items || []).filter((it) => !blocked(it)) }))
      .filter((g) => g.items.length);
    // precompute searchable bodies once
    guides.forEach((g) => g.items.forEach((it) => { it._body = guideBody(it); }));

    let currentId = guides[0] && guides[0].items[0] && guides[0].items[0].id;
    // A deep link (#/learn?guide=<id>) wins over the default first guide — this
    // is how a search result opens the guide it matched.
    const wantedGuide = (App.routeQuery && App.routeQuery.guide) ? String(App.routeQuery.guide) : "";
    if (wantedGuide) currentId = wantedGuide;

    function showGuide(id) {
      // feature-lc: a deep link into a guide this portal has HIDDEN degrades to a
      // graceful note — never a 404, never a leak of the hidden content.
      const visible = guides.some((g) => g.items.some((it) => it.id === id));
      // variant-aware: an id known to stock OR a variant but absent from the
      // ACTIVE tree degrades to the same graceful note (never a 404, no leaks).
      const existsAtAll = activeGuides().some((g) => (g.items || []).some((it) => it.id === id)) || idKnownAnywhere(id);
      if (!visible && existsAtAll) {
        currentId = null;
        paintNav();
        content.innerHTML = "";
        const note = el("div", "card learn-unavailable");
        note.appendChild(el("h2", null, "Not available in this portal"));
        note.appendChild(el("p", "cell-muted", "This guide covers a feature that isn't currently turned on for this portal. If it gets enabled later, the guide appears here automatically."));
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

  App.learn = { render, GUIDES, validateGuideFeatureTags, isKnownFeatureTag, activeGuides, LC_VARIANTS, FS_GUIDES };
})(typeof window !== "undefined" ? window : globalThis);
