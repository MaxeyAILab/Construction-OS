-- Custom SQL migration file, put your code below! --

-- api.md §13: POST /ai/search. Same "ai" module namespace as
-- 0060_ai_gateway_permissions.sql's ai.run.read.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('ai.search.read', 'ai', 'search', 'read', 'Use natural-language search (RAG) over permitted data')
ON CONFLICT (key) DO NOTHING;
