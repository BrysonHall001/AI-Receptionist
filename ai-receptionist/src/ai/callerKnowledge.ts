import { prisma } from "../db/client";
import { listRecordTypes, resolveRecordTypeId } from "../services/recordTypeService";
import { listLinksForContact } from "../services/recordLinkService";
import { listFields } from "../services/fieldService";

// Caps so the prompt never bloats, no matter how much data a caller has.
const MAX_MODULES = 6;
const MAX_RECORDS_PER_MODULE = 5;
const MAX_FIELDS_PER_RECORD = 4;

/**
 * Build a concise, readable "what you know about this caller" summary from the
 * caller's OWN linked records of the enabled modules (record-type keys). Generic
 * over ANY module — nothing here is equipment-specific. Awareness only: never
 * emits internal ids, and the prompt instructs the AI not to mutate these.
 *
 * Returns "" when: no caller phone, no modules enabled, the caller isn't a known
 * contact, or the caller has no linked records of the enabled modules.
 */
export async function buildCallerRecordKnowledge(
  tenantId: string,
  callerPhone: string | null | undefined,
  moduleKeys: string[],
): Promise<string> {
  if (!callerPhone || !Array.isArray(moduleKeys) || !moduleKeys.length) return "";

  const contact = await prisma.contact.findFirst({ where: { tenantId, deletedAt: null, phone: callerPhone } as any });
  if (!contact) return ""; // unknown caller -> nothing (current behavior)

  const types = await listRecordTypes(tenantId).catch(() => [] as any[]);
  const typeByKey: Record<string, any> = {};
  (types as any[]).forEach((t) => (typeByKey[t.key] = t));

  // Only enabled, real, non-contact modules — de-duplicated, in the caller's order, capped.
  const wanted = Array.from(new Set(moduleKeys))
    .filter((k) => k !== "contact" && typeByKey[k])
    .slice(0, MAX_MODULES);

  const parts: string[] = [];
  for (const key of wanted) {
    let links: any[] = [];
    try { links = await listLinksForContact(tenantId, contact.id, key); } catch { links = []; }
    const records = (links || []).map((l) => l && l.record).filter(Boolean);
    if (!records.length) continue;

    let fields: any[] = [];
    try { fields = await listFields(tenantId, key); } catch { fields = []; }
    const labelByKey: Record<string, string> = {};
    fields.forEach((f: any) => (labelByKey[f.key] = f.label || f.key));

    const recSummaries = records.slice(0, MAX_RECORDS_PER_MODULE).map((rec: any) => {
      const title = String(rec.title || "").trim() || "(untitled)";
      const cf = rec.customFields || {};
      const bits: string[] = [];
      for (const f of fields) {
        if (bits.length >= MAX_FIELDS_PER_RECORD) break;
        if (f.type === "textarea") continue; // skip long free-text (e.g. Notes) in a concise summary
        const v = cf[f.key];
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
        bits.push(`${labelByKey[f.key] || f.key}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
      }
      return bits.length ? `${title} (${bits.join(", ")})` : title;
    });

    const t = typeByKey[key];
    const moduleLabel = t.labelPlural || t.label || key;
    const extra = records.length > MAX_RECORDS_PER_MODULE ? `, and ${records.length - MAX_RECORDS_PER_MODULE} more` : "";
    parts.push(`${moduleLabel} — ${recSummaries.join("; ")}${extra}`);
  }

  return parts.length ? `This caller's records — ${parts.join(" | ")}.` : "";
}

// Small helper the caller-side may use to confirm a module key resolves for a tenant
// (kept for symmetry / tests). Not required by the summary path above.
export async function moduleExists(tenantId: string, key: string): Promise<boolean> {
  const id = await resolveRecordTypeId(tenantId, key).catch(() => null);
  return !!id;
}

const MAX_PRIOR_CALLS = 3;

/**
 * Build a concise summary of a KNOWN caller's PRIOR (finished) calls — the "Calls"
 * page-source. Only runs when "calls" is among the enabled page keys. Awareness
 * only. Returns "" for unknown callers, no prior calls, or when Calls isn't enabled.
 * `excludeCallSid` drops the in-progress call so it's never summarized as "prior".
 */
export async function buildCallerCallHistory(
  tenantId: string,
  callerPhone: string | null | undefined,
  pageKeys: string[],
  excludeCallSid?: string | null,
): Promise<string> {
  if (!callerPhone || !Array.isArray(pageKeys) || !pageKeys.includes("calls")) return "";
  const contact = await prisma.contact.findFirst({ where: { tenantId, deletedAt: null, phone: callerPhone } as any });
  if (!contact) return "";
  const sessions = await prisma.callSession.findMany({
    where: { tenantId, contactId: contact.id, finalizedAt: { not: null }, ...(excludeCallSid ? { callSid: { not: excludeCallSid } } : {}) } as any,
    orderBy: { createdAt: "desc" },
    take: MAX_PRIOR_CALLS,
  });
  if (!sessions.length) return "";
  const bits = sessions.map((s: any) => {
    const when = s.createdAt ? new Date(s.createdAt).toISOString().slice(0, 10) : "";
    const ex = (s.extracted && typeof s.extracted === "object") ? s.extracted : {};
    const reason = ex.intent ? String(ex.intent) : "no reason recorded";
    const outcome = s.status === "COMPLETED" ? "completed" : String(s.status || "").toLowerCase();
    return `${when ? when + ": " : ""}${reason}${outcome ? ` (${outcome})` : ""}`;
  });
  return `Recent prior calls from this caller — ${bits.join("; ")}.`;
}
