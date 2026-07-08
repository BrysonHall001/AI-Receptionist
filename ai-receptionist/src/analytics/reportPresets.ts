// Built-in report-widget presets ("templates") for the Analytics on-ramp.
//
// Mirrors src/automation/presets.ts: function-based, niche-agnostic CATEGORIES the
// user sees, plus a HIDDEN internal-only `vertical` tag that is NEVER sent to the
// browser (publicReportPresets() strips it, exactly like the automations presets
// route strips its vertical). Each preset is a ready-made WIDGET in the exact shape
// the Reports engine already renders — applying one just appends this widget to the
// current dashboard and it renders/edits identically to a hand-built widget.
//
// Presets are defined ONLY against sources + fields that ALWAYS exist in the Reports
// builder (calls, contacts, pipeline and their standard fields), so they apply
// cleanly. PRESET_SOURCE_FIELDS below is the always-present allowlist the validator
// and self-test check against; the client also drops any field that isn't present in
// a given portal, so a template never produces a broken widget.

export interface ReportPresetCategory { key: string; label: string; }

// The ONLY grouping the user sees. Function-based, never industry-based.
export const REPORT_PRESET_CATEGORIES: ReportPresetCategory[] = [
  { key: "volume_activity", label: "Volume & activity" },
  { key: "conversion_pipeline", label: "Conversion & pipeline" },
  { key: "breakdowns", label: "Breakdowns" },
  { key: "trends", label: "Trends over time" },
];

// Internal-only. NOT shown anywhere in the UI; not sent to the browser.
export type ReportVertical = "recruiting" | "home_services" | "insurance" | "general";

// The widget shape the Reports engine renders (same object hand-built widgets use).
export interface WidgetDim { key: string; date?: "day" | "week" | "month" | "year"; }
export interface WidgetDef {
  title: string;
  type: "kpi" | "bar" | "line" | "pie" | "stacked" | "heatmap" | "list";
  source: string;
  measure: { op: "count" | "sum" | "avg"; field?: string };
  groupBy: WidgetDim[];
  series: WidgetDim[];
  filters: unknown[];
}
export interface ReportPreset {
  key: string;
  name: string;
  description: string;
  category: string;       // one of REPORT_PRESET_CATEGORIES[].key
  vertical: ReportVertical; // HIDDEN internal tag — never surfaced in the UI
  widget: WidgetDef;
}

// Always-present sources + fields (the Reports builder guarantees these). Used to
// validate presets and by the self-test. Custom/record-type sources are intentionally
// NOT used by presets so every template applies cleanly in every portal.
export const PRESET_SOURCE_FIELDS: Record<string, { key: string; type: string }[]> = {
  calls: [
    { key: "name", type: "text" }, { key: "phone", type: "text" }, { key: "intent", type: "text" },
    { key: "status", type: "text" }, { key: "createdAt", type: "date" },
  ],
  contacts: [
    { key: "createdAt", type: "date" }, { key: "callCount", type: "number" },
  ],
  pipeline: [
    { key: "stageLabel", type: "text" }, { key: "recordTypeLabel", type: "text" },
    { key: "recordStatusLabel", type: "text" }, { key: "subtypeLabel", type: "text" },
    { key: "contactName", type: "text" }, { key: "createdAt", type: "date" },
  ],
};

const W = (w: WidgetDef): WidgetDef => w; // tiny helper for readable definitions

export const REPORT_PRESETS: ReportPreset[] = [
  // ---------------- Volume & activity ----------------
  {
    key: "total_calls", name: "Total calls", category: "volume_activity", vertical: "general",
    description: "A single headline number: how many calls you've received in total.",
    widget: W({ title: "Total calls", type: "kpi", source: "calls", measure: { op: "count" }, groupBy: [], series: [], filters: [] }),
  },
  {
    key: "avg_calls_per_contact", name: "Average calls per contact", category: "volume_activity", vertical: "general",
    description: "On average, how many calls each contact has made — a quick engagement gauge.",
    widget: W({ title: "Avg calls per contact", type: "kpi", source: "contacts", measure: { op: "avg", field: "callCount" }, groupBy: [], series: [], filters: [] }),
  },
  {
    key: "calls_per_day", name: "Calls per day", category: "volume_activity", vertical: "general",
    description: "A line showing how many calls come in each day, so you can spot busy and quiet days.",
    widget: W({ title: "Calls per day", type: "line", source: "calls", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "day" }], series: [], filters: [] }),
  },
  {
    key: "new_contacts_week", name: "New contacts per week", category: "volume_activity", vertical: "general",
    description: "How many new contacts are added each week — your top-of-funnel growth.",
    widget: W({ title: "New contacts per week", type: "bar", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] }),
  },

  // ---------------- Conversion & pipeline ----------------
  {
    key: "pipeline_by_stage", name: "Pipeline by stage", category: "conversion_pipeline", vertical: "general",
    description: "How many records sit in each pipeline stage right now — see where things pile up.",
    widget: W({ title: "Pipeline by stage", type: "bar", source: "pipeline", measure: { op: "count" }, groupBy: [{ key: "stageLabel" }], series: [], filters: [] }),
  },
  {
    key: "records_by_status", name: "Records by status", category: "conversion_pipeline", vertical: "general",
    description: "A pie of records split by their status — the mix of open vs. closed at a glance.",
    widget: W({ title: "Records by status", type: "pie", source: "pipeline", measure: { op: "count" }, groupBy: [{ key: "recordStatusLabel" }], series: [], filters: [] }),
  },

  // ---------------- Breakdowns ----------------
  {
    key: "calls_by_reason", name: "Calls by reason", category: "breakdowns", vertical: "general",
    description: "What people are calling about — calls grouped by their reason/intent.",
    widget: W({ title: "Calls by reason", type: "bar", source: "calls", measure: { op: "count" }, groupBy: [{ key: "intent" }], series: [], filters: [] }),
  },
  {
    key: "calls_by_outcome", name: "Calls by outcome", category: "breakdowns", vertical: "general",
    description: "A pie of calls by their status/outcome — see how calls are ending up.",
    widget: W({ title: "Calls by outcome", type: "pie", source: "calls", measure: { op: "count" }, groupBy: [{ key: "status" }], series: [], filters: [] }),
  },

  // ---------------- Trends over time ----------------
  {
    key: "contacts_over_time", name: "Contacts over time", category: "trends", vertical: "general",
    description: "A line of new contacts by month — the long-term growth trend.",
    widget: W({ title: "Contacts over time", type: "line", source: "contacts", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "month" }], series: [], filters: [] }),
  },
  {
    key: "calls_per_week", name: "Calls per week", category: "trends", vertical: "general",
    description: "A line of call volume by week — a smoother trend than the daily view.",
    widget: W({ title: "Calls per week", type: "line", source: "calls", measure: { op: "count" }, groupBy: [{ key: "createdAt", date: "week" }], series: [], filters: [] }),
  },
];

// Validate one preset against the always-present source/field allowlist. Returns a
// list of problems (empty = structurally valid and renderable by aggregate()).
const VALID_TYPES = ["kpi", "bar", "line", "pie", "stacked", "heatmap", "list"];
const VALID_OPS = ["count", "sum", "avg"];
export function validateReportPreset(p: ReportPreset): string[] {
  const problems: string[] = [];
  const w = p.widget;
  if (!w) return [`${p.key}: missing widget`];
  const fields = PRESET_SOURCE_FIELDS[w.source];
  if (!fields) problems.push(`${p.key}: unknown source "${w.source}"`);
  if (!VALID_TYPES.includes(w.type)) problems.push(`${p.key}: invalid type "${w.type}"`);
  if (!w.measure || !VALID_OPS.includes(w.measure.op)) problems.push(`${p.key}: invalid measure op`);
  const byKey = new Map((fields || []).map((f) => [f.key, f]));
  if (w.measure && (w.measure.op === "sum" || w.measure.op === "avg")) {
    const f = w.measure.field ? byKey.get(w.measure.field) : undefined;
    if (!f) problems.push(`${p.key}: measure ${w.measure.op} needs a numeric field that exists in "${w.source}"`);
    else if (f.type !== "number" && f.type !== "percent") problems.push(`${p.key}: measure field "${w.measure.field}" is not numeric`);
  }
  for (const d of w.groupBy || []) {
    const f = byKey.get(d.key);
    if (!f) problems.push(`${p.key}: group-by "${d.key}" not in source "${w.source}"`);
    else if (d.date && f.type !== "date") problems.push(`${p.key}: date bucket on non-date field "${d.key}"`);
  }
  return problems;
}

// Public projection sent to the browser — the internal `vertical` tag is stripped,
// exactly like the automations presets route.
export function publicReportPresets() {
  return REPORT_PRESETS.map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    category: p.category,
    type: p.widget.type,
    widget: p.widget, // ready-made widget to apply (no internal metadata inside)
  }));
}
