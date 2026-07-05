// DB-backed self-test (Codespace) for the "Last login: Never" fix (Task 4).
//
// Proves that creating a session stamps lastLoginAt at the SINGLE chokepoint
// (createSession) — so EVERY authentication path (password login, invite-accept
// auto-login, and any future path) updates it, not just the /login handler.
//
// SAFETY: one TEMPORARY user + its session, both deleted at the end.
//
//   npx tsx src/db/selfTest_sessionStampsLastLogin.ts
import { prisma, disconnectDb } from "./client";
import { createSession } from "../auth/session";

const db = prisma as any;
const EMAIL = `selftest_lastlogin_${Date.now()}@example.invalid`;

const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }

async function main() {
  console.log("Session creation stamps lastLoginAt");
  console.log("===================================");
  let userId: string | null = null;
  try {
    // A brand-new user who has never logged in — lastLoginAt starts null (the "Never" state).
    const user = await db.user.create({
      data: { email: EMAIL, passwordHash: "x", name: "Self Test", role: "SUPER_ADMIN", lastLoginAt: null },
    });
    userId = user.id;
    check(user.lastLoginAt == null, "new user starts with lastLoginAt = null (shows 'Never')");

    const before = Date.now();
    // Create a session the SAME way invite-accept / login do — via createSession only.
    const token = await createSession(user.id);
    check(typeof token === "string" && token.length > 0, "createSession returns a session token");

    const after = await db.user.findUnique({ where: { id: user.id } });
    check(after.lastLoginAt != null, "creating a session stamps lastLoginAt (no longer 'Never')");
    check(!!after.lastLoginAt && new Date(after.lastLoginAt).getTime() >= before - 2000,
      "lastLoginAt is stamped with the current time");

    // Clean up the session row we created.
    await db.session.deleteMany({ where: { userId: user.id } });
  } catch (e) {
    check(false, "test threw: " + (e as Error).message);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    await disconnectDb();
  }

  console.log(`\n${failures.length === 0 ? "ALL PASSED \u2705" : failures.length + " FAILED \u274c"} (session stamps lastLogin)`);
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
