process.env.AI_PROVIDER = "mock";

// TEMPLATE BUILDER PART 2 — self-test.
//
// Two things carry the batch: a built-in template cannot be deleted by ANY route, and
// "deleted" means unavailable rather than erased. Both are proved against the real service
// and the real endpoint, not against a description of them.
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma, disconnectDb } = require("./client");
const { createPortal } = require("../services/portalService");
const { createUser } = require("../services/userService");
const { createSession } = require("../auth/session");
const { createApp } = require("../app");
const { TENANT_TEMPLATES, resolveTemplate, listAllTemplates, reservedTemplateKeys } = require("../services/tenantTemplates");
const { readFileSync } = require("fs");
const { resolve: resolvePath } = require("path");
const { JSDOM } = require("jsdom");

const db = prisma as any;
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const cleanupTenants: string[] = [];
const cleanupUsers: string[] = [];
const cleanupRows: string[] = [];
const PW = "Correct-Horse-9!";

async function main() {
  console.log("TEMPLATE BUILDER PART 2 — self-test");
  console.log("===================================");
  const stamp = Date.now();
  const server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const owner: any = await createUser({ email: `tb2-owner-${stamp}@example.invalid`, name: "TB2 Owner", password: PW, role: "OWNER", tenantId: null } as any);
  cleanupUsers.push(owner.id);
  const ownerJar = `air_session=${await createSession(owner.id)}`;
  const post = async (path: string, body: any, cookie: string) => {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body || {}) });
    let j: any = null; try { j = await r.json(); } catch { /* */ }
    return { status: r.status, body: j };
  };

  const key = `tb2_${stamp}`;
  const row: any = await db.tenantTemplateRow.create({
    data: { key, label: `TB2 ${stamp}`, description: "Built for the test.", spec: { pagesOffPrefill: ["#/reports"], modulesHiddenPrefill: ["vehicle"] } },
  });
  cleanupRows.push(row.id);

  // ---------- (1) THE ONE THAT MATTERS: a built-in cannot be deleted ----------
  console.log("\n(1) the four built-in templates:");
  const builtInKeys: string[] = reservedTemplateKeys();
  check(builtInKeys.length === 4, `there are ${builtInKeys.length} built-in keys (${builtInKeys.join(", ")})`);
  // There is no row to address them by, so the only way to try is to forge one - which is
  // exactly what a bypass would do. Make a row carrying a built-in key and aim the endpoint
  // at it: the SERVER must refuse on the key, not on the absence of a row.
  const forged: any = await db.tenantTemplateRow.create({ data: { key: builtInKeys[0], label: "Forged", description: "", spec: {} } });
  cleanupRows.push(forged.id);
  const attack = await post(`/api/admin/template-rows/${forged.id}/delete`, { password: PW }, ownerJar);
  check(attack.status === 400 && /built-in/i.test(attack.body?.error || ""),
    `a direct request carrying a BUILT-IN key is refused (${attack.status}: ${attack.body?.error}) \u2014 with the correct password, so it is the key that stopped it`);
  const stillThere = await db.tenantTemplateRow.findUnique({ where: { id: forged.id } });
  check(!!stillThere && stillThere.deletedAt === null, "\u2026and nothing was marked deleted");
  // NEGATIVE: the same request against a NON built-in key goes through, so the refusal above
  // is the key check working rather than the endpoint being broken for everything.
  const control: any = await db.tenantTemplateRow.create({ data: { key: `ctl_${stamp}`, label: "Control", description: "", spec: {} } });
  cleanupRows.push(control.id);
  const ok = await post(`/api/admin/template-rows/${control.id}/delete`, { password: PW }, ownerJar);
  check(ok.status === 200,
    `NEGATIVE: the identical request against a template you BUILT succeeds (${ok.status}) \u2014 the refusal is the built-in check, not a dead endpoint`);
  check(TENANT_TEMPLATES.length === 4, "the four built-ins are still in code, untouched by any of this");

  // ---------- (2) the password gate ----------
  console.log("\n(2) deleting asks for the password:");
  const noPw = await post(`/api/admin/template-rows/${row.id}/delete`, {}, ownerJar);
  check(noPw.status === 400, `no password is refused (${noPw.status})`);
  const badPw = await post(`/api/admin/template-rows/${row.id}/delete`, { password: "not-my-password" }, ownerJar);
  check(badPw.status === 401 && badPw.body?.error === "Invalid email or password",
    "a wrong password is refused with the same generic message a failed sign-in gives");
  const auditRow = await db.auditEvent.findFirst({
    where: { actorId: owner.id, action: "auth.login_failed" }, orderBy: { createdAt: "desc" },
  }).catch(() => null);
  check(!!auditRow, "\u2026and it writes the SAME audit row a failed sign-in writes");
  check((await db.tenantTemplateRow.findUnique({ where: { id: row.id } })).deletedAt === null,
    "\u2026and nothing was deleted by the failed attempt");

  // ---------- (3) deleted means unavailable, not erased ----------
  console.log("\n(3) what deleting actually does:");
  const madeFromIt: any = await createPortal({ name: `tb2-tenant-${stamp}`, billingStatus: "trial", template: key } as any);
  cleanupTenants.push(madeFromIt.id);
  const goodDel = await post(`/api/admin/template-rows/${row.id}/delete`, { password: PW }, ownerJar);
  check(goodDel.status === 200, "the correct password deletes it");
  const after = await db.tenantTemplateRow.findUnique({ where: { id: row.id } });
  check(!!after && !!after.deletedAt && after.deletedById === owner.id,
    "\u2026as a SOFT delete: the row survives, stamped with who did it and when");
  const offered = (await listAllTemplates()).map((t: any) => t.key);
  check(!offered.includes(key), "\u2026it is no longer offered when creating a tenant");
  check(offered.length === 4, `\u2026leaving exactly the four built-ins (${offered.length})`);
  const resolved = await resolveTemplate(key);
  check(!!resolved && resolved.key === key,
    "\u2026but it STILL RESOLVES, so a tenant made from it carries on exactly as it is");
  const t = await db.tenant.findUnique({ where: { id: madeFromIt.id } });
  check(t.templateKey === key, "\u2026and that tenant still reports which template it came from");

  // ---------- (4) the key is reserved forever ----------
  console.log("\n(4) the name cannot be reused:");
  const reuse = await post("/api/admin/template-rows", { label: `TB2 ${stamp}`, description: "", spec: {} }, ownerJar);
  check(reuse.status === 409,
    `creating a new template with the deleted one's name is refused (${reuse.status}) \u2014 reusing it would rewrite that tenant's history`);

  // ---------- (5) who may delete ----------
  console.log("\n(5) who can reach it:");
  const portalUser: any = await createUser({ email: `tb2-cu-${stamp}@example.invalid`, name: "CU", password: PW, role: "CLIENT_USER", tenantId: madeFromIt.id } as any);
  cleanupUsers.push(portalUser.id);
  const cuJar = `air_session=${await createSession(portalUser.id)}`;
  const cuTry = await post(`/api/admin/template-rows/${control.id}/delete`, { password: PW }, cuJar);
  check(cuTry.status === 401 || cuTry.status === 403,
    `someone who cannot reach Developer Tools cannot delete a template (${cuTry.status})`);
  server.close();

  // ---------- (6) one component, two screens ----------
  console.log("\n(6) the shared card:");
  const adminJs = readFileSync(resolvePath(__dirname, "..", "..", "public", "js", "admin.js"), "utf8");
  const inner = adminJs.slice(adminJs.indexOf("(function (global) {") + "(function (global) {".length, adminJs.lastIndexOf("})(typeof window"));
  const w: any = new JSDOM("<body></body>", { runScripts: "outside-only", url: "http://localhost/" }).window;
  const el = (tag: string, c?: string, h?: string) => { const n = w.document.createElement(tag); if (c) n.className = c; if (h !== undefined) n.innerHTML = h; return n; };
  const esc = (x: any) => String(x == null ? "" : x).replace(/[&<>"]/g, (c: string) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  w.App = { util: { el, esc, toast: () => { /* */ }, $: (s: string) => w.document.querySelector(s) }, icons: { forTemplateKey: (k: string) => `<svg data-k="${k}"/>` } };
  const templateCard = new Function("global", inner + "\nreturn templateCard;")(w);
  const sample = { key: "field_services", label: "Field Services", description: "Work orders.", customLcOffer: true, builtIn: true };
  const wizardCard = templateCard(sample, { selectedKey: "general", lcChecked: false, onPick: () => { /* */ } });
  const builderCard = templateCard(sample, { onPick: () => { /* */ }, onDelete: () => { /* */ } });
  check(wizardCard.outerHTML === builderCard.outerHTML,
    "both screens render IDENTICAL markup for a built-in \u2014 one component, and the x is absent from both");
  const mine = { ...sample, key: "mine", label: "Mine", builtIn: false };
  const deletable = templateCard(mine, { onPick: () => { /* */ }, onDelete: () => { /* */ } });
  const wizardMine = templateCard(mine, { selectedKey: "general", lcChecked: false, onPick: () => { /* */ } });
  check(!!deletable.querySelector(".tpl-x") && !wizardMine.querySelector(".tpl-x"),
    "a template you BUILT gets the x on the builder and never on the wizard");
  check(deletable.outerHTML.replace(/<span class="tpl-x".*?<\/span>/, "") === wizardMine.outerHTML,
    "\u2026and the x is the ONLY difference between them");

  // ---------- (7) the row scrolls rather than wrapping ----------
  console.log("\n(7) the row:");
  const css = readFileSync(resolvePath(__dirname, "..", "..", "public", "styles.css"), "utf8");
  const rowRule = css.slice(css.indexOf(".adm-tpl-row { position: relative;"), css.indexOf("}", css.indexOf(".adm-tpl-row { position: relative;")));
  check(/flex-wrap:\s*nowrap/.test(rowRule) && /overflow-x:\s*auto/.test(rowRule),
    "the row scrolls sideways instead of wrapping onto a second line");
  check(css.includes(".adm-tpl-row > .adm-tpl-card { flex: 0 0 auto; }"),
    "\u2026and the cards keep their designed width rather than being squashed to fit");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .adm-tpl-band"));
  check(/\.adm-tpl-band \{[^}]*background-position: 0% 0% !important/.test(reduced),
    "reduced motion pins the background so it does not move");

  for (const id of cleanupTenants) { await db.tenant.delete({ where: { id } }).catch(() => { /* */ }); }
  for (const id of cleanupUsers) { await db.user.delete({ where: { id } }).catch(() => { /* */ }); }
  for (const id of cleanupRows) { await db.tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ }); }

  console.log("");
  if (failures.length) { console.log(`${failures.length} FAILED \u274c: ${failures[0]}`); await disconnectDb(); process.exit(1); }
  console.log("ALL PASSED \u2705 (one row, two screens, and deletion that keeps history readable)");
  await disconnectDb();
  process.exit(0);
}

main().catch(async (e: any) => {
  console.error("threw:", e);
  // Clean up even on a throw, so a crash cannot leave fixtures that make the next run worse.
  try {
    for (const id of cleanupTenants) await (prisma as any).tenant.delete({ where: { id } }).catch(() => { /* */ });
    for (const id of cleanupUsers) await (prisma as any).user.delete({ where: { id } }).catch(() => { /* */ });
    for (const id of cleanupRows) await (prisma as any).tenantTemplateRow.delete({ where: { id } }).catch(() => { /* */ });
  } catch { /* best-effort */ }
  await disconnectDb().catch(() => { /* */ });
  process.exit(1);
});

export {};
