import crypto from "node:crypto";
import { prisma } from "../db/client";
import { createContact, updateContact } from "./contactService";

const db = prisma as any;

// System contact fields that map to top-level columns; everything else is a
// custom field stored in customFields. The tenant is NEVER taken from the body.
const SYSTEM_KEYS = new Set(["name", "phone", "email", "intent"]);
const MAX_STR = 2000; // cap any single mapped string value

export function genToken(): string {
  // High-entropy, URL-safe secret (~32 chars). This is the only thing that
  // identifies which endpoint (and therefore which tenant) a POST is for.
  return crypto.randomBytes(24).toString("base64url");
}

// ---- endpoint CRUD (tenant-scoped) ----------------------------------------
export async function listEndpoints(tenantId: string) {
  const rows = await db.inboundEndpoint.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  return rows.map(serializeEndpoint);
}

export async function getEndpoint(tenantId: string, id: string) {
  const ep = await db.inboundEndpoint.findFirst({ where: { id, tenantId } });
  return ep ? serializeEndpoint(ep) : null;
}

export async function createEndpoint(tenantId: string, input: { name?: string; mapping?: Record<string, string>; createdById?: string | null }) {
  let token = genToken();
  // Vanishingly unlikely to collide, but guarantee uniqueness anyway.
  for (let i = 0; i < 5; i++) { if (!(await db.inboundEndpoint.findUnique({ where: { token } }))) break; token = genToken(); }
  const ep = await db.inboundEndpoint.create({
    data: {
      tenantId,
      name: (input.name || "Inbound endpoint").toString().slice(0, 120),
      token,
      mapping: cleanMapping(input.mapping),
      enabled: true,
      createdById: input.createdById ?? null,
    },
  });
  return serializeEndpoint(ep);
}

export async function updateEndpoint(tenantId: string, id: string, input: { name?: string; mapping?: Record<string, string>; enabled?: boolean }) {
  const ep = await db.inboundEndpoint.findFirst({ where: { id, tenantId } });
  if (!ep) throw new Error("Endpoint not found");
  const data: any = {};
  if (input.name !== undefined) data.name = String(input.name).slice(0, 120);
  if (input.mapping !== undefined) data.mapping = cleanMapping(input.mapping);
  if (input.enabled !== undefined) data.enabled = !!input.enabled;
  const updated = await db.inboundEndpoint.update({ where: { id }, data });
  return serializeEndpoint(updated);
}

export async function regenerateToken(tenantId: string, id: string) {
  const ep = await db.inboundEndpoint.findFirst({ where: { id, tenantId } });
  if (!ep) throw new Error("Endpoint not found");
  const token = genToken();
  const updated = await db.inboundEndpoint.update({ where: { id }, data: { token } });
  return serializeEndpoint(updated);
}

export async function deleteEndpoint(tenantId: string, id: string) {
  const ep = await db.inboundEndpoint.findFirst({ where: { id, tenantId } });
  if (!ep) throw new Error("Endpoint not found");
  await db.inboundEndpoint.delete({ where: { id } });
  return { ok: true };
}

export async function listCalls(tenantId: string, endpointId?: string, limit = 50) {
  const where: any = { tenantId };
  if (endpointId) where.endpointId = endpointId;
  const rows = await db.inboundCall.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(limit, 200) });
  return rows;
}

function serializeEndpoint(ep: any) {
  return { id: ep.id, name: ep.name, token: ep.token, mapping: ep.mapping || {}, enabled: ep.enabled, createdAt: ep.createdAt };
}

function cleanMapping(m?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!m || typeof m !== "object") return out;
  for (const [k, v] of Object.entries(m)) {
    const key = String(k).trim();
    const target = String(v ?? "").trim();
    if (key && target) out[key] = target;
  }
  return out;
}

async function logCall(tenantId: string, endpointId: string, status: "accepted" | "rejected", reason: string, contactId: string | null, sourceIp: string | null) {
  try {
    await db.inboundCall.create({ data: { tenantId, endpointId, status, reason: reason.slice(0, 300), contactId, sourceIp: sourceIp?.slice(0, 64) ?? null } });
  } catch { /* logging must never break ingest */ }
}

// ---- value coercion / sanitization ----------------------------------------
function scalar(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim().slice(0, MAX_STR);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ").slice(0, MAX_STR);
  return null; // ignore nested objects
}
function multi(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
  if (v == null) return [];
  return String(v).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
}

export interface IngestResult { status: number; body: any; }

// The ONLY entry point for public inbound data. tenantId comes from the token's
// endpoint — the body cannot influence it.
export async function ingest(token: string, body: any, sourceIp: string | null): Promise<IngestResult> {
  const ep = await db.inboundEndpoint.findUnique({ where: { token: String(token || "") } });
  if (!ep) return { status: 404, body: { error: "Not found" } }; // unknown/invalid token

  const tenantId: string = ep.tenantId; // <-- tenant derived solely from the token

  if (!ep.enabled) {
    await logCall(tenantId, ep.id, "rejected", "Endpoint is disabled", null, sourceIp);
    return { status: 403, body: { error: "Endpoint disabled" } };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    await logCall(tenantId, ep.id, "rejected", "Body must be a JSON object", null, sourceIp);
    return { status: 400, body: { error: "Body must be a JSON object" } };
  }

  // Field types (for multi_select splitting). Includes system + custom defs.
  const defs = await db.fieldDef.findMany({ where: { tenantId } });
  const typeByKey: Record<string, string> = {};
  const customKeys = new Set<string>();
  for (const d of defs as any[]) { typeByKey[d.key] = d.type; if (!d.system) customKeys.add(d.key); }

  const mapping: Record<string, string> = (ep.mapping || {}) as any;
  const data: any = { customFields: {} };
  let mappedCount = 0;
  for (const [incomingKey, targetKey] of Object.entries(mapping)) {
    if (!(incomingKey in body)) continue; // only configured keys; unexpected fields ignored
    const raw = (body as any)[incomingKey];
    if (SYSTEM_KEYS.has(targetKey)) {
      const s = scalar(raw);
      if (s != null) { data[targetKey] = s; mappedCount++; }
    } else if (customKeys.has(targetKey)) {
      if (typeByKey[targetKey] === "multi_select") { data.customFields[targetKey] = multi(raw); mappedCount++; }
      else { const s = scalar(raw); if (s != null) { data.customFields[targetKey] = s; mappedCount++; } }
    } // else: target field doesn't exist for this tenant -> ignored
  }

  if (mappedCount === 0) {
    await logCall(tenantId, ep.id, "rejected", "No mapped fields present in payload", null, sourceIp);
    return { status: 422, body: { error: "No mapped fields present in payload" } };
  }

  // Identity match (respect the tenant's identity rule): prefer email, else phone.
  const email = data.email ? String(data.email).trim() : null;
  const phone = data.phone ? String(data.phone).trim() : null;
  let existing: any = null;
  if (email) existing = await db.contact.findFirst({ where: { tenantId, deletedAt: null, email: { equals: email, mode: "insensitive" } } });
  if (!existing && phone) existing = await db.contact.findFirst({ where: { tenantId, deletedAt: null, phone } });

  const actor = { type: "system" as const, name: "Inbound webhook" };
  try {
    if (existing) {
      await updateContact(existing.id, tenantId, data, actor);
      await logCall(tenantId, ep.id, "accepted", "Updated existing contact", existing.id, sourceIp);
      return { status: 200, body: { ok: true, action: "updated", contactId: existing.id } };
    }
    const c = await createContact(tenantId, { ...data, source: "webhook" }, actor); // enforces identity rule + validation + fires ContactCreated
    await logCall(tenantId, ep.id, "accepted", "Created contact", c.id, sourceIp);
    return { status: 200, body: { ok: true, action: "created", contactId: c.id } };
  } catch (e) {
    const reason = (e as Error).message || "Rejected";
    await logCall(tenantId, ep.id, "rejected", reason, null, sourceIp);
    return { status: 422, body: { ok: false, error: reason } };
  }
}
