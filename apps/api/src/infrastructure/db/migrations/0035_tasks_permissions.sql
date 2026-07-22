-- Custom SQL migration file, put your code below! --

-- api.md §7 (M6): tasks.task.* wildcard covers GET/POST /tasks and
-- GET/PATCH/DELETE /tasks/{id}; comment is broken out as its own action
-- key since it's a distinct permission per api.md's row for
-- POST /tasks/{id}/comments.
INSERT INTO permissions (key, module, resource, action, description) VALUES
  ('tasks.task.read', 'tasks', 'task', 'read', 'View tasks and punch items'),
  ('tasks.task.create', 'tasks', 'task', 'create', 'Create a task or punch item'),
  ('tasks.task.update', 'tasks', 'task', 'update', 'Update a task or punch item'),
  ('tasks.task.delete', 'tasks', 'task', 'delete', 'Delete a task or punch item'),
  ('tasks.task.comment', 'tasks', 'task', 'comment', 'Comment on a task or punch item')
ON CONFLICT (key) DO NOTHING;
