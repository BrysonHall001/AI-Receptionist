// PART B self-test — the three new field types: autonumber, color, progress.
//
//   npx tsx src/db/selfTest_autonumberColorProgress.ts     (needs dev Postgres)
//
// Proves:
//  (1) FIELD_TYPES includes autonumber/color/progress and createField ACCEPTS them.
//  (2) AUTO-NUMBER assigns a UNIQUE, sequential value per record — even under concurrent
//      creation (no skips/dupes) — honoring the field's prefix + zero-padding.   <-- autonumber
//  (3) COLOR stores/reads a hex value (import coercion normalizes to "#rrggbb").
//  (4) PROGRESS stores an integer and CLAMPS out-of-range values into 0-100.
import { prisma, disconnectDb } from "./client";
import { FIELD_TYPES, createField, listFields } from "../services/fieldService";
import { createRecord, getRecord, coerceCustomValue } from "../services/recordService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const tenantIds: string[] = [];
async function mkTenant() {
  const t = await prisma.tenant.create({ data: { name: `nft-${stamp}-${Math.random().toString(36).slice(2, 6)}`, notifyEmail: `nft-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}

async function main() {
  console.log("Part B - new field types: Auto-number, Color, Progress");
  console.log("======================================================");

  // (1) registered + accepted.
  for (const t of ["autonumber", "color", "progress"]) check((FIELD_TYPES as readonly string[]).includes(t), `FIELD_TYPES includes '${t}'`);
  const T = await mkTenant();
  const anField: any = await createField(T, { label: "Ref no", type: "autonumber", options: { prefix: "INV-", pad: 4 } } as any, "vehicle");
  const colorField: any = await createField(T, { label: "Tag colour", type: "color" }, "vehicle");
  const progField: any = await createField(T, { label: "Percent done", type: "progress" }, "vehicle");
  check(anField.type === "autonumber" && colorField.type === "color" && progField.type === "progress", "createField accepts autonumber, color, and progress");
  const listed = await listFields(T, "vehicle");
  const anKey = (listed.find((f: any) => f.type === "autonumber") || {}).key;
  const colorKey = (listed.find((f: any) => f.type === "color") || {}).key;
  const progKey = (listed.find((f: any) => f.type === "progress") || {}).key;
  check(!!anKey && !!colorKey && !!progKey, "all three fields are listed on the module");

  // (2) AUTO-NUMBER - 12 records created CONCURRENTLY must get 12 distinct sequential values.
  const N = 12;
  const recs = await Promise.all(Array.from({ length: N }, (_, i) => createRecord(T, "vehicle", { title: "Van " + (i + 1), customFields: {} })));
  const fresh = await Promise.all(recs.map((r: any) => getRecord(T, r.id)));
  const nums = fresh.map((r: any) => String((r.customFields || {})[anKey] || ""));
  const uniq = new Set(nums);
  check(uniq.size === N, `auto-number assigned ${uniq.size}/${N} UNIQUE values under concurrent create (no dupes)`); // proves no dup under concurrency
  check(nums.every((v) => /^INV-\d{4}$/.test(v)), "each auto-number honors the prefix + zero-padding (INV-0001 form)");
  const seq = nums.map((v) => parseInt(v.replace("INV-", ""), 10)).sort((a, b) => a - b);
  const contiguous = seq.length === N && seq[0] === 1 && seq[seq.length - 1] === N && seq.every((v, i) => v === i + 1);
  check(contiguous, "the assigned numbers form the contiguous sequence 1..N (no skips)");

  // A record created WITH a value keeps it (back-number), not overwritten.
  const back: any = await createRecord(T, "vehicle", { title: "Legacy", customFields: { [anKey]: "INV-9999" } });
  const backRead: any = await getRecord(T, back.id);
  check((backRead.customFields || {})[anKey] === "INV-9999", "a supplied auto-number value is respected (back-number, not overwritten)");

  // (3) COLOR - import coercion normalizes to #rrggbb; a stored hex round-trips.
  check(coerceCustomValue({ type: "color" }, "#3366FF").value === "#3366ff", "color import normalizes #3366FF -> #3366ff");
  check(coerceCustomValue({ type: "color" }, "f0a").value === "#ff00aa", "color import expands shorthand f0a -> #ff00aa");
  check(!!coerceCustomValue({ type: "color" }, "nope").error, "color import rejects a non-hex value");
  const cRec: any = await createRecord(T, "vehicle", { title: "Red van", customFields: { [colorKey]: "#112233" } });
  const cRead: any = await getRecord(T, cRec.id);
  check((cRead.customFields || {})[colorKey] === "#112233", "a color hex stores + reads back on a record");

  // (4) PROGRESS - clamps out-of-range to 0..100; a valid value round-trips.
  check(coerceCustomValue({ type: "progress" }, "75").value === 75, "progress import keeps an in-range value (75)");
  check(coerceCustomValue({ type: "progress" }, "150").value === 100, "progress import CLAMPS 150 -> 100");
  check(coerceCustomValue({ type: "progress" }, "-5").value === 0, "progress import CLAMPS -5 -> 0");
  const pRec: any = await createRecord(T, "vehicle", { title: "Half done", customFields: { [progKey]: 50 } });
  const pRead: any = await getRecord(T, pRec.id);
  check((pRead.customFields || {})[progKey] === 50, "a progress value stores + reads back on a record");
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    console.log(`\n${failures.length === 0 ? "ALL PASSED (autonumber unique+sequential; color hex; progress clamped 0-100)" : failures.length + " FAILED"}`);
    process.exit(failures.length ? 1 : 0);
  });
