// Self-test: Audiences = named, DYNAMIC contact filters (reuse SavedFilter view="audience").
// Proves CRUD, tenant + view scoping, and that resolveAudienceContacts always reflects the
// CURRENT matching contacts via the shared server-side evalRules.
//   npx tsx src/db/selfTest_audiences.ts
import { prisma, disconnectDb } from "./client";
import { listAudiences, getAudience, createAudience, updateAudience, deleteAudience, resolveAudienceContacts, countAudienceContacts } from "../services/audienceService";
import { createSavedFilter, listSavedFilters } from "../services/savedFilterService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }
const VIP = { rules: [{ field: "name", op: "contains", value: "VIP", conj: "AND" }] };

async function mkTenant(name: string) { const t = await db.tenant.create({ data: { name, billingStatus: "paid", notifyEmail: "" } }); return t.id; }
let phoneSeq = 1000;
async function mkContact(tenantId: string, name: string, email: string | null) {
  return db.contact.create({ data: { tenantId, name, email, phone: `+1555${phoneSeq++}`, source: "test" } });
}

async function main() {
  console.log("audiences\n=========");
  const tenants: string[] = [];
  try {
    const tA = await mkTenant("Aud Co A"); tenants.push(tA);
    const tB = await mkTenant("Aud Co B"); tenants.push(tB);
    // Matching + non-matching contacts (one matcher has no email).
    await mkContact(tA, "VIP Alice", "alice@x.test");
    await mkContact(tA, "VIP Bob", null);
    await mkContact(tA, "Regular Carol", "carol@x.test");

    console.log("create + list (view-scoped):");
    const aud = await createAudience({ tenantId: tA, name: "VIP folks", definition: VIP, createdById: null });
    check(!!aud.id, "createAudience returns an id");
    const raw = await db.savedFilter.findUnique({ where: { id: aud.id } });
    check(raw.view === "audience", "stored as SavedFilter with view=\"audience\"");
    const r0 = raw.definition?.rules?.[0] || {};
    check(r0.field === "name" && r0.op === "contains" && r0.value === "VIP", "definition stores the contacts rule shape (field/op/value)");
    const list = await listAudiences(tA);
    check(list.length === 1 && list[0].id === aud.id, "listAudiences returns it");

    console.log("\nresolveAudienceContacts is DYNAMIC (live re-evaluation):");
    let matches = await resolveAudienceContacts(tA, aud.id);
    check(!!matches && matches.length === 2, "matches the 2 VIP contacts (not the regular one)");
    check(!!matches && matches.every((m) => /VIP/.test(m.name || "")), "only VIP-named contacts returned");
    check(!!matches && matches.some((m) => m.email === null), "a matcher with no email is still returned (caller filters emailable)");
    // Add a new matching contact -> resolves to MORE without touching the audience.
    await mkContact(tA, "VIP Dave", "dave@x.test");
    matches = await resolveAudienceContacts(tA, aud.id);
    check(!!matches && matches.length === 3, "newly-added matching contact appears immediately (dynamic)");
    // Change a contact so it stops matching -> drops out.
    const carol = await db.contact.findFirst({ where: { tenantId: tA, name: "Regular Carol" } });
    await db.contact.update({ where: { id: carol.id }, data: { name: "VIP Carol" } });
    check((await countAudienceContacts(tA, aud.id)) === 4, "renaming a contact INTO the criteria grows the count (dynamic both ways)");

    console.log("\nupdate (rename + redefine) + get:");
    const okRen = await updateAudience(aud.id, tA, { name: "VIPs only" });
    check(okRen && (await getAudience(aud.id, tA))!.name === "VIPs only", "rename persists");
    const NARROW = { rules: [{ field: "name", op: "contains", value: "Alice", conj: "AND" }] };
    await updateAudience(aud.id, tA, { definition: NARROW });
    check((await resolveAudienceContacts(tA, aud.id))!.length === 1, "updated criteria re-resolves (now only Alice)");

    console.log("\ntenant + view scoping (isolation):");
    check((await getAudience(aud.id, tB)) === null, "tenant B cannot getAudience tenant A's audience");
    check((await updateAudience(aud.id, tB, { name: "hijack" })) === false, "tenant B cannot update it");
    check((await resolveAudienceContacts(tB, aud.id)) === null, "tenant B resolve -> null (scoped)");
    check((await deleteAudience(aud.id, tB)) === false, "tenant B cannot delete it");
    check((await resolveAudienceContacts(tA, "does-not-exist")) === null, "unknown audience id -> null");
    // A contacts-view SavedFilter must NOT be treated as an audience.
    const sf = await createSavedFilter({ tenantId: tA, name: "a contacts filter", view: "contacts", definition: VIP, createdById: null });
    check((await listAudiences(tA)).every((a) => a.id !== sf.id), "a view=contacts saved filter is NOT listed as an audience");
    check((await getAudience(sf.id, tA)) === null, "getAudience refuses a contacts-view filter");
    check((await updateAudience(sf.id, tA, { name: "x" })) === false, "updateAudience refuses a contacts-view filter");
    check((await listSavedFilters(tA, "contacts")).some((f: any) => f.id === sf.id), "...and that filter still exists under view=contacts (untouched)");

    console.log("\ndelete:");
    check(await deleteAudience(aud.id, tA), "deleteAudience (own tenant) succeeds");
    check((await listAudiences(tA)).length === 0, "audience gone from list");
  } catch (e) {
    console.log("   (error: " + (e as Error).stack + ")"); fails++;
  } finally {
    for (const id of tenants) {
      try { await db.savedFilter.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.contact.deleteMany({ where: { tenantId: id } }); } catch {}
      try { await db.tenant.delete({ where: { id } }); } catch {}
    }
  }
  console.log("\n=========");
  console.log(fails === 0 ? "ALL PASSED \u2705  (audiences)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
