"use strict";

require('dotenv').config();
const db = require('./db');
const { callStructuredLLM } = require('./llm/client');
const { validateJudgement, TASK_JUDGEMENT_SCHEMA, SYSTEM_PROMPT } = require('./controllers/aiJudge.controller');
const { alertJobFailed } = require('./llm/alerts');

const POLL_MS = 2000;

/**
 * The real dependencies. Tests inject fakes here — no DB or network needed.
 */
function defaultDeps() {
  return {
    llm: callStructuredLLM,
    completeJob: (id, result) => db.completeJob(id, result),
    failJob: (id, message) => db.failJob(id, message),
    getJob: (id) => db.getJob(id),
    alert: alertJobFailed,
  };
}

/**
 * Process one claimed job.
 *
 * Idempotent by construction: if the job is already 'done' (jobs WILL be
 * delivered twice — a crash after completeJob but before ack, a manual
 * replay, a second worker), we skip the LLM call entirely and exit cleanly.
 *
 * On failure: failJob() reschedules with exponential backoff while attempts
 * remain; once dead-lettered ('failed'), an alert fires — someone finds out.
 */
async function processJob(job, deps = defaultDeps()) {
  if (job.status === 'done') return { outcome: 'duplicate' }; // already handled

  const { text } = job.payload;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const result = await deps.llm({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Today is ${today}.\nTask text: """${text}"""` },
      ],
      schemaName: 'task_judgement',
      schema: TASK_JUDGEMENT_SCHEMA,
    });

    const judgement = JSON.parse(result.content);
    const validationError = validateJudgement(judgement);
    if (validationError) throw new Error(`invalid model output: ${validationError}`);

    await deps.completeJob(job.id, judgement);
    console.log(`[worker] job ${job.id} done in ${result.elapsedMs}ms`);
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

async function main() {
  console.log('[worker] started — polling every', POLL_MS, 'ms');
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
