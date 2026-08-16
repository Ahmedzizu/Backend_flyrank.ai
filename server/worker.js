"use strict";

require('dotenv').config();
const db = require('./db');
const { callStructuredLLM } = require('./llm/client');
const { validateJudgement, TASK_JUDGEMENT_SCHEMA, SYSTEM_PROMPT } = require('./controllers/aiJudge.controller');
const { alertJobFailed } = require('./llm/alerts');
const { handleReportJob } = require('./report');

const POLL_MS = 2000;
const REPORT_EVERY_MS = 24 * 60 * 60 * 1000; // stretch: one report per day

/**
 * The real dependencies. Tests inject fakes here — no DB or network needed.
 */
function defaultDeps() {
  return {
    llm: callStructuredLLM,
    report: handleReportJob,
    completeJob: (id, result) => db.completeJob(id, result),
    failJob: (id, message) => db.failJob(id, message),
    getJob: (id) => db.getJob(id),
    alert: alertJobFailed,
  };
}

/**
 * Do the actual work for a claimed job and return the value to store in
 * `result`. Dispatch is by job.kind; anything thrown here is handled by
 * processJob() below, so every kind gets the same retry/backoff/alert
 * semantics for free.
 */
async function runJob(job, deps) {
  if (job.kind === 'generate_report') return deps.report(job);
  if (job.kind !== 'task_judge') throw new Error(`unknown job kind: ${job.kind}`);

  const { text } = job.payload;
  const today = new Date().toISOString().slice(0, 10);

  const result = await deps.llm({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Today is ${today}.\nTask text: """${text}"""` },
    ],
    schemaName: 'task_judge',
    schema: TASK_JUDGEMENT_SCHEMA,
  });

  const judgement = JSON.parse(result.content);
  const validationError = validateJudgement(judgement);
  if (validationError) throw new Error(`invalid model output: ${validationError}`);
  return judgement;
}

/**
 * Process one claimed job.
 *
 * Idempotent by construction: if the job is already 'done' (jobs WILL be
 * delivered twice — a crash after completeJob but before ack, a manual
 * replay, a second worker), we skip the work entirely and exit cleanly.
 *
 * On failure: failJob() reschedules with exponential backoff while attempts
 * remain; once dead-lettered ('failed'), an alert fires — someone finds out.
 */
async function processJob(job, deps = defaultDeps()) {
  if (job.status === 'done') return { outcome: 'duplicate' }; // already handled

  try {
    const result = await runJob(job, deps);
    await deps.completeJob(job.id, result);
    console.log(`[worker] job ${job.id} (${job.kind}) done`);
    return { outcome: 'done' };
  } catch (err) {
    await deps.failJob(job.id, err.message);
    const updated = await deps.getJob(job.id);

    if (updated.status === 'failed') {
      await deps.alert(updated); // dead-letter — someone must find out
      return { outcome: 'failed' };
    }
    console.warn(`[worker] job ${job.id} retry scheduled (attempt ${updated.attempts}/${updated.max_attempts}): ${err.message}`);
    return { outcome: 'retry', attempt: updated.attempts };
  }
}

async function tick(deps = defaultDeps()) {
  const job = await db.claimNextJob();
  if (!job) return false; // queue empty
  await processJob(job, deps);
  return true;
}

/**
 * Stretch: enqueue the daily report. The deterministic idempotency key means
 * worker restarts can never create a second report for the same day — the
 * queue's ON CONFLICT just hands back the existing row.
 */
async function enqueueDailyReport() {
  const today = new Date().toISOString().slice(0, 10);
  const job = await db.enqueueJob(`report:daily:${today}`, { source: 'schedule' }, 'generate_report');
  if (job.inserted) console.log(`[worker] daily report enqueued: ${job.id}`);
}

async function main() {
  console.log('[worker] started — polling every', POLL_MS, 'ms');
  await enqueueDailyReport();                        // stretch
  setInterval(enqueueDailyReport, REPORT_EVERY_MS);  // stretch
  for (;;) {
    try {
      const didWork = await tick();
      if (!didWork) await new Promise(r => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error('[worker] tick error:', err.message);
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  }
}

if (require.main === module) main();

module.exports = { processJob, tick };
