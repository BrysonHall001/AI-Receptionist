-- Going-forward Change Log entry: portal layout polish + role-consistency fix. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_portal_layout_polish_20260708',
  '2026-07-11',
  'UI',
  'Polished the tenant portal layout and fixed a role-display inconsistency. Layout: the Sign out and Impersonate buttons in the bottom-left user box are now centre-aligned; the separate context row ("All tenants / Viewing / page name") was removed. For owners/super-admins/auditors, "← All tenants" now sits at the top of the left column beside the logo with the portal name directly beneath it (no "Viewing:" prefix); the current page is shown by the highlighted menu item, so the standalone page title is gone. The Settings gear moved to the upper-right of the top pages row. Rename, reorder and Hide are available again on both the top-row pages and the left-column modules, and hidden items stay hidden until restored from Settings. The top pages row and the left modules column now flex to the screen and scroll (horizontally / vertically) when their items overflow instead of clipping. The "A Vaala product" tagline moved to sit just above the user name in the bottom-left block, and the Impersonate menu now opens upward from the bottom-left button and is clamped to stay fully on-screen. Role fix: the portal view and the admin Users list now always show the same role for an account — the app re-reads the live role so a make-owner promotion no longer shows as "Owner" in Users but a stale "Super Admin" in the portal. No change to permissions or data.',
  'batch-portal-layout-polish-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
