import ExcelJS from "exceljs";
import JSZip from "jszip";
import { prisma } from "../db/client";
import { listContacts } from "./readModels";
import { listRecords } from "./recordService";
import { listFields } from "./fieldService";
import { listRecordTypes } from "./recordTypeService";
import { getPortal } from "./portalService";
import { sendRichEmail } from "./notificationService";
import { evalRules, Rule, Column } from "../automation/conditions";

// ============================================================================
// Server-side report executor — the same runner the recurring batch will reuse.
//
// Given a ScheduledReport definition + tenantId it: fetches each included type's
// rows, applies that type's saved filter rules with the EXISTING server-side rule
// evaluator (evalRules), builds the SAME columns/headers/order the client export
// emits (mirrors contactColumnDefs / recordColumnDefs), and serializes to the
// LOCKED format: xlsx = one workbook, one sheet per type; csv = a plain .csv for a
// single type, or a .zip of one CSV per type for several. The artifact is emailed
// (existing sendRichEmail, attachments) and logged to ExportRecord (kind:"report").
// ============================================================================

// definition.types[typeKey] = { fields: <checked column keys>, rules: <filter rules> }.
// A type is INCLUDED iff it has >= 1 field checked.
export interface ReportTypeDef { fields?: string[]; rules?: Rule[] }
export interface ReportDefinition { types?: Record<string, ReportTypeDef> }

// A single output column: stable key (selection), header label, eval type, and the
// value/raw accessors. `value` is the exact text the client CSV cell would hold;
// `raw` feeds the rule evaluator (same get/text contract Column uses).
interface ColSpec { key: string; label: string; type: string; value: (row: any) => string; raw: (row: any) => any }

// ---- value formatting, mirrored 1:1 from public/js/util.js + portal.js --------
function scalar(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
function fmtDate(iso: any): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + `, ${time}`;
}
function fmtAppt(iso: any): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
const colType = (t: string) => (t === "number" ? "number" : t === "date" ? "date" : "text");

// ---- CSV building, mirrored 1:1 from portal.js (csvCell + buildCSV) ------------
function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCSV(cols: ColSpec[], rows: any[]): string {
  const header = cols.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => cols.map((c) => csvCell(c.value(row))).join(","));
  return [header, ...lines].join("\n");
}

// ---- column builders: byte-for-byte mirrors of the client export defs ---------

// Contacts: system+custom fields (in Fields order), then Source / Caller ID /
// Calls / Time Created — identical to contactColumnDefs(fields).
export async function contactColSpecs(tenantId: string): Promise<ColSpec[]> {
  const fields = await listFields(tenantId, "contact");
  const SYS = new Set(["name", "phone", "email", "intent"]);
  const specs: ColSpec[] = fields.map((f: any) => {
    const get = SYS.has(f.key) ? (r: any) => r[f.key] : (r: any) => (r.customFields || {})[f.key];
    return { key: f.key, label: f.label, type: colType(f.type), raw: get, value: (r: any) => scalar(get(r)) };
  });
  specs.push({ key: "source", label: "Source", type: "text", raw: (r) => r.source, value: (r) => r.source || "unknown" });
  specs.push({ key: "callerId", label: "Caller ID", type: "text", raw: (r) => r.callerId, value: (r) => r.callerId || "" });
  specs.push({ key: "callCount", label: "Calls", type: "number", raw: (r) => r.callCount, value: (r) => String(r.callCount || 0) });
  specs.push({ key: "createdAt", label: "Time Created", type: "date", raw: (r) => r.createdAt, value: (r) => fmtDate(r.createdAt) });
  return specs;
}

// Records (Jobs / Bookings / custom): Title, [Appointment + Resource for bookings],
// [Type if subtypes], [Status if recordStages], custom fields, Created — identical
// to recordColumnDefs(fields, type, resById).
async function recordColSpecs(tenantId: string, type: any, resNameById: Map<string, string>, resourceLabel: string): Promise<ColSpec[]> {
  const fields = await listFields(tenantId, type.key);
  const specs: ColSpec[] = [];
  specs.push({ key: "title", label: "Title", type: "text", raw: (r) => r.title, value: (r) => r.title || "" });
  if (type.key === "booking") {
    specs.push({ key: "appointmentAt", label: "Appointment", type: "date", raw: (r) => r.appointmentAt, value: (r) => fmtAppt(r.appointmentAt) });
    specs.push({ key: "resourceId", label: resourceLabel, type: "text", raw: (r) => r.resourceId || null, value: (r) => (r.resourceId ? resNameById.get(r.resourceId) || "" : "") });
  }
  if ((type.subtypes || []).length) {
    specs.push({ key: "subtypeKey", label: "Type", type: "text", raw: (r) => r.subtypeKey, value: (r) => subtypeLabel(type, r.subtypeKey) });
  }
  if ((type.recordStages || []).length) {
    specs.push({ key: "stageKey", label: "Status", type: "text", raw: (r) => r.stageKey, value: (r) => recordStageLabel(type, r.stageKey) });
  }
  for (const f of fields as any[]) {
    const get = (r: any) => (r.customFields || {})[f.key];
    specs.push({ key: f.key, label: f.label, type: colType(f.type), raw: get, value: (r) => scalar(get(r)) });
  }
  specs.push({ key: "createdAt", label: "Created", type: "date", raw: (r) => r.createdAt, value: (r) => fmtDate(r.createdAt) });
  return specs;
}
function subtypeLabel(type: any, key: any): string {
  const s = ((type && type.subtypes) || []).find((x: any) => x.key === key);
  return s ? s.label : (key || "");
}
function recordStageLabel(type: any, key: any): string {
  const s = ((type && type.recordStages) || []).find((x: any) => x.key === key);
  return s ? s.label : (key || "");
}

// evalRules wants Column[] (key/type/get/text). Derive from the same ColSpecs the
// output uses, so a filter can reference ANY column the user saw in the editor.
export function colsForEval(specs: ColSpec[]): Column[] {
  return specs.map((s) => ({ key: s.key, type: s.type, get: s.raw, text: s.value }));
}

// One included type's resolved data: the chosen columns (in client order) + the
// rows that survive its filter.
export interface BuiltType { typeKey: string; label: string; columns: ColSpec[]; rows: any[]; csv: string }

// Build every included type: fetch rows, filter, pick the checked columns (keeping
// the client's column ORDER), and render that type's CSV.
export async function buildReport(tenantId: string, definition: ReportDefinition): Promise<BuiltType[]> {
  const types = definition?.types || {};
  const recordTypes = await listRecordTypes(tenantId);
  const portal = await getPortal(tenantId);
  const resourceLabel = (portal?.labels as any)?.resource?.one || "Resource";

  // Resolve resource names once (only needed if a booking type is included).
  let resNameById = new Map<string, string>();
  const includesBooking = Object.keys(types).some((k) => k === "booking" && (types[k].fields || []).length);
  if (includesBooking) {
    const resources = await (prisma as any).resource.findMany({ where: { tenantId }, select: { id: true, name: true } });
    resNameById = new Map(resources.map((r: any) => [r.id, r.name]));
  }

  const out: BuiltType[] = [];
  // Iterate in record-type order so multi-type output (sheets / zipped files) is stable.
  for (const rt of recordTypes) {
    const def = types[rt.key];
    const checked = (def?.fields || []).filter(Boolean);
    if (!checked.length) continue; // a type is included only if it has a checked field

    const allCols = rt.key === "contact"
      ? await contactColSpecs(tenantId)
      : await recordColSpecs(tenantId, rt, resNameById, resourceLabel);

    // Keep ONLY checked columns, preserving the client's column order.
    const checkedSet = new Set(checked);
    const columns = allCols.filter((c) => checkedSet.has(c.key));
    if (!columns.length) continue;

    const rawRows = rt.key === "contact"
      ? await listContacts(tenantId)
      : await listRecords(tenantId, rt.key);

    const evalCols = colsForEval(allCols);
    const rules = (def?.rules || []) as Rule[];
    const rows = rawRows.filter((row: any) => evalRules(row, rules, evalCols));

    out.push({ typeKey: rt.key, label: rt.labelPlural || rt.label || rt.key, columns, rows, csv: buildCSV(columns, rows) });
  }
  return out;
}

// Excel sheet names: <=31 chars, none of []:*?/\.
function sheetName(label: string, used: Set<string>): string {
  let base = String(label || "Sheet").replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) { name = base.slice(0, 28) + " " + n++; }
  used.add(name.toLowerCase());
  return name;
}
function slugify(s: string): string {
  return String(s || "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report";
}

export interface Artifact { filename: string; content: Buffer | string; ext: string; mime: string; base64: boolean }

// Serialize the built types to the LOCKED output format.
export async function serializeArtifact(reportName: string, format: string, built: BuiltType[]): Promise<Artifact> {
  const slug = slugify(reportName);
  if (format === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const used = new Set<string>();
    for (const b of built) {
      const ws = wb.addWorksheet(sheetName(b.label, used));
      ws.addRow(b.columns.map((c) => c.label));
      for (const row of b.rows) ws.addRow(b.columns.map((c) => c.value(row)));
    }
    if (!built.length) wb.addWorksheet("Report"); // never an empty workbook
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return { filename: `${slug}.xlsx`, content: buf, ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: true };
  }
  // CSV family. Single type -> a plain .csv; multiple -> a .zip of per-type CSVs.
  if (built.length <= 1) {
    return { filename: `${slug}.csv`, content: built[0]?.csv ?? "", ext: "csv", mime: "text/csv;charset=utf-8;", base64: false };
  }
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const b of built) {
    let fn = slugify(b.label), n = 2;
    while (usedNames.has(fn)) fn = `${slugify(b.label)}-${n++}`;
    usedNames.add(fn);
    zip.file(`${fn}.csv`, b.csv);
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return { filename: `${slug}.zip`, content: buf, ext: "zip", mime: "application/zip", base64: true };
}

// Run a report end to end: build -> serialize -> email -> log to ExportRecord.
export async function runAndDeliverReport(input: {
  tenantId: string;
  reportId: string;
  name: string;
  format: string;
  definition: ReportDefinition;
  recipients: string[];
  emailBody?: string | null;
  createdById?: string | null;
}): Promise<{ exportRecordId: string; rowCount: number; filename: string; perType: Array<{ typeKey: string; rowCount: number }> }> {
  const { tenantId, reportId, name, format, definition, recipients } = input;
  const built = await buildReport(tenantId, definition);
  const artifact = await serializeArtifact(name, format, built);
  const totalRows = built.reduce((sum, b) => sum + b.rows.length, 0);

  // Email it to every recipient (existing sendRichEmail; mock path logs in dev).
  const portal = await getPortal(tenantId);
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const subject = `Report: ${name} — ${today}`;
  const sheetList = built.map((b) => `${b.label} (${b.rows.length})`).join(", ") || "no rows";
  // Custom rich-text body (from the report builder) when present; otherwise the
  // default attachment notice. "Present" = has real text OR an embedded image, not
  // an empty Quill doc (e.g. "<p><br></p>"). The report file is attached either way.
  const bodyText = (input.emailBody || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  const bodyHasEmbed = /<img\b/i.test(input.emailBody || "");
  const html = (bodyText || bodyHasEmbed)
    ? (input.emailBody as string)
    : `<p>Your report <strong>${escapeHtml(name)}</strong> is attached (${escapeHtml(artifact.ext.toUpperCase())}).</p><p>Included: ${escapeHtml(sheetList)}.</p>`;
  for (const to of recipients) {
    await sendRichEmail({ to, subject, html, fromEmail: portal?.notifyEmail || "", fromName: portal?.name || null, attachments: [{ filename: artifact.filename, content: artifact.content }] }, {
      // Report recipients are typed addresses, not contacts -> contactId null.
      type: "report",
      tenantId,
      sentById: input.createdById ?? null,
    });
  }

  // Log the run to ExportRecord (kind:"report"). Store the EXACT emitted artifact so
  // the list's Download reproduces the emailed file: plain CSV as text; xlsx/zip as
  // base64. A tiny {ext, mime, base64} hint rides in the existing `fields` JSON — no
  // new columns.
  const csvColumn = artifact.base64 ? (artifact.content as Buffer).toString("base64") : (artifact.content as string);
  const rec = await (prisma as any).exportRecord.create({
    data: {
      tenantId,
      kind: "report",
      reportId,
      dataType: built.length === 1 ? built[0].typeKey : null,
      name: name.trim(),
      rowCount: totalRows,
      fields: { ext: artifact.ext, mime: artifact.mime, base64: artifact.base64, filename: artifact.filename } as any,
      csv: csvColumn,
      createdById: input.createdById ?? null,
    },
  });
  await (prisma as any).scheduledReport.update({ where: { id: reportId }, data: { lastRunAt: new Date() } });

  return { exportRecordId: rec.id, rowCount: totalRows, filename: artifact.filename, perType: built.map((b) => ({ typeKey: b.typeKey, rowCount: b.rows.length })) };
}

function escapeHtml(s: string): string {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
