// Bookable RESOURCES (staff / stylist / technician / provider), Batch 1.
//
// A small per-tenant config list (name + color + order). We use (prisma as any)
// for the Resource model and for the new Record.resourceId column because the
// generated Prisma client only knows them after `prisma generate` runs on the
// next deploy — this keeps the build green locally with a stale client.

import { prisma } from "../db/client";
import { sanitizeHours, durationForService, BookingConfig } from "./bookingConfig";

const db = prisma as any;

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#6366f1";

function cleanColor(input: any): string {
  const v = typeof input === "string" ? input.trim() : "";
  return HEX.test(v) ? v.toLowerCase() : DEFAULT_COLOR;
}

/** Keep only positive-integer durations, keyed by service. Empty → null (fallback). */
function sanitizeDurations(input: any): Record<string, number> | null {
  if (!input || typeof input !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
  }
  return Object.keys(out).length ? out : null;
}

/** A non-negative integer buffer, or null (fallback). */
function sanitizeBuffer(input: any): number | null {
  if (input === null || input === undefined || input === "") return null;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export interface ResourceDTO {
  id: string;
  name: string;
  color: string;
  order: number;
  hours: Record<string, { start: string; end: string }[]> | null; // null = uses business hours
  durations: Record<string, number> | null; // per-service overrides; null = business
  bufferMin: number | null; // null = uses business buffer
}

function serialize(r: any): ResourceDTO {
  return {
    id: r.id, name: r.name, color: r.color, order: r.order,
    hours: r.hours ?? null,
    durations: r.durations ?? null,
    bufferMin: typeof r.bufferMin === "number" ? r.bufferMin : null,
  };
}

/** The effective weekly hours for a resource: its own custom hours if set,
 *  otherwise the business hours (the fallback). */
export function resolveResourceHours(
  resource: { hours?: any } | null | undefined,
  businessHours: Record<string, { start: string; end: string }[]>
): Record<string, { start: string; end: string }[]> {
  const h = resource && (resource as any).hours;
  return h && typeof h === "object" ? h : businessHours;
}

/** Effective duration (minutes) for a service: the resource's own per-service
 *  duration if set (>0), else the business duration for that service. */
export function resolveResourceDuration(
  resource: { durations?: any } | null | undefined,
  config: BookingConfig,
  serviceKey?: string | null
): number {
  const d = resource && (resource as any).durations;
  if (d && typeof d === "object" && serviceKey != null) {
    const n = Number(d[serviceKey]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return durationForService(config, serviceKey);
}

/**
 * The block length (minutes) for a booking. If an explicit end is stored — which
 * only external/synced events have, because their arbitrary lengths don't fit the
 * service-duration model — use the real start→end span. Otherwise fall back to
 * `fallbackMin` (the existing service-based duration) EXACTLY as before, so native
 * bookings (endAt null) are byte-for-byte unchanged. A non-positive or invalid
 * span also falls back, never producing a zero/negative block.
 */
export function effectiveDurationMin(
  appointmentAt: Date | string,
  endAt: Date | string | null | undefined,
  fallbackMin: number
): number {
  if (endAt) {
    const diff = Math.round((new Date(endAt).getTime() - new Date(appointmentAt).getTime()) / 60000);
    if (Number.isFinite(diff) && diff > 0) return diff;
  }
  return fallbackMin;
}

/** Effective buffer (minutes): the resource's own buffer if set, else business. */
export function resolveResourceBuffer(
  resource: { bufferMin?: any } | null | undefined,
  config: BookingConfig
): number {
  const b = resource && (resource as any).bufferMin;
  return typeof b === "number" && b >= 0 ? Math.floor(b) : config.bufferMin;
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
export async function createResource(tenantId: string, input: { name?: string; color?: string; hours?: any; durations?: any; bufferMin?: any }): Promise<ResourceDTO> {
  const name = (input.name || "").trim();
  if (!name) throw new Error("Name is required.");
  const last = await db.resource.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const order = (last && typeof last.order === "number" ? last.order : -1) + 1;
  const data: any = { tenantId, name, color: cleanColor(input.color), order };
  if (input.hours !== undefined && input.hours !== null) data.hours = sanitizeHours(input.hours);
  if (input.durations !== undefined) data.durations = input.durations === null ? null : sanitizeDurations(input.durations);
  if (input.bufferMin !== undefined) data.bufferMin = sanitizeBuffer(input.bufferMin);
  const row = await db.resource.create({ data });
  return serialize(row);
}

/** Rename / recolor a resource (tenant-scoped). */
export async function updateResource(tenantId: string, id: string, input: { name?: string; color?: string; hours?: any; durations?: any; bufferMin?: any }): Promise<ResourceDTO> {
  const existing = await db.resource.findFirst({ where: { id, tenantId, deletedAt: null } });
  if (!existing) throw new Error("Resource not found.");
  const data: any = {};
  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (!name) throw new Error("Name is required.");
    data.name = name;
  }
  if (typeof input.color === "string") data.color = cleanColor(input.color);
  // hours/durations/bufferMin: null → clear to "use business"; value → custom
  // (sanitized); undefined → leave unchanged.
  if (input.hours !== undefined) data.hours = input.hours === null ? null : sanitizeHours(input.hours);
  if (input.durations !== undefined) data.durations = input.durations === null ? null : sanitizeDurations(input.durations);
  if (input.bufferMin !== undefined) data.bufferMin = sanitizeBuffer(input.bufferMin);
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
