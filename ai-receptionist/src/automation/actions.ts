import { prisma } from "../db/client";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES, EventActor } from "../events/types";
import { sendRichEmail } from "../services/notificationService";
import { sendSms } from "../services/smsService";
import { updateContact, createContact, softDeleteContacts } from "../services/contactService";
import { addRecordNote } from "../services/recordService";
import { listLinksForRecord } from "../services/recordLinkService";
import { log as logActivity } from "../services/activityService";
import { FieldMeta, renderTemplate, templateContext, buildColumns, valueOf, conditionFields, loadFieldDefs } from "./contactRow";
import { evalRules } from "./conditions";
import { validateWebhookUrl, sendWebhook, buildContactPayload } from "./webhook";

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
  // The trigger/event that started this run (best-effort), included in webhook
  // payloads. Set by the engine; a generic label for queued/scheduled jobs.
  triggerType?: string;
  // Extra {{token}} values beyond contact fields (e.g. {{new_stage}},
  // {{record_title}} from a StageChanged event). Layered on top of the contact's
  // field tokens by templateTokens(). Optional; empty when the event has none.
  extraTokens?: Record<string, string>;
  // Stage 2a: set when the automation's subject is a record (e.g. a job) rather
  // than a contact. "create_note" then targets the record; contact-only actions
  // are blocked upstream by the engine. Unset = the normal contact behavior.
  subjectType?: "contact" | "record";
  recordId?: string;
  recordTitle?: string | null;
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
  { type: "wait", label: "Wait / delay (then run the actions below later)" },
  { type: "create_record", label: "Create a record" },
  { type: "update_record", label: "Update a record" },
  { type: "search_records", label: "Find records" },
  { type: "delete_record", label: "Delete a record (to recycle bin)" },
  { type: "compute_field", label: "Compute value into field" },
  { type: "send_webhook", label: "Send webhook (POST to a URL)" },
  // Record-subject only: fan out to the record's linked contacts (e.g. a job's
  // candidates). Generic label — no "job"/"candidate" hardcoded.
  { type: "act_on_linked", label: "Act on linked contacts (note / mock email / SMS each)" },
];

// A single flow run may delete at most this many records WITHOUT the action
// being explicitly set to "Allow bulk delete". This stops a misconfigured
// Find + Delete from silently emptying a CRM. Everything deleted is soft-deleted
// (recycle bin) and can be restored regardless.
const BULK_DELETE_THRESHOLD = 10;
// A single "act on linked contacts" run may MESSAGE (mock email/SMS) at most
// this many linked contacts WITHOUT the action being explicitly set to "Allow
// bulk send". This is the confirm-before-large-batch-send guard. Internal-note
// fan-out is exempt (no outbound comms). Change this one number to retune.
const BULK_SEND_THRESHOLD = 25;
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

// Build the {{token}} map for templating: a contact's own field tokens, with
// any event-supplied extras (e.g. {{new_stage}}, {{record_title}}) layered on
// top. Centralized so every action templates the same way. With no extras this
// is identical to the previous templateContext() behavior.
function templateTokens(contact: any, ctx: ActionContext): Record<string, string> {
  return { ...templateContext(contact, ctx.fieldDefs), ...(ctx.extraTokens || {}) };
}

const EXECUTORS: Record<string, Executor> = {
  async send_email(cfg, ctx) {
    const contact = await freshContact(ctx);
    if (!contact.email) return { type: "send_email", status: "skipped", detail: "Contact has no email" };
    const tmpl = templateTokens(contact, ctx);
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
    const tmpl = templateTokens(contact, ctx);
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
    const tmpl = templateTokens(contact, ctx);
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
    // Record subject (Stage 2a): write the note to the record's activity, which
    // shows on the job's detail page. Templating uses the record tokens only.
    if (ctx.subjectType === "record") {
      if (!ctx.recordId) return { type: "create_note", status: "failed", error: "No record subject to attach the note to" };
      const text = renderTemplate(String(cfg.text ?? ""), ctx.extraTokens || {}).trim();
      if (!text) return { type: "create_note", status: "skipped", detail: "Empty note" };
      await addRecordNote(ctx.tenantId, ctx.recordId, text, { id: ctx.actor.id, name: ctx.actor.name, type: "automation" });
      return { type: "create_note", status: "success", detail: "added note to record" };
    }
    const contact = await freshContact(ctx);
    const tmpl = templateTokens(contact, ctx);
    const text = renderTemplate(String(cfg.text ?? ""), tmpl).trim();
    if (!text) return { type: "create_note", status: "skipped", detail: "Empty note" };
    await logActivity({ tenantId: ctx.tenantId, contactId: contact.id, type: "note", summary: text, detail: { via: "automation" }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
    return { type: "create_note", status: "success" };
  },

  // ----- Act on linked contacts (Stage 2b) -----
  // Record-subject only. Resolves the record's linked contacts (e.g. a job's
  // candidates) via the EXISTING listLinksForRecord helper (tenant-scoped), then
  // applies one sub-action to EACH: a note on the contact's own timeline, or a
  // mock email / SMS. Per-candidate templating ({{name}}) plus the job tokens
  // ({{record_title}}) are both available.
  async act_on_linked(cfg, ctx) {
    if (ctx.subjectType !== "record" || !ctx.recordId) {
      return { type: "act_on_linked", status: "failed", error: "This action only runs on record-subject automations (e.g. a Record/Status-change trigger)." };
    }
    const sub = String(cfg.subAction || "note"); // "note" | "email" | "sms"

    // Resolve linked contacts for this record (same portal; helper is tenant-scoped).
    let links: any[] = [];
    try { links = await listLinksForRecord(ctx.tenantId, ctx.recordId); }
    catch (e) { return { type: "act_on_linked", status: "failed", error: `Could not load linked records: ${(e as Error).message}` }; }
    const candidates = (links || []).filter((l: any) => l.parentType === "contact" && l.parent && l.parent.id);

    // ANTI-SILENT-GREEN: zero linked contacts is never a quiet success.
    if (!candidates.length) {
      return { type: "act_on_linked", status: "failed", error: "No linked candidates to act on" };
    }

    const messaging = sub === "email" || sub === "sms";
    // SEND-SAFETY GATE: messaging beyond the threshold requires explicit allow-bulk.
    // Counts the resolved recipients regardless of mock vs real, so it stays
    // correct once real provider keys are added.
    if (messaging && candidates.length > BULK_SEND_THRESHOLD && !cfg.allowBulk) {
      return { type: "act_on_linked", status: "failed", error: `Would message ${candidates.length} linked contacts; bulk send not allowed. Turn on "Allow bulk send" on this action to permit more than ${BULK_SEND_THRESHOLD}.` };
    }

    const contactFieldDefs = await loadFieldDefs(ctx.tenantId);
    let ok = 0;
    let fail = 0;
    const errs: string[] = [];
    for (const lk of candidates) {
      const who = lk.parent.name || lk.parent.email || lk.parent.phone || lk.parent.id;
      try {
        const cand = await prisma.contact.findUnique({ where: { id: lk.parent.id } });
        if (!cand || cand.tenantId !== ctx.tenantId) { fail++; errs.push(`${who}: not found`); continue; } // tenant guard
        const tokens = { ...templateContext(cand, contactFieldDefs), ...(ctx.extraTokens || {}) };

        if (sub === "note") {
          const text = renderTemplate(String(cfg.text ?? ""), tokens).trim();
          if (!text) { fail++; errs.push(`${who}: empty note`); continue; }
          await logActivity({ tenantId: ctx.tenantId, contactId: cand.id, type: "note", summary: text, detail: { via: "automation", fromRecord: ctx.recordId }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
          ok++;
        } else if (sub === "email") {
          if (!cand.email) { fail++; errs.push(`${who}: no email`); continue; }
          const subject = renderTemplate(String(cfg.subject ?? ""), tokens);
          const html = renderTemplate(String(cfg.html ?? cfg.body ?? ""), tokens);
          await sendRichEmail({ to: cand.email, subject, html, fromEmail: ctx.portal.notifyEmail || "", fromName: ctx.portal.name });
          await logActivity({ tenantId: ctx.tenantId, contactId: cand.id, type: "email_sent", summary: `Email sent: ${subject}`, detail: { subject, to: cand.email, via: "automation" }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
          await emitEvent({ tenantId: ctx.tenantId, type: EVENT_TYPES.EmailSent, actor: ctx.actor, subject: { type: "contact", id: cand.id }, payload: { subject, to: cand.email } });
          ok++;
        } else if (sub === "sms") {
          if (!cand.phone) { fail++; errs.push(`${who}: no phone`); continue; }
          const body = renderTemplate(String(cfg.body ?? ""), tokens);
          if (!body.trim()) { fail++; errs.push(`${who}: empty message`); continue; }
          await sendSms({ to: cand.phone, body, from: ctx.portal.phoneNumber });
          await logActivity({ tenantId: ctx.tenantId, contactId: cand.id, type: "text_sent", summary: "Text message sent", detail: { to: cand.phone, body, via: "automation" }, actor: { id: ctx.actor.id, name: ctx.actor.name, type: "automation" } });
          await emitEvent({ tenantId: ctx.tenantId, type: EVENT_TYPES.SMSSent, actor: ctx.actor, subject: { type: "contact", id: cand.id }, payload: { to: cand.phone } });
          ok++;
        } else {
          fail++; errs.push(`${who}: unknown sub-action`);
        }
      } catch (e) { fail++; errs.push(`${who}: ${(e as Error).message}`); }
    }

    const verb = sub === "note" ? "noted" : sub === "email" ? "emailed (mock)" : "messaged (mock)";
    // ANTI-SILENT-GREEN: any per-candidate failure makes the whole result FAILED,
    // with succeeded/failed counts and reasons — never a blanket green.
    if (fail > 0) {
      const more = errs.length > 5 ? ` …(+${errs.length - 5} more)` : "";
      return { type: "act_on_linked", status: "failed", error: `${verb} ${ok}/${candidates.length}; ${fail} failed: ${errs.slice(0, 5).join("; ")}${more}` };
    }
    return { type: "act_on_linked", status: "success", detail: `${verb} ${ok} linked contact(s)` };
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

  // "wait" is handled by the flow runner (engine.runOne splits the flow at the
  // Wait step and queues what follows). This no-op exists only so a stray queued
  // wait can never produce an "unknown action" failure.
  async wait(_cfg, _ctx) {
    return { type: "wait", status: "success", detail: "no-op (handled by the flow runner)" };
  },

  // Outbound webhook: POST a JSON snapshot of the triggering contact (+ flow
  // metadata) to a configured URL. Tenant-scoped (only ctx.tenantId's contact),
  // SSRF-checked, short timeout, and the optional secret header is NEVER logged.
  async send_webhook(cfg, ctx) {
    const url = String(cfg.url || "").trim();
    if (!url) return { type: "send_webhook", status: "skipped", detail: "No URL configured" };

    const check = await validateWebhookUrl(url);
    if (!check.ok) return { type: "send_webhook", status: "failed", error: `Blocked URL: ${check.reason}` };

    const contact = await freshContact(ctx); // tenant-checked
    const payload = {
      source: "ClarityCRM",
      event: {
        tenantId: ctx.tenantId,
        automationId: ctx.actor.id,
        automationName: ctx.actor.name,
        trigger: ctx.triggerType || "unknown",
        occurredAt: new Date().toISOString(),
      },
      contact: buildContactPayload(contact, ctx.fieldDefs),
    };

    const r = await sendWebhook({ url, headerName: cfg.headerName, headerValue: cfg.headerValue, payload });
    if (r.outcome === "blocked") return { type: "send_webhook", status: "failed", error: `Blocked URL: ${r.reason}` };
    if (r.outcome === "timeout") return { type: "send_webhook", status: "failed", error: "Timed out (no response in 5s)" };
    if (r.outcome === "error") return { type: "send_webhook", status: "failed", error: `Request failed: ${r.error}` };
    if (r.ok) return { type: "send_webhook", status: "success", detail: `POST ${check.host} → ${r.status}` };
    return { type: "send_webhook", status: "failed", error: `POST ${check.host} → HTTP ${r.status}` };
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
  const tmpl = templateTokens(contactForTemplating || {}, ctx);
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
