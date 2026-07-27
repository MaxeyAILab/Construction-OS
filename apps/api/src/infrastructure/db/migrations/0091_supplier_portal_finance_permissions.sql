-- Custom SQL migration file, put your code below! --

-- api.md §10: "GET/POST /invoices | finance.invoice.* | AP+AR unified...
-- POST /invoices/{id}/approve -> /payments | finance.invoice.approve /
-- finance.payment.*." Supplier Portal (M15, FR-VEND-1/2) reuses
-- procurement.po.update/read (already seeded) for PO confirm/read —
-- no new procurement permission needed, only the dual-path share check
-- inside the service layer.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('finance.invoice.read', 'finance', 'invoice', 'read', 'View invoices (AP+AR) and their lines/payments'),
  ('finance.invoice.create', 'finance', 'invoice', 'create', 'Create an invoice or add a line (FR-VEND-2/FR-SUB-3)'),
  ('finance.invoice.approve', 'finance', 'invoice', 'approve', 'Approve an invoice, or void a draft one'),
  ('finance.payment.create', 'finance', 'payment', 'create', 'Record a payment against an approved invoice')
ON CONFLICT (key) DO NOTHING;
