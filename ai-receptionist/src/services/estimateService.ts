// Estimates Lifecycle batch: send → public accept/decline → convert.
//
// Everything here rides existing machinery: records via recordService, links
// via recordLinkService, timeline via activityService, sends via
// notificationService, events via the bus. The public surface (see
// routes/estimatePublic.ts) resolves tenant/record/contact SERVER-SIDE from the
// token row only, and its payload is a strict allowlist — no portal data, no
// other records, ever. NO payment collection anywhere.

import crypto from "crypto";
import { prisma } from "../db/client";
import { createRecord, getRecord, updateRecord, addRecordNote } from "./recordService";
import { resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY, INVOICE_RECORD_TYPE_KEY, ensureEstimateDefaultFields, ensureInvoiceDefaultFields } from "./recordTypeService";
import { listLinksForRecord, createLink } from "./recordLinkService";
import { log as logActivity } from "./activityService";
import { sendRichEmail } from "./notificationService";
import { getPortalTheme } from "./portalService";
import { emitEvent } from "../events/bus";
import { EVENT_TYPES } from "../events/types";

const db = prisma as any;

export const ESTIMATE_RECORD_TYPE_KEY = "estimate";
const DEFAULT_VALIDITY_DAYS = 30; // approved: stamped onto valid_until at send when empty

// ---------------------------------------------------------------------------
// Helpers

async function loadEstimate(tenantId: string, recordId: string): Promise<any> {
  const rec = await getRecord(tenantId, recordId);
  const rtId = await resolveRecordTypeId(tenantId, ESTIMATE_RECORD_TYPE_KEY);
  if (!rec || rec.recordTypeId !== rtId) throw new Error("That record isn't an estimate.");
  // Field backfill for OLDER portals: system-type field seeding runs only when a
  // type row is first CREATED (ensureRecordType's one-time onCreate), so tenants
  // whose Estimate row predates the pre-built field registry have none of the
  // seeded fields this lifecycle reads/writes (status, line_items, valid_until,
  // total…). seedDefaultFields is idempotent by key, so ensuring here — exactly
  // when the feature is actually used — is a no-op everywhere else and never
  // touches renamed/edited fields.
  await ensureEstimateDefaultFields(tenantId, rtId);
  return rec;
}

/** The estimate's first linked contact (the customer), or null. */
async function linkedContact(tenantId: string, recordId: string): Promise<any | null> {
  const links = await listLinksForRecord(tenantId, recordId);
  const first = (links || []).find((l: any) => l.parentType === "contact");
  if (!first) return null;
  return db.contact.findFirst({ where: { id: first.parentId, tenantId, deletedAt: null } });
}

/** End of the estimate's valid_until day (record wall-date convention), or null. */
export function validUntilCutoff(validUntil: any): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(validUntil || "").trim());
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T23:59:59.999Z`);
}

function linkState(link: any, validUntil: any): "active" | "decided" | "revoked" | "expired" {
  if (link.decidedAt) return "decided";
  if (link.revokedAt) return "revoked";
  const cutoff = validUntilCutoff(validUntil);
  if (cutoff && Date.now() > cutoff.getTime()) return "expired";
  return "active";
}

// ---------------------------------------------------------------------------
// SEND: mint a link (revoking any older ones), stamp valid_until + status.

export async function issueEstimateLink(
  tenantId: string,
  recordId: string,
  opts: { actor?: { id?: string | null; name?: string | null }; email?: boolean; origin?: string } = {},
): Promise<{ token: string; url: string; validUntil: string; emailedTo: string | null }> {
  const rec = await loadEstimate(tenantId, recordId);
  const cf = rec.customFields || {};
  if (String(cf.status || "") === "Accepted" || String(cf.status || "") === "Declined") {
    throw new Error("This estimate has already been decided.");
  }

  // Default validity: stamp valid_until 30 days out when empty (the per-estimate
  // override is simply editing the field before or after sending).
  let validUntil = String(cf.valid_until || "").trim();
  if (!validUntil) validUntil = new Date(Date.now() + DEFAULT_VALIDITY_DAYS * 86400000).toISOString().slice(0, 10);

  const contact = await linkedContact(tenantId, recordId);

  // Re-sending mints a FRESH link and revokes the old ones (a forwarded stale
  // link can never race a newer one).
  await db.estimateLink.updateMany({ where: { tenantId, recordId, decidedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = crypto.randomBytes(32).toString("hex"); // survey-precedent token strength
  await db.estimateLink.create({ data: { tenantId, recordId, contactId: contact ? contact.id : null, token } });

  // Status -> Sent via the EXISTING record write path (audit + events as a
  // manual edit would); valid_until stamped in the same write.
  await updateRecord(tenantId, recordId, { customFields: { ...cf, status: "Sent", valid_until: validUntil } });

  const url = `${(opts.origin || "").replace(/\/$/, "")}/estimate.html?token=${encodeURIComponent(token)}`;

  let emailedTo: string | null = null;
  if (opts.email) {
    if (!contact) throw new Error("No linked customer to email — link a contact first, or copy the link instead.");
    if (!String(contact.email || "").trim()) throw new Error(`${contact.name || "The linked customer"} has no email — copy the link instead.`);
    const portal = await db.tenant.findUnique({ where: { id: tenantId } });
    const title = rec.title || "Your estimate";
    await sendRichEmail({
      to: contact.email,
      subject: `${title} from ${portal?.name || "us"}`,
      html: [
        `<p style="margin:0 0 8px">Hi ${contact.name || "there"},</p>`,
        `<p style="margin:0 0 8px">Your estimate is ready to review. You can accept or decline it online:</p>`,
        `<p style="margin:0 0 8px"><a href="${url}">View your estimate</a></p>`,
        `<p style="margin:0 0 8px">This link is valid until ${validUntil}.</p>`,
      ].join(""),
      fromEmail: portal?.notifyEmail || "",
      fromName: portal?.name || null,
    }, { tenantId, contactId: contact.id, kind: "estimate_link" } as any);
    await logActivity({ tenantId, contactId: contact.id, type: "email_sent", summary: `Estimate link sent: ${title}`, detail: { fromRecord: recordId, via: "estimate_link" }, actor: opts.actor as any });
    emailedTo = contact.email;
  }
  await addRecordNote(tenantId, recordId, `Estimate link ${opts.email && emailedTo ? "emailed to " + emailedTo : "created"} — valid until ${validUntil}.`, opts.actor as any);
  return { token, url, validUntil, emailedTo };
}

// ---------------------------------------------------------------------------
// PUBLIC: resolve a token to the allowlisted payload; stamp first view.

const PUBLIC_UNAVAILABLE = "This estimate isn't available.";

export async function resolveEstimatePublic(token: string): Promise<any | null> {
  const t = String(token || "").trim();
  if (!t || t.length < 32) return null;
  const link = await db.estimateLink.findUnique({ where: { token: t } });
  if (!link) return null;
  const rec = await db.record.findFirst({ where: { id: link.recordId, tenantId: link.tenantId, deletedAt: null } });
  if (!rec) return null;
  const cf = rec.customFields || {};
  const state = linkState(link, cf.valid_until);
  if (state === "revoked") return null; // a revoked link is simply gone
  if (!link.viewedAt && state === "active") {
    await db.estimateLink.update({ where: { id: link.id }, data: { viewedAt: new Date() } });
  }
  const portal = await db.tenant.findUnique({ where: { id: link.tenantId } });
  const theme = await getPortalTheme(link.tenantId);
  // STRICT ALLOWLIST — the estimate's own content + business identity. Nothing
  // else ever joins this object (tested against an exact key set).
  return {
    available: true,
    state, // "active" | "decided" | "expired"
    business: { name: portal?.name || "", logo: (theme as any)?.logo || null },
    estimate: {
      title: rec.title || "Estimate",
      number: String(cf.estimate_number || ""),
      date: String(cf.estimate_date || ""),
      validUntil: String(cf.valid_until || ""),
      lineItems: Array.isArray(cf.line_items) ? cf.line_items.map((li: any) => ({ description: String(li?.description ?? li?.name ?? ""), quantity: Number(li?.quantity) || 0, unitPrice: Number(li?.unitPrice ?? li?.unit_price) || 0, amount: Number(li?.amount) || 0 })) : [],
      total: Number(cf.total) || 0,
      notes: String(cf.notes || ""),
    },
    decision: link.decision || null,
    decidedAt: link.decidedAt ? link.decidedAt.toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// DECIDE: idempotent + terminal. Timestamps the link, flips the status field,
// logs the contact timeline, fires EstimateDecided through the bus.

export async function decideEstimate(token: string, decision: string, comment?: string): Promise<{ ok: boolean; code?: string; message?: string; duplicate?: boolean }> {
  const d = decision === "accepted" || decision === "declined" ? decision : null;
  if (!d) return { ok: false, code: "bad", message: "Please choose accept or decline." };
  const t = String(token || "").trim();
  const link = t ? await db.estimateLink.findUnique({ where: { token: t } }) : null;
  if (!link || link.revokedAt) return { ok: false, code: "unavailable", message: PUBLIC_UNAVAILABLE };
  // SUSPENSION: a suspended tenant stops accepting public decisions. Same
  // "unavailable" answer a dead link gets — the public learns nothing.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (await require("./tenantSuspensionService").isTenantSuspended(link.tenantId)) return { ok: false, code: "unavailable", message: PUBLIC_UNAVAILABLE };
  if (link.decidedAt) {
    // Idempotent: the SAME decision again reports success-as-duplicate; a
    // DIFFERENT one is refused — decisions are terminal.
    if (link.decision === d) return { ok: true, duplicate: true };
    return { ok: false, code: "decided", message: "This estimate has already been decided." };
  }
  const rec = await db.record.findFirst({ where: { id: link.recordId, tenantId: link.tenantId, deletedAt: null } });
  if (!rec) return { ok: false, code: "unavailable", message: PUBLIC_UNAVAILABLE };
  const cf = rec.customFields || {};
  if (linkState(link, cf.valid_until) === "expired") return { ok: false, code: "expired", message: "This estimate has expired. Please contact the business for a fresh one." };

  const cleanComment = String(comment || "").trim().slice(0, 500) || null;
  // Terminal guard at the DB: only an undecided, unrevoked row can take the
  // decision (a concurrent double-tap loses the updateMany race and lands in
  // the idempotent branch on retry).
  const claimed = await db.estimateLink.updateMany({
    where: { id: link.id, decidedAt: null, revokedAt: null },
    data: { decidedAt: new Date(), decision: d, comment: cleanComment },
  });
  if (!claimed.count) return decideEstimate(token, decision, comment);

  // Status via the EXISTING record write path.
  await updateRecord(link.tenantId, link.recordId, { customFields: { ...cf, status: d === "accepted" ? "Accepted" : "Declined" } });
  await addRecordNote(link.tenantId, link.recordId, `Customer ${d} this estimate${cleanComment ? ` — “${cleanComment}”` : ""}.`, { type: "system", name: "Estimate page" } as any);
  if (link.contactId) {
    await logActivity({
      tenantId: link.tenantId, contactId: link.contactId, type: "estimate_decision",
      summary: `${d === "accepted" ? "Accepted" : "Declined"} estimate: ${rec.title || "Estimate"}`,
      detail: { fromRecord: link.recordId, decision: d, comment: cleanComment },
    });
  }
  await emitEvent({
    tenantId: link.tenantId,
    type: EVENT_TYPES.EstimateDecided,
    subject: { type: "record", id: link.recordId },
    actor: { type: "system", name: "Estimate page" },
    payload: { decision: d, comment: cleanComment, record_title: rec.title || "Estimate" },
  } as any);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CONVERT: accepted-only, once-only. Work order always; invoice by default.

export async function convertEstimate(
  tenantId: string,
  recordId: string,
  opts: { invoice?: boolean; actor?: { id?: string | null; name?: string | null } } = {},
): Promise<{ workOrderId: string; invoiceId: string | null; already?: boolean }> {
  const rec = await loadEstimate(tenantId, recordId);
  const cf = rec.customFields || {};
  if (String(cf.status || "") !== "Accepted") throw new Error("Only an accepted estimate can be converted.");

  // Once-only guard: the stored conversion link IS the idempotence record —
  // a second click navigates to the existing work order, never duplicates.
  const links = await listLinksForRecord(tenantId, recordId);
  const woTypeId = await resolveRecordTypeId(tenantId, WORK_ORDER_RECORD_TYPE_KEY);
  for (const l of links || []) {
    if (l.parentType !== "record") continue;
    const otherId = l.recordId === recordId ? l.parentId : l.recordId;
    const other = await db.record.findFirst({ where: { id: otherId, tenantId, recordTypeId: woTypeId, deletedAt: null } });
    if (other && (l.role === "converted_from_estimate" || (other.customFields || {}).converted_from_estimate === recordId)) {
      return { workOrderId: other.id, invoiceId: null, already: true };
    }
  }

  // Address carry: the estimate's first address-type field value, if any.
  const rtId = await resolveRecordTypeId(tenantId, ESTIMATE_RECORD_TYPE_KEY);
  const addrDef = await db.fieldDef.findFirst({ where: { tenantId, recordTypeId: rtId, type: "address" }, orderBy: { order: "asc" } });
  const addrVal = addrDef ? (cf as any)[addrDef.key] : null;

  // Work-order subtype is REQUIRED at create when the module has subtypes; the
  // conversion picks the tenant's FIRST one (whatever they've named it) — the
  // dispatcher refines it on the record like any other field.
  const woRow = await db.recordType.findFirst({ where: { tenantId, id: woTypeId } });
  const firstSubtype = Array.isArray(woRow?.subtypes) && woRow.subtypes.length ? (woRow.subtypes[0] as any).key : null;
  const wo: any = await createRecord(tenantId, WORK_ORDER_RECORD_TYPE_KEY, {
    title: rec.title || "Converted estimate",
    subtypeKey: firstSubtype,
    customFields: {
      description: String(cf.notes || "") || `From estimate ${cf.estimate_number || ""}`.trim(),
      converted_from_estimate: recordId,
      ...(addrVal ? { service_address: addrVal } : {}),
    },
  } as any);
  await createLink(tenantId, { recordId: wo.id, parentType: "record", parentId: recordId, role: "converted_from_estimate" });

  const contact = await linkedContact(tenantId, recordId);
  if (contact) await createLink(tenantId, { recordId: wo.id, parentType: "contact", parentId: contact.id, role: "customer" });

  let invoiceId: string | null = null;
  if (opts.invoice !== false) {
    // Same backfill honesty for Invoices (see loadEstimate) — total/number
    // computation depends on the seeded field rows existing.
    const invTypeId = await resolveRecordTypeId(tenantId, INVOICE_RECORD_TYPE_KEY);
    await ensureInvoiceDefaultFields(tenantId, invTypeId);
    const inv: any = await createRecord(tenantId, INVOICE_RECORD_TYPE_KEY, {
      title: rec.title || "Invoice",
      customFields: { line_items: Array.isArray(cf.line_items) ? cf.line_items : [], converted_from_estimate: recordId },
    } as any);
    invoiceId = inv.id;
    await createLink(tenantId, { recordId: inv.id, parentType: "record", parentId: recordId, role: "converted_from_estimate" });
    if (contact) await createLink(tenantId, { recordId: inv.id, parentType: "contact", parentId: contact.id, role: "customer" });
  }

  await addRecordNote(tenantId, recordId, `Converted to a work order${invoiceId ? " + invoice" : ""}.`, opts.actor as any);
  return { workOrderId: wo.id, invoiceId };
}

/** Portal status summary for the record page (sent/viewed/decided/expired). */
export async function estimateLinkStatus(tenantId: string, recordId: string): Promise<any> {
  const rec = await loadEstimate(tenantId, recordId);
  const cf = rec.customFields || {};
  const link = await db.estimateLink.findFirst({ where: { tenantId, recordId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  if (!link) return { sent: false, status: String(cf.status || "Draft") };
  return {
    sent: true,
    status: String(cf.status || ""),
    state: linkState(link, cf.valid_until),
    viewedAt: link.viewedAt ? link.viewedAt.toISOString() : null,
    decidedAt: link.decidedAt ? link.decidedAt.toISOString() : null,
    decision: link.decision || null,
    comment: link.comment || null,
    validUntil: String(cf.valid_until || ""),
  };
}
