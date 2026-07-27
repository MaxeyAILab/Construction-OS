-- Custom SQL migration file, put your code below! --

-- api.md §10: "GET/POST /projects/{id}/payment-applications |
-- finance.payapp.* | AIA-style billing (FR-FIN-4); POST {id}/generate-pdf
-- -> 202".
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('finance.payapp.read', 'finance', 'payapp', 'read', 'View payment applications and their lines'),
  ('finance.payapp.create', 'finance', 'payapp', 'create', 'Create a payment application or add a line'),
  ('finance.payapp.approve', 'finance', 'payapp', 'approve', 'Submit, approve (bills the client), or void a payment application')
ON CONFLICT (key) DO NOTHING;
