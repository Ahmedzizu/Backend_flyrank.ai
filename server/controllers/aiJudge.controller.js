"use strict";

const crypto = require("crypto");
const db = require("../db");

const CATEGORIES = ["bug", "feature", "chore", "research", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

const TASK_JUDGEMENT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    priority: { type: "string", enum: PRIORITIES },
    suggested_title: {
      type: "string",
      description: "Short, clean task title in imperative form, e.g. 'Fix login page crash'",
    },
    due_hint: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD) if a deadline is mentioned or implied, else null",
    },
    confidence: { type: "number", description: "Model confidence between 0 and 1" },
  },
  required: ["category", "priority", "suggested_title", "due_hint", "confidence"],
  additionalProperties: false,
};

function validateJudgement(j) {
  if (!j || typeof j !== "object") return "judgement is not an object";
  if (!CATEGORIES.includes(j.category)) return "invalid category";
  if (!PRIORITIES.includes(j.priority)) return "invalid priority";
  if (typeof j.suggested_title !== "string" || j.suggested_title.length < 1 || j.suggested_title.length > 120) {
    return "invalid suggested_title";
  }
  if (j.due_hint !== null && (typeof j.due_hint !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(j.due_hint))) {
    return "invalid due_hint (expected YYYY-MM-DD or null)";
  }
  if (typeof j.confidence !== "number" || j.confidence < 0 || j.confidence > 1) {
    return "invalid confidence (expected number in [0, 1])";
  }
  return null;
}

const SYSTEM_PROMPT = [
  "You triage raw task descriptions into structured data.",
  "Rules:",
  "- category: bug for defects/crashes, feature for new capabilities, chore for maintenance, research for investigation, other otherwise.",
  "- priority: urgent only for explicit ASAP/blocking language; high for deadlines within days.",
  "- suggested_title: short imperative title, no filler words.",
  "- due_hint: resolve relative dates against today's date given in the user message; null if none.",
  "- confidence: 1.0 only when the text is unambiguous.",
].join("\n");

/**
 * POST /tasks/judge — A7: no LLM call here. Validates, enqueues, answers 202.
 * Idempotent: the same text (or a client-supplied Idempotency-Key header)
 * always maps to the same job row.
 */
async function judgeTask(req, res) {
  const { text } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 2 || text.length > 1000) {
    return res.status(400).json({ error: "text is required (2-1000 chars)" });
  }

  const trimmed = text.trim();
  const key = req.headers["idempotency-key"] ||
    crypto.createHash("sha256").update(trimmed).digest("hex");

  const job = await db.enqueueJob(key, { text: trimmed });
  return res.status(202).json({
    job_id: job.id,
    status: job.status,
    links: { status: `/tasks/judge/${job.id}` },
  });
}

/**
 * GET /tasks/judge/:jobId — status endpoint. Reports the result when done.
 */
async function getJudgeJob(req, res) {
  const { jobId } = req.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return res.status(400).json({ error: "jobId must be a UUID" });
  }

  const job = await db.getJob(jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const body = {
    job_id: job.id,
    status: job.status,
    attempts: job.attempts,
    created_at: job.created_at,
  };
  if (job.status === "done") body.result = job.result;
  if (job.status === "failed") body.error = job.error;
  return res.json(body);
}

module.exports = { judgeTask, getJudgeJob, validateJudgement, TASK_JUDGEMENT_SCHEMA, SYSTEM_PROMPT };
