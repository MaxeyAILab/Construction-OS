-- Custom SQL migration file, put your code below! --

-- M14 Subcontractor Management (FR-SUB-1..3). api.md has no dedicated
-- Subcontractor API section (same gap as M12 Safety) — follows the same
-- module.resource.action shape api.md §1.1 mandates for every module
-- regardless.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('subcontractor.subcontractor.read', 'subcontractor', 'subcontractor', 'read', 'View the subcontractor registry'),
  ('subcontractor.subcontractor.create', 'subcontractor', 'subcontractor', 'create', 'Add a subcontractor to the registry'),
  ('subcontractor.subcontractor.update', 'subcontractor', 'subcontractor', 'update', 'Update a subcontractor record or prequal status'),
  ('subcontractor.subcontract.read', 'subcontractor', 'subcontract', 'read', 'View subcontracts and their lines'),
  ('subcontractor.subcontract.create', 'subcontractor', 'subcontract', 'create', 'Create a subcontract or add lines'),
  ('subcontractor.subcontract.update', 'subcontractor', 'subcontract', 'update', 'Update a subcontract header'),
  ('subcontractor.subcontract.approve', 'subcontractor', 'subcontract', 'approve', 'Approve a subcontract, creating a commitment (FR-SUB-3)')
ON CONFLICT (key) DO NOTHING;

-- api.md §5: "GET/POST /bid-packages · nested /invitations, /bids |
-- estimating.bid.* | Sub bidding (FR-EST-6)". Deferred when Estimating's
-- own permission row was first seeded (0023_estimating_permissions.sql)
-- since subcontractors didn't exist yet — closed now.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('estimating.bid.read', 'estimating', 'bid', 'read', 'View bid packages, invitations, and bids'),
  ('estimating.bid.create', 'estimating', 'bid', 'create', 'Create a bid package, invite a subcontractor, or submit a bid'),
  ('estimating.bid.update', 'estimating', 'bid', 'update', 'Update a bid package or invitation status')
ON CONFLICT (key) DO NOTHING;