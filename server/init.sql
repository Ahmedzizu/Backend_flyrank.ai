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

-- A7: jobs table — the Postgres-backed queue for background AI judgements.
-- idempotency_key is UNIQUE: enqueueing the same job twice returns the existing row.
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'task_judge',
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  result JSONB,
  error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs (status, run_at, created_at);
