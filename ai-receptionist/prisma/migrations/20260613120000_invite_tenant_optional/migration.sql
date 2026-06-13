-- Allow invites with no portal (for SUPER_ADMIN / AUDITOR invites, which are not
-- tied to any portal). This only relaxes a constraint; it changes no existing data.
-- Portal invites are unaffected (they still carry their tenantId). The foreign key
-- stays in place and simply isn't checked when tenantId is NULL.
ALTER TABLE "Invite" ALTER COLUMN "tenantId" DROP NOT NULL;
