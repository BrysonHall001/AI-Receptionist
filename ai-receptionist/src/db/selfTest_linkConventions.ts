// LINK CONVENTIONS — data-layer self-test. Five standing layers. Fixture
// patterns: selfTest_priceBook (tenant + estimate convert flow), the dummy
// probe from selfTest_listpageIntegrity. Note on audit parity: link add/remove
// carries no dedicated audit event today; the panels write through the SAME
// createLink/softDeleteLink paths, so parity is identity — asserted by round-
// tripping real RecordLink rows through those exact services.
import { prisma, disconnectDb } from "./client";
import { listRecordTypes, listLinkConventions, ensureLinkConventions, resolveRecordTypeId, WORK_ORDER_RECORD_TYPE_KEY } from "../services/recordTypeService";
import { createRecord, generateDummyRecord } from "../services/recordService";
import { createLink, listLinksForRecord, softDeleteLink } from "../services/recordLinkService";
import { createResource } from "../services/resourceService";
import { issueEstimateLink, decideEstimate, convertEstimate, ESTIMATE_RECORD_TYPE_KEY } from "../services/estimateService";
import { readFileSync } from "fs";
import { join } from "path";

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");

async function mkTenant(tag: string) {
  const stamp = Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const t = await db.tenant.create({ data: { name: `lc-${tag}-${stamp}`, notifyEmail: `lc-${tag}-${stamp}@example.invalid`, billingStatus: "active" } });
  return t.id as string;
}

async function main() {
  console.log("Link Conventions — data-layer self-test");
  console.log("=======================================");

  // ---------- (1) builds ----------
  console.log("\n(1) builds & migrations:");
  const cl = await db.changeLogEntry.findFirst({ where: { commitSha: "batch-link-conventions-20260725" } });
  check(!!cl && cl.id === "cl_link_conventions_20260725", "the changelog row landed (idempotent migration)");

  // ---------- (2) happy paths ----------
  console.log("\n(2) happy paths:");
  const T = await mkTenant("main");
  const types: any[] = await listRecordTypes(T);
  const wo = types.find((t) => t.key === "work_order");
  const eq = types.find((t) => t.key === "equipment");
  check(Array.isArray(wo.linkConventions) && wo.linkConventions.some((c: any) => c.role === "serviced_equipment" && c.surfaced && c.cardinality === "many")
    && wo.linkConventions.some((c: any) => c.role === "converted_from_estimate" && c.cardinality === "one"),
    "the registry payload carries BOTH surfaced conventions on work_order");
  check(eq.linkConventions.some((c: any) => c.role === "serviced_equipment" && c.labelTo === "Service history"),
    "\u2026and equipment sees the SAME convention from the reverse side (Service history)");
  await ensureLinkConventions(T); await ensureLinkConventions(T);
  const { DEFAULT_LINK_CONVENTION_COUNT } = require("../services/recordTypeService");
  const SEEDED_CONVENTIONS = await db.linkConvention.count({ where: { tenantId: T } });
  check(SEEDED_CONVENTIONS === DEFAULT_LINK_CONVENTION_COUNT,
    `seeding is idempotent by key (${SEEDED_CONVENTIONS} rows after repeated ensures \u2014 every declared convention, once each)`);

  // Panel-path add/remove = the exact services the routes call.
  const woRec: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Compressor swap", subtypeKey: "repair", stageKey: "scheduled", appointmentAt: "2026-07-30T10:00", customFields: {} } as any);
  const unit: any = await createRecord(T, "equipment", { title: "Rooftop AC \u2014 Unit 7", customFields: { status: "Active" } } as any);
  const link: any = await createLink(T, { recordId: woRec.id, parentType: "record", parentId: unit.id, role: "serviced_equipment" });
  const woLinks: any[] = await listLinksForRecord(T, woRec.id);
  const mine = woLinks.find((l) => l.role === "serviced_equipment");
  check(!!mine && mine.other && mine.other.title === "Rooftop AC \u2014 Unit 7" && "appointmentAt" in mine.other && "createdAt" in mine.other,
    "the link lists with role + the key-facts snapshot (additive appointmentAt/createdAt present)");
  const eqLinks: any[] = await listLinksForRecord(T, unit.id);
  const hist = eqLinks.find((l) => l.role === "serviced_equipment");
  check(!!hist && hist.other && hist.other.title === "Compressor swap" && String(hist.other.appointmentAt || "").length > 0,
    "the REVERSE side resolves: the unit's history lists the work order with its appointment date");
  await softDeleteLink(T, link.id);
  check(!(await listLinksForRecord(T, woRec.id)).some((l: any) => l.role === "serviced_equipment"), "panel-path remove soft-deletes through the one machinery");

  // Dummy awareness (D).
  await createResource(T, { name: "Kit Tech" } as any);
  const dummy: any = await generateDummyRecord(T, WORK_ORDER_RECORD_TYPE_KEY);
  const dl: any[] = await listLinksForRecord(T, dummy.id);
  check(dl.some((l) => l.role === "serviced_equipment" && l.other && l.other.title), "a dummy work order arrives equipment-linked (role serviced_equipment)");

  // Conversion carries the UNIFIED role (declared, not migrated).
  const est: any = await createRecord(T, ESTIMATE_RECORD_TYPE_KEY, { title: "Duct quote", customFields: { status: "Draft", line_items: [{ description: "Ducting", quantity: 1, unitPrice: 200 }] } } as any);
  const issued: any = await issueEstimateLink(T, est.id, {});
  await decideEstimate(issued.token, "accepted");
  const conv = await convertEstimate(T, est.id, {});
  const convLinks: any[] = await listLinksForRecord(T, conv.workOrderId);
  check(convLinks.some((l) => l.role === "converted_from_estimate"), "conversion's back-link carries the unified declared role (no migration, none needed)");

  // ---------- (3) prime-directive regressions ----------
  console.log("\n(3) prime-directive regressions:");
  const rawWo: any = await createRecord(T, WORK_ORDER_RECORD_TYPE_KEY, { title: "Raw link WO", subtypeKey: "repair", customFields: {} } as any);
  await createLink(T, { recordId: rawWo.id, parentType: "record", parentId: unit.id }); // NO role — an owner-built association
  const rawL = (await listLinksForRecord(T, rawWo.id)).find((l: any) => l.otherType === "record");
  check(!!rawL && rawL.role == null, "an owner-built role-less link stays raw (never auto-adopted by seeding \u2014 the collision rule)");
  // Client-side contracts (contactsAllViews source-assertion precedent):
  const portal = read("public/js/portal.js");
  // RELATED REVISION (tenant-templates batch, stale-test rule): the batch-18
  // PANELS are gone \u2014 the convention now lives on the Related tabs. The
  // client contracts below assert the relocated design: the tab OWNS all of
  // its module's links (no exclusion split), a conventioned add CARRIES the
  // role, and cardinality-one hides Add when filled. Route-side, add/remove
  // still rides the same POST/DELETE link routes behind the permissionGate.
  check(!portal.includes("mountConventionPanels") && portal.includes("conventionForTab"),
    "the panels are GONE and the Related tabs are convention-aware (one linking UI on the page)");
  check(!portal.includes("surfacedRoles[l.role]") && portal.includes("l.other.recordTypeId === type.id; }).map"),
    "the tab owns ALL of its module's links \u2014 role-carrying and raw alike, nothing shows twice");
  check(portal.includes('conv.cardinality === "one" && links.length >= 1'), "cardinality one-filled hides Add on the conventioned tab (batch-18 rule relocated)");
  check(portal.includes("...(conv ? { role: conv.role } : {})"), "a conventioned tab's add CARRIES THE ROLE through the existing link route (permissionGate + parity by construction)");

  // ---------- (4) catastrophics ----------
  console.log("\n(4) catastrophics:");
  const TB = await mkTenant("iso");
  const bConvs: any[] = await listLinkConventions(TB);
  check(bConvs.length === SEEDED_CONVENTIONS && bConvs.every((c) => c.tenantId === TB), `CROSS-TENANT: conventions resolve tenant-isolated (B sees only its own ${bConvs.length} rows)`);
  check((await db.linkConvention.count({ where: { tenantId: T } })) === SEEDED_CONVENTIONS, "\u2026and B's ensure never wrote into A");

  for (const x of [T, TB]) { await db.tenant.delete({ where: { id: x } }).catch(() => { /* best-effort */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); process.exitCode = 1; }
  else console.log("ALL PASSED \u2705 (links learned meanings without growing a second machinery; raw stays raw)");
}

main().catch((e) => { console.error("threw:", e); process.exitCode = 1; }).finally(async () => { await disconnectDb(); });
