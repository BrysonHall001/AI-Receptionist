// Stage 3a backfill — run ONCE, explicitly, after the stage_history migration.
//
//   npx tsx src/db/backfillStageHistory.ts
//
// For every existing candidate↔job link (RecordLink) that has a stage, this
// writes ONE synthetic history row meaning "entered current stage at <the
// link's updatedAt>". That date is APPROXIMATE: updatedAt is "last touched",
// not the true moment the candidate entered the stage. Accurate history begins
// once Stage 3b logs real moves. The script is IDEMPOTENT — it skips any link
// that already has a history row, so running it twice is safe.
//
// It writes the same way the app does (Prisma, tenant copied from each link),
// so it stays portal-scoped: each row carries its own link's tenantId.

import { prisma, disconnectDb } from "./client";

// `prisma as any` mirrors the rest of the codebase: model access works at
// runtime once the client is regenerated against the new schema, and this file
// type-checks either way.
const db = prisma as any;

async function main(): Promise<void> {
  const links = await db.recordLink.findMany({
    where: { deletedAt: null, stageKey: { not: null } },
    select: { id: true, tenantId: true, stageKey: true, updatedAt: true },
  });

  let created = 0;
  let skipped = 0;
  for (const lk of links) {
    const existing = await db.stageHistory.count({ where: { recordLinkId: lk.id } });
    if (existing > 0) { skipped++; continue; } // already has history — leave it alone
    await db.stageHistory.create({
      data: {
        tenantId: lk.tenantId,
        recordLinkId: lk.id,
        fromStage: null,
        toStage: lk.stageKey,
        enteredAt: lk.updatedAt, // APPROXIMATE: last-updated, not true stage-entry
        source: "backfill",
      },
    });
    created++;
  }

  console.log(
    `[backfill stage-history] links with a stage: ${links.length} | history rows created: ${created} | skipped (already had history): ${skipped}`,
  );
}

main()
  .then(async () => { await disconnectDb(); process.exit(0); })
  .catch(async (err) => { console.error("[backfill stage-history] FAILED:", err); await disconnectDb(); process.exit(1); });
