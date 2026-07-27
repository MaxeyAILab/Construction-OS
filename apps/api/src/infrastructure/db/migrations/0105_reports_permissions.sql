-- Custom SQL migration file, put your code below! --

-- api.md §14: "GET/POST/PATCH /reports/definitions | POST
-- /reports/definitions/{id}/run | GET /reports/runs/{id}" (FR-EXEC-2).
-- run/get-run reuse the read verb — same "materializing a read-only view
-- as a document doesn't need its own write permission" precedent as
-- Payment Applications' POST .../generate-pdf reusing finance.payapp.read.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('reports.definition.read', 'reports', 'definition', 'read', 'View saved report definitions and run status/downloads'),
  ('reports.definition.create', 'reports', 'definition', 'create', 'Create a saved report definition'),
  ('reports.definition.update', 'reports', 'definition', 'update', 'Update a saved report definition')
ON CONFLICT (key) DO NOTHING;
