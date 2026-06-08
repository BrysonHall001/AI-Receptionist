BUG FIX: Candidate-link search on the Job detail page
======================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

NO database migration. NO schema change. NO new endpoint. One file changed:
  public/js/portal.js

FINDING (plain English):
The search code was already correct — it queries THIS portal's contacts
(GET /api/contacts, portal-scoped), filters by name/email/phone, and renders
matches. There was no broken endpoint and no wrong field. The likely reason
"maya" showed nothing is that the portal has no contact by that name — the
recent dummy data you made were JOBS (which are Records, not Contacts), and
"Create Dummy Job" never makes contacts.

WHAT CHANGED:
- Click into the box (focus) and it now lists contacts to pick immediately.
- Clear messages: "This portal has no contacts yet…" vs "No contacts match …".
- Hardened against an unexpected response shape. Still reuses /api/contacts,
  still portal-scoped, still creates a RecordLink on selection.

See the chat for restore-point, apply, and revert commands.
