// RecordLink service (Batch 1b) — the many-to-many join between a polymorphic
// parent and a record, carrying the relationship stage. Parent is read from
// parentType (only "contact" exists today) so account/property parents slot in
// later without rework. Unlinking is a soft-delete. Tenant-scoped throughout.

import { prisma } from "../db/client";
import { resolveRecordTypeId } from "./recordTypeService";

const db = prisma as any;

/** Links on a record (e.g. candidates on a Job), with parent display info. */
export async function listLinksForRecord(tenantId: string, recordId: string) {
  const rec = await db.record.findFirst({ where: { id: recordId, tenantId, deletedAt: null } });
  if (!rec) throw new Error("Record not found");
  const links = await db.recordLink.findMany({ where: { tenantId, recordId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const contactIds = links.filter((l: any) => l.parentType === "contact").map((l: any) => l.parentId);
  const contacts = contactIds.length ? await db.contact.findMany({ where: { id: { in: contactIds }, tenantId } }) : [];
  const byId: any = {};
  contacts.forEach((c: any) => (byId[c.id] = c));
  return links.map((l: any) => ({
    id: l.id,
    recordId: l.recordId,
    parentType: l.parentType,
    parentId: l.parentId,
    role: l.role ?? null,
    stageKey: l.stageKey ?? null,
    parent: l.parentType === "contact" && byId[l.parentId]
      ? { id: byId[l.parentId].id, name: byId[l.parentId].name, email: byId[l.parentId].email, phone: byId[l.parentId].phone }
      : null,
  }));
}

/** Links from a contact's side (e.g. Jobs this contact is on), with record display info. */
export async function listLinksForContact(tenantId: string, contactId: string, recordType?: string | null) {
  const links = await db.recordLink.findMany({ where: { tenantId, parentType: "contact", parentId: contactId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const recIds = links.map((l: any) => l.recordId);
  const recs = recIds.length ? await db.record.findMany({ where: { id: { in: recIds }, tenantId, deletedAt: null } }) : [];
  const byId: any = {};
  recs.forEach((r: any) => (byId[r.id] = r));
  let out = links
    .map((l: any) => ({
      id: l.id,
      stageKey: l.stageKey ?? null,
      role: l.role ?? null,
      record: byId[l.recordId] ? { id: byId[l.recordId].id, title: byId[l.recordId].title, recordTypeId: byId[l.recordId].recordTypeId, stageKey: byId[l.recordId].stageKey } : null,
    }))
    .filter((x: any) => x.record);
  if (recordType) {
    const rtId = await resolveRecordTypeId(tenantId, recordType);
    out = out.filter((x: any) => x.record.recordTypeId === rtId);
  }
  return out;
}

/** Create a link (or update stage/role if one already exists). Parent defaults to a contact. */
export async function createLink(tenantId: string, input: { recordId: string; parentType?: string; parentId: string; role?: string | null; stageKey?: string | null }) {
  const parentType = input.parentType || "contact";
  const rec = await db.record.findFirst({ where: { id: input.recordId, tenantId, deletedAt: null } });
  if (!rec) throw new Error("Record not found");
  if (parentType === "contact") {
    const c = await db.contact.findFirst({ where: { id: input.parentId, tenantId, deletedAt: null } });
    if (!c) throw new Error("Contact not found");
  }
  const existing = await db.recordLink.findFirst({ where: { tenantId, recordId: input.recordId, parentType, parentId: input.parentId, deletedAt: null } });
  if (existing) {
    const data: any = {};
    if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
    if (input.role !== undefined) data.role = input.role ?? null;
    if (Object.keys(data).length) return db.recordLink.update({ where: { id: existing.id }, data });
    return existing;
  }
  return db.recordLink.create({ data: { tenantId, recordId: input.recordId, parentType, parentId: input.parentId, role: input.role ?? null, stageKey: input.stageKey ?? null, customFields: {} } });
}

export async function updateLink(tenantId: string, id: string, input: { stageKey?: string | null; role?: string | null }) {
  const link = await db.recordLink.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!link) throw new Error("Link not found");
  const data: any = {};
  if (input.stageKey !== undefined) data.stageKey = input.stageKey ?? null;
  if (input.role !== undefined) data.role = input.role ?? null;
  return db.recordLink.update({ where: { id }, data });
}

/** Unlink = soft-delete the relationship (never a hard delete). */
export async function softDeleteLink(tenantId: string, id: string): Promise<void> {
  const link = await db.recordLink.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!link) throw new Error("Link not found");
  await db.recordLink.update({ where: { id }, data: { deletedAt: new Date() } });
}
