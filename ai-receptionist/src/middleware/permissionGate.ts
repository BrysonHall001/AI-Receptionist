import { Request, Response, NextFunction } from "express";
import { can, moduleAreaKey, Right } from "../services/permissionService";
import { getLockedPages } from "../services/portalService";
import { prisma } from "../db/client";

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

/**
 * PER-MODULE RESOLUTION.
 *
 * No record route carries its module in the path - /records/:id is a RECORD id, not a type -
 * so a rule that needs the module says so with `modules`, and ONLY those rules pay for a
 * lookup. The other ~200 rules are untouched and cost nothing.
 *
 * A resolver returns the record-type KEYS the request touches, or null when it cannot tell.
 * NULL MEANS REFUSE. A request we cannot attribute to a module is never let through.
 */
type ModuleResolver = (req: Request) => Promise<string[] | null>;
interface PermRule { m: string; re: RegExp; area: string; right: Right; modules?: ModuleResolver }

const db = prisma as any;
/** The type keys for a set of record ids, scoped to the caller's tenant. */
async function keysForRecordIds(req: Request, ids: string[]): Promise<string[] | null> {
  const clean = Array.from(new Set((ids || []).filter((x) => typeof x === "string" && x)));
  if (!clean.length) return [];                       // nothing touched -> nothing to check
  const tenantId = (req.user as any)?.tenantId ?? null;
  const rows = await db.record.findMany({
    where: { id: { in: clean }, ...(tenantId ? { tenantId } : {}) },
    select: { id: true, recordType: { select: { key: true } } },
  }).catch(() => null);
  if (!rows) return null;
  // A missing or cross-tenant id is unresolvable -> refuse, never silently narrow the set.
  if (rows.length !== clean.length) return null;
  return Array.from(new Set(rows.map((r: any) => r.recordType?.key).filter(Boolean)));
}
/** The record id sitting in a path segment, e.g. /records/<id>/visits. */
const idAt = (path: string, i: number) => (path.split("/").filter(Boolean)[i] || "");
const byPathRecord = (i: number): ModuleResolver => (req) => keysForRecordIds(req, [idAt(req.path, i)]);
/** POST /records carries its type in the BODY - no query needed at all. */
const byBodyType: ModuleResolver = async (req) => {
  const b: any = req.body || {};
  const key = b.type || b.recordTypeKey || b.kind;
  if (typeof key === "string" && key) return [key];
  if (typeof b.recordTypeId === "string" && b.recordTypeId) {
    const rt = await db.recordType.findUnique({ where: { id: b.recordTypeId }, select: { key: true } }).catch(() => null);
    return rt?.key ? [rt.key] : null;      // a named-but-unknown type is unresolvable -> refuse
  }
  return [];                               // names nothing -> base check, i.e. today's behaviour
};
/** GET /records?type=<key> names its module in the query; with none, it is a list of
 *  everything and the HANDLER filters, so the gate lets it through. */
const byQueryType: ModuleResolver = async (req) => {
  const t = (req.query || {}).type;
  return typeof t === "string" && t ? [t] : [];
};
/** A visit belongs to a record; the record's type is the module. */
const byVisitId: ModuleResolver = async (req) => {
  const parts = req.path.split("/").filter(Boolean);      // records/visits/<id>[/complete]
  const v = await db.workOrderVisit.findUnique({ where: { id: parts[2] || "" }, select: { recordId: true } }).catch(() => null);
  return v ? keysForRecordIds(req, [v.recordId]) : null;
};
/** Every module this tenant has. Used where an endpoint genuinely spans all of them. */
const allModules: ModuleResolver = async (req) => {
  const tenantId = (req.user as any)?.tenantId;
  if (!tenantId) return [];
  const rows = await db.recordType.findMany({ where: { tenantId }, select: { key: true } }).catch(() => null);
  return rows ? rows.map((r: any) => r.key).filter((k: string) => k && k !== "contact") : null;
};
/** Bulk operations: one query over the id list, then EVERY type involved must be permitted. */
const byBodyIds: ModuleResolver = (req) => keysForRecordIds(req, ((req.body || {}) as any).ids || []);
/** A link joins two records that may be of different types - both ends must be permitted. */
const byRecordLink: ModuleResolver = async (req) => {
  const linkId = idAt(req.path, 1);
  const link = await db.recordLink.findUnique({ where: { id: linkId }, select: { recordId: true, parentType: true, parentId: true } }).catch(() => null);
  if (!link) return null;
  const own = await keysForRecordIds(req, [link.recordId]);
  if (own === null) return null;
  // parentType "contact" is the contacts AREA, not a records: module, and is gated separately.
  if (link.parentType && link.parentType !== "contact") {
    const other = await keysForRecordIds(req, [link.parentId]);
    if (other === null) return null;
    return Array.from(new Set([...own, ...other]));
  }
  return own;
};

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
  // Drips (visual builder) — same area/rights as Templates/Surveys/Audiences.
  { m: "POST", re: /^\/drips\/[^/]+\/(activate|deactivate)$/, area: "communication", right: "edit" },
  { m: "POST", re: /^\/drips\/[^/]+\/validate$/, area: "communication", right: "view" },
  { m: "POST", re: /^\/drips$/, area: "communication", right: "edit" },
  { m: "PATCH", re: /^\/drips\/[^/]+$/, area: "communication", right: "edit" },
  { m: "DELETE", re: /^\/drips\/[^/]+$/, area: "communication", right: "delete" },
  { m: "GET", re: /^\/drips(\/|$)/, area: "communication", right: "view" },
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
  // Audiences (named contact filters) — same area/rights as Templates/Surveys.
  { m: "POST", re: /^\/audiences$/, area: "communication", right: "edit" },
  { m: "PATCH", re: /^\/audiences\/[^/]+$/, area: "communication", right: "edit" },
  { m: "DELETE", re: /^\/audiences\/[^/]+$/, area: "communication", right: "delete" },
  { m: "GET", re: /^\/audiences(\/|$)/, area: "communication", right: "view" },


  // ---- Records: Jobs / Bookings / custom share one "records" area (Batch-1 catalog) ----
  { m: "POST", re: /^\/records\/bulk-delete$/, area: "records", right: "delete", modules: byBodyIds },
  { m: "POST", re: /^\/records\/bulk-update$/, area: "records", right: "edit", modules: byBodyIds },
  { m: "POST", re: /^\/records$/, area: "records", right: "edit", modules: byBodyType },
  { m: "POST", re: /^\/records\/restore$/, area: "records", right: "edit", modules: byBodyIds },
  { m: "POST", re: /^\/records\/import$/, area: "records", right: "edit", modules: byBodyType },
  // Seeding demo data is not a per-module action; it stays on the base records grant.
  { m: "POST", re: /^\/records\/dummy$/, area: "records", right: "edit" },
  { m: "PATCH", re: /^\/records\/[^/]+$/, area: "records", right: "edit", modules: byPathRecord(1) },
  { m: "POST", re: /^\/records\/[^/]+\/(notes|links)$/, area: "records", right: "edit", modules: byPathRecord(1) },
  // On my way (Customer Comms batch): texting the customer about a record is an
  // edit-level act on that record — view-only roles get a clean 403.
  { m: "POST", re: /^\/records\/[^/]+\/notify-on-my-way$/, area: "records", right: "edit", modules: byPathRecord(1) },
  // Multi-visit work orders (multivisit-cardfix batch)
  { m: "GET", re: /^\/records\/[^/]+\/visits$/, area: "records", right: "view", modules: byPathRecord(1) },
  { m: "POST", re: /^\/records\/[^/]+\/visits$/, area: "records", right: "edit", modules: byPathRecord(1) },
  { m: "PATCH", re: /^\/records\/visits\/[^/]+$/, area: "records", right: "edit", modules: byVisitId },
  { m: "POST", re: /^\/records\/visits\/[^/]+\/(complete|cancel)$/, area: "records", right: "edit", modules: byVisitId },
  // Estimates Lifecycle batch:
  { m: "POST", re: /^\/records\/[^/]+\/estimate-link$/, area: "records", right: "edit", modules: byPathRecord(1) },
  { m: "GET", re: /^\/records\/[^/]+\/estimate-status$/, area: "records", right: "view", modules: byPathRecord(1) },
  { m: "POST", re: /^\/records\/[^/]+\/convert-estimate$/, area: "records", right: "edit", modules: byPathRecord(1) },
  { m: "PATCH", re: /^\/record-links\/[^/]+$/, area: "records", right: "edit", modules: byRecordLink },
  { m: "DELETE", re: /^\/record-links\/[^/]+$/, area: "records", right: "edit", modules: byRecordLink },
  // The general record reads. /records/<id> resolves by that record; /records?type=<key>
  // resolves by the requested type. /records with NO type would span every module at once -
  // it is a LIST, so rather than refuse it we let it through here and the handler returns
  // only the modules the caller may view (permittedRecordTypes in routes/api.ts).
  { m: "GET", re: /^\/records\/[^/]+$/, area: "records", right: "view", modules: byPathRecord(1) },
  { m: "GET", re: /^\/records$/, area: "records", right: "view", modules: byQueryType },
  { m: "GET", re: /^\/records\/[^/]+\/.*$/, area: "records", right: "view", modules: byPathRecord(1) },
  // The pipeline is a LINK GRAPH across modules rather than a list of one, so it takes the
  // strictest-applicable rule: view on every module. Never more permissive than today.
  { m: "GET", re: /^\/pipeline$/, area: "records", right: "view", modules: allModules },
  // The booking calendar is gated on the BOOKING module; the work-order shading inside it is
  // filtered by the handler, so Work Orders means "see the shading", not "lose the calendar".
  { m: "GET", re: /^\/bookings\/calendar$/, area: "records", right: "view", modules: async () => ["booking"] },
  // /availability returns FREE TIME, not records: work-order busy time contributes to what is
  // not free, but anonymously - you cannot tell a work order from a booking from a lunch break.
  // Nothing per-module is exposed, so it is gated on the booking module rather than filtered.
  { m: "GET", re: /^\/availability$/, area: "records", right: "view", modules: async () => ["booking"] },

  // ---- Automations (data) — operational /automations/jobs* left ungated ----
  { m: "DELETE", re: /^\/automations\/[^/]+$/, area: "automations", right: "delete" },
  { m: "POST", re: /^\/automations(\/(presets\/apply|apply-flow|webhook-test))?$/, area: "automations", right: "edit" },
  { m: "PATCH", re: /^\/automations\/[^/]+$/, area: "automations", right: "edit" },
  { m: "POST", re: /^\/automations\/[^/]+\/(test|run|enroll)$/, area: "automations", right: "edit" },
  { m: "GET", re: /^\/automations(\/(meta|presets|manual|runs|events))?$/, area: "automations", right: "view" },

  // ---- Read-only areas (today a no-op: every role has view) ----
  { m: "GET", re: /^\/calls(\/|$)/, area: "calls", right: "view" },
  { m: "GET", re: /^\/stats$/, area: "dashboard", right: "view" },
  { m: "GET", re: /^\/dashboards(\/home)?$/, area: "dashboard", right: "view" },

  // ---- Client Billing (gated_view): Portal Admins yes, Client Users no unless granted ----
  { m: "GET", re: /^\/portal-billing(\/|$)/, area: "billing", right: "view" },

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
    // PER-MODULE ENFORCEMENT. A rule that names a module resolver is checked against EVERY
    // module the request touches - strictest applicable, never most permissive. A bulk delete
    // spanning two modules needs delete on both; a link joining two needs edit on both. That
    // is deliberate for ACTIONS: partial success would silently delete some of what was
    // selected, which is a bug rather than a permission.
    if (rule.modules) {
      const keys = await rule.modules(req).catch(() => null);
      // TWO DIFFERENT ANSWERS, and conflating them would be a hole.
      //   null -> we tried to resolve and COULD NOT (unknown id, wrong tenant, lookup
      //           failed). Refuse. A request we cannot attribute is never waved through.
      //   []   -> the request NAMES no module at all (an untyped list, an empty bulk).
      //           Fall through to the base `records` check, which is exactly today's
      //           behaviour - so this can never be more permissive than before. Where such
      //           an endpoint returns a list, the handler additionally filters it.
      if (keys === null) { res.status(403).json({ error: "Not authorized" }); return; }
      if (keys.length) {
        for (const key of keys) {
          if (!(await can(actor, moduleAreaKey(key), rule.right))) { res.status(403).json({ error: "Not authorized" }); return; }
        }
        next();
        return;
      }
    }
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
  { re: /^\/portal-billing(\/|$)/, hrefs: ["#/billing"] },
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
