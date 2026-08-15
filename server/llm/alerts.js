"use strict";

/**
 * Alerts: when a job fails permanently (dead-letter), someone must find out.
 * Always logs a loud, greppable line; optionally posts to a webhook
 * (Slack/Discord/anything that accepts {text}) if ALERT_WEBHOOK_URL is set.
 */
async function alertJobFailed(job) {
  const line =
    `[ALERT] JOB FAILED PERMANENTLY id=${job.id} kind=${job.kind} ` +
    `attempts=${job.attempts}/${job.max_attempts} error="${job.error}"`;
  console.error(line);

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    // The alert channel itself failed — still logged above, never silent.
    console.error(`[ALERT] webhook delivery failed: ${err.message}`);
  }
}

module.exports = { alertJobFailed };
