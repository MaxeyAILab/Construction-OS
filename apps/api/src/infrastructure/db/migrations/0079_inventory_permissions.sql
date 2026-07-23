-- Custom SQL migration file, put your code below! --

-- api.md §11 (M10 Inventory): catalog/locations, stock levels, movements.
-- No PATCH is documented for items/locations (the table only lists
-- GET/POST), so no update permission is minted for either — same
-- "don't invent past what's documented" reasoning as elsewhere this
-- session.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('inventory.item.read', 'inventory', 'item', 'read', 'View the inventory item catalog'),
  ('inventory.item.create', 'inventory', 'item', 'create', 'Add a catalog item'),
  ('inventory.location.read', 'inventory', 'location', 'read', 'View warehouses and job-site stores'),
  ('inventory.location.create', 'inventory', 'location', 'create', 'Add a warehouse or job-site store'),
  ('inventory.stock.read', 'inventory', 'stock', 'read', 'View stock levels'),
  ('inventory.movement.read', 'inventory', 'movement', 'read', 'View the stock movement ledger'),
  ('inventory.movement.create', 'inventory', 'movement', 'create', 'Post a stock movement (issue/transfer/adjustment/return, FR-INV-2)')
ON CONFLICT (key) DO NOTHING;