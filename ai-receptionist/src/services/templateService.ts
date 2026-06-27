import { prisma } from "../db/client";

const db = prisma as any;

function dto(t: any) {
  return {
    id: t.id, name: t.name, kind: t.kind, subject: t.subject ?? "", body: t.body ?? "", tag: t.tag ?? null,
    createdById: t.createdById ?? null,
    createdAt: t.createdAt ? t.createdAt.toISOString() : null,
    updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
  };
}

export async function listTemplates(tenantId: string, kind?: string) {
  const where: any = { tenantId };
  if (kind) where.kind = kind;
  const rows = await db.emailTemplate.findMany({ where, orderBy: { name: "asc" } });
  // Resolve creator names for the Templates tab's "Updated by" column. The model has
  // no separate updatedById, so the creator is the best available attribution.
  const ids = Array.from(new Set(rows.map((t: any) => t.createdById).filter(Boolean))) as string[];
  const nameById: Record<string, string | null> = {};
  if (ids.length) {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
    users.forEach((u: any) => { nameById[u.id] = u.name || u.email || null; });
  }
  return rows.map((t: any) => ({ ...dto(t), createdByName: t.createdById ? (nameById[t.createdById] ?? null) : null }));
}

export async function createTemplate(input: { tenantId: string; name: string; kind: string; subject?: string | null; body: string; tag?: string | null; createdById?: string | null }) {
  const t = await db.emailTemplate.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      kind: input.kind === "sms" ? "sms" : "email",
      subject: input.subject ?? null,
      body: input.body ?? "",
      tag: input.tag ?? null,
      createdById: input.createdById ?? null,
    },
  });
  return dto(t);
}

// Update an existing template IN PLACE (bound to its id; never creates a duplicate).
// Tenant-scoped: returns null if the id isn't this tenant's.
export async function updateTemplate(
  id: string,
  tenantId: string,
  input: { name?: string; subject?: string | null; body?: string; tag?: string | null },
): Promise<ReturnType<typeof dto> | null> {
  const existing = await db.emailTemplate.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== tenantId) return null;
  const data: any = {};
  if (input.name != null && String(input.name).trim()) data.name = String(input.name).trim();
  if (input.subject !== undefined) data.subject = input.subject ?? null;
  if (input.body !== undefined) data.body = input.body ?? "";
  if (input.tag !== undefined) data.tag = input.tag ?? null;
  const t = await db.emailTemplate.update({ where: { id }, data });
  return dto(t);
}

export async function deleteTemplate(id: string, tenantId: string): Promise<boolean> {
  const t = await db.emailTemplate.findUnique({ where: { id } });
  if (!t || t.tenantId !== tenantId) return false;
  await db.emailTemplate.delete({ where: { id } });
  return true;
}
