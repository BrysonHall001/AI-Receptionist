import { prisma } from "../db/client";

export async function listTemplates(tenantId: string, kind?: string) {
  const where: any = { tenantId };
  if (kind) where.kind = kind;
  const rows = await prisma.emailTemplate.findMany({ where, orderBy: { name: "asc" } });
  return rows.map((t: any) => ({ id: t.id, name: t.name, kind: t.kind, subject: t.subject ?? "", body: t.body ?? "" }));
}

export async function createTemplate(input: { tenantId: string; name: string; kind: string; subject?: string | null; body: string; createdById?: string | null }) {
  const t = await prisma.emailTemplate.create({
    data: {
      tenantId: input.tenantId,
      name: input.name.trim(),
      kind: input.kind === "sms" ? "sms" : "email",
      subject: input.subject ?? null,
      body: input.body ?? "",
      createdById: input.createdById ?? null,
    },
  });
  return { id: t.id, name: t.name, kind: t.kind, subject: t.subject ?? "", body: t.body ?? "" };
}

export async function deleteTemplate(id: string, tenantId: string): Promise<boolean> {
  const t = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!t || t.tenantId !== tenantId) return false;
  await prisma.emailTemplate.delete({ where: { id } });
  return true;
}
