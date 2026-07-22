-- Custom SQL migration file, put your code below! --

-- api.md §10 (M9): finance.budget.read/update are documented exactly.
-- finance.costtxn.create has no api.md endpoint to anchor to (manual cost
-- transaction entry isn't documented there — same gap as /project-templates
-- in the Projects module) but follows the same finance.* namespace.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('finance.budget.read', 'finance', 'budget', 'read', 'View a project budget, its lines, and the financial summary'),
  ('finance.budget.update', 'finance', 'budget', 'update', 'Create/update a project budget and its lines (original amounts, pre-lock only)'),
  ('finance.costtxn.create', 'finance', 'costtxn', 'create', 'Post a manual cost transaction to the project cost ledger')
ON CONFLICT (key) DO NOTHING;
