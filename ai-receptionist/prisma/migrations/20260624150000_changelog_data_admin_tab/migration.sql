-- Going-forward Change Log entry (explicit work date — June 24, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_data_admin_tab',
  '2026-06-24T00:00:00.000Z',
  'Feature',
  'New Settings → Data Administration tab brings importing, exporting, and history into one place. Import and Export sub-tabs let you pick any type (Contacts or any record type) and open the same importer/exporter used on each page. The Import / Export History sub-tab shows all import and export activity for the portal across every type, each row labelled with its type and whether it was an import or export, with sort tabs for All or a single type.',
  'data-administration-tab',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
