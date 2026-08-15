"use strict";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * One LLM call attempt. No retries here — the caller (callLLM) owns that.
 * Injected `fetchFn` keeps this unit-testable without network mocks.
 */
async function attemptLLMCall(payload, fetchFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetchFn(payload, { signal: controller.signal });
    const elapsedMs = Date.now() - started;

    if (!res.ok) {
      const err = new Error(`LLM provider error: HTTP ${res.status}`);
      err.status = res.status;
      err.elapsedMs = elapsedMs;
      throw err;
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : undefined;

    if (typeof content !== "string" || content.length === 0) {
      const err = new Error("LLM response missing message.content");
      err.code = "EMPTY_CONTENT";
      err.elapsedMs = elapsedMs;
      throw err;
    }

    return { content, elapsedMs };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error(`LLM call timed out after ${timeoutMs}ms`);
      timeoutErr.code = "TIMEOUT";
      throw timeoutErr;
    }
    // Network-level failure (DNS, socket reset, ...) — no HTTP status attached.
    if (err.status === undefined && !err.code) err.code = "NETWORK";
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry policy: retry transient failures (timeout / network / 5xx / 429),
 * give up immediately on permanent ones (4xx like 400/401).
 */
function isRetryable(err) {
  if (err.code === "TIMEOUT" || err.code === "NETWORK") return true;
  if (err.status === 429) return true;
  if (typeof err.status === "number" && err.status >= 500) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded retry wrapper: `maxAttempts` total tries with exponential backoff
 * (500ms, 1000ms, 2000ms... capped at 4s). Stops early on permanent errors.
 */
async function callLLM(payload, fetchFn, { timeoutMs = 10000, maxAttempts = 3 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await attemptLLMCall(payload, fetchFn, timeoutMs);
      result.attempts = attempt;
      return result;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isRetryable(err)) break;
      await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
    }
  }

  lastError.attempts = maxAttempts;
  throw lastError;
}

/**
 * Provider fetch implementations. Each takes the common payload and
 * translates it into the provider's wire format (both are OpenAI-compatible).
 */

function groqFetch(apiKey) {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  return async (payload, { signal }) => {
    const body = {
      model: payload.model,
      messages: payload.messages,
      temperature: payload.temperature !== undefined ? payload.temperature : 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: payload.schemaName,
          strict: true, // constrained decoding — guaranteed schema match
          schema: payload.schema,
        },
      },
    };
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  };
}

function openRouterFetch(apiKey) {
  return async (payload, { signal }) => {
    const body = {
      model: payload.model,
      messages: payload.messages,
      temperature: payload.temperature !== undefined ? payload.temperature : 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: payload.schemaName,
          strict: true,
          schema: payload.schema,
        },
      },
    };
    return fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  };
}

/** Default fallback order if OPENROUTER_MODEL is unset. */
const OPENROUTER_FALLBACKS = [
  "deepseek/deepseek-chat-v3.1:free",
  "openai/gpt-oss-20b:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

/**
 * Build the fetch function chain from environment config.
 * Primary provider first, then fallbacks (each gets the full retry budget).
 */
function buildProviderChain(env) {
  env = env || process.env;
  const chain = [];
  if (env.GROQ_API_KEY) {
    chain.push({
      name: "groq",
      model: env.GROQ_MODEL || "openai/gpt-oss-20b",
      fetchFn: groqFetch(env.GROQ_API_KEY),
    });
  }
  if (env.OPENROUTER_API_KEY) {
    const models = env.OPENROUTER_MODEL ? [env.OPENROUTER_MODEL] : OPENROUTER_FALLBACKS;
    for (const model of models) {
      chain.push({ name: "openrouter", model: model, fetchFn: openRouterFetch(env.OPENROUTER_API_KEY) });
    }
  }
  return chain;
}

/**
 * Ask the model for a schema-conformant judgement.
 * Tries each configured provider in order; each provider gets the retry budget.
 */
async function callStructuredLLM({ messages, schemaName, schema, env }) {
  const chain = buildProviderChain(env);
  if (chain.length === 0) {
    throw new Error("No LLM provider configured. Set GROQ_API_KEY and/or OPENROUTER_API_KEY.");
  }

  let lastError;
  for (const provider of chain) {
    try {
      const payload = { model: provider.model, messages, schemaName, schema, temperature: 0 };
      return await callLLM(payload, provider.fetchFn, {});
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

module.exports = {
  attemptLLMCall,
  callLLM,
  isRetryable,
  buildProviderChain,
  callStructuredLLM,
};
