import { prisma } from "../db/client";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES, EventActor } from "../events/types";
import { sendRichEmail } from "../services/notificationService";
import { sendSms } from "../services/smsService";
import { updateContact } from "../services/contactService";
import { log as logActivity } from "../services/activityService";
import { FieldMeta, renderTemplate, templateContext } from "./contactRow";

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
];

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
};

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
