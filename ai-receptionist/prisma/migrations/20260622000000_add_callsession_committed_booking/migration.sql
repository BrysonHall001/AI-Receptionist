-- Backend-owned booking commitment on CallSession. Captured the instant the AI
-- calls the confirm_booking tool, so the booked resource + time come from a
-- deterministic backend decision instead of being reconstructed from the AI's
-- extracted blob at finalize. committedAppointmentAt holds the SAME zoneless
-- wall-clock string the app uses ("YYYY-MM-DDTHH:MM"), stored verbatim — no
-- timezone conversion. Purely additive + reversible (both nullable, no default).
ALTER TABLE "CallSession" ADD COLUMN "committedResourceId" TEXT;
ALTER TABLE "CallSession" ADD COLUMN "committedAppointmentAt" TEXT;
