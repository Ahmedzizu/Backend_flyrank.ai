Task API — Postgres Migration + AI Task Triage (queued) + PDF Reports
Stack
Node.js + Express

PostgreSQL (Docker, with named volume pgdata) — also doubles as the job queue

docker-compose runs three services: app (API), db (Postgres), worker (background jobs)

Groq API (free tier) for AI judgements, OpenRouter free models as fallback

PDFKit for report rendering — streams straight to disk, no big buffers in memory

Setup
Copy .env.example to .env

Add a free Groq key to .env: GROQ_API_KEY=gsk_... (console.groq.com/keys — no credit card)

Run: docker compose up --build

API at http://localhost:3000/tasks — Swagger docs at http://localhost:3000/api-docs

Architecture
The service and routes layers were NOT changed when swapping from
in-memory storage to Postgres. Only db.js (connection) and
controllers/tasks.controller.js (SQL queries) were updated to use
the pg Pool instead of the in-memory array. This proves the
repository pattern: storage is swappable without touching business logic.

A8 extended the same queue with a second job kind (generate_report).
The jobs table schema did not change — it was already generic
(kind, payload, result). db.js gained an optional kind
parameter on enqueueJob, and worker.js now dispatches by kind.
The triage pipeline is byte-for-byte untouched.

AI Task Triage — accept fast, work in background, report status
The LLM call takes ~1s — too slow to hold a request open. So the endpoint
never calls the model: it queues a job and answers instantly with 202.
A separate worker service polls the queue, calls the model, and stores
the result. A status endpoint reports where the job is.

bash
# 1. Accept fast — no model call in the request
curl -X POST http://localhost:3000/tasks/judge \
  -H "Content-Type: application/json" \
  -d '{"text": "Fix the login page crash before the demo on Monday"}'
# 202 {"job_id":"...","status":"queued","links":{"status":"/tasks/judge/..."}}

# 2. Report status — poll until done
curl http://localhost:3000/tasks/judge/<job_id>
# {"job_id":"...","status":"done","attempts":0,
#  "result":{"category":"bug","priority":"high","suggested_title":"Fix login page crash",
#            "due_hint":"2026-08-17","confidence":0.92}}
Job lifecycle: queued → processing → done | failed.

PDF Reports — query, render, store and link (A8)
"Generate a report" is the classic background job. Rendering a PDF means
SQL aggregation + file generation — far too slow for a request. So the
endpoint never builds the PDF: it queues a generate_report job on the
SAME jobs table and answers instantly with 202. The worker aggregates
the data, renders the PDF, stores it on disk, and writes only the path
back to the job row.

bash
# 1. Request a report — instant, no PDF built in the request
curl -X POST http://localhost:3000/reports
# 202 {"jobId":"...","status":"queued","statusUrl":"/reports/..."}

# 2. Poll status until done
curl http://localhost:3000/reports/<job_id>
# {"jobId":"...","status":"done","attempts":0,
#  "stats":{"total":3,"done":0,"pending":3},
#  "downloadUrl":"/reports/.../download"}

# 3. Download the artifact
curl -OJ http://localhost:3000/reports/<job_id>/download
# tasks-report-xxxxxxxx.pdf
Artifact handling — store and link, never ship bytes around:

The PDF is rendered straight to uploads/reports/<job_id>.pdf by a
PDFKit stream — no multi-MB buffers moving through the app.

jobs.result carries only { file, stats }: the path and the headline
numbers. The queue and the API never see the PDF itself.

The download path is rebuilt from the validated job UUID — never from
client-supplied input.

Scheduled reports (stretch): the worker enqueues a daily report on
startup and every 24h with a deterministic idempotency key
(report:daily:YYYY-MM-DD). Restarts and extra ticks can never create
a second report for the same day — ON CONFLICT returns the existing row.

The non-negotiables
Idempotency (jobs WILL run twice). Two layers: every job carries an
idempotency_key (sha256 of the text, or a client Idempotency-Key
header) with a UNIQUE constraint + ON CONFLICT — retrying the same
request returns the same job, never a duplicate. And the worker skips
any job already in done, so a double delivery never triggers a second
model call or a second write.

Retries (jobs WILL fail). failJob() reschedules the job with
exponential backoff (5s → 10s → 20s) while attempts remain, then
dead-letters it as failed. On top of the per-call retries inside the
LLM client (A6), jobs get a second, coarser retry layer. Report jobs
get the same semantics for free — the worker's retry/backoff/alert
wrapper wraps every kind.

Alerts (someone must find out). A permanently failed job fires
alertJobFailed(): a loud [ALERT] JOB FAILED PERMANENTLY log line,
plus a webhook POST if ALERT_WEBHOOK_URL is set (Slack/Discord).

Queue mechanics
The jobs table IS the queue — no Redis, no new dependencies.

claimNextJob() uses FOR UPDATE SKIP LOCKED (the standard Postgres
dequeue): two workers can never grab the same job.

Jobs stuck in processing for >5 minutes (crashed worker) are
reclaimed automatically.

Trust guarantees on the model output (from A6, unchanged)
Schema enforced twice: Groq json_schema strict mode (constrained
decoding) + server-side validateJudgement. Malformed output fails the
job instead of storing garbage.

10s timeout per attempt via AbortController.

Bounded per-call retries: 3 attempts with backoff for transient errors
(5xx/429/network/timeout); permanent 4xx fails fast.

Provider fallback chain: Groq → OpenRouter free models.

Judgement, not autopilot: the API guarantees the shape of the answer,
not its correctness — a human approves before anything is saved.

Tests — 19 cases
text
node --test tests/
A6 (9): happy path, malformed output rejected, timeout, retry-then-success,
bounded retries, fail-fast on 4xx, request validation (400), enqueue → 202,
retry-policy units.

A7 (8): worker happy path, duplicate delivery skipped (idempotency),
retry while attempts remain, dead-letter fires the alert, invalid model
output fails the job, 202 + job_id from the endpoint, same request → same
job, status endpoint (done/failed/404/400).

A8 (2): report handler renders the PDF and returns path + stats only
(the artifact is linked, not shipped); render failure propagates so the
worker retries. Both run on injected fakes — no DB, no filesystem.

Persistence proof
Started stack with docker compose up -d, confirmed 3 seeded tasks via GET /tasks

Added a new task via POST /tasks → returned {"id":5,"title":"Persistence check","done":false}

Ran docker compose down — removed both app and db containers plus the network

Ran docker compose up -d — fresh containers created, same named volume pgdata reattached

GET /tasks returned all 4 tasks including id:5 — proving data survived a full
container teardown/rebuild thanks to the Docker volume, not just an app restart.

Endpoints
GET /tasks

GET /tasks/:id

POST /tasks

PUT /tasks/:id

DELETE /tasks/:id

POST /tasks/judge — enqueue AI triage job → 202 + job id (instant)

GET /tasks/judge/:jobId — job status; result when done, error when failed

POST /reports — enqueue PDF report job → 202 + job id (instant)

GET /reports/:jobId — job status; stats + downloadUrl when done

GET /reports/:jobId/download — the PDF file (409 until ready, 410 if cleaned up)