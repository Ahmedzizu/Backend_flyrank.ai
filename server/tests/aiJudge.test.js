"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { callLLM, attemptLLMCall, isRetryable } = require("../llm/client");
const { validateJudgement, judgeTask } = require("../controllers/aiJudge.controller");
const db = require("../db");

/* ---------- shared fixtures ---------- */

const VALID_JUDGEMENT = {
  category: "bug",
  priority: "urgent",
  suggested_title: "Fix login page crash",
  due_hint: "2026-08-17",
  confidence: 0.92,
};

function okFetch(json) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] }),
  });
}

const SLOW_FETCH = (_payload, { signal }) =>
  new Promise((_, reject) => {
    signal.addEventListener("abort", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    });
  });

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

/* ---------- A6: LLM client layer (unchanged behavior) ---------- */

// 1. Happy path — valid judgement passes through.
test("1. valid judgement flows through the client", async () => {
  const result = await callLLM(
    { model: "test", messages: [], schemaName: "s", schema: {} },
    okFetch(VALID_JUDGEMENT),
    { timeoutMs: 1000, maxAttempts: 1 }
  );
  const judgement = JSON.parse(result.content);
  assert.equal(validateJudgement(judgement), null);
  assert.equal(judgement.suggested_title, "Fix login page crash");
  assert.equal(result.attempts, 1);
});

// 2. Malformed model output is caught by validation, never returned.
test("2. malformed model output fails validation", () => {
  assert.notEqual(validateJudgement({ ...VALID_JUDGEMENT, priority: "whenever" }), null);
  assert.notEqual(validateJudgement({ ...VALID_JUDGEMENT, confidence: 9 }), null);
  assert.notEqual(validateJudgement({ ...VALID_JUDGEMENT, due_hint: "next Friday" }), null);
  assert.equal(validateJudgement(VALID_JUDGEMENT), null);
});

// 3. Timeout: AbortController fires, error surfaces as TIMEOUT.
test("3. slow provider is aborted and reported as timeout", async () => {
  await assert.rejects(
    attemptLLMCall({}, SLOW_FETCH, 50),
    (err) => err.code === "TIMEOUT"
  );
});

// 4. Retry: transient 500 twice, then success on attempt 3.
test("4. retries transient 5xx and succeeds within budget", async () => {
  let calls = 0;
  const flakyFetch = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 500, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(VALID_JUDGEMENT) } }] }),
    };
  };
  const result = await callLLM({}, flakyFetch, { timeoutMs: 1000, maxAttempts: 3 });
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
});

// 5. Retries are bounded: persistent 503 stops at maxAttempts.
test("5. retries stop at maxAttempts on persistent failure", async () => {
  let calls = 0;
  const downFetch = async () => {
    calls += 1;
    return { ok: false, status: 503, json: async () => ({}) };
  };
  await assert.rejects(
    callLLM({}, downFetch, { timeoutMs: 1000, maxAttempts: 2 }),
    (err) => err.status === 503 && err.attempts === 2
  );
  assert.equal(calls, 2);
});

// 6. Permanent errors (401 bad API key) are NOT retried — fail fast.
test("6. permanent 4xx errors fail fast without retrying", async () => {
  let calls = 0;
  const badKeyFetch = async () => {
    calls += 1;
    return { ok: false, status: 401, json: async () => ({}) };
  };
  await assert.rejects(
    callLLM({}, badKeyFetch, { timeoutMs: 1000, maxAttempts: 3 }),
    (err) => err.status === 401
  );
  assert.equal(calls, 1);
});

/* ---------- A7: endpoint now enqueues instead of calling the LLM ---------- */

// 7. Request validation: missing/short text => 400, nothing enqueued.
test("7. controller rejects invalid request bodies with 400", async () => {
  const res1 = mockRes();
  await judgeTask({ body: {}, headers: {} }, res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error, "text is required (2-1000 chars)");

  const res2 = mockRes();
  await judgeTask({ body: { text: "x" }, headers: {} }, res2);
  assert.equal(res2.statusCode, 400);
});

// 8. A7: the endpoint enqueues and answers 202 — the LLM call moved to the worker.
test("8. endpoint enqueues a job and answers 202 instantly", async () => {
  const orig = db.enqueueJob;
  db.enqueueJob = async (key, payload) => ({
    id: "11111111-2222-4333-8444-555555555555",
    status: "queued",
  });
  try {
    const res = mockRes();
    await judgeTask({ body: { text: "Fix the login page crash" }, headers: {} }, res);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.status, "queued");
    assert.ok(res.body.job_id);
  } finally {
    db.enqueueJob = orig;
  }
});

/* ---------- retry policy unit checks ---------- */

test("retry policy: 429/TIMEOUT/NETWORK/5xx retryable, 400/401 not", () => {
  assert.equal(isRetryable({ status: 429 }), true);
  assert.equal(isRetryable({ code: "TIMEOUT" }), true);
  assert.equal(isRetryable({ code: "NETWORK" }), true);
  assert.equal(isRetryable({ status: 500 }), true);
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable({ status: 401 }), false);
});
