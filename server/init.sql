CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO tasks (title, done)
SELECT * FROM (VALUES
  ('Buy milk', false),
  ('Learn SQL', false),
  ('Finish assignment', false)
) AS seed(title, done)
WHERE NOT EXISTS (SELECT 1 FROM tasks);
