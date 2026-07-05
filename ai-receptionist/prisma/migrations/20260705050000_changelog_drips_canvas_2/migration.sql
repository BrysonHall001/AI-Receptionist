INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_drips_canvas_2',
  '2026-07-05',
  'Feature',
  'Drips can now be wired together and run: draw connectors between nodes, and the drip compiles into a real automation that executes through the existing engine. Added graph validation and activate/deactivate. (Linear flows; branching + full visual polish next.)',
  'batch-drips-canvas-2-20260705',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
