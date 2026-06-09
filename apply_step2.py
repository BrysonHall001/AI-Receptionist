#!/usr/bin/env python3
# Step 2 - Theme becomes PER-PORTAL branding.
# Safe + surgical: each change is applied only if the exact original text is
# found; otherwise that file is left untouched and the script reports it. Run
# this from the project root (the folder that contains package.json).
import sys, os

EDITS = [
    # ---- 1) portalService.ts: add per-portal theme read/write + master default
    ("src/services/portalService.ts",
"""export async function updatePortal(
  id: string,
  data: Partial<{ name: string; businessType: string; phoneNumber: string | null; notifyEmail: string; greeting: string; status: "ACTIVE" | "SUSPENDED"; requireEmail: boolean }>,
) {
  return prisma.tenant.update({ where: { id }, data: data as any });
}""",
"""export async function updatePortal(
  id: string,
  data: Partial<{ name: string; businessType: string; phoneNumber: string | null; notifyEmail: string; greeting: string; status: "ACTIVE" | "SUSPENDED"; requireEmail: boolean }>,
) {
  return prisma.tenant.update({ where: { id }, data: data as any });
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
}"""),

    # ---- 2a) api.ts: repoint imports
    ("src/routes/api.ts",
"""import { updatePortal, getPortal, setTenantLabels } from "../services/portalService";
import { PRESETS, FONTS } from "../theme/themes";
import { createUser, listUsers, deleteUser, setPassword, publicUser, getUserTheme, setUserTheme, getContactColumns, setContactColumns } from "../services/userService";""",
"""import { updatePortal, getPortal, setTenantLabels, getPortalTheme, setPortalTheme, MASTER_DEFAULT_THEME } from "../services/portalService";
import { PRESETS, FONTS } from "../theme/themes";
import { createUser, listUsers, deleteUser, setPassword, publicUser, getContactColumns, setContactColumns } from "../services/userService";"""),

    # ---- 2b) api.ts: rewrite the two /api/theme handlers
    ("src/routes/api.ts",
"""// ---- Per-user theme (Appearance). Personal to each account, independent of
// portal context. Every authenticated user controls their own theme. ----
apiRouter.get("/theme", async (req: Request, res: Response) => {
  res.json({ theme: await getUserTheme(req.user!.id), presets: PRESETS, fonts: FONTS });
});

apiRouter.patch("/theme", async (req: Request, res: Response) => {
  // sanitizeUserTheme rejects anything that isn't a known preset, a strict-hex
  // + allow-listed-font custom, or a clean (length-capped, escaped) name.
  const theme = await setUserTheme(req.user!.id, (req.body ?? {}).theme ?? req.body);
  res.json({ theme });
});""",
"""// ---- Per-portal theme (Appearance). Branding belongs to the PORTAL: everyone
// who enters a portal sees its theme. Resolved by the tenant (via
// resolveTenantScope), never by user id. The master hub (no portal in context)
// returns a fixed default and cannot be themed. Only PORTAL_ADMIN/SUPER_ADMIN
// may save; CLIENT_USER can read but not change (enforced here, not just in UI). ----
apiRouter.get("/theme", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  // No portal in context (e.g. super-admin on the master hub): the fixed
  // default look, with presets/fonts so the picker still renders. Never a 400.
  if (!tenantId) {
    res.json({ theme: MASTER_DEFAULT_THEME, presets: PRESETS, fonts: FONTS });
    return;
  }
  res.json({ theme: await getPortalTheme(tenantId), presets: PRESETS, fonts: FONTS });
});

apiRouter.patch("/theme", async (req: Request, res: Response) => {
  const tenantId = resolveTenantScope(req);
  if (!tenantId) {
    res.status(400).json({ error: "No portal selected" });
    return;
  }
  // Branding is an admin setting - same bar as the rest of portal Settings.
  if (req.user!.role === "CLIENT_USER") {
    res.status(403).json({ error: "Not authorized to change the portal theme" });
    return;
  }
  // sanitizeUserTheme (inside setPortalTheme) rejects anything that isn't a known
  // preset, a strict-hex + allow-listed-font custom, or a clean (length-capped,
  // escaped) name.
  const theme = await setPortalTheme(tenantId, (req.body ?? {}).theme ?? req.body);
  res.json({ theme });
});"""),

    # ---- 3) userService.ts: remove the dead per-user theme path
    ("src/services/userService.ts",
"""
// ---- Per-user theme preferences (stored on User.themePrefs JSON) ----
import {
  sanitizeUserTheme,
  sanitizeLegacyTheme,
  legacyToUserTheme,
  UserTheme,
  DEFAULT_USER_THEME,
} from "../theme/themes";

function isEmptyPrefs(p: any): boolean {
  return !p || typeof p !== "object" || (!p.active && !(Array.isArray(p.customs) && p.customs.length));
}

export async function getUserTheme(userId: string): Promise<UserTheme> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ...DEFAULT_USER_THEME };
  const prefs = (user as any).themePrefs;
  if (!isEmptyPrefs(prefs)) return sanitizeUserTheme(prefs);

  // No personal theme yet: fall back to the portal's old per-portal theme so
  // the existing look isn't lost. Not persisted until the user saves.
  if (user.tenantId) {
    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (tenant && (tenant as any).theme) {
      return legacyToUserTheme(sanitizeLegacyTheme((tenant as any).theme));
    }
  }
  return { ...DEFAULT_USER_THEME };
}

export async function setUserTheme(userId: string, input: unknown): Promise<UserTheme> {
  const clean = sanitizeUserTheme(input);
  await prisma.user.update({ where: { id: userId }, data: { themePrefs: clean as any } });
  return clean;
}

// ---- Per-user Contacts column layout (stored on User.contactColumns JSON) ----""",
"""
// NOTE: Theme is now PER-PORTAL branding, not a per-user preference. The old
// getUserTheme/setUserTheme path was removed; theme lives on Tenant.theme and is
// handled by getPortalTheme/setPortalTheme in portalService.ts. The User.themePrefs
// column is left in place (dormant) and is no longer read or written.

// ---- Per-user Contacts column layout (stored on User.contactColumns JSON) ----"""),

    # ---- 4a) theme.js: header comment
    ("public/js/theme.js",
"""// Per-USER theming on the client (personal preference, portal-independent).
//""",
"""// Per-PORTAL theming on the client (branding shared by everyone in the portal).
// The Appearance pane loads/saves the PORTAL's theme via /api/theme; the server
// resolves it by tenant. Only PORTAL_ADMIN/SUPER_ADMIN see the editing controls
// (CLIENT_USER gets a read-only notice), and the server enforces the same rule.
//"""),

    # ---- 4b) theme.js: CLIENT_USER read-only gate in mountSettings
    ("public/js/theme.js",
"""    const presets = data.presets || [];
    const fonts = data.fonts || [];
    // prefs is the live, editable per-user theme state.""",
"""    const presets = data.presets || [];
    const fonts = data.fonts || [];

    // Branding is a portal-admin setting. A CLIENT_USER sees the portal's theme
    // applied to their UI but cannot change it - show a read-only notice and stop
    // before building any editing controls. (The server also rejects their saves.)
    const role = App.state.me && App.state.me.role;
    if (role === "CLIENT_USER") {
      host.innerHTML =
        `<div class="cell-muted" style="padding:8px 0">` +
        `The appearance of this portal is set by an administrator, so the theme isn't editable from your account.` +
        `</div>`;
      return;
    }

    // prefs is the live, editable PORTAL theme state."""),
]

def main():
    if not os.path.exists("package.json"):
        print("X  No package.json here. cd into the project folder and run again.")
        sys.exit(1)
    # Group edits by file, preserving order.
    by_file = {}
    for path, old, new in EDITS:
        by_file.setdefault(path, []).append((old, new))

    failures = []
    touched = []
    for path, edits in by_file.items():
        if not os.path.exists(path):
            failures.append(f"{path} (file not found)")
            continue
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        original = text
        ok = True
        all_applied = True
        for old, new in edits:
            if new in text:
                continue  # this edit already applied
            all_applied = False
            if text.count(old) != 1:
                failures.append(f"{path} (a section didn't match exactly once; found {text.count(old)})")
                ok = False
                break
            text = text.replace(old, new, 1)
        if not ok:
            continue  # leave this file untouched
        if all_applied:
            print(f"=  {path}: already applied, skipping.")
            continue
        if text != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            touched.append(path)
            print(f"OK {path}: change applied.")

    if failures:
        print("\nX  Some changes did NOT apply (those files were left untouched):")
        for x in failures:
            print("   - " + x)
        print("Tell Claude exactly what this printed; do not proceed.")
        sys.exit(1)
    if touched:
        print("\nStep 2 changes applied to:")
        for p in touched:
            print("   - " + p)
    else:
        print("\nNothing to do - everything was already applied.")

if __name__ == "__main__":
    main()
