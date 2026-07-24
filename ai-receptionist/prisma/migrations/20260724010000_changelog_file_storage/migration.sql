-- Changelog: File storage (R2 object storage, local fallback, migration sweep)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_file_storage_20260724',
  '2026-07-24',
  'Improvement',
  'Photos and files now live in real object storage instead of inside the database. Nothing looks different — every image, gallery, and attachment renders exactly as before — but under the hood, new uploads travel to private cloud storage and the record keeps only a small reference, while a quiet background sweep gradually moves every previously-embedded file over too, verifying each one byte-for-byte before the original is replaced (a file that can''t be verified is left exactly as it was and retried later — nothing is ever lost). The practical win: image fields now take photos up to 8 MB and file fields up to 15 MB, big enough for real job-site pictures. Files are served only through the app with the same sign-in and permissions as the records they belong to, storage health and migration progress show on the Health page, and on machines without storage configured everything simply keeps working the old way.',
  'batch-file-storage-20260724',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
