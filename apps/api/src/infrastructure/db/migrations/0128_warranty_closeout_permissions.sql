-- Custom SQL migration file, put your code below! --

-- M19 Warranty & Closeout Management (api.md §18, FR-CLOSE-1..6).
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('closeout.checklist_item.read', 'closeout', 'checklist_item', 'read', 'View a project''s closeout checklist'),
  ('closeout.checklist_item.create', 'closeout', 'checklist_item', 'create', 'Add a tenant-defined closeout checklist item (FR-CLOSE-1)'),
  ('closeout.checklist_item.update', 'closeout', 'checklist_item', 'update', 'Set a checklist item''s status or linked document'),
  ('closeout.package.read', 'closeout', 'package', 'read', 'View a project''s closeout package status and assembly history'),
  ('closeout.package.assemble', 'closeout', 'package', 'assemble', 'Assemble the closeout package once the checklist and punch list are complete (FR-CLOSE-2/3)'),
  ('closeout.warranty.read', 'closeout', 'warranty', 'read', 'View a project''s warranties and their due-state'),
  ('closeout.warranty.create', 'closeout', 'warranty', 'create', 'Record a warranty (FR-CLOSE-4)'),
  ('closeout.warranty.update', 'closeout', 'warranty', 'update', 'Amend a warranty''s responsible party, duration, or linked document'),
  ('closeout.claim.read', 'closeout', 'claim', 'read', 'View warranty claims'),
  ('closeout.claim.create', 'closeout', 'claim', 'create', 'File a warranty claim internally (the client-portal path uses a project share instead, FR-CLOSE-5)'),
  ('closeout.claim.update', 'closeout', 'claim', 'update', 'Move a warranty claim through its lifecycle (acknowledge/resolve/reject)')
ON CONFLICT (key) DO NOTHING;
