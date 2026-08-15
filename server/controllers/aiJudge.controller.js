"use strict";

const { callStructuredLLM } = require("../llm/client");

/**
 * The judgement we ask the model for: given raw task text, return a triage —
 * category, priority, a clean title, and an ISO date hint if one is mentioned.
 */

const CATEGORIES = ["bug", "feature", "chore", "research", "other"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

// Contract sent to the model (Groq strict mode enforces it at decode time).
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

/**
 * Server-side re-validation — even with strict mode we never trust the wire
 * blindly. Returns an error message string, or null if valid.
 */
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

function mapErrorToHttp(err) {
  if (err.code === "TIMEOUT") return { status: 504, body: { error: "llm_timeout", detail: err.message } };
  if (err.status === 429) return { status: 503, body: { error: "llm_rate_limited" } };
  if (typeof err.status === "number" && err.status >= 400 && err.status < 500) {
    return { status: 502, body: { error: "llm_provider_rejected", detail: `HTTP ${err.status}` } };
  }
  return { status: 502, body: { error: "llm_unavailable" } };
}

/**
 * POST /tasks/judge
 * Body: { "text": "Fix the login page crash before the demo on Monday" }
 * 200:  { "data": <TaskJudgement>, "meta": { "attempts": 1, "elapsedMs": 312 } }
 */
async function judgeTask(req, res) {
  const { text } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 2 || text.length > 1000) {
    return res.status(400).json({ error: "text is required (2-1000 chars)" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const result = await callStructuredLLM({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Today is ${today}.\nTask text: """${text.trim()}"""` },
      ],
      schemaName: "task_judgement",
      schema: TASK_JUDGEMENT_SCHEMA,
    });

    let judgement;
    try {
      judgement = JSON.parse(result.content);
    } catch {
      return res.status(502).json({ error: "llm_invalid_json" });
    }

    const validationError = validateJudgement(judgement);
    if (validationError) {
      // Malformed model answer never reaches our response.
      return res.status(502).json({ error: "llm_invalid_schema", detail: validationError });
    }

    return res.status(200).json({
      data: judgement,
      meta: { attempts: result.attempts, elapsedMs: result.elapsedMs },
    });
  } catch (err) {
    const { status, body } = mapErrorToHttp(err);
    return res.status(status).json(body);
  }
}

module.exports = { judgeTask, validateJudgement, TASK_JUDGEMENT_SCHEMA };
