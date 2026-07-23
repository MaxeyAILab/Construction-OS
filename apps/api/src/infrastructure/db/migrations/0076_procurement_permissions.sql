-- Custom SQL migration file, put your code below! --

-- api.md §11 (M5 Procurement): registry, PO lifecycle, RFQ/quote
-- workflow, deliveries. procurement.po.approve is its own permission
-- (distinct from update) since approval is the FR-PROC-3 atomic
-- commitment-writing action — same "the consequential action gets its
-- own key" precedent as finance.co.approve / crm.opportunity.win.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('procurement.supplier.read', 'procurement', 'supplier', 'read', 'View the supplier registry'),
  ('procurement.supplier.create', 'procurement', 'supplier', 'create', 'Add a supplier'),
  ('procurement.supplier.update', 'procurement', 'supplier', 'update', 'Update a supplier'),
  ('procurement.po.read', 'procurement', 'po', 'read', 'View purchase orders'),
  ('procurement.po.create', 'procurement', 'po', 'create', 'Create a purchase order'),
  ('procurement.po.update', 'procurement', 'po', 'update', 'Edit a draft purchase order, and non-approval/cancel status moves (submit/send/confirm/close)'),
  ('procurement.po.approve', 'procurement', 'po', 'approve', 'Approve a purchase order, writing a budget commitment (FR-PROC-3)'),
  ('procurement.po.cancel', 'procurement', 'po', 'cancel', 'Cancel a purchase order'),
  ('procurement.rfq.read', 'procurement', 'rfq', 'read', 'View RFQs and supplier quotes'),
  ('procurement.rfq.create', 'procurement', 'rfq', 'create', 'Create an RFQ, record a supplier quote'),
  ('procurement.delivery.read', 'procurement', 'delivery', 'read', 'View deliveries against a purchase order'),
  ('procurement.delivery.create', 'procurement', 'delivery', 'create', 'Record a delivery receipt (FR-PROC-4)')
ON CONFLICT (key) DO NOTHING;