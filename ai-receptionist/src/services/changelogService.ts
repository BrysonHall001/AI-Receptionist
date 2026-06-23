// Change Log read/write service. Global (non-tenant) product-level log.
//
// The master-hub endpoint reads via listChangeLog(); the one-time historical
// seed (src/db/seedChangelog.ts) writes via upsertChangeLogEntry(). Both go
// through the real Prisma client so there's a single query path in and out.
import { prisma } from "../db/client";

export interface ChangeLogInput {
  date: string | Date;          // commit date
  type: string;                 // category
  description: string;          // clean, user-facing text
  commitSha?: string | null;    // source hash; enables idempotent upsert
}

// Newest first. `date` is the change date; `createdAt` breaks ties deterministically.
export async function listChangeLog(limit = 2000) {
  const rows = await prisma.changeLogEntry.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  return rows.map((r: any) => ({
    id: r.id,
    date: r.date instanceof Date ? r.date.toISOString() : r.date,
    type: r.type,
    description: r.description,
    commitSha: r.commitSha ?? null,
  }));
}

export type UpsertResult = "created" | "updated" | "created-no-sha";

// Idempotent: keyed on commitSha. Re-running with the same commitSha UPDATES the
// existing row (no duplicate). Rows without a commitSha can't be de-duplicated,
// so they're always created (the historical seed always supplies a commitSha).
export async function upsertChangeLogEntry(row: ChangeLogInput): Promise<UpsertResult> {
  const date = row.date instanceof Date ? row.date : new Date(row.date);
  const data = { date, type: row.type, description: row.description };

  if (!row.commitSha) {
    await prisma.changeLogEntry.create({ data: { ...data, commitSha: null } });
    return "created-no-sha";
  }

  const existing = await prisma.changeLogEntry.findUnique({ where: { commitSha: row.commitSha } });
  if (existing) {
    await prisma.changeLogEntry.update({ where: { commitSha: row.commitSha }, data });
    return "updated";
  }
  await prisma.changeLogEntry.create({ data: { ...data, commitSha: row.commitSha } });
  return "created";
}

// Convenience for the seed loader: upsert a list and tally what happened.
export async function upsertChangeLogEntries(rows: ChangeLogInput[]) {
  const tally = { created: 0, updated: 0, createdNoSha: 0 };
  for (const row of rows) {
    const r = await upsertChangeLogEntry(row);
    if (r === "created") tally.created++;
    else if (r === "updated") tally.updated++;
    else tally.createdNoSha++;
  }
  return tally;
}
