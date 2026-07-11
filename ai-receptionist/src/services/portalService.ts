import { prisma } from "../db/client";
import { DEFAULT_VOICE_ID } from "../config/voices";
import { DEFAULT_TIMEZONE } from "../config/timezones";
import { recordTypeHref, togglableRecordTypeKeys } from "./recordTypeService";

// ---- Owner page-lock -------------------------------------------------------
// The canonical set of lockable left-nav hrefs. Any lockedPages input is filtered
// to this set so only real nav pages can ever be stored.
export const LOCKABLE_HREFS = [
  "#/dashboard", "#/calls", "#/contacts", "#/jobs", "#/bookings",
  "#/reports", "#/automations", "#/communication", "#/learn", "#/feedback",
  "#/billing",
];
export function sanitizeLockedPages(input: any): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const h of input) if (typeof h === "string" && LOCKABLE_HREFS.includes(h)) set.add(h);
  return Array.from(set);
}

// Small TTL cache so can()/lockGate (which run per gated request) don't hit the DB
// every time. Busted explicitly whenever a tenant's lockedPages is written.
const _lockCache = new Map<string, { at: number; pages: string[] }>();
const LOCK_TTL_MS = 5000;
export function bustLockedPagesCache(tenantId: string) { _lockCache.delete(tenantId); }
export async function getLockedPages(tenantId: string): Promise<string[]> {
  if (!tenantId) return [];
  const hit = _lockCache.get(tenantId);
  if (hit && Date.now() - hit.at < LOCK_TTL_MS) return hit.pages;
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { lockedPages: true } as any }).catch(() => null);
  const pages = sanitizeLockedPages((t as any)?.lockedPages);
  _lockCache.set(tenantId, { at: Date.now(), pages });
  return pages;
}

export async function listPortals() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { callSessions: true, contacts: true, users: true } } },
  });
  return tenants.map((t: any) => ({
    id: t.id,
    name: t.name,
    businessType: t.businessType,
    phoneNumber: t.phoneNumber,
    notifyEmail: t.notifyEmail,
    greeting: t.greeting,
    status: t.status,
    billingStatus: (t as any).billingStatus ?? null,
    requireEmail: (t as any).requireEmail !== false,
    receptionistEnabled: (t as any).receptionistEnabled === true,
    voiceMode: ((t as any).voiceMode as string) || ((t as any).receptionistEnabled === true ? "WALKIE" : "OFF"),
    calls: t._count?.callSessions ?? 0,
    contacts: t._count?.contacts ?? 0,
    users: t._count?.users ?? 0,
    lockedPages: sanitizeLockedPages((t as any).lockedPages),
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function getPortal(id: string) {
  const t = await prisma.tenant.findUnique({ where: { id } });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    businessType: t.businessType,
    phoneNumber: t.phoneNumber,
    notifyEmail: t.notifyEmail,
    greeting: t.greeting,
    labels: (t as any).labels ?? {},
    lockedPages: sanitizeLockedPages((t as any).lockedPages),
    status: t.status,
    billingStatus: (t as any).billingStatus ?? null,
    requireEmail: (t as any).requireEmail !== false,
    receptionistEnabled: (t as any).receptionistEnabled === true,
    voiceMode: ((t as any).voiceMode as string) || ((t as any).receptionistEnabled === true ? "WALKIE" : "OFF"),
    voiceId: ((t as any).voiceId as string) || DEFAULT_VOICE_ID,
    timezone: ((t as any).timezone as string) || DEFAULT_TIMEZONE,
    aiInstructions: (t as any).aiInstructions ?? "",
    aiKnowledgeModules: Array.isArray((t as any).aiKnowledgeModules) ? (t as any).aiKnowledgeModules : [],
    createdAt: t.createdAt.toISOString(),
  };
}

// Merge generic-word overrides (e.g. "record","stage") into Tenant.labels.
// Portal-scoped (only this tenant's row). Both forms required per word. Stable
// keys aren't involved — this is display words only.
export async function setTenantLabels(
  tenantId: string,
  generic: Record<string, { one?: string; many?: string }>
) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new Error("Portal not found");
  const current = (t as any).labels && typeof (t as any).labels === "object" ? { ...(t as any).labels } : {};
  for (const [k, v] of Object.entries(generic || {})) {
    const one = String((v && v.one) || "").trim();
    const many = String((v && v.many) || "").trim();
    if (!one || !many) throw new Error(`Both singular and plural are required for "${k}"`);
    current[k] = { one, many };
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { labels: current } as any });
  return current;
}

// Per-portal left-nav config, stored as a reserved `nav` key INSIDE Tenant.labels
// (so there's no schema change / no migration). Shape:
//   { order: string[], hidden: string[], labels: { [href]: string } }
// - order:  preferred nav item order, by href ("#/calls", ...). Unknown/new hrefs
//           simply fall back to their default position on the client.
// - hidden: hrefs the portal has hidden. Home Dashboard (#/dashboard) can NEVER be
//           hidden, so it's stripped here defensively even if a client sends it.
// - labels: per-href display overrides for the fixed nav items (Calls/Reports/etc.).
//           A blank value means "use the built-in default", so we just don't store it.
// This is the single source of truth the later per-row nav menu will read/write too.
export const NAV_HOME_HREF = "#/dashboard";
export async function setTenantNav(
  tenantId: string,
  nav: { order?: string[]; hidden?: string[]; labels?: Record<string, string> }
) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new Error("Portal not found");
  const current = (t as any).labels && typeof (t as any).labels === "object" ? { ...(t as any).labels } : {};
  const order = Array.isArray(nav.order) ? nav.order.filter((h) => typeof h === "string") : [];
  const hidden = (Array.isArray(nav.hidden) ? nav.hidden.filter((h) => typeof h === "string") : [])
    .filter((h) => h !== NAV_HOME_HREF);
  const labels: Record<string, string> = {};
  if (nav.labels && typeof nav.labels === "object") {
    for (const [href, val] of Object.entries(nav.labels)) {
      const s = String(val == null ? "" : val).trim();
      if (s) labels[href] = s;
    }
  }
  current.nav = { order, hidden, labels };
  await prisma.tenant.update({ where: { id: tenantId }, data: { labels: current } as any });
  return current.nav;
}

// Allowed billing statuses. REQUIRED at creation (no default) — see Tenant.billingStatus.
export const BILLING_STATUSES = ["free", "trial", "paid", "exception"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export function isBillingStatus(v: unknown): v is BillingStatus {
  return typeof v === "string" && (BILLING_STATUSES as readonly string[]).includes(v);
}

export async function createPortal(input: {
  name: string;
  notifyEmail?: string;
  lockedPages?: string[];
  billingStatus: BillingStatus;
  // Record-type sections to START HIDDEN in this portal's nav (by record-type KEY,
  // e.g. ["equipment"]). VISIBILITY ONLY — the types are still seeded on first use,
  // so the choice is fully reversible (un-hide later under Settings → Labels). Only
  // togglable (non-contact) keys are honored; anything else is ignored. Omitted =
  // nothing hidden = all sections visible (today's behavior).
  hiddenRecordTypes?: string[];
}) {
  // Create writes only name + (optional) notifyEmail now. greeting, businessType and
  // requireEmail fall back to their column defaults (they're no longer collected at
  // creation — greeting/businessType are dead, the identity rule is hard-set on).
  // lockedPages (owner page-lock) can be set atomically at creation.
  // billingStatus is REQUIRED (no column default) — the caller must supply a valid value.
  if (!isBillingStatus(input.billingStatus)) {
    throw new Error("billingStatus must be one of: " + BILLING_STATUSES.join(", "));
  }
  // Translate the unchosen record-type KEYS into hidden nav HREFS, using the exact
  // hide mechanism Settings → Labels uses (Tenant.labels.nav.hidden). Validated
  // against the togglable registry keys so core pages (Contacts/Home/etc.) can never
  // be hidden here. Contacts is core and always stays visible.
  const togglable = new Set(togglableRecordTypeKeys());
  const hideKeys = Array.isArray(input.hiddenRecordTypes)
    ? Array.from(new Set(input.hiddenRecordTypes.filter((k) => typeof k === "string" && togglable.has(k))))
    : [];
  const hiddenHrefs = hideKeys.map(recordTypeHref).filter((h) => h !== NAV_HOME_HREF);
  const labels = hiddenHrefs.length ? { nav: { order: [], hidden: hiddenHrefs, labels: {} } } : undefined;
  return prisma.tenant.create({
    data: {
      name: input.name,
      notifyEmail: input.notifyEmail || "",
      lockedPages: sanitizeLockedPages(input.lockedPages),
      billingStatus: input.billingStatus,
      ...(labels ? { labels } : {}),
    } as any,
  });
}

export async function updatePortal(
  id: string,
  data: Partial<{ name: string; businessType: string; phoneNumber: string | null; notifyEmail: string; greeting: string; status: "ACTIVE" | "SUSPENDED"; requireEmail: boolean; receptionistEnabled: boolean; voiceMode: string; voiceId: string; timezone: string; aiInstructions: string; aiKnowledgeModules: string[]; lockedPages: string[]; billingStatus: string }>,
) {
  const clean: any = { ...data };
  if (clean.lockedPages !== undefined) clean.lockedPages = sanitizeLockedPages(clean.lockedPages);
  const out = await prisma.tenant.update({ where: { id }, data: clean as any });
  if (clean.lockedPages !== undefined) bustLockedPagesCache(id); // lock changed -> drop cache
  return out;
}

// ---- Per-portal theme (branding) -------------------------------------------
// One theme per portal: everyone who enters the portal sees it. Stored on the
// existing Tenant.theme JSON column in the modern {active, customs} shape and
// validated by the shared sanitizer (so only known-good presets/hex/fonts can
// ever be saved). The master hub (no portal in context) uses a fixed default
// and has no editable theme. Replaces the old per-user theme path.
import { sanitizeUserTheme, UserTheme, DEFAULT_USER_THEME } from "../theme/themes";

// What the master hub (no portal selected) renders.
export const MASTER_DEFAULT_THEME: UserTheme = { ...DEFAULT_USER_THEME };

export async function getPortalTheme(tenantId: string): Promise<UserTheme> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) return { ...MASTER_DEFAULT_THEME };
  const raw = (t as any).theme;
  // Only honor a real saved theme (modern shape); anything else -> default look.
  if (!raw || typeof raw !== "object" || !(raw as any).active) {
    return { ...MASTER_DEFAULT_THEME };
  }
  return sanitizeUserTheme(raw);
}

export async function setPortalTheme(tenantId: string, input: unknown): Promise<UserTheme> {
  const clean = sanitizeUserTheme(input);
  await prisma.tenant.update({ where: { id: tenantId }, data: { theme: clean as any } });
  return clean;
}
