// Pipeline / Funnel read model (records reporting, batch 4).
//
// One row per active RecordLink (a contact-in-a-policy-at-a-stage relationship).
// This is the unit the funnel counts — we never collapse a policy to a single
// stage. Read-only and tenant-scoped: every query filters by tenantId, and the
// route resolves the tenant via resolveTenantScope before calling in.
//
// Stage label + pipeline order are resolved from the parent record's pipeline:
// the record's subtype stage list (RecordType.subtypes[].stages) if it has a
// subtype, otherwise the record type's top-level stages. Order is the position
// in that list (how the app orders stages everywhere). Reads existing columns
// only — no schema change.

import { prisma } from "../db/client";
import { listRecordTypes } from "./recordTypeService";

const db = prisma as any;

function stagesFor(rt: any, subtypeKey: string | null): any[] {
  if (!rt) return [];
  if (subtypeKey) {
    const st = (rt.subtypes || []).find((s: any) => s && s.key === subtypeKey);
    if (st && Array.isArray(st.stages)) return st.stages;
  }
  return Array.isArray(rt.stages) ? rt.stages : [];
}

export interface PipelineRow {
  id: string;
  stageKey: string | null;
  stageLabel: string;
  stageOrder: number;
  recordType: string | null;
  recordTypeLabel: string;
  subtypeLabel: string;
  recordStatusLabel: string;
  recordTitle: string;
  contactName: string;
  contactIntent: string;
  customFields: Record<string, unknown>;
  createdAt: Date;
}

export async function listPipelineLinks(tenantId: string): Promise<PipelineRow[]> {
  // Record types → label / stage / subtype / record-status lookups.
  const types = (await listRecordTypes(tenantId)) as any[];
  const typeById: Record<string, any> = {};
  types.forEach((t) => { typeById[t.id] = t; });

  const links = await db.recordLink.findMany({
    where: { tenantId, parentType: "contact", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!links.length) return [];

  const recIds = Array.from(new Set(links.map((l: any) => l.recordId)));
  const recs = await db.record.findMany({ where: { id: { in: recIds }, tenantId, deletedAt: null } });
  const recById: Record<string, any> = {};
  recs.forEach((r: any) => { recById[r.id] = r; });

  const contactIds = Array.from(new Set(links.map((l: any) => l.parentId)));
  const contacts = contactIds.length
    ? await db.contact.findMany({ where: { id: { in: contactIds }, tenantId } })
    : [];
  const contactById: Record<string, any> = {};
  contacts.forEach((c: any) => { contactById[c.id] = c; });

  const rows: PipelineRow[] = [];
  for (const l of links as any[]) {
    const rec = recById[l.recordId];
    if (!rec) continue; // record missing/soft-deleted → drop the orphan link
    const rt = typeById[rec.recordTypeId];
    const stages = stagesFor(rt, rec.subtypeKey ?? null);
    const idx = stages.findIndex((s: any) => s && s.key === l.stageKey);
    const stage = idx >= 0 ? stages[idx] : null;
    const subtype = rt ? (rt.subtypes || []).find((s: any) => s && s.key === rec.subtypeKey) : null;
    const recStatus = rt ? (rt.recordStages || []).find((s: any) => s && s.key === rec.stageKey) : null;
    const c = contactById[l.parentId];
    rows.push({
      id: l.id,
      stageKey: l.stageKey ?? null,
      stageLabel: stage ? String(stage.label ?? stage.key) : (l.stageKey ? String(l.stageKey) : "(no stage)"),
      stageOrder: idx >= 0 ? idx : 9999,
      recordType: rt ? rt.key : null,
      recordTypeLabel: rt ? String(rt.label || rt.key) : "(unknown type)",
      subtypeLabel: subtype ? String(subtype.label ?? subtype.key) : (rec.subtypeKey ? String(rec.subtypeKey) : ""),
      recordStatusLabel: recStatus ? String(recStatus.label ?? recStatus.key) : (rec.stageKey ? String(rec.stageKey) : ""),
      recordTitle: rec.title || "",
      contactName: c ? (c.name || "") : "",
      contactIntent: c ? (c.intent || "") : "",
      customFields: c ? ((c.customFields as any) || {}) : {},
      createdAt: l.createdAt,
    });
  }
  return rows;
}
