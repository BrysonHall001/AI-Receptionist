// DB-backed self-test (Codespace) for "who's online" presence.
//
//   npx tsx src/db/selfTest_presence.ts        (needs dev Postgres)
//
// Proves the privacy/visibility rules:
//   1) SCOPING: members present in tenant A never appear for tenant B (and vice versa).
//   2) FRESHNESS: a member whose lastSeenAt is older than the 90s window is excluded.
//   3) SELF: the caller (a member) IS included in their own tenant's list.
//   4) ADMIN EXCLUSION: OWNER / SUPER_ADMIN / AUDITOR are NEVER returned — even with a
//      fresh lastSeenAt and even if tenant-scoped (simulating being "in" the portal via
//      impersonation) — because presence keys off the REAL identity's row + role filter.
//   5) HEARTBEAT keys off the REAL user (an impersonating admin stamps their own admin
//      row, never a member row → still no dot).
//   6) DOT-COLOR validation rejects junk and persists a valid hex (lowercased); the
//      fallback color is deterministic.
import { prisma, disconnectDb } from "./client";
import { apiRouter } from "../routes/api";
import { listPresentMembers, presenceFallbackColor, stampHeartbeat, PRESENCE_WINDOW_MS } from "../services/presenceService";

const stamp = Date.now();
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

function findHandler(method: string, path: string): (req: any, res: any) => any {
  const layer = (apiRouter as any).stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]);
  if (!layer) throw new Error(`route not wired: ${method} ${path}`);
  const s = layer.route.stack;
  return s[s.length - 1].handle;
}
function mockRes() {
  const res: any = { _status: 200, _json: null };
  res.status = (c: number) => { res._status = c; return res; };
  res.json = (o: any) => { res._json = o; return res; };
  return res;
}
const fresh = () => new Date();
const stale = () => new Date(Date.now() - PRESENCE_WINDOW_MS - 60_000);

const tenantIds: string[] = [];
const userIds: string[] = [];
async function mkTenant(tag: string) {
  const t = await prisma.tenant.create({ data: { name: `presence-${tag}-${stamp}`, notifyEmail: `t-${tag}-${stamp}@ex.com`, billingStatus: "active" } });
  tenantIds.push(t.id); return t.id;
}
async function mkUser(tenantId: string | null, role: any, tag: string, lastSeenAt: Date | null, dotColor?: string) {
  const u = await prisma.user.create({ data: { email: `${tag}-${stamp}@ex.com`, passwordHash: "x", name: tag.toUpperCase(), role, tenantId, lastSeenAt, dotColor: dotColor ?? null } });
  userIds.push(u.id); return u;
}

async function main() {
  console.log("Presence — scoping, admin exclusion, heartbeat, dot-color\n=========================================================");

  const A = await mkTenant("A"), B = await mkTenant("B");
  const mA1 = await mkUser(A, "CLIENT_USER", "alice", fresh());       // member, fresh (the "caller")
  const mA2 = await mkUser(A, "PORTAL_ADMIN", "adam", fresh());       // portal-admin member, fresh
  const cA = await mkUser(A, "CLIENT_USER", "casey", fresh());        // custom-role user = base CLIENT_USER
  await prisma.user.update({ where: { id: cA.id }, data: { customRoleId: null } });
  const staleA = await mkUser(A, "CLIENT_USER", "stan", stale());     // member, STALE
  const adminInA = await mkUser(A, "SUPER_ADMIN", "sam", fresh());    // admin-tier but tenant-scoped + fresh (should still be excluded)
  const mB1 = await mkUser(B, "CLIENT_USER", "bob", fresh());         // member of B
  const owner = await mkUser(null, "OWNER", "olly", fresh());         // admin-tier, global, fresh

  const listA = await listPresentMembers(A);
  const idsA = new Set(listA.map((p) => p.id));
  const listB = await listPresentMembers(B);
  const idsB = new Set(listB.map((p) => p.id));

  // (3) self + normal members present
  check(idsA.has(mA1.id), "caller (alice) IS included in her own tenant list");
  check(idsA.has(mA2.id) && idsA.has(cA.id), "portal-admin + custom-role members are present");
  // (2) freshness
  check(!idsA.has(staleA.id), "stale member (>90s) is excluded");
  // (1) cross-tenant scoping
  check(!idsA.has(mB1.id), "tenant B member does NOT appear in tenant A");
  check(idsB.has(mB1.id) && !idsB.has(mA1.id), "tenant A members do NOT appear in tenant B");
  // (4) admin exclusion — this is the line that proves admin exclusion + scoping
  check(!idsA.has(owner.id) && !idsA.has(adminInA.id), "OWNER/SUPER_ADMIN excluded from A even with fresh lastSeenAt (incl. tenant-scoped)");
  // no PII leaked
  check(listA.every((p) => !("email" in p)), "presence entries expose no email/PII");

  // (BUG-1 FIX) self-view: a brand-new member (lastSeenAt = null) is absent until their
  // OWN heartbeat is stamped, then appears IMMEDIATELY — no dependency on a prior/separate
  // heartbeat call or poll ordering. This is what GET /api/presence now guarantees by
  // stamping the caller before listing.
  const fresh1 = await mkUser(A, "CLIENT_USER", "nadia", null); // brand-new, never seen
  const beforeStamp = await listPresentMembers(A);
  check(!beforeStamp.some((p) => p.id === fresh1.id), "brand-new member (lastSeenAt null) is absent before any heartbeat");
  await stampHeartbeat(fresh1.id);
  const afterStamp = await listPresentMembers(A);
  check(afterStamp.some((p) => p.id === fresh1.id), "member appears IMMEDIATELY after their own heartbeat is stamped (self-view fix)");

  // (5) heartbeat keys off REAL identity. Simulate impersonation: realUser=owner (admin),
  // req.user carries owner's id downgraded into tenant A (as the middleware builds it).
  await prisma.user.update({ where: { id: owner.id }, data: { lastSeenAt: stale() } });
  const hb = findHandler("POST", "/presence/heartbeat");
  await hb({ realUser: { id: owner.id, role: "OWNER" }, user: { id: owner.id, role: "CLIENT_USER", tenantId: A } }, mockRes());
  const ownerAfter = await prisma.user.findUnique({ where: { id: owner.id }, select: { lastSeenAt: true } });
  check(!!ownerAfter?.lastSeenAt && ownerAfter.lastSeenAt.getTime() > Date.now() - 10_000, "heartbeat stamped the REAL (admin) user");
  const listA2 = await listPresentMembers(A);
  check(!listA2.some((p) => p.id === owner.id), "impersonating admin STILL produces no dot after heartbeat");

  // (6) dot-color validation + persistence
  const patch = findHandler("PATCH", "/account/dot-color");
  const rBad = mockRes();
  await patch({ realUser: { id: mA1.id }, user: { id: mA1.id }, body: { color: "not-a-color" } }, rBad);
  check(rBad._status === 400, "PATCH dot-color rejects junk (400)");
  const rGood = mockRes();
  await patch({ realUser: { id: mA1.id }, user: { id: mA1.id }, body: { color: "#A34BD0" } }, rGood);
  const saved = await prisma.user.findUnique({ where: { id: mA1.id }, select: { dotColor: true } });
  check(rGood._status === 200 && saved?.dotColor === "#a34bd0", "PATCH dot-color persists a valid hex (lowercased)");
  const getC = findHandler("GET", "/account/dot-color");
  const rGet = mockRes();
  await getC({ realUser: { id: mA1.id }, user: { id: mA1.id } }, rGet);
  check(rGet._json && rGet._json.color === "#a34bd0" && rGet._json.isDefault === false, "GET dot-color returns saved color (isDefault false)");
  const rGet2 = mockRes();
  await getC({ realUser: { id: mA2.id }, user: { id: mA2.id } }, rGet2);
  check(rGet2._json && rGet2._json.isDefault === true && /^#[0-9a-f]{6}$/.test(rGet2._json.color), "GET dot-color falls back to a deterministic hex when unset");
  check(presenceFallbackColor(mA2.id) === presenceFallbackColor(mA2.id) && presenceFallbackColor(mA2.id) === rGet2._json.color, "fallback color is deterministic for a given id");

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (presence scoping + admin exclusion + heartbeat + dot-color)" : failures.length + " FAILED \u274c"}`);
}

main()
  .catch((e) => { console.error(e); failures.push("threw: " + (e as Error).message); })
  .finally(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await disconnectDb();
    process.exit(failures.length ? 1 : 0);
  });
