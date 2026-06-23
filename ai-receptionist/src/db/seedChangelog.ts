import fs from "fs";
import path from "path";
import { disconnectDb } from "./client";
import { upsertChangeLogEntries, ChangeLogInput } from "../services/changelogService";
import { logger } from "../utils/logger";

/**
 * One-time loader for the product Change Log.
 *
 *   npm run seed:changelog -- <path-to-json>
 *   (defaults to src/db/changelog.sample.json if no path is given)
 *
 * The JSON is an array of rows:
 *   [{ "date": "2026-06-23", "type": "Feature",
 *      "description": "Added the Change Log page.", "commitSha": "abc123" }, ...]
 *
 * IDEMPOTENT: rows are upserted keyed on `commitSha`, so re-running with the same
 * file changes nothing (and editing a description re-runs cleanly as an update,
 * never a duplicate). Run it as many times as you like.
 *
 * This reads git history ONCE, offline, into the DB. The running app only ever
 * reads the ChangeLogEntry table — never git.
 */
async function main(): Promise<void> {
  const file = (process.argv[2] || "src/db/changelog.sample.json").trim();
  const abs = path.resolve(process.cwd(), file);

  if (!fs.existsSync(abs)) {
    logger.error(`Change Log seed file not found: ${abs}`);
    logger.error('Usage: npm run seed:changelog -- <path-to-json>');
    await disconnectDb();
    process.exit(1);
  }

  let rows: ChangeLogInput[];
  try {
    rows = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    logger.error(`Could not parse JSON in ${abs}: ${(e as Error).message}`);
    await disconnectDb();
    process.exit(1);
    return;
  }

  if (!Array.isArray(rows)) {
    logger.error("Seed file must be a JSON array of { date, type, description, commitSha } rows.");
    await disconnectDb();
    process.exit(1);
    return;
  }

  // Validate before writing anything, so a bad row fails loudly up front.
  const bad: number[] = [];
  rows.forEach((r, i) => { if (!r || !r.date || !r.type || !r.description) bad.push(i); });
  if (bad.length) {
    logger.error(`These row(s) are missing date/type/description: ${bad.join(", ")}`);
    await disconnectDb();
    process.exit(1);
    return;
  }

  logger.info(`Loading ${rows.length} Change Log row(s) from ${file}…`);
  const tally = await upsertChangeLogEntries(rows);
  logger.info(`Done. created=${tally.created} updated=${tally.updated} created-without-sha=${tally.createdNoSha}`);

  await disconnectDb();
  process.exit(0);
}

main().catch(async (e) => {
  logger.error(e);
  await disconnectDb();
  process.exit(1);
});
