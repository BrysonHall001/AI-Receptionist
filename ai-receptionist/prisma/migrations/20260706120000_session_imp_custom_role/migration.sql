-- Custom-role impersonation: carry a PortalRole id on the session overlay so an
-- admin "acting as" / "viewing as" a CUSTOM role resolves to EXACTLY that role's
-- permissions. Additive, nullable — safe on existing rows and pre-consumption.
ALTER TABLE "Session" ADD COLUMN "impCustomRoleId" TEXT;
