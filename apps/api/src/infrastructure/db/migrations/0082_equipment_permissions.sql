-- Custom SQL migration file, put your code below! --

-- api.md §11 (M11 Equipment): registry, assignments, usage logs,
-- maintenance (schedules/work orders/inspections share one combined
-- permission — api.md's own table lists them under a single
-- "GET/POST /equipment/{id}/maintenance" bullet, same "one documented
-- bullet, one permission namespace" precedent as inventory.location.*).
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('equipment.equipment.read', 'equipment', 'equipment', 'read', 'View the equipment registry'),
  ('equipment.equipment.create', 'equipment', 'equipment', 'create', 'Add equipment to the registry'),
  ('equipment.equipment.update', 'equipment', 'equipment', 'update', 'Update an equipment record'),
  ('equipment.assignment.read', 'equipment', 'assignment', 'read', 'View equipment assignments'),
  ('equipment.assignment.create', 'equipment', 'assignment', 'create', 'Assign equipment to a project, or end an assignment (FR-EQ-1)'),
  ('equipment.usage.read', 'equipment', 'usage', 'read', 'View equipment usage logs'),
  ('equipment.usage.create', 'equipment', 'usage', 'create', 'Log equipment usage hours/odometer (FR-EQ-2)'),
  ('equipment.maintenance.read', 'equipment', 'maintenance', 'read', 'View maintenance schedules, work orders, and inspections'),
  ('equipment.maintenance.create', 'equipment', 'maintenance', 'create', 'Create/update maintenance schedules, work orders, and inspections (FR-EQ-3)')
ON CONFLICT (key) DO NOTHING;