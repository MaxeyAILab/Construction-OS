-- Custom SQL migration file, put your code below! --

-- api.md §5 (M2): estimating.estimate.* covers /estimates + /estimates/{id}
-- + /estimates/{id}/versions + /estimates/{id}/lines. estimating.costbook.*
-- covers /cost-items + /assemblies + price-history. finance.budget.create
-- is the cross-module permission api.md §5 documents for
-- POST /estimates/{id}/convert-to-budget (line 161) — it doesn't exist yet
-- because the Budget module (0020_seed_finance_permissions) only needed
-- read/update so far.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('estimating.estimate.read', 'estimating', 'estimate', 'read', 'View estimates and their lines'),
  ('estimating.estimate.create', 'estimating', 'estimate', 'create', 'Create an estimate or a new version of one'),
  ('estimating.estimate.update', 'estimating', 'estimate', 'update', 'Update an estimate header, its lines, or add assembly lines'),
  ('estimating.estimate.delete', 'estimating', 'estimate', 'delete', 'Delete an estimate line'),
  ('estimating.costbook.read', 'estimating', 'costbook', 'read', 'View cost items, assemblies, and price history'),
  ('estimating.costbook.manage', 'estimating', 'costbook', 'manage', 'Create/update cost items, assemblies, and record price observations'),
  ('finance.budget.create', 'finance', 'budget', 'create', 'Create a project budget, including converting an estimate to a budget')
ON CONFLICT (key) DO NOTHING;