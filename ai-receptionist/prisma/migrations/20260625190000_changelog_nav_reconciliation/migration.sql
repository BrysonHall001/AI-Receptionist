-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_nav_reconciliation',
  '2026-06-25T00:00:00.000Z',
  'Backend',
  'The sidebar menu now derives from real permissions instead of being its own separate visibility system. A page appears in someone''s menu only when their role can actually view that area AND the page isn''t hidden in the portal''s menu settings. This removes the old contradiction of two switches for "can I see this page": permissions are the single source of truth for access, while hide/rename stay purely cosmetic (tidy or relabel the menu, never grant or deny access). Existing roles'' menus look exactly the same as before; renaming pages still works everywhere; a hidden page simply leaves the menu but still opens by direct link for anyone allowed to view it. Custom roles will automatically get a correct menu once they can be created.',
  'nav-reconciliation-batch3',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
