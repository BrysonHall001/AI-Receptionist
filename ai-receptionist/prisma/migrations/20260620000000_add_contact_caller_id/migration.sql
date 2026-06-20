-- Add the verified inbound caller ID as its own nullable column on Contact.
-- Separate from the editable `phone`; intentionally NOT unique (a caller-ID line
-- can be shared by multiple contacts — family/office). Purely additive + reversible.
ALTER TABLE "Contact" ADD COLUMN "callerId" TEXT;
