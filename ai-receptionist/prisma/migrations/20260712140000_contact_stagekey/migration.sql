-- Contact.stageKey (contacts-all-views): the contact's own pipeline stage on the contact record
-- type — the contact twin of Record.stageKey, giving the new Contacts Board a lane to put a card
-- in. INDEPENDENT of RecordLink."stageKey" (the funnel/relationship stages): nothing here touches
-- RecordLink or the funnel read models. Additive + nullable; no backfill — existing contacts
-- simply have no stage until someone sets one.
ALTER TABLE "Contact" ADD COLUMN "stageKey" TEXT;
