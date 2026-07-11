// Real-path self-test for the role-consistency fix (portal view vs admin Users list).
//
//   npx tsx src/db/selfTest_roleConsistency.ts        (needs dev Postgres)
//
// Symptom this guards against: an account showed "Owner" in Clarity HQ -> Users but
// "Super Admin" in the portal view. Root cause was NOT two different role sources on
// the server — BOTH surfaces read the SAME user.role column:
//   * portal view / sidebar chip  ->  /api/auth/me  ->  attachUser -> getUserForToken
//   * admin Users list            ->  /api/admin/users -> listUsers -> publicUser
// The disagreement came from the CLIENT caching App.state.me at boot and never
// re-reading it, so an out-of-band promotion (make-owner sets role=OWNER) appeared in
// the freshly-fetched Users list but not in the cached sidebar identity. The client
// fix re-syncs App.state.me; this test proves the SERVER sources agree for any role.
//
// It also prints (read-only) the ACTUAL role of the operator account(s) so you can see
// what your row really is, without changing anything.
//
// SAFETY: creates ONE temporary user, then deletes it. Never mutates real accounts.

import { prisma, disconnectDb } from "./client";
import { createSession, getUserForToken, destroySession } from "../auth/session";
import { publicUser, createUser } from "../services/userService";
import { env } from "../config/env";

const failures: string[] = [];
function check(cond: boolean, label: string) {
  console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`);
  if (!cond) failures.push(label);
}

// The exact value the portal view / sidebar renders from: /api/auth/me -> attachUser,
// which builds req.user.role from getUserForToken(session).user.role.
async function roleFromMePath(userId: string): Promise<string | null> {
  const token = await createSession(userId);
  try {
    const u = (await getUserForToken(token)) as any;
    return u ? (u.role as string) : null;
  } finally {
    await destroySession(token);
  }
}

// The exact value the admin Users list renders from: /api/admin/users -> listUsers,
// which maps every row through publicUser(row). We read the same row + tenant include.
async function roleFromAdminUsersPath(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
  return row ? (publicUser(row as any).role as string) : null;
}

async function main() {
  console.log("Role consistency — portal view vs admin Users list (real Prisma)");
  console.log("================================================================\n");

  // ---- (A) Read-only diagnostic: what are the operator accounts' REAL roles? -------
  console.log("Actual roles in the database (read-only diagnostic):");
  const diagEmails = Array.from(
    new Set([String(env.SUPER_ADMIN_EMAIL || "").toLowerCase(), "brysonhall001@gmail.com"].filter(Boolean))
  );
  for (const email of diagEmails) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) console.log(`  \u2022 ${email}: role = ${u.role}`);
    else console.log(`  \u2022 ${email}: (no such user)`);
  }
  console.log("");

  // ---- (B) Deterministic: both server sources resolve the SAME role, for OWNER and
  //          SUPER_ADMIN alike, because they share the user.role column. ------------
  const email = `roleconsistency_${Date.now()}@example.invalid`;
  const temp = await createUser({ email, password: "SelfTestPassw0rd!", role: "SUPER_ADMIN", tenantId: null });
  try {
    for (const role of ["OWNER", "SUPER_ADMIN"] as const) {
      await prisma.user.update({ where: { id: temp.id }, data: { role: role as any } });
      const mePath = await roleFromMePath(temp.id);
      const adminPath = await roleFromAdminUsersPath(temp.id);
      console.log(`With DB role = ${role}:`);
      check(mePath === role, `portal view / sidebar (/me source) resolves ${role}`);
      check(adminPath === role, `admin Users list (listUsers source) resolves ${role}`);
      check(mePath === adminPath, `both surfaces AGREE (same source) -> ${mePath}`);
    }
  } finally {
    await prisma.user.delete({ where: { id: temp.id } }).catch(() => undefined);
  }

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705 (both surfaces resolve role from the same source)" : failures.length + " FAILED \u274c"}`);
  await disconnectDb();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error("selfTest_roleConsistency crashed:", (err as Error).message);
  await disconnectDb();
  process.exit(1);
});
