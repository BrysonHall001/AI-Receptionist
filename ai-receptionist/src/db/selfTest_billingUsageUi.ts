// Static self-test — Billing & Usage UI (fs-reads only; run in sandbox).
//   npx tsx src/db/selfTest_billingUsageUi.ts
import { readFileSync } from "fs";
import { resolve } from "path";
const failures: string[] = [];
function check(cond: boolean, label: string) { console.log(`  ${cond ? "\u2713" : "\u2717"} ${label}`); if (!cond) failures.push(label); }
const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const has = (s: string, sub: string) => s.indexOf(sub) !== -1;

function main() {
  console.log("Billing & Usage UI");
  console.log("==================");
  const reports = read("../../public/js/reports.js");
  const admin = read("../../public/js/admin.js");
  const app = read("../../public/js/app.js");
  const html = read("../../public/index.html");

  console.log("(1) reuse of the reports widget engine:");
  check(has(reports, "renderWidgetBody,") || /renderWidgetBody\s*[},]/.test(reports.slice(reports.indexOf("App.reports ="))), "reports.js exposes renderWidgetBody on App.reports");
  check(has(admin, "App.reports.renderWidgetBody("), "admin.js drives the SAME engine via App.reports.renderWidgetBody");
  check(!/renderWidgetBody[\s\S]{0,400}App\.portalApi/.test(admin) && has(admin, "/api/admin/usage"), "hub usage widgets fetch from the admin usage endpoints, not portalApi");
  check(has(html, "chart.umd.min.js") && html.indexOf("chart.umd.min.js") < html.indexOf("/js/admin.js"), "Chart.js is loaded before admin.js on the hub page");

  console.log("\n(2) usage reporting source (Task 1):");
  for (const f of ['key: "date"', 'key: "tenant"', 'key: "calls"', 'key: "callMinutes"', 'key: "promptTokens"', 'key: "completionTokens"', 'key: "totalTokens"', 'key: "emails"', 'key: "sms"', 'key: "callCost"', 'key: "tokenCost"', 'key: "numberCost"', 'key: "totalCost"']) {
    check(has(admin, f), `usage source has field ${f}`);
  }
  check(has(admin, 'key: "usage"') && has(admin, "reportFields: USAGE_FIELDS"), "a { key:'usage', reportFields } source is defined");
  check(has(admin, "callSeconds || 0) / 60"), "callMinutes is derived from callSeconds/60");

  console.log("\n(3) per-tenant drill-in (Task 2):");
  check(has(admin, "async function usageSectionInto") && has(admin, "/api/admin/usage/tenant/"), "tenant detail has a usage drill-in using the per-tenant endpoint");
  check(has(admin, "usageSectionInto(usageHost, portal)"), "renderTenantDetail mounts the usage section");
  check(has(admin, "Total est. cost") && has(admin, "usageKpis"), "drill-in shows KPI cards incl. Total est. cost");

  console.log("\n(4) macro page + 3 tabs (Task 3):");
  check(has(admin, "async function renderUsageBilling"), "renderUsageBilling page exists");
  check(has(admin, '["overview", "Overview"]') && has(admin, '["byportal", "By portal"]') && has(admin, '["rates", "Billing Rates"]'), "three tabs: Overview, By portal, Billing Rates");
  check(has(admin, "/api/admin/usage?bucket=day"), "Overview/By-portal use the macro usage endpoint");
  check(has(admin, "data.perTenant") && has(admin, "App.table.mount("), "By portal renders a sortable per-tenant table");
  check(has(app, 'if ((path === "/admin/email" || path === "/admin/usage") && !(me.role === "OWNER" || me.role === "SUPER_ADMIN"))'), "Billing & Usage page is OWNER/SUPER_ADMIN gated in the router");

  console.log("\n(5) Billing Rates consolidation + logos (Task 4):");
  check(has(admin, "async function billingRatesInto"), "rates form is embeddable (billingRatesInto)");
  check(!has(admin, "async function renderBilling(") && !has(app, '"#/admin/billing"'), "standalone Billing page + nav are GONE");
  check(has(admin, "/api/admin/billing-rates") && !/\.billingRate\.|second rates store/i.test(admin), "reuses the SAME rates endpoint (no duplicate store)");
  check(has(admin, "/img/openai.webp") && has(admin, "/img/twilio.png"), "OpenAI + Twilio logos on the rate rows (reused integration assets)");
  for (const rk of ["openAiInputPer1kTokens", "openAiOutputPer1kTokens", "twilioPerCallMinute", "twilioPerNumberMonthly", "twilioPerSms"]) {
    check(has(admin, rk), `rate field present: ${rk}`);
  }
  check(has(admin, "does not bill anyone"), "explanatory note retained");

  console.log("\n(6) range + grouping control (Task 5):");
  check(has(admin, "function usageRangeControl") && has(admin, "grouping"), "date-range + day/week/month/year grouping control exists");
  check(has(admin, "OVER_TIME_DEFS") && has(admin, 'field: "totalCost"') && has(admin, 'field: "calls"'), "widgets are config-driven (cost + calls over time)");

  console.log("\n==================");
  if (failures.length === 0) console.log("ALL CHECKS PASSED \u2705  (billing & usage UI)");
  else { console.log(`${failures.length} CHECK(S) FAILED \u274c`); failures.forEach((f) => console.log("   - " + f)); }
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
