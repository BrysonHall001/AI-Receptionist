// Self-test: consuming audiences at SEND time. Focuses on resolveAudiencesToContactIds — the
// union/de-dupe across multiple audiences that the email + survey send routes call. Dynamic
// (reads contacts fresh), de-dupes across audiences, and reports per-audience counts + missing ids.
//   npx tsx src/db/selfTest_audiencesConsume.ts
import { prisma, disconnectDb } from "./client";
import { createAudience, resolveAudiencesToContactIds } from "../services/audienceService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const rule = (value: string) => ({ rules: [{ field: "name", op: "contains", value, conj: "AND" }] });
let phoneSeq = 7000;
async function mkContact(tenantId: string, name: string, email: string | null) { return db.contact.create({ data: { tenantId, name, email, phone: `+1555${phoneSeq++}`, source: "test" } }); }

async function main() {
  console.log("audiences consume\n=================");
  const tenants: string[] = [];
  try {
    const tA = (await db.tenant.create({ data: { name: "Consume A", billingStatus: "paid", notifyEmail: "" } })).id; tenants.push(tA);
    const tB = (await db.tenant.create({ data: { name: "Consume B", billingStatus: "paid", notifyEmail: "" } })).id; tenants.push(tB);
    await mkContact(tA, "VIP Alice", "alice@x.test");
    await mkContact(tA, "VIP Bob", "bob@x.test");
    await mkContact(tA, "Regular Carol", "carol@x.test");
    await mkContact(tA, "VIP Dave", null); // matches VIP but has no email

    const audVip = await createAudience({ tenantId: tA, name: "VIPs", definition: rule("VIP"), createdById: null });
    const audAlice = await createAudience({ tenantId: tA, name: "Alice only", definition: rule("Alice"), createdById: null });
    const audNone = await createAudience({ tenantId: tA, name: "Nobody", definition: rule("ZZZ-nomatch"), createdById: null });

    console.log("union + de-dupe across audiences:");
    let r = await resolveAudiencesToContactIds(tA, [audVip.id, audAlice.id]);
    check(r.contactIds.length === 3, "VIP(3: Alice,Bob,Dave) ∪ Alice(1) de-dupes to 3 (Alice not double-counted)");
    check(r.perAudience[audVip.id] === 3 && r.perAudience[audAlice.id] === 1, "per-audience counts reported (VIP=3, Alice=1)");
    check(r.missing.length === 0, "no missing ids for valid audiences");
    check(new Set(r.contactIds).size === r.contactIds.length, "returned ids are unique");

    console.log("\nincludes non-emailable matches (blast filters emailable downstream):");
    const dave = await db.contact.findFirst({ where: { tenantId: tA, name: "VIP Dave" } });
    check(r.contactIds.includes(dave.id), "VIP Dave (no email) is in the resolved set — emailable filter is the blast's job");

    console.log("\ndynamic at call time:");
    await mkContact(tA, "VIP Eve", "eve@x.test");
    r = await resolveAudiencesToContactIds(tA, [audVip.id]);
    check(r.contactIds.length === 4, "newly-added matching contact appears immediately (4 now)");

    console.log("\nzero-match + missing + scoping:");
    r = await resolveAudiencesToContactIds(tA, [audNone.id]);
    check(r.contactIds.length === 0 && r.perAudience[audNone.id] === 0, "zero-match audience -> 0 (surfaced via perAudience)");
    r = await resolveAudiencesToContactIds(tA, [audVip.id, "does-not-exist"]);
    check(r.contactIds.length === 4 && r.missing.includes("does-not-exist"), "unknown id -> skipped + reported in missing, valid one still resolves");
    r = await resolveAudiencesToContactIds(tB, [audVip.id]);
    check(r.contactIds.length === 0 && r.missing.includes(audVip.id), "cross-tenant audience id -> missing (scoped), no leak");

    console.log("\nempty input:");
    r = await resolveAudiencesToContactIds(tA, []);
    check(r.contactIds.length === 0 && r.missing.length === 0, "no audiences -> empty result");
  } catch (e) {
    console.log("   (error: " + (e as Error).stack + ")"); fails++;
  } finally {
    for (const id of tenants) {
      try { await db.savedFilter.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.contact.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n=================");
  console.log(fails === 0 ? "ALL PASSED \u2705  (audiences consume)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
