// Bookable RESOURCES (staff / stylist / technician / provider), Batch 1.
//
// A small per-tenant config list (name + color + order). We use (prisma as any)
// for the Resource model and for the new Record.resourceId column because the
// generated Prisma client only knows them after `prisma generate` runs on the
// next deploy — this keeps the build green locally with a stale client.

import { prisma } from "../db/client";

const db = prisma as any;

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#6366f1";

function cleanColor(input: any): string {
  const v = typeof input === "string" ? input.trim() : "";
  return HEX.test(v) ? v.toLowerCase() : DEFAULT_COLOR;
}

export interface ResourceDTO {
  id: string;
  name: string;
  color: string;
  order: number;
}

function serialize(r: any): ResourceDTO {
  return { id: r.id, name: r.name, color: r.color, order: r.order };
}

/** All live (non-deleted) resources for a tenant, in display order. */
export async function listResources(tenantId: string): Promise<ResourceDTO[]> {
  const rows = await db.resource.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(serialize);
}

/** Create a resource. Name required; color optional (defaults). New rows sort last. */
export async function createResource(tenantId: string, input: { name?: string; color?: string }): Promise<ResourceDTO> {
  const name = (input.name || "").trim();
  if (!name) throw new Error("Name is required.");
  const last = await db.resource.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const order = (last && typeof last.order === "number" ? last.order : -1) + 1;
  const row = await db.resource.create({
    data: { tenantId, name, color: cleanColor(input.color), order },
  });
  return serialize(row);
}

/** Rename / recolor a resource (tenant-scoped). */
export async function updateResource(tenantId: string, id: string, input: { name?: string; color?: string }): Promise<ResourceDTO> {
  const existing = await db.resource.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new Error("Resource not found.");
  const data: any = {};
  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (!name) throw new Error("Name is required.");
    data.name = name;
  }
  if (typeof input.color === "string") data.color = cleanColor(input.color);
  const row = await db.resource.update({ where: { id }, data });
  return serialize(row);
}

/** How many LIVE bookings are currently assigned to this resource. */
export async function assignedBookingCount(tenantId: string, resourceId: string): Promise<number> {
  return db.record.count({ where: { tenantId, resourceId, deletedAt: null } });
}

/**
 * Delete a resource. BLOCKED while any live booking is still assigned to it
 * (safe: nothing is orphaned and no booking is silently changed). The caller
 * surfaces the count so the user can reassign/unassign first.
 */
export async function deleteResource(tenantId: string, id: string): Promise<{ ok: true }> {
  const existing = await db.resource.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new Error("Resource not found.");
  const count = await assignedBookingCount(tenantId, id);
  if (count > 0) {
    const e: any = new Error(`This is assigned to ${count} booking${count === 1 ? "" : "s"}. Reassign or unassign ${count === 1 ? "it" : "them"} first, then delete.`);
    e.code = "resource_in_use";
    e.count = count;
    throw e;
  }
  await db.resource.delete({ where: { id } });
  return { ok: true };
}

/** True if `resourceId` is a real live resource for this tenant (for assignment validation). */
export async function resourceExists(tenantId: string, resourceId: string): Promise<boolean> {
  const row = await db.resource.findFirst({ where: { id: resourceId, tenantId, deletedAt: null }, select: { id: true } });
  return !!row;
}
