-- Custom SQL migration file, put your code below! --

-- api.md conventions (M8 Field Operations). field.daily_report.update
-- covers both editing a draft and submitting it (status: 'draft' ->
-- 'submitted') — unlike change orders' separate .submit key, FR-FIELD-1
-- documents no distinct "reviewer submits" actor for daily reports, and a
-- single update permission keeps the offline sync mutation engine's
-- generic create/update/delete handler registry entity-agnostic (no
-- per-field permission special-casing). field.time_entry.approve is
-- broken out since FR-FIELD-2's "route to job costing/payroll" is a
-- distinct, more-privileged actor approving someone else's hours, same
-- reasoning as finance.co.approve.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('field.daily_report.read', 'field', 'daily_report', 'read', 'View daily reports'),
  ('field.daily_report.create', 'field', 'daily_report', 'create', 'Create a daily report (draft)'),
  ('field.daily_report.update', 'field', 'daily_report', 'update', 'Edit a draft daily report, or submit it'),
  ('field.time_entry.read', 'field', 'time_entry', 'read', 'View time entries'),
  ('field.time_entry.create', 'field', 'time_entry', 'create', 'Log a time entry'),
  ('field.time_entry.approve', 'field', 'time_entry', 'approve', 'Approve a time entry, posting it to job costing')
ON CONFLICT (key) DO NOTHING;
