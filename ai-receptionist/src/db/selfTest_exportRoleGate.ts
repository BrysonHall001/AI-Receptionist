// Self-test — the export role gate. Exercises the REAL requireRole middleware
// (the same one now applied to GET /api/feedback/export-rows, and the one the
// admin router uses for the master export routes).
//
//   npx tsx src/db/selfTest_exportRoleGate.ts
//
// PROVES: OWNER/SUPER_ADMIN/AUDITOR pass (next() called, no error); PORTAL_ADMIN
// and CLIENT_USER are rejected with 403; an unauthenticated request gets 401.
// Because the route sees the EFFECTIVE role, impersonating a CLIENT_USER/
// PORTAL_ADMIN hits the PORTAL_ADMIN/CLIENT_USER case below -> 403.
// No DB needed (pure middleware), so this runs anywhere.

import { requireRole } from "../middleware/auth";

const gate = requireRole("OWNER", "SUPER_ADMIN", "AUDITOR");
const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures.push(label);
}

function run(role: string | null): { status: number; nexted: boolean } {
  let status = 0;
  let nexted = false;
  const req: any = { user: role ? { role } : undefined };
  const res: any = { status(c: number) { status = c; return this; }, json() { return this; } };
  const next = () => { nexted = true; };
  gate(req, res, next);
  return { status, nexted };
}

console.log("Export role gate (real requireRole middleware)");
console.log("==============================================");

console.log("Allowed roles pass through:");
for (const role of ["OWNER", "SUPER_ADMIN", "AUDITOR"]) {
  const r = run(role);
  check(r.nexted && r.status === 0, `${role} -> allowed (next called, no error status)`);
}

console.log("Lower roles are rejected (covers impersonating down):");
for (const role of ["PORTAL_ADMIN", "CLIENT_USER"]) {
  const r = run(role);
  check(!r.nexted && r.status === 403, `${role} -> 403, not allowed through`);
}

console.log("Unauthenticated is rejected:");
const u = run(null);
check(!u.nexted && u.status === 401, "no user -> 401");

console.log("\n==============================================");
if (failures.length === 0) console.log("ALL CHECKS PASSED ✅");
else { console.log(`${failures.length} CHECK(S) FAILED ❌`); failures.forEach((f) => console.log("   - " + f)); }
process.exit(failures.length === 0 ? 0 : 1);
