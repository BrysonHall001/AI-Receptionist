-- Going-forward Change Log entry: runtime CDN libraries vendored locally. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_vendor_cdn_libs_20260712',
  '2026-07-12',
  'Improvement',
  'Reliability: Clarity no longer depends on a third-party CDN at runtime. Four frontend libraries - the rich-text editor (Quill), Excel import/export (SheetJS), zip handling (JSZip), and charts (Chart.js) - previously loaded from cdnjs.cloudflare.com every time the app opened, meaning a slow, blocked, or down CDN could break those features for you and your clients. All four are now served from Clarity''s own servers at the exact same versions, joining the map library (Leaflet) which was already self-hosted. Nothing changes in how anything looks or works - the app simply has one less external service that can take it down.',
  'batch-vendor-cdn-libs-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
