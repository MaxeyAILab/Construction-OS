-- Custom SQL migration file, put your code below! --

-- api.md §4 (M1 CRM): "crm.contact.*" covers BOTH /crm/contacts and
-- /crm/companies (contact_companies) — a single documented permission
-- namespace for the two closely-related resources, not split into a
-- separate crm.contactcompany.* the way finance.co.*/finance.budget.*
-- stay distinct.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('crm.contact.read', 'crm', 'contact', 'read', 'View contacts and contact companies'),
  ('crm.contact.create', 'crm', 'contact', 'create', 'Create a contact or contact company'),
  ('crm.contact.update', 'crm', 'contact', 'update', 'Update a contact or contact company'),
  ('crm.contact.delete', 'crm', 'contact', 'delete', 'Delete a contact'),
  ('crm.opportunity.read', 'crm', 'opportunity', 'read', 'View opportunities and their activity timeline'),
  ('crm.opportunity.create', 'crm', 'opportunity', 'create', 'Create an opportunity'),
  ('crm.opportunity.update', 'crm', 'opportunity', 'update', 'Update an opportunity (stage moves, mark lost)'),
  ('crm.opportunity.win', 'crm', 'opportunity', 'win', 'Mark an opportunity won, atomically creating its project (FR-CRM-4)'),
  ('crm.activity.read', 'crm', 'activity', 'read', 'View an opportunity''s activity timeline'),
  ('crm.activity.create', 'crm', 'activity', 'create', 'Log a call/email/meeting/note against an opportunity'),
  ('crm.settings.manage', 'crm', 'settings', 'manage', 'Manage the tenant''s pipeline stage configuration')
ON CONFLICT (key) DO NOTHING;