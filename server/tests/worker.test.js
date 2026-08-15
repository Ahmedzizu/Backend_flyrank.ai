"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { processJob } = require("../worker");
const { judgeTask, getJudgeJob } = require("../controllers/aiJudge.controller");
const db = require("../db");

/* ---------- fixtures ---------- */

const VALID = {
  category: "bug",
  priority: "high",
  suggested_title: "Fix login page crash",
  due_hint: null,
  confidence: 0.9,
};

const JOB = {
  id: "job-1",
  kind: "task_judge",
  payload: { text: "Fix the login page crash" },
  status: "processing",
  attempts: 0,
  max_attempts: 3,
};

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

/** Fake worker dependencies — records every call so tests can assert on them. */
function fakeDeps(overrides = {}) {
  const calls = { llm: 0, completeJob: [], failJob: [], alert: [] };
  return {
    calls,
    llm: overrides.llm || (async () => {
      calls.llm++;
      return { content: JSON.stringify(VALID), elapsedMs: 5, attempts: 1 };
    }),
    completeJob: overrides.completeJob || (async (id, result) => { calls.completeJob.push({ id, result }); }),
    failJob: overrides.failJob || (async (id, msg) => { calls.failJob.push({ id, msg }); }),
    getJob: overrides.getJob || (async () => ({ ...JOB, status: "queued", attempts: 1 })),
    alert: overrides.alert || (async (job) => { calls.alert.push(job); }),
  };
}

function withStub(method, fn, run) {
  const orig = db[method];
  db[method] = fn;
  return Promise.resolve()
    .then(run)
    .finally(() => { db[method] = orig; });
}

/* ---------- 8 test cases ---------- */

// 1. Worker happy path: valid LLM output is validated and stored.
test("1. worker completes a job with a validated judgement", async () => {
  const deps = fakeDeps();
  const r = await processJob({ ...JOB }, deps);
  assert.equal(r.outcome, "done");
  assert.equal(deps.calls.llm, 1);
  assert.equal(deps.calls.completeJob.length, 1);
  assert.deepEqual(deps.calls.completeJob[0].result, VALID);
  assert.equal(deps.calls.failJob.length, 0);
});

// 2. Idempotency: a job already done is NOT processed again (jobs run twice).
test("2. duplicate delivery skips the LLM call entirely", async () => {
  const deps = fakeDeps();
  const r = await processJob({ ...JOB, status: "done" }, deps);
  assert.equal(r.outcome, "duplicate");
  assert.equal(deps.calls.llm, 0);          // no second AI call
  assert.equal(deps.calls.completeJob.length, 0); // no second write
});

// 3. Transient failure: job is rescheduled, no alert yet.
test("3. failed job is retried while attempts remain", async () => {
  const deps = fakeDeps({
    llm: async () => { throw new Error("LLM provider error: HTTP 500"); },
    getJob: async () => ({ ...JOB, status: "queued", attempts: 1, max_attempts: 3 }),
  });
  const r = await processJob({ ...JOB }, deps);
  assert.equal(r.outcome, "retry");
  assert.equal(deps.calls.failJob.length, 1);
  assert.equal(deps.calls.failJob[0].msg, "LLM provider error: HTTP 500");
  assert.equal(deps.calls.alert.length, 0); // not dead yet — nobody paged
});

// 4. Dead-letter: after max attempts, the alert fires — someone finds out.
test("4. permanently failed job triggers an alert", async () => {
  const deps = fakeDeps({
    llm: async () => { throw new Error("LLM provider error: HTTP 500"); },
    getJob: async () => ({ ...JOB, status: "failed", attempts: 3, max_attempts: 3, error: "LLM provider error: HTTP 500" }),
  });
  const r = await processJob({ ...JOB }, deps);
  assert.equal(r.outcome, "failed");
  assert.equal(deps.calls.alert.length, 1);
  assert.equal(deps.calls.alert[0].status, "failed");
  assert.equal(deps.calls.alert[0].attempts, 3);
});

// 5. Malformed model output is a failure, not a stored result.
test("5. invalid model output fails the job instead of storing garbage", async () => {
  const deps = fakeDeps({
    llm: async () => ({ content: JSON.stringify({ ...VALID, priority: "whenever" }), elapsedMs: 5, attempts: 1 }),
    getJob: async () => ({ ...JOB, status: "queued", attempts: 1 }),
  });
  const r = await processJob({ ...JOB }, deps);
  assert.equal(r.outcome, "retry");
  assert.match(deps.calls.failJob[0].msg, /invalid model output/);
  assert.equal(deps.calls.completeJob.length, 0);
});

// 6. Endpoint answers 202 instantly with a job id — no LLM call in the request.
test("6. POST /tasks/judge enqueues and returns 202 + job_id", async () => {
  await withStub("enqueueJob", async (key, payload) => {
    assert.match(key, /^[0-9a-f]{64}$/);        // sha256 of the text
    assert.equal(payload.text, "Fix the login page crash");
    return { id: "11111111-2222-4333-8444-555555555555", status: "queued" };
  }, async () => {
    const res = mockRes();
    await judgeTask({ body: { text: "Fix the login page crash" }, headers: {} }, res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.status, "queued");
    assert.equal(res.body.job_id, "11111111-2222-4333-8444-555555555555");
    assert.equal(res.body.links.status, "/tasks/judge/11111111-2222-4333-8444-555555555555");
  });
});

// 7. Idempotent enqueue: same text twice maps to the same job (ON CONFLICT).
test("7. retrying the same request returns the same job, not a new one", async () => {
  const seen = [];
  await withStub("enqueueJob", async (key) => {
    seen.push(key);
    // second call simulates ON CONFLICT: existing row comes back
    return { id: "aaaaaaaa-0000-4000-8000-000000000001", status: seen.length === 1 ? "queued" : "processing" };
  }, async () => {
    const res1 = mockRes();
    await judgeTask({ body: { text: "same text" }, headers: {} }, res1);
    const res2 = mockRes();
    await judgeTask({ body: { text: "same text" }, headers: {} }, res2);
    assert.equal(res1.body.job_id, res2.body.job_id); // same job both times
    assert.equal(seen[0], seen[1]);                   // same idempotency key
  });
});

// 8. Status endpoint: done returns result, failed returns error, bad id 400/404.
test("8. GET /tasks/judge/:jobId reports status, result, and errors", async () => {
  const done = { id: "j1", status: "done", attempts: 1, created_at: "x", result: VALID, error: null };
  await withStub("getJob", async () => done, async () => {
    const res = mockRes();
    await getJudgeJob({ params: { jobId: "11111111-2222-4333-8444-555555555555" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "done");
    assert.deepEqual(res.body.result, VALID);
  });

  await withStub("getJob", async () => undefined, async () => {
    const res = mockRes();
    await getJudgeJob({ params: { jobId: "11111111-2222-4333-8444-555555555555" } }, res);
    assert.equal(res.statusCode, 404);
  });

  const res = mockRes();
  await getJudgeJob({ params: { jobId: "not-a-uuid" } }, res);
  assert.equal(res.statusCode, 400);
});
