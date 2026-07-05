// Audiences = NAMED, DYNAMIC contact filters. We reuse the existing SavedFilter model with
// view="audience" rather than adding a new table: it already carries tenantId, name, a JSON
// definition (the same {rules, search} contacts-filter shape used by table.js + conditions.ts),
// createdById, and timestamps — a dedicated model would duplicate all of that plus its CRUD. An
// audience always re-evaluates to the CURRENT matching contacts (nothing is materialized).
import { listSavedFilters, createSavedFilter, updateSavedFilter, deleteSavedFilter } from "./savedFilterService";
import { prisma } from "../db/client";
import { listContacts } from "./readModels";
import { contactColSpecs, colsForEval } from "./reportExecutor";
import { evalRules, type Rule } from "../automation/conditions";

const AUDIENCE_VIEW = "audience";

export interface AudienceDTO { id: string; name: string; definition: any; createdAt: string; }

export async function listAudiences(tenantId: string): Promise<AudienceDTO[]> {
  const rows = await listSavedFilters(tenantId, AUDIENCE_VIEW);
  return rows.map((f: any) => ({ id: f.id, name: f.name, definition: f.definition ?? {}, createdAt: f.createdAt }));
}

export async function getAudience(id: string, tenantId: string): Promise<AudienceDTO | null> {
  const row = await prisma.savedFilter.findUnique({ where: { id } });
  if (!row || row.tenantId !== tenantId || row.view !== AUDIENCE_VIEW) return null;
  return { id: row.id, name: row.name, definition: (row.definition as any) ?? {}, createdAt: row.createdAt.toISOString() };
}

export async function createAudience(input: { tenantId: string; name: string; definition: unknown; createdById?: string | null }): Promise<AudienceDTO> {
  const created = await createSavedFilter({ tenantId: input.tenantId, name: input.name, view: AUDIENCE_VIEW, definition: input.definition, createdById: input.createdById });
  return { id: created.id, name: created.name, definition: (created.definition as any) ?? {}, createdAt: created.createdAt.toISOString() };
}

// Rename and/or update the criteria. Tenant-scoped + audience-view-scoped so a contacts saved
// filter can't be mutated through this path.
export async function updateAudience(id: string, tenantId: string, patch: { name?: string; definition?: unknown }): Promise<boolean> {
  const existing = await prisma.savedFilter.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId || existing.view !== AUDIENCE_VIEW) return false;
  return updateSavedFilter(id, tenantId, patch);
}

export async function deleteAudience(id: string, tenantId: string): Promise<boolean> {
  const existing = await prisma.savedFilter.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId || existing.view !== AUDIENCE_VIEW) return false;
  return deleteSavedFilter(id, tenantId);
}

// Resolve an audience to its CURRENT matching contacts by applying the stored rules with the SAME
// server-side evaluator the reports/automations use. This is what A2 / Drips will call. Always
// live: it reads contacts + rules fresh, so a contact that starts/stops matching is reflected
// immediately. Returns null if the audience doesn't exist for this tenant.
export async function resolveAudienceContacts(
  tenantId: string,
  audienceId: string,
): Promise<Array<{ id: string; name: string | null; email: string | null }> | null> {
  const aud = await getAudience(audienceId, tenantId);
  if (!aud) return null;
  const rules: Rule[] = (aud.definition && Array.isArray(aud.definition.rules)) ? aud.definition.rules : [];
  const specs = await contactColSpecs(tenantId);
  const evalCols = colsForEval(specs);
  const contacts = await listContacts(tenantId);
  const matches = contacts.filter((row: any) => evalRules(row, rules, evalCols));
  return matches.map((c: any) => ({ id: c.id, name: c.name ?? null, email: c.email ?? null }));
}

// Count-only helper (for library match counts) — same evaluation, no row payload.
export async function countAudienceContacts(tenantId: string, audienceId: string): Promise<number | null> {
  const rows = await resolveAudienceContacts(tenantId, audienceId);
  return rows ? rows.length : null;
}
