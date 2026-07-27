-- Custom SQL migration file, put your code below! --

-- M12 Safety & Compliance (FR-SAFE-1..3). api.md has no dedicated Safety
-- API section (unlike M5/M10/M11's §11) — the permission namespace below
-- follows the same module.resource.action shape api.md §1.1 mandates for
-- every module regardless.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('safety.form_template.read', 'safety', 'form_template', 'read', 'View safety form templates (toolbox talk / inspection checklists)'),
  ('safety.form_template.create', 'safety', 'form_template', 'create', 'Create a safety form template'),
  ('safety.form.read', 'safety', 'form', 'read', 'View filled safety forms'),
  ('safety.form.create', 'safety', 'form', 'create', 'Submit a filled safety form (toolbox talk / inspection, FR-SAFE-1)'),
  ('safety.incident.read', 'safety', 'incident', 'read', 'View incidents and near-misses'),
  ('safety.incident.create', 'safety', 'incident', 'create', 'Report an incident, near-miss, or observation (FR-SAFE-1)'),
  ('safety.incident.update', 'safety', 'incident', 'update', 'Update an incident''s status/severity or route it to a corrective action (FR-SAFE-3)'),
  ('safety.certification.read', 'safety', 'certification', 'read', 'View certifications and compliance items'),
  ('safety.certification.create', 'safety', 'certification', 'create', 'Add a certification or compliance item'),
  ('safety.certification.update', 'safety', 'certification', 'update', 'Renew or update a certification (FR-SAFE-2)')
ON CONFLICT (key) DO NOTHING;