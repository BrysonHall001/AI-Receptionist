-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_call_export',
  '2026-06-25T00:00:00.000Z',
  'Feature',
  'Calls can now be exported, the same way Contacts are. The Calls page toolbar has a new Export button (next to Simulate call), and Calls is now a choice on the Data Administration → Export tab. Call exports save to the Import / Export History (type Calls, with the user who ran it) and are downloadable, and a full Data Backup now includes a Calls sheet/file. Exportable call fields include caller name, phone, caller ID, reason, status, and time, plus optional email, turns, finalized time, and call ID.',
  'call-export',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
