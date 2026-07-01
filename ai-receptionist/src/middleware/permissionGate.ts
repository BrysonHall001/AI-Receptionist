import { Request, Response, NextFunction } from "express";
import { can, Right } from "../services/permissionService";
import { getLockedPages } from "../services/portalService";

// ===========================================================================
// Batch 2 — server-side permission ENFORCEMENT (no UI).
//
// One chokepoint mounted on apiRouter. It maps the incoming (method, path) to an
// (area, right) from the Batch-1 catalog and enforces can(req.user, area, right),
// returning a clean 403 on denial. This is ADDITIVE: it runs after requireAuth and
// the view-only guard, and BEFORE the route handlers' own tenant scoping
// (tenantOr400) — a request must pass BOTH the area gate AND tenant scope.
//
// SAFETY — admins are a guaranteed no-op: can() returns true for OWNER /
// SUPER_ADMIN / AUDITOR / PORTAL_ADMIN on every area+right, so they pass every gate
// regardless of how a route is mapped. A mapping mistake therefore cannot break an
// admin; it could only mis-gate a custom/CLIENT_USER, which the self-test covers.
//
// Routes NOT listed here are left ungated (tenant scope + any existing inline checks
// still apply) — deliberately, for: self-service /account/*, Feedback (its own
// role logic in feedbackService), Twilio/OpenAI integration writes (a STRICTER
// admin-tier-only check stays — gating them with "manage" would LOOSEN them for
// PORTAL_ADMIN), /saved-filters, /record-types, and the operational
// /automations/jobs* queue endpoints.
// DASHBOARDS: /dashboards POST/PATCH/DELETE (Home Dashboard + Analytics widgets) are
// intentionally LEFT OPEN — by product decision anyone (incl. Client Users) may build
// dashboards/Analytics. The catalog marks dashboard/reports as data (edit/delete exist)
// for an honest table, but no gate rule restricts those mutations. The only guard is the
// inline "Home Dashboard can't be edited by CLIENT_USER" check in dashboardService.
// TEMPLATES are NO LONGER ungated — they are gated to the communication area below.
// Settings READS (GET /settings, /labels, /theme, /fields, ...) stay open too, since
// every role needs them to render; only the WRITES are gated to "manage".
// ===========================================================================

interface PermRule { m: string; re: RegExp; area: string; right: Right }

// First match wins — order specific (delete/sub-paths) before general.
export const PERM_RULES: PermRule[] = [
  // ---- Contacts (data: view / edit / delete) ----
  { m: "POST", re: /^\/contacts\/bulk-delete$/, area: "contacts", right: "delete" },
  { m: "DELETE", re: /^\/contacts\/[^/]+$/, area: "contacts", right: "delete" },
  { m: "POST", re: /^\/contacts(\/(restore|bulk-update|merge|dummy|import))?$/, area: "contacts", right: "edit" },
  { m: "PATCH", re: /^\/contacts\/[^/]+$/, area: "contacts", right: "edit" },
  { m: "POST", re: /^\/contacts\/[^/]+\/(email|text)$/, area: "contacts", right: "edit" },
  { m: "GET", re: /^\/contacts(\/|$)/, area: "contacts", right: "view" },

  // ---- Communication (data: view / edit / delete) — email templates, surveys, sends ----
  // Email templates: previously UNGATED (anyone could CRUD). Now closed to the area.
  { m: "POST", re: /^\/templates$/, area: "communication", right: "edit" },
  { m: "PATCH", re: /^\/templates\/[^/]+$/, area: "communication", right: "edit" },
  { m: "DELETE", re: /^\/templates\/[^/]+$/, area: "communication", right: "delete" },
  { m: "GET", re: /^\/templates(\/|$)/, area: "communication", right: "view" },
  // Surveys: re-pointed from contacts.edit to the communication area (create/edit/send =
  // edit, delete = delete, all reads = view). Send actions count as edit.
  { m: "POST", re: /^\/surveys\/[^/]+\/(recipients|send|send-test)$/, area: "communication", right: "edit" },
  { m: "POST", re: /^\/surveys\/[^/]+\/duplicate$/, area: "communication", right: "edit" },
  { m: "PATCH", re: /^\/surveys\/[^/]+\/status$/, area: "communication", right: "edit" },
  { m: "POST", re: /^\/surveys$/, area: "communication", right: "edit" },
  { m: "DELETE", re: /^\/surveys\/[^/]+$/, area: "communication", right: "delete" },
  { m: "GET", re: /^\/surveys(\/|$)/, area: "communication", right: "view" },
  // Email blast + sent log.
  { m: "POST", re: /^\/communication\/email$/, area: "communication", right: "edit" },
  { m: "GET", re: /^\/communication\/sends$/, area: "communication", right: "view" },


  // ---- Records: Jobs / Bookings / custom share one "records" area (Batch-1 catalog) ----
  { m: "POST", re: /^\/records\/bulk-delete$/, area: "records", right: "delete" },
  { m: "POST", re: /^\/records(\/(restore|bulk-update|dummy|import))?$/, area: "records", right: "edit" },
  { m: "PATCH", re: /^\/records\/[^/]+$/, area: "records", right: "edit" },
  { m: "POST", re: /^\/records\/[^/]+\/(notes|links)$/, area: "records", right: "edit" },
  { m: "PATCH", re: /^\/record-links\/[^/]+$/, area: "records", right: "edit" },
  { m: "DELETE", re: /^\/record-links\/[^/]+$/, area: "records", right: "edit" },
  { m: "GET", re: /^\/records(\/|$)/, area: "records", right: "view" },
  { m: "GET", re: /^\/pipeline$/, area: "records", right: "view" },
  { m: "GET", re: /^\/bookings\/calendar$/, area: "records", right: "view" },
  { m: "GET", re: /^\/availability$/, area: "records", right: "view" },

  // ---- Automations (data) — operational /automations/jobs* left ungated ----
  { m: "DELETE", re: /^\/automations\/[^/]+$/, area: "automations", right: "delete" },
  { m: "POST", re: /^\/automations(\/(presets\/apply|apply-flow|webhook-test))?$/, area: "automations", right: "edit" },
  { m: "PATCH", re: /^\/automations\/[^/]+$/, area: "automations", right: "edit" },
  { m: "POST", re: /^\/automations\/[^/]+\/(test|run)$/, area: "automations", right: "edit" },
  { m: "GET", re: /^\/automations(\/(meta|presets|manual|runs|events))?$/, area: "automations", right: "view" },

  // ---- Read-only areas (today a no-op: every role has view) ----
  { m: "GET", re: /^\/calls(\/|$)/, area: "calls", right: "view" },
  { m: "GET", re: /^\/stats$/, area: "dashboard", right: "view" },
  { m: "GET", re: /^\/dashboards(\/home)?$/, area: "dashboard", right: "view" },

  // ---- Settings sub-areas: WRITES -> manage (reads stay open) ----
  { m: "PATCH", re: /^\/settings$/, area: "settings_general", right: "manage" },
  { m: "PATCH", re: /^\/theme$/, area: "settings_appearance", right: "manage" },
  { m: "PATCH", re: /^\/booking-config$/, area: "settings_scheduling", right: "manage" },
  { m: "POST", re: /^\/resources$/, area: "settings_resources", right: "manage" },
  { m: "PATCH", re: /^\/resources\/[^/]+$/, area: "settings_resources", right: "manage" },
  { m: "DELETE", re: /^\/resources\/[^/]+$/, area: "settings_resources", right: "manage" },
  { m: "PATCH", re: /^\/labels$/, area: "settings_labels", right: "manage" },
  { m: "POST", re: /^\/fields$/, area: "settings_fields", right: "manage" },
  { m: "PATCH", re: /^\/fields\/reorder$/, area: "settings_fields", right: "manage" },
  { m: "PATCH", re: /^\/fields\/[^/]+(\/section)?$/, area: "settings_fields", right: "manage" },
  { m: "DELETE", re: /^\/fields\/[^/]+$/, area: "settings_fields", right: "manage" },
  { m: "POST", re: /^\/field-sections(\/.*)?$/, area: "settings_fields", right: "manage" },
  { m: "PATCH", re: /^\/field-sections(\/.*)?$/, area: "settings_fields", right: "manage" },
  { m: "DELETE", re: /^\/field-sections\/[^/]+$/, area: "settings_fields", right: "manage" },
  { m: "POST", re: /^\/record-(subtypes|stages|statuses)\/.+$/, area: "settings_fields", right: "manage" },
  { m: "POST", re: /^\/exports$/, area: "settings_data", right: "manage" },
  { m: "GET", re: /^\/exports(\/|$)/, area: "settings_data", right: "manage" },
  { m: "GET", re: /^\/reports(\/|$)/, area: "settings_data", right: "manage" },
  { m: "POST", re: /^\/reports\/run$/, area: "settings_data", right: "manage" },
  { m: "POST", re: /^\/reports\/save$/, area: "settings_data", right: "manage" },
  { m: "PATCH", re: /^\/reports\/[^/]+\/active$/, area: "settings_data", right: "manage" },
  { m: "POST", re: /^\/backups$/, area: "settings_data", right: "manage" },

  // ---- User management (Team) ----
  { m: "GET", re: /^\/users$/, area: "users", right: "view" },
  { m: "POST", re: /^\/users$/, area: "users", right: "edit" },
  { m: "DELETE", re: /^\/users\/[^/]+$/, area: "users", right: "delete" },
  { m: "POST", re: /^\/invites\/[^/]+\/revoke$/, area: "users", right: "edit" },
];

/** Map a request to its (area, right), or null if the route is ungated. */
export function ruleFor(method: string, path: string): PermRule | null {
  const m = (method || "").toUpperCase();
  const p = (path || "").replace(/^\/api(?=\/)/, ""); // defensive: router-relative anyway
  return PERM_RULES.find((r) => r.m === m && r.re.test(p)) || null;
}

/** The enforcement middleware. Fails closed: any denial or error -> clean 403. */
export async function permissionGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rule = ruleFor(req.method, req.path);
    if (!rule) { next(); return; }                 // ungated route
    // Resolve the EFFECTIVE acting identity. While impersonating (act-as-type OR
    // view-as-user), enforcement must use the ASSUMED role's rights — never the real
    // admin's — so an impersonating owner/super-admin can't exceed the role they're
    // acting as. attachUser also downgrades req.user; deriving it here too makes this
    // chokepoint authoritative on its own, closing the hole where an un-downgraded
    // admin identity would pass every gate. customRoleId is cleared because
    // impersonation always assumes a system role.
    const imp = (req as any).impersonation;
    const u = (req.user as any) || {};
    const actor = imp && (imp.mode === "act-as-type" || imp.mode === "view-as-user")
      ? { id: u.id, role: imp.assumedRole || u.role, tenantId: imp.scopeTenantId ?? u.tenantId ?? null, customRoleId: null }
      : u;
    if (await can(actor, rule.area, rule.right)) { next(); return; }
    res.status(403).json({ error: "Not authorized" });
  } catch {
    res.status(403).json({ error: "Not authorized" }); // fail closed
  }
}

// ===========================================================================
// Owner page-lock — API coverage for the endpoints permissionGate leaves UNGATED.
//
// The can() short-circuit already 403s every PERM_RULES-gated endpoint of a locked
// area (contacts/records/communication/automations/calls/dashboard...). This second
// middleware closes the holes the audit flagged — endpoints with NO gate rule that
// would otherwise still answer for a locked page: the shared dashboard/analytics
// widgets (/dashboards, /stats), Feedback (its own role logic), and the operational
// automations queue (/automations/jobs*). It maps (method-agnostic) path -> the nav
// href(s) it serves and 403s if ANY is locked for the acting tenant — for EVERYONE,
// independent of role. Global owners/super-admins (no tenant scope) are unaffected.
// ===========================================================================
interface LockRule { re: RegExp; hrefs: string[] }
const LOCK_RULES: LockRule[] = [
  // Dashboard + Analytics share these widget/stat endpoints — lock either page and the
  // shared endpoints close (over-block on purpose: a real lock must never leak).
  { re: /^\/dashboards(\/|$)/, hrefs: ["#/dashboard", "#/reports"] },
  { re: /^\/stats$/, hrefs: ["#/dashboard", "#/reports"] },
  { re: /^\/feedback(\/|$)/, hrefs: ["#/feedback"] },
  { re: /^\/automations\/jobs(\/|$)/, hrefs: ["#/automations"] },
];

export async function lockGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const p = (req.path || "").replace(/^\/api(?=\/)/, "");
    const rule = LOCK_RULES.find((r) => r.re.test(p));
    if (!rule) { next(); return; }
    // Effective tenant scope (impersonation-aware, mirrors permissionGate). No tenant
    // scope (a global owner/super-admin) -> never locked.
    const imp = (req as any).impersonation;
    const u = (req.user as any) || {};
    const tenantId = imp && (imp.mode === "act-as-type" || imp.mode === "view-as-user")
      ? (imp.scopeTenantId ?? u.tenantId ?? null)
      : (u.tenantId ?? null);
    if (!tenantId) { next(); return; }
    const locked = await getLockedPages(tenantId);
    if (rule.hrefs.some((h) => locked.includes(h))) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: "Not authorized" }); // fail closed
  }
}
