// Learning Center — categorized, step-by-step how-to guides.
//
// AUDIENCE: written for END USERS working inside a portal (the default, as
// requested). A few admin-only features are clearly marked "(Admin)".
//
// EDITING: everything lives in the GUIDES array below. Each category has items;
// each guide has a title and an ordered list of "blocks". Block types:
//   { p: "paragraph text" }                  → a paragraph
//   { steps: ["do this", "then this"] }       → a numbered list
//   { shot: "..." }                            → DEPRECATED: no longer rendered
//                                                (real screenshots are a later pass)
//   { tip: "a helpful note" }                 → a highlighted tip
// To add a guide: copy an item, change the title/blocks. To add a category:
// add a new { cat, items } entry. No other wiring needed.
(function (global) {
  const App = global.App || (global.App = {});
  const { el, esc } = App.util;

  // Owner page-lock: the "finding your way around" guide lists the nav sections in one
  // sentence. Render it dynamically so locked pages aren't named. This sentinel is
  // swapped for the computed sentence at render time.
  const NAV_SECTIONS_SENTINEL = "@@NAV_SECTIONS@@";
  function listJoin(a) { if (a.length <= 1) return a.join(""); if (a.length === 2) return a[0] + " and " + a[1]; return a.slice(0, -1).join(", ") + ", and " + a[a.length - 1]; }
  function navSectionsSentence() {
    const NAV_LABELS = (App.buildPortalNav ? App.buildPortalNav() : [["#/dashboard", "Home Dashboard"], ["#/calls", "Calls"], ["#/contacts", "Contacts"], ["#/jobs", "Jobs"], ["#/bookings", "Bookings"], ["#/reports", "Analytics"], ["#/automations", "Automations"], ["#/communication", "Communication"], ["#/learn", "Learning Center"], ["#/feedback", "Feedback"]]).map(function (it) { return [it[0], it[1]]; });
    const names = NAV_LABELS.filter((x) => !(App.isPageLocked && App.isPageLocked(x[0]))).map((x) => x[1]);
    return "The left navigation lists the main sections: " + listJoin(names) + ".";
  }

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
              NAV_SECTIONS_SENTINEL,
              "Settings isn't in the left menu — open it from the gear icon in the top-right.",
              "Near the bottom-left you'll find the Recycle Bin link and your user box with a Sign out button.",
              "The top bar shows where you are, with a Refresh button and the settings gear on the right.",
            ] },
            { shot: "Full app with the left navigation and top bar labelled" },
            { tip: "Your column layout and saved preferences are tied to your own account, so they follow you when you sign in. Your portal's theme and logo are set for the whole portal (see Appearance)." },
          ],
        },
        {
          id: "today",
          page: "#/dashboard",
          title: "Using the Home Dashboard",
          blocks: [
            { p: "The Home Dashboard is your landing page — a build-your-own dashboard of charts and numbers drawn from your live data." },
            { steps: [
              "It starts empty, showing 'No widgets yet'. Click '+ Add widget' to build your first chart.",
              "For each widget, pick a type (a single KPI number, bar, stacked bar, line, pie, heat map, or a list/table), choose a data source (calls, contacts, or jobs), a measure (count, sum, or average), and how to group it.",
              "Drag widgets to reorder them and resize them to lay out the dashboard.",
              "The numbers update automatically from your live calls, contacts, and jobs — no refresh needed.",
            ] },
            { shot: "Home Dashboard with a couple of widgets and the + Add widget button" },
            { tip: "Everyone in your portal sees the same Home Dashboard, and portal admins can edit it. It uses the same builder as the Analytics page, so anything you can chart there you can pin here." },
          ],
        },
      ],
    },
    {
      cat: "Calls & receptionist", page: "#/calls",
      items: [
        {
          id: "calls-list",
          title: "Seeing your calls",
          blocks: [
            { p: "The Calls page lists every call your AI receptionist has handled, with the newest at the top." },
            { steps: [
              "Click 'Calls' in the left navigation.",
              "Each row shows the caller's name, the reason for the call, the status, and when it came in.",
              "The list updates on its own as new calls arrive — you don't need to refresh.",
            ] },
            { tip: "Status shows 'In progress' while a call is live and flips to 'Completed' when it wraps up. 'Missed' means the call didn't finish." },
          ],
        },
        {
          id: "call-detail",
          title: "Reading a call and its transcript",
          blocks: [
            { p: "Open any call to see its details and the full back-and-forth between the caller and your receptionist." },
            { steps: [
              "Click a row in the Calls list.",
              "The panel shows the caller's phone and email, the reason for calling, when it was received, and whether you were notified by email.",
              "Scroll to the Transcript to read the whole conversation, turn by turn.",
            ] },
            { tip: "You also get an email summary of every call, so new leads reach you even when you're not signed in." },
          ],
        },
        {
          id: "ai-instructions",
          title: "Telling your receptionist about your business",
          blocks: [
            { p: "The 'AI Instructions' box on the Calls page is where you teach your receptionist about your business so it can answer callers accurately." },
            { steps: [
              "Go to the Calls page and find the 'AI Instructions' panel below your calls.",
              "Write your services, hours, pricing, and anything callers commonly ask.",
              "Click Save.",
            ] },
            { tip: "This is added on top of your receptionist's built-in ability to stay helpful and capture caller details — you're adding knowledge, not replacing how it behaves." },
          ],
        },
        {
          id: "receptionist-voice",
          title: "Choosing your receptionist's voice",
          blocks: [
            { p: "You can choose the voice your AI receptionist speaks with from a short list of options." },
            { steps: [
              "On the Calls page, find 'Receptionist voice' at the top-right of the AI Instructions panel.",
              "Pick a voice from the dropdown — it saves right away.",
            ] },
            { tip: "The voice you pick is used on premium voice calls." },
          ],
        },
      ],
    },
    {
      cat: "Contacts", page: "#/contacts",
      items: [
        {
          id: "contact-identity",
          title: "How contacts are identified (email vs. phone)",
          blocks: [
            { p: "Every contact you add manually or bring in through an import must have a unique email address — that's how the system keeps people from being entered twice." },
            { p: "Contacts created automatically from phone calls are the exception: they're saved by phone number, so a caller who never gives an email still gets captured. You can always add their email later." },
            { tip: "So if you're typing in a new contact or importing a list and it asks for an email, that's expected. Phone-call contacts don't need one." },
          ],
        },
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
      cat: "Finding & organizing", pagesAll: ["#/contacts", "#/jobs"],
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
      cat: "Bulk actions", pagesAll: ["#/contacts", "#/jobs"],
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
      cat: "Importing & exporting", pagesAll: ["#/contacts", "#/jobs"],
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
      cat: "Custom fields", pagesAll: ["#/contacts", "#/jobs"],
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
      cat: "Jobs", page: "#/jobs",
      items: [
        {
          id: "jobs-overview",
          title: "Tracking work with Jobs",
          blocks: [
            { p: "Jobs let you track pieces of work — quotes, projects, service visits — alongside the contacts they belong to." },
            { steps: [
              "Click 'Jobs' in the left navigation.",
              "Click 'Create Job' to add one, or 'Import' to bring in a list from a spreadsheet.",
              "Click any job to open it and update its details.",
              "Use 'Export' to download your jobs as a spreadsheet.",
            ] },
            { tip: "Jobs work just like Contacts — searching, filtering, choosing columns, and bulk actions all behave the same way." },
          ],
        },
        {
          id: "job-pipelines",
          title: "Job types and pipelines (stages)",
          blocks: [
            { p: "Each job moves through a pipeline of stages — for example New, Scheduled, In progress, Done — so you always know where the work stands." },
            { steps: [
              "Open the Fields page from the left navigation and choose the Jobs type.",
              "Under 'types & pipelines', add or rename job types — each type has its own pipeline.",
              "Add, rename, reorder, or remove the stages in a pipeline.",
              "On a job, choose its type to set which pipeline it follows, then move it along the stages as the work progresses.",
            ] },
            { tip: "A stage or type that still has jobs in it can't be deleted until those jobs are moved first — this protects your data." },
          ],
        },
      ],
    },
    {
      cat: "Analytics & dashboards", page: "#/reports",
      items: [
        {
          id: "reports",
          title: "Building analytics and dashboards",
          blocks: [
            { p: "The Analytics page hosts customizable dashboards built from your live data — calls, contacts, and jobs." },
            { steps: [
              "Click 'Analytics' in the left navigation.",
              "Create a dashboard, then click 'Add widget'.",
              "Pick a widget type: KPI (a single number), bar, stacked bar, line, pie, heat map, or list/table.",
              "Choose a data source (calls, contacts, or jobs), a measure (count, sum, or average of a field), and how to group it.",
              "Drag widgets to reorder and resize them to arrange your dashboard.",
            ] },
            { shot: "Analytics page with a dashboard of a KPI and a chart" },
            { tip: "Your Home Dashboard uses this same builder — anything you can chart here you can pin to your landing page." },
          ],
        },
      ],
    },
    {
      cat: "Automations", page: "#/automations",
      items: [
        {
          id: "automations-overview",
          title: "Automations: the big picture",
          blocks: [
            { p: "An automation does something for you automatically. Every one has the same shape: a trigger (what happens) → conditions (optional filters that decide whether to continue) → actions (what to do)." },
            { p: "Open it from 'Automations' in the left navigation. The page has four tabs:" },
            { steps: [
              "Workflows — the automations you've built, each with an on/off switch.",
              "Execution log — what your automations have actually done, run by run.",
              "Event log — a raw record of things that happened in your CRM (the triggers).",
              "Scheduled — actions queued to run later (from delays or date-based triggers); you can cancel a pending one before it runs.",
            ] },
            { p: "To build one, click '+ New automation', give it a name, choose a trigger, add any conditions, then add one or more actions. Save it, then flip the switch to turn it on. Use 'Edit', 'Test', 'Logs', or 'Delete' on each card." },
            { p: "On the Workflows tab there's also a toolbar to search by name and filter by status or trigger, and to sort the list — it only changes what you see, never what runs." },
            { tip: "New automations are OFF until you turn them on, and 'Test' lets you dry-run one against a chosen contact to see each action's result before you rely on it." },
          ],
        },
        {
          id: "automations-triggers",
          title: "Triggers: what can start an automation",
          blocks: [
            { p: "A trigger is the event that kicks an automation off. You pick exactly one per automation. The available triggers are:" },
            { steps: [
              "Contact created — a new contact is added (by hand, by import, or via an inbound webhook).",
              "Contact updated — an existing contact is saved with changes.",
              "Field changed — a specific field's value changes. You can scope it to one field (e.g. only when 'Status' changes) or run it on any field change.",
              "Tag added / Tag removed — a value is added to or removed from a multi-select (tag) field.",
              "Email sent / SMS sent — an email or text goes out (from the contact screen or from another automation).",
              "Note added — a note is added to a contact's timeline.",
              "Manual — run from a record — it never fires on its own; it only runs when you open a contact and click 'Run automation'.",
              "On a date (relative to a date field) — runs a set number of days/weeks/months before or after a date field (for example, 30 days before a renewal date).",
            ] },
            { tip: "When an automation's own action changes a contact, that change does NOT set off other automations. This is deliberate — it prevents automations from looping or cascading into each other." },
          ],
        },
        {
          id: "automations-conditions",
          title: "Conditions & filters: deciding when it runs",
          blocks: [
            { p: "Conditions are optional. With none, the automation runs every time its trigger fires. Add conditions and the automation only continues when they're met — they gate the whole automation (all of its actions), not individual actions." },
            { p: "Conditions use the exact same rule builder as the Contacts filters, so they behave the way you're already used to. You can build rules on the standard fields (name, phone, email, intent), 'Time created', and any of your custom fields." },
            { p: "The operators include: is, is not, contains, does not contain, is empty, is not empty, greater than, less than, is before / is after a date, is today, between two dates, and in the previous N days/weeks/months/years." },
            { p: "Multiple rules combine with AND by default (all must be true). Switching a rule's joiner to OR starts a new group, so you can express 'this group OR that group' — written out, that's (A and B) or (C and D)." },
            { tip: "If a condition refers to a field that doesn't exist in your portal yet, the automation can still be saved as a draft — it just won't match until you create or map that field." },
          ],
        },
        {
          id: "automations-actions",
          title: "Actions: what an automation can do",
          blocks: [
            { p: "Actions run in order, top to bottom, when the trigger fires and the conditions pass. The current actions are:" },
            { steps: [
              "Send email — emails the contact; supports {{field}} placeholders (e.g. Hi {{name}}) and optional saved templates.",
              "Send SMS — texts the contact.",
              "Update contact field — sets a field to a value (placeholders supported).",
              "Add tag / Remove tag — adds or removes a value on a multi-select (tag) field.",
              "Create internal note — adds a note to the contact's timeline.",
              "Assign owner — sets the contact's owner.",
              "Wait / delay — pauses the flow; the actions listed after it run later (see Scheduling & delays).",
              "Create a record — creates a new contact, following the same rules as adding one by hand.",
              "Update a record — updates this contact, or the records found by a 'Find records' step.",
              "Find records — finds contacts matching conditions so a later Update or Delete can act on them.",
              "Delete a record — moves contact(s) to the Recycle Bin (a soft delete you can restore).",
              "Compute value into field — calculates a value into a field (see Compute value into a field).",
              "Send webhook — POSTs the contact's details to a URL you specify (see Webhooks).",
            ] },
            { tip: "Sending depends on your email/text provider being connected. Until then, Send email and Send SMS still save fine and simply don't transmit (in local/demo mode they're logged, not sent)." },
          ],
        },
        {
          id: "automations-compute",
          title: "Compute value into a field",
          blocks: [
            { p: "The 'Compute value into field' action calculates a value and writes it into a destination field. It's a fixed, safe set of operations — there's no scripting involved." },
            { steps: [
              "Add to a date — take a date field and add an amount (years, months, or days), writing the result into a Date field.",
              "Subtract from a date — the same, but going backwards.",
              "Copy a value — copy one field's value into another field, with no math.",
            ] },
            { p: "Example: when a policy starts, set 'Renewal date' = 'Start date' + 1 year. Pair this with the 'On a date' trigger to act a set time before that renewal." },
            { tip: "Date math must land in a Date field. If you point it at a non-date field, the step is flagged rather than writing something wrong." },
          ],
        },
        {
          id: "automations-scheduling",
          title: "Scheduling & delays",
          blocks: [
            { p: "There are two ways an automation can act later instead of immediately." },
            { p: "Delays — add a 'Wait / delay' step inside an automation. Actions above the wait run right away; actions below it are queued to run after the wait (you set an amount in minutes, hours, or days)." },
            { p: "Date-based runs — use the 'On a date (relative to a date field)' trigger to run a set number of days/weeks/months before or after a date field." },
            { p: "Anything waiting or scheduled appears on the 'Scheduled' tab, where you can cancel a pending job before it runs." },
            { tip: "Scheduled and delayed work is evaluated by a daily sweep rather than to the exact second, so a step set for 'in 3 days' runs on the next sweep after that time — not to the minute." },
          ],
        },
        {
          id: "automations-webhooks",
          title: "Webhooks: inbound and outbound",
          blocks: [
            { p: "A webhook is just a way for two systems to talk over the web. The CRM supports both directions." },
            { p: "Inbound (a lead arrives from an outside form or tool): an admin sets up an inbound webhook — a private link — under Settings. When another system sends a lead to that link, the CRM creates or updates a contact in your portal. Which portal it lands in is decided by the link itself, and every attempt (accepted or rejected) is recorded." },
            { p: "Outbound (you push data out): the 'Send webhook' action POSTs a snapshot of the triggering contact to a URL you choose. You can add an optional secret header, and internal/private addresses are blocked for safety. A 'Send test' button lets you fire a sample first." },
            { tip: "Outbound webhooks are a good way to notify another app (a chat channel, a spreadsheet service, an automation tool) the moment something happens to a contact." },
          ],
        },
        {
          id: "automations-templates",
          title: "Start from a template",
          blocks: [
            { p: "If you'd rather not build from scratch, the template library gives you ready-made automations." },
            { steps: [
              "On Automations → Workflows, click the 'Start from a template' card above your list.",
              "Browse the templates, grouped by what they do (Lead capture & routing, Follow-ups, Pipeline & status, Stay in touch).",
              "Click one to see a plain-English preview — its trigger, conditions, actions, and which fields it expects.",
              "Click 'Apply' to add it. It opens in the builder for you to review.",
            ] },
            { p: "Applying a template always creates an inactive DRAFT — nothing runs until you review it and turn it on yourself." },
            { tip: "Some templates expect a custom field your portal may not have (like a status or a date field). If so, the template is clearly flagged so you can create or map that field before switching it on. Applying the same template twice makes a numbered copy rather than overwriting the first." },
          ],
        },
        {
          id: "automations-wizard",
          title: "Build with a wizard",
          blocks: [
            { p: "The wizard walks you through building an automation by answering a few questions. It only ever offers triggers, fields, and actions that actually exist in your portal." },
            { steps: [
              "On Automations → Workflows, click the 'Build with a wizard' card.",
              "Trigger — choose what starts it.",
              "Filter (optional) — add conditions that must all be true.",
              "Branch (optional) — choose whether different actions should run depending on a condition.",
              "Actions — pick what should happen.",
              "Review — read the plain-English summary, then create it.",
            ] },
            { p: "If you choose to branch, the wizard creates TWO linked drafts: one '(if)' automation for when your condition is true, and one '(otherwise)' automation for everything else. On the Workflows list they're shown together as a 'Branch pair'." },
            { tip: "Because a branch is two automations, you must turn BOTH on for full coverage. If only one of a pair is on, the list shows a gentle warning that contacts on the other path will get nothing. As with templates, everything the wizard makes starts as an inactive draft." },
          ],
        },
      ],
    },
    {
      cat: "Recycle Bin", pagesAll: ["#/contacts", "#/jobs"],
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
      cat: "Feedback", page: "#/feedback",
      items: [
        {
          id: "feedback",
          title: "Sending feedback and tracking replies",
          blocks: [
            { p: "Feedback is where you can report a problem or send a request, then follow the conversation as it's answered." },
            { steps: [
              "Click 'Feedback' in the left navigation.",
              "Fill in a short 'Problem' summary and a longer 'Description' — both are required — then click Submit.",
              "Your ticket appears under 'Open tickets', marked 'Needs Reply'.",
              "Click a ticket to open it, read any replies, and add your own in the conversation thread.",
            ] },
            { tip: "You'll see your own tickets here. When a ticket is sorted out it moves to the 'Resolved' list, where you can still open it to read the conversation." },
          ],
        },
      ],
    },
    {
      cat: "General settings",
      items: [
        {
          id: "business-profile",
          title: "Your business details",
          blocks: [
            { p: "Settings → General is where your business profile lives — the information your receptionist and notifications use." },
            { steps: [
              "Open Settings and choose 'General'.",
              "Update your business name, business type, phone number, the email where call notifications should go, and your receptionist's greeting.",
              "Click 'Save changes'.",
            ] },
            { tip: "'Notify email' is where call summaries are sent — keep it current so new leads don't slip by." },
          ],
        },
      ],
    },
    {
      cat: "Team",
      items: [
        {
          id: "invite-teammates",
          title: "Inviting teammates",
          blocks: [
            { p: "Settings → Team is where you add the people on your team and choose what they can do." },
            { steps: [
              "Open Settings and choose 'Team'.",
              "Enter the person's name and email, and pick a role: Portal Admin or Client User.",
              "Click 'Send invite'. They get an email with a link to set their own password — no temporary password needed.",
              "If the email is slow to arrive, copy the activation link shown in the confirmation and send it to them yourself.",
              "The person appears in your team list right away, marked 'Pending'. When they accept and set a password, that flips to their normal role automatically. You can 'Revoke' a pending invite from the list to cancel it.",
            ] },
            { tip: "Portal Admins can manage settings and the team; Client Users work day-to-day with contacts, jobs, and calls. If you're unsure, choose the lower role — you can always invite again." },
          ],
        },
      ],
    },
    {
      cat: "Lead capture",
      items: [
        {
          id: "lead-capture",
          title: "Capturing leads from your website",
          blocks: [
            { p: "Lead capture links let new leads from a website form, Zapier, or another tool land straight in your portal as contacts — automatically." },
            { steps: [
              "Open Settings and choose 'Lead capture'.",
              "Create a secure link.",
              "Give that link to your website form or automation tool so submissions flow in on their own.",
            ] },
            { tip: "Treat the link like a password — anyone who has it can send contacts into your portal." },
          ],
        },
      ],
    },
    {
      cat: "Renaming & navigation",
      items: [
        {
          id: "labels-and-nav",
          title: "Renaming things and tidying your menu",
          blocks: [
            { p: "Settings → Labels lets you rename the words the app uses (like 'Contacts' or 'Jobs') and control your left-hand menu." },
            { steps: [
              "Open Settings and choose 'Labels'.",
              "Rename a word by typing the singular — the plural fills in for you, and you can edit it for irregulars.",
              "Under 'Pages & navigation', show or hide menu items, reorder them, and rename them to match how your business talks.",
            ] },
            { tip: "Renaming only changes the label you see — your data and history stay exactly the same. To change the actual job types and the stages work moves through, use the Fields page; Labels only renames words and tidies the menu." },
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
            { p: "Settings → Appearance controls how this portal looks. The theme and logo are set for the whole portal, so everyone who signs in sees the same look." },
            { steps: [
              "Go to Settings → Appearance.",
              "Pick a ready-made look from the 'Basic' or 'Fun' dropdowns (a colour preview appears beside each).",
              "Or use 'Design your own' to set background, content panel, top bar, sidebar, and font colours, plus a font.",
              "Under 'Logo / white-label', upload a PNG or JPEG to replace the default logo in the top-left for everyone in this portal (leave it empty to keep the default).",
              "Click 'Save as new theme…', give it a name, and it appears in 'Your saved themes' to switch back to anytime.",
            ] },
            { shot: "Settings → Appearance with the theme dropdowns, the designer, and the logo upload" },
            { tip: "Appearance is a portal-admin setting. If you don't see the controls, your portal's look has already been set by an admin and isn't editable from your account." },
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
    if (b.p) return el("p", "learn-p", esc(App.relabelText(b.p)));
    if (b.tip) { const d = el("div", "learn-tip"); d.innerHTML = `<strong>Tip:</strong> ${esc(App.relabelText(b.tip))}`; return d; }
    // Screenshot placeholders are intentionally not rendered (real images come
    // later). Any leftover { shot } block is skipped so no empty frame appears.
    if (b.shot) return null;
    if (b.steps) {
      const ol = el("ol", "learn-steps");
      b.steps.forEach((s) => { const text = s === NAV_SECTIONS_SENTINEL ? navSectionsSentence() : App.relabelText(s); ol.appendChild(el("li", null, esc(text))); });
      return ol;
    }
    return null;
  }

  function render(host) {
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

    const search = el("input", "search-input learn-search");
    search.type = "search";
    search.placeholder = "Search guides…";
    nav.appendChild(search);
    const navList = el("div", "learn-nav-list");
    nav.appendChild(navList);

    // Owner page-lock: hide guides for pages locked for this tenant — a locked page must
    // not appear (or be openable) in the Learning Center. A category/guide is hidden when
    // its `page` is locked, or (for cross-cutting data guides) when EVERY page in its
    // `pagesAll` is locked. Cross-cutting categories with neither tag always show. Empty on
    // the master hub. Filtering runs at BOTH the category and the individual-guide level.
    const blocked = (x) => {
      if (!App.isPageLocked) return false;
      if (x.page && App.isPageLocked(x.page)) return true;
      if (x.pagesAll && x.pagesAll.length && x.pagesAll.every((h) => App.isPageLocked(h))) return true;
      return false;
    };
    const guides = GUIDES
      .filter((g) => !blocked(g))
      .map((g) => Object.assign({}, g, { items: (g.items || []).filter((it) => !blocked(it)) }))
      .filter((g) => g.items.length);

    let currentId = guides[0] && guides[0].items[0] && guides[0].items[0].id;

    function showGuide(id) {
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
      const term = (search.value || "").trim().toLowerCase();
      navList.innerHTML = "";
      guides.forEach((g) => {
        const items = g.items.filter((it) => !term || it.title.toLowerCase().includes(term) || g.cat.toLowerCase().includes(term));
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

  App.learn = { render, GUIDES };
})(typeof window !== "undefined" ? window : globalThis);
