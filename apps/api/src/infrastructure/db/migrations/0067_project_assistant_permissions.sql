-- Custom SQL migration file, put your code below! --

-- api.md §13: POST /ai/conversations, POST /ai/conversations/{id}/messages
-- — the only two conversation endpoints that table lists (no GET; a
-- listing/history endpoint isn't part of this spec pass, so no
-- ai.conversation.read permission is seeded for one). Same "ai" module
-- namespace as ai.run.read/ai.search.read. suggest_tasks's "draft"
-- consequence class (ai-spec §6) needs no separate gate beyond this one
-- key, since a draft artifact is "visible only to the user" and nothing
-- persists elsewhere.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('ai.conversation.create', 'ai', 'conversation', 'create', 'Open AI assistant conversations and post messages')
ON CONFLICT (key) DO NOTHING;
