-- Custom SQL migration file, put your code below! --

-- api.md §6 (M7): permission keys are documented as 2-segment
-- (schedule.read/update/baseline/resources) rather than the module.
-- resource.action shape used elsewhere; module=resource="schedule" here to
-- fit the permissions table's 3-column shape without inventing a resource
-- noun api.md doesn't name. `schedule.update` gates activity CRUD, the
-- batch endpoint, dependency replacement, and recalculate — api.md's own
-- table reuses it for all four rows. `schedule.resources` (cross-project
-- conflicts, FR-SCH-5) is deferred with the Lookahead/resource-conflicts
-- roadmap row and intentionally not seeded here.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('schedule.read', 'schedule', 'schedule', 'read', 'View a project schedule, its activities, and dependencies'),
  ('schedule.update', 'schedule', 'schedule', 'update', 'Create/update/delete schedule activities and dependencies, and run CPM recalculation'),
  ('schedule.baseline', 'schedule', 'schedule', 'baseline', 'Snapshot a schedule baseline')
ON CONFLICT (key) DO NOTHING;
