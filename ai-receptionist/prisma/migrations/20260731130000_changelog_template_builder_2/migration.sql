-- Changelog: template builder part 2 — the shared row and deletion
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_template_builder_2_20260731',
  '2026-07-31',
  'Improvement',
  'The Create a Template screen now shows the same row of template buttons that sits at the top of Create tenant, so you can see everything that already exists while you build something new. It is the same row, drawn by the same code, so the two screens can never drift apart. Clicking one you built opens it for editing; clicking a built-in one tells you it cannot be edited here. In both places the row now slides sideways once there are more templates than fit across the screen, instead of wrapping onto a second line or squashing the buttons. The coloured band behind the row shifts slightly as you scroll, so it reads as something you can move rather than something that got cut off, and a soft fade appears at whichever end still has more to see. If you have asked your computer for reduced motion, the band stays still. Each template you built now carries a small x. Clicking it asks you to confirm and to type your password, and the password is checked on the server, not just on the screen. Too many wrong attempts are throttled, and a wrong one is recorded in the audit log the same way a failed sign-in is. HERE IS WHAT DELETING ACTUALLY DOES, because the word is misleading. It means the template is no longer offered when you create a tenant. It does not erase anything. Any tenant you already made from that template carries on exactly as it is, keeps everything it was set up with, and can still tell you which template it came from. The name is also kept aside permanently so it can never be reused for a different template later, because that would quietly rewrite the history of the tenants made from the original. The four built-in templates have no x at all, and cannot be deleted by any means. They live in the product code rather than in your data, and the server refuses to remove one no matter what it is asked.',
  'batch-template-builder-2-20260731',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
