-- Custom SQL migration file, put your code below! --

-- api.md §13: GET /ai/runs — "Tenant AI audit/usage". Follows the "ai"
-- module namespace ai-spec.md/api.md use throughout §13's route table
-- (ai.run.read), not the admin.* namespace audit_log ended up under.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('ai.run.read', 'ai', 'run', 'read', 'Read AI Gateway usage/cost audit (ai_runs)')
ON CONFLICT (key) DO NOTHING;
