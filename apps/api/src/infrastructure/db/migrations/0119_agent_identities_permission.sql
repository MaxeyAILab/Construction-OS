-- Custom SQL migration file, put your code below! --

INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('admin.agent.manage', 'admin', 'agent', 'manage', 'Declare, update, pause/resume, and decommission AI agent identities')
ON CONFLICT (key) DO NOTHING;
