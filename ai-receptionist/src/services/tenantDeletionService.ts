// TENANT DELETION — the complete, ordered cascade.
//
// WHY THIS FILE EXISTS: 40 of the 51 tenant-scoped models cascade from Tenant,
// but 19 carry a tenantId with NO relation and would simply be LEFT BEHIND, and
// the tenant's file bytes live in object storage, which no database cascade can
// reach. Deleting a tenant by hand was therefore never safe. This does it
// properly, in an order that respects the foreign keys, and refuses rather than
// half-finishing.
//
// THE GUARD (owner's rule): a DEMO tenant may be deleted directly. A real
// tenant must be SUSPENDED first — deleting a live customer should take two
// deliberate steps, not one. The typed-name confirmation is enforced at the
// route, so the service can also be used by tooling.
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { audit } from "./auditService";
import { AUDIT_ACTIONS } from "./auditCatalog";

const db = prisma as any;

/** Every model holding a tenantId WITHOUT a cascading relation, in an order
 *  that never leaves a foreign key dangling (children before parents). The
 *  suite asserts this list against the schema, so a new model added later
 *  cannot silently start orphaning rows. */
export const NON_CASCADING_MODELS: string[] = [
  // notification/suggestion layer first — they reference users and records
  "notification", "suggestion", "demoSeedRun",
  // the search index carries a tenantId with no relation, so it would be left
  // behind by the cascade (caught by this very list's schema assertion)
  "searchIndex",
  // per-record and per-contact satellites
  "workOrderVisit", "recordGeo", "contactGeo", "fieldSection",
  // comms + exports
  "emailLog", "surveyRecipient", "exportRecord",
  // feedback + usage + billing history
  "feedbackTicket", "usageDaily", "billingAuditLog",
  // ops logs
  "errorEvent", "webhookEvent", "auditEvent",
  // access last: invites, custom roles, then the people themselves
  "invite", "portalRole", "user",
];

export interface DeleteResult {
  tenantId: string;
  name: string;
  deletedRows: Record<string, number>;
  filesRemoved: number;
  fileFailures: number;
}

/** Delete every object this tenant owns in storage. Returns counts; a storage
 *  failure is reported, never silently swallowed, but does not abort the
 *  database work (the rows are the record of truth, and an orphaned blob is a
 *  cleanup task, not a correctness break). */
async function removeTenantFiles(tenantId: string): Promise<{ removed: number; failed: number }> {
  let removed = 0, failed = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { storage } = require("./fileStorage");
    const files = await db.storedFile.findMany({ where: { tenantId }, select: { key: true } });
    const client = storage();
    for (const f of files) {
      try { await client.delete(f.key); removed += 1; }
      catch (err) { failed += 1; logger.error(`[tenant-delete] storage delete failed for ${f.key}: ${(err as Error).message}`); }
    }
  } catch (err) {
    logger.error(`[tenant-delete] storage sweep failed for ${tenantId}: ${(err as Error).message}`);
  }
  return { removed, failed };
}

export interface DeleteActor { id?: string | null; name?: string | null; email?: string | null; role?: string | null }

/**
 * Delete a tenant and everything belonging to it.
 * Throws (leaving the tenant intact) when the guard refuses.
 */
export async function deleteTenantCompletely(tenantId: string, actor?: DeleteActor): Promise<DeleteResult> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, status: true, isDemo: true } });
  if (!tenant) throw new Error("Tenant not found.");
  if (tenant.isDemo !== true && tenant.status !== "SUSPENDED") {
    throw new Error("This is not a demo tenant. Suspend it first, then delete it.");
  }

  // 1) Object storage BEFORE the rows, so we still know which files existed.
  const files = await removeTenantFiles(tenantId);

  // 2) The rows nothing would cascade, in dependency order, then the tenant
  //    itself (which cascades the other 40 models). One transaction: either the
  //    tenant is gone with its debris, or nothing changed.
  const deletedRows: Record<string, number> = {};
  await db.$transaction(async (tx: any) => {
    for (const model of NON_CASCADING_MODELS) {
      if (!tx[model] || typeof tx[model].deleteMany !== "function") continue;
      try {
        const res = await tx[model].deleteMany({ where: { tenantId } });
        if (res.count) deletedRows[model] = res.count;
      } catch (err) {
        // A failure here aborts the transaction: better an intact tenant than
        // a half-deleted one.
        throw new Error(`Deleting ${model} rows failed: ${(err as Error).message}`);
      }
    }
    await tx.tenant.delete({ where: { id: tenantId } });
  }, { timeout: 120000 });

  audit({
    tenantId: null, actorType: "user", actorId: actor?.id ?? null,
    actorLabel: (actor && (actor.name || actor.email)) || "Hub user", actorRole: actor?.role ?? null,
    action: AUDIT_ACTIONS.HUB_TENANT_DELETE, subjectType: "tenant", subjectId: tenantId, subjectLabel: tenant.name,
    meta: { rows: deletedRows, filesRemoved: files.removed, fileFailures: files.failed, wasDemo: tenant.isDemo === true, status: tenant.status },
  } as any);
  logger.info(`[tenant-delete] "${tenant.name}" (${tenantId}) removed: ${JSON.stringify(deletedRows)}, ${files.removed} file(s)`);

  return { tenantId, name: tenant.name, deletedRows, filesRemoved: files.removed, fileFailures: files.failed };
}
