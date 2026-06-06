import { prisma } from "../db/client";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES, EventActor } from "../events/types";
import { sendRichEmail } from "../services/notificationService";
import { sendSms } from "../services/smsService";
import { updateContact, createContact, softDeleteContacts } from "../services/contactService";
import { log as logActivity } from "../services/activityService";
import { FieldMeta, renderTemplate, templateContext, buildColumns, valueOf, conditionFields } from "./contactRow";
import { evalRules } from "./conditions";

const db = prisma as any;

export interface ActionConfig {
  id?: string;
  type: string;
  config?: Record<string, any>;
}

export interface ActionResult {
  type: string;
  status: "success" | "skipped" | "failed";
  detail?: string;
  error?: string;
}

export interface ActionContext {
  tenantId: string;
  contactId: string;
  fieldDefs: FieldMeta[];
  actor: EventActor; // automation actor (loop-safe: engine ignores automation events)
  portal: { phoneNumber?: string | null; notifyEmail?: string | null; name?: string | null };
  // IDs found by a "search_records" action earlier in the same run, so later
  // "update_record"/"delete_record" actions can act on that set. Shared across
  // all actions of one run (the engine passes one ctx through the loop).
  workingSet?: string[];
}

// Metadata for the builder UI. Adding an action = add an executor + an entry
// here; the engine never changes.
export const ACTION_TYPES: { type: string; label: string }[] = [
  { type: "send_email", label: "Send email" },
  { type: "send_sms", label: "Send SMS" },
  { type: "update_field", label: "Update contact field" },
  { type: "add_tag", label: "Add tag" },
  { type: "remove_tag", label: "Remove tag" },
  { type: "create_note", label: "Create internal note" },
  { type: "assign_owner", label: "Assign owner" },
  { type: "create_record", label: "Create a record" },
  { type: "update_record", label: "Update a record" },
  { type: "search_records", label: "Find records" },
  { type: "delete_record", label: "Delete a record (to recycle bin)" },
  { type: "compute_field", label: "Compute value into field" },
];

// A single flow run may delete at most this many records WITHOUT the action
// being explicitly set to "Allow bulk delete". This stops a misconfigured
// Find + Delete from silently emptying a CRM. Everything deleted is soft-deleted
// (recycle bin) and can be restored regardless.
const BULK_DELETE_THRESHOLD = 10;
// Hard cap on how many records one "Find records" action will collect.
const MAX_SEARCH_RESULTS = 500;

const SYSTEM_KEYS = new Set(["name", "phone", "email", "intent"]);

async function freshContact(ctx: ActionContext) {
  const c = await prisma.contact.findUnique({ where: { id: ctx.contactId } });
  if (!c || c.tenantId !== ctx.tenantId) throw new Error("Contact not found");
  return c as any;
}

function asArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v == null || v === "") return [];
  return [String(v)];
}

type Executor = (cfg: Record<string, any>, ctx: ActionContext) => Promise<ActionResult>;

const EXECUTORS: Record<string, Executor> = {
  async send_email(cfg, ctx) {
    const contact = await freshContact(ctx);
    if (!contact.email) return { type: "send_email", status: "skipped", detail: "Contact has no email" };
    const tmpl = templateContext(contact, ctx.fieldDefs);
    let subject = cfg.subject || "";
    let html = cfg.html || cfg.body || "";
    if (cfg.templateId) {
      const t = await db.emailTemplate.findUnique({ where: { id: cfg.templateId } });
      if (t && t.tenantId === ctx.tenantId) {
        subject = subject || t.subject || "";
        html = html || t.body || "";
      }
    }
    subject = renderTemplate(subject, tmpl);
    html = renderTemplate(html, tmpl);
    await sendRichEmail({ to: contact.email, subject, html, fromEmail: ctx.portal.notifyEmail || "", fromName: ctx.portal.name });
    await logActivity({ tenantId: ctx.tenantId, contactId: contact.id, type: "email_sent", summary: `Email sent: ${subject}`, detail: { subject, to: contact.email, via: "automation" }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
    await emitEvent({ tenantId: ctx.tenantId, type: EVENT_TYPES.EmailSent, actor: ctx.actor, subject: { type: "contact", id: contact.id }, payload: { subject, to: contact.email } });
    return { type: "send_email", status: "success", detail: `to ${contact.email}` };
  },

  async send_sms(cfg, ctx) {
    const contact = await freshContact(ctx);
    if (!contact.phone) return { type: "send_sms", status: "skipped", detail: "Contact has no phone" };
    const tmpl = templateContext(contact, ctx.fieldDefs);
    let body = cfg.body || "";
    if (cfg.templateId) {
      const t = await db.emailTemplate.findUnique({ where: { id: cfg.templateId } });
      if (t && t.tenantId === ctx.tenantId) body = body || t.body || "";
    }
    body = renderTemplate(body, tmpl);
    if (!body.trim()) return { type: "send_sms", status: "skipped", detail: "Empty message" };
    await sendSms({ to: contact.phone, body, from: ctx.portal.phoneNumber });
    await logActivity({ tenantId: ctx.tenantId, contactId: contact.id, type: "text_sent", summary: "Text message sent", detail: { to: contact.phone, body, via: "automation" }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
    await emitEvent({ tenantId: ctx.tenantId, type: EVENT_TYPES.SMSSent, actor: ctx.actor, subject: { type: "contact", id: contact.id }, payload: { to: contact.phone } });
    return { type: "send_sms", status: "success", detail: `to ${contact.phone}` };
  },

  async update_field(cfg, ctx) {
    const contact = await freshContact(ctx);
    const field = cfg.field;
    if (!field) return { type: "update_field", status: "skipped", detail: "No field selected" };
    const tmpl = templateContext(contact, ctx.fieldDefs);
    const value = renderTemplate(String(cfg.value ?? ""), tmpl);
    const patch: any = {};
    if (SYSTEM_KEYS.has(field)) patch[field] = value;
    else patch.customFields = { [field]: value };
    await updateContact(contact.id, ctx.tenantId, patch, { id: ctx.actor.id, name: ctx.actor.name, type: "automation" });
    return { type: "update_field", status: "success", detail: `${field} = ${value}` };
  },

  async add_tag(cfg, ctx) {
    const contact = await freshContact(ctx);
    const field = cfg.field;
    const value = String(cfg.value ?? "").trim();
    if (!field || !value) return { type: "add_tag", status: "skipped", detail: "Tag field/value missing" };
    const cur = asArray((contact.customFields || {})[field]);
    if (cur.includes(value)) return { type: "add_tag", status: "skipped", detail: `Already has ${value}` };
    await updateContact(contact.id, ctx.tenantId, { customFields: { [field]: [...cur, value] } }, { id: ctx.actor.id, name: ctx.actor.name, type: "automation" });
    return { type: "add_tag", status: "success", detail: `+${value}` };
  },

  async remove_tag(cfg, ctx) {
    const contact = await freshContact(ctx);
    const field = cfg.field;
    const value = String(cfg.value ?? "").trim();
    if (!field || !value) return { type: "remove_tag", status: "skipped", detail: "Tag field/value missing" };
    const cur = asArray((contact.customFields || {})[field]);
    if (!cur.includes(value)) return { type: "remove_tag", status: "skipped", detail: `No ${value}` };
    await updateContact(contact.id, ctx.tenantId, { customFields: { [field]: cur.filter((v) => v !== value) } }, { id: ctx.actor.id, name: ctx.actor.name, type: "automation" });
    return { type: "remove_tag", status: "success", detail: `-${value}` };
  },

  async create_note(cfg, ctx) {
    const contact = await freshContact(ctx);
    const tmpl = templateContext(contact, ctx.fieldDefs);
    const text = renderTemplate(String(cfg.text ?? ""), tmpl).trim();
    if (!text) return { type: "create_note", status: "skipped", detail: "Empty note" };
    await logActivity({ tenantId: ctx.tenantId, contactId: contact.id, type: "note", summary: text, detail: { via: "automation" }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
    return { type: "create_note", status: "success" };
  },

  async assign_owner(cfg, ctx) {
    const contact = await freshContact(ctx);
    const userId = cfg.userId;
    if (!userId) return { type: "assign_owner", status: "skipped", detail: "No owner selected" };
    // Owner is stored on a customFields key for now (see AUTOMATIONS.md). This
    // keeps the schema stable; it can be promoted to a Contact.ownerId column later.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const ownerName = user?.name || user?.email || userId;
    await updateContact(contact.id, ctx.tenantId, { customFields: { owner: userId, ownerName } }, { id: ctx.actor.id, name: ctx.actor.name, type: "automation" });
    return { type: "assign_owner", status: "success", detail: ownerName };
  },

  // ----- Record actions (session 3) -----
  // All reuse the EXISTING contact service so validation, the tenant's
  // contact-identity rule, uniqueness, and event/loop behavior are identical to
  // the normal UI. Mutations carry actor=automation, so the engine's loop guard
  // (it ignores automation-sourced events) prevents self-retriggering.

  async create_record(cfg, ctx) {
    // Templating context comes from the triggering contact (so values can use
    // {{name}} etc.). The new record itself is brand-new and separate.
    const trigger = await prisma.contact.findUnique({ where: { id: ctx.contactId } }).catch(() => null);
    const data = valuesToContactData(cfg.values, ctx, trigger || {});
    // createContact enforces requireEmail / phone-or-email / uniqueness / required
    // custom fields — it throws on any violation, which runAction turns into a
    // failed result. We do not bypass any of it.
    const created = await createContact(ctx.tenantId, data, automationActor(ctx));
    return { type: "create_record", status: "success", detail: `created ${created.name || created.phone || created.email || created.id}` };
  },

  async update_record(cfg, ctx) {
    const useSearch = cfg.target === "search";
    const ids = useSearch ? (ctx.workingSet || []) : [ctx.contactId];
    if (!Array.isArray(cfg.values) || !cfg.values.length) return { type: "update_record", status: "skipped", detail: "No fields to set" };
    if (useSearch && !ids.length) return { type: "update_record", status: "skipped", detail: "No search results — add a Find records action first" };
    let ok = 0, fail = 0, lastErr = "";
    for (const id of ids) {
      try {
        const c = await prisma.contact.findUnique({ where: { id } });
        if (!c || c.tenantId !== ctx.tenantId) { fail++; continue; } // tenant guard
        const patch = valuesToContactData(cfg.values, ctx, c);
        await updateContact(id, ctx.tenantId, patch, automationActor(ctx));
        ok++;
      } catch (e) { fail++; lastErr = (e as Error).message; }
    }
    if (!ok && fail) return { type: "update_record", status: "failed", error: lastErr || "Update failed" };
    return { type: "update_record", status: "success", detail: useSearch ? `updated ${ok} record(s)${fail ? `, ${fail} failed` : ""}` : "updated this record" };
  },

  async search_records(cfg, ctx) {
    const columns = buildColumns(ctx.fieldDefs);
    const conditions = Array.isArray(cfg.conditions) ? cfg.conditions : [];
    // Tenant-scoped, active-only (deletedAt: null mirrors the contacts list).
    const rows = await prisma.contact.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null } as any, take: 5000 });
    const matched = rows.filter((r: any) => evalRules(r, conditions as any, columns)).slice(0, MAX_SEARCH_RESULTS).map((r: any) => r.id);
    ctx.workingSet = matched;
    return { type: "search_records", status: "success", detail: `found ${matched.length} record(s)` };
  },

  async delete_record(cfg, ctx) {
    const useSearch = cfg.target === "search";
    const ids = useSearch ? (ctx.workingSet || []) : [ctx.contactId];
    if (!ids.length) return { type: "delete_record", status: "skipped", detail: useSearch ? "No search results — add a Find records action first" : "No record to delete" };
    if (ids.length > BULK_DELETE_THRESHOLD && !cfg.allowBulk) {
      return { type: "delete_record", status: "failed", error: `Refusing to delete ${ids.length} records. Turn on "Allow bulk delete" in this action to permit more than ${BULK_DELETE_THRESHOLD}.` };
    }
    // softDeleteContacts == the recycle-bin path (sets deletedAt). Tenant-scoped.
    // Nothing is hard-deleted; restore from Recycle Bin works exactly as for a
    // user-initiated delete.
    const n = await softDeleteContacts(ctx.tenantId, ids);
    return { type: "delete_record", status: "success", detail: `moved ${n} record(s) to the recycle bin` };
  },

  // Compute a derived value from a FIXED menu of operations (no formulas/scripts)
  // and write it to a destination field. Date math is the focus:
  //   date_add / date_subtract : source date +/- amount (years|months|days)
  //   copy                     : copy a value from one field to another
  // Writes via updateContact, so tenant scoping + the normal write path apply.
  async compute_field(cfg, ctx) {
    const op = cfg.op;
    const source = cfg.source;
    const dest = cfg.dest;
    if (!dest) return { type: "compute_field", status: "skipped", detail: "No destination field selected" };
    if (op !== "copy" && !source) return { type: "compute_field", status: "skipped", detail: "No source field selected" };

    const fields = conditionFields(ctx.fieldDefs);
    const typeOf = (k: string) => fields.find((f) => f.key === k)?.type || "text";
    const isDateOp = op === "date_add" || op === "date_subtract";
    // Respect the destination field's type: date math must land in a date field.
    if (isDateOp && typeOf(dest) !== "date") {
      return { type: "compute_field", status: "failed", error: `Destination "${dest}" must be a Date field for date math` };
    }

    const useSearch = cfg.target === "search";
    const ids = useSearch ? (ctx.workingSet || []) : [ctx.contactId];
    if (useSearch && !ids.length) return { type: "compute_field", status: "skipped", detail: "No search results — add a Find records action first" };

    let ok = 0, fail = 0, skip = 0, lastErr = "", lastVal = "";
    for (const id of ids) {
      try {
        const c = await prisma.contact.findUnique({ where: { id } });
        if (!c || c.tenantId !== ctx.tenantId) { fail++; continue; } // tenant guard
        const srcRaw = source ? valueOf(c, source) : null;
        let computed: any;
        if (isDateOp) {
          const amount = Number(cfg.amount);
          if (!isFinite(amount)) { skip++; continue; }
          const unit = cfg.unit === "months" || cfg.unit === "days" ? cfg.unit : "years";
          const delta = op === "date_subtract" ? -amount : amount;
          computed = addToDateString(srcRaw, delta, unit);
          if (computed == null) { skip++; continue; } // source wasn't a valid date
        } else if (op === "copy") {
          computed = srcRaw == null ? "" : Array.isArray(srcRaw) ? srcRaw : String(srcRaw);
        } else {
          return { type: "compute_field", status: "failed", error: "Unknown operation" };
        }
        const patch: any = SYSTEM_KEYS.has(dest) ? { [dest]: computed } : { customFields: { [dest]: computed } };
        await updateContact(id, ctx.tenantId, patch, automationActor(ctx));
        ok++; lastVal = String(computed);
      } catch (e) { fail++; lastErr = (e as Error).message; }
    }
    if (!ok && fail) return { type: "compute_field", status: "failed", error: lastErr || "Compute failed" };
    if (!ok && skip) return { type: "compute_field", status: "skipped", detail: "Nothing computed (source empty or not a valid date)" };
    return { type: "compute_field", status: "success", detail: useSearch ? `set ${dest} on ${ok} record(s)` : `${dest} = ${lastVal}` };
  },
};

// Add/subtract whole calendar units to a "YYYY-MM-DD" string, returning the same
// format. All math is done in UTC so there is no timezone/DST drift. Returns null
// if the input isn't a parseable date. (amount may be negative to subtract.)
function addToDateString(dateStr: any, amount: number, unit: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? "").trim());
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(dt.getTime())) return null;
  if (unit === "years") dt.setUTCFullYear(dt.getUTCFullYear() + amount);
  else if (unit === "months") dt.setUTCMonth(dt.getUTCMonth() + amount);
  else dt.setUTCDate(dt.getUTCDate() + amount);
  return dt.toISOString().slice(0, 10);
}

function automationActor(ctx: ActionContext) {
  return { id: ctx.actor.id, name: ctx.actor.name, type: "automation" as const };
}

// Turn builder "values" rows ([{field,value}]) into a contact patch, mapping
// system keys to top-level and everything else to customFields. Values support
// {{field}} templating against the provided contact.
function valuesToContactData(values: any, ctx: ActionContext, contactForTemplating: any) {
  const tmpl = templateContext(contactForTemplating || {}, ctx.fieldDefs);
  const data: any = {};
  const custom: Record<string, any> = {};
  let hasCustom = false;
  for (const item of Array.isArray(values) ? values : []) {
    const field = item && item.field;
    if (!field) continue;
    const value = renderTemplate(String(item.value ?? ""), tmpl);
    if (SYSTEM_KEYS.has(field)) data[field] = value;
    else { custom[field] = value; hasCustom = true; }
  }
  if (hasCustom) data.customFields = custom;
  return data;
}

/** Run a single action; never throws — failures are captured in the result. */
export async function runAction(action: ActionConfig, ctx: ActionContext): Promise<ActionResult> {
  const exec = EXECUTORS[action.type];
  if (!exec) return { type: action.type, status: "failed", error: "Unknown action type" };
  try {
    return await exec(action.config || {}, ctx);
  } catch (err) {
    return { type: action.type, status: "failed", error: (err as Error).message };
  }
}
