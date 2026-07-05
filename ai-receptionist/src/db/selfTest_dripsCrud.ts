// Self-test: Drip service (visual builder, slice 1). CRUD, graph normalization + round-trip, and
// tenant scoping.  npx tsx src/db/selfTest_dripsCrud.ts
import { prisma, disconnectDb } from "./client";
import { listDrips, getDrip, createDrip, updateDrip, deleteDrip } from "../services/dripService";

const db = prisma as any;
let fails = 0;
function check(c: boolean, l: string) { console.log(`  ${c ? "\u2713" : "\u2717"} ${l}`); if (!c) fails++; }

async function main() {
  console.log("drips crud\n=========");
  const tenants: string[] = [];
  try {
    const tA = (await db.tenant.create({ data: { name: "Drip A", billingStatus: "paid", notifyEmail: "" } })).id; tenants.push(tA);
    const tB = (await db.tenant.create({ data: { name: "Drip B", billingStatus: "paid", notifyEmail: "" } })).id; tenants.push(tB);

    console.log("create + graph round-trip:");
    const graph = { nodes: [
      { id: "n1", type: "enroll_audience", x: 40, y: 60, config: { audienceIds: ["a1"] } },
      { id: "n2", type: "wait", x: 220, y: 60, config: { amount: 2, unit: "days" } },
      { id: "n3", type: "send_email", x: 400, y: 60, config: { mode: "scratch", subject: "Hi", html: "<p>x</p>" } },
    ] };
    const d = await createDrip({ tenantId: tA, name: "Nurture", graph, createdById: null });
    check(!!d.id && d.name === "Nurture", "createDrip returns id + name");
    const got = await getDrip(d.id, tA);
    check(!!got && got.graph.nodes.length === 3, "graph persisted with 3 nodes");
    const n2 = got!.graph.nodes.find((n: any) => n.id === "n2");
    check(n2 && n2.x === 220 && n2.y === 60 && n2.config.amount === 2 && n2.config.unit === "days", "node positions + config round-trip exactly");
    check(got!.graph.nodes[0].config.audienceIds[0] === "a1", "nested config (audienceIds) preserved");
    check((await listDrips(tA)).some((x) => x.id === d.id), "listDrips includes it");

    console.log("\ngraph normalization (defensive):");
    const messy = await createDrip({ tenantId: tA, name: "Messy", graph: { nodes: [
      { id: "ok", type: "wait", x: "150", y: 30 },                 // string x -> number, missing config -> {}
      { id: "", type: "wait", x: 0, y: 0 },                        // no id -> dropped
      { type: "send_email", x: 1, y: 1 },                          // no id -> dropped
      { id: "bad", type: "", x: 1, y: 1 },                         // no type -> dropped
      { id: "nan", type: "wait", x: "abc", y: 5, config: null },   // bad x -> 0, null config -> {}
    ] } as any });
    const mg = (await getDrip(messy.id, tA))!.graph.nodes;
    check(mg.length === 2, "invalid nodes (no id/type) dropped");
    const ok = mg.find((n: any) => n.id === "ok");
    check(ok && ok.x === 150 && typeof ok.x === "number" && typeof ok.config === "object", "string x coerced to number; missing config -> {}");
    const nan = mg.find((n: any) => n.id === "nan");
    check(nan && nan.x === 0 && typeof nan.config === "object", "unparseable x -> 0; null config -> {}");

    console.log("\nupdate (rename + regraph):");
    const upd = await updateDrip(d.id, tA, { name: "Nurture v2", graph: { nodes: [{ id: "z", type: "wait", x: 10, y: 10, config: { amount: 1, unit: "hours" } }] } });
    check(!!upd && upd.name === "Nurture v2" && upd.graph.nodes.length === 1, "rename + graph replace persisted");
    check((await getDrip(d.id, tA))!.graph.nodes[0].config.unit === "hours", "reopened drip reflects the new graph");

    console.log("\ntenant scoping:");
    check((await getDrip(d.id, tB)) === null, "tenant B cannot get tenant A's drip");
    check((await updateDrip(d.id, tB, { name: "hijack" })) === null, "tenant B cannot update it");
    check((await deleteDrip(d.id, tB)) === false, "tenant B cannot delete it");
    check((await listDrips(tB)).length === 0, "tenant B sees none of tenant A's drips");

    console.log("\ndelete:");
    check(await deleteDrip(d.id, tA), "deleteDrip (own tenant) succeeds");
    check(!(await listDrips(tA)).some((x) => x.id === d.id), "drip removed from list");
  } catch (e) {
    console.log("   (error: " + (e as Error).stack + ")"); fails++;
  } finally {
    for (const id of tenants) { try { await db.drip.deleteMany({ where: { tenantId: id } }); } catch {} try { await db.tenant.delete({ where: { id } }); } catch {} }
  }
  console.log("\n=========");
  console.log(fails === 0 ? "ALL PASSED \u2705  (drips crud)" : `${fails} FAILED \u274c`);
  await disconnectDb();
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1); });
