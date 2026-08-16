const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { REPORTS_DIR } = require('../report');

// POST /reports — يصفّ المهمة ويرد فورًا؛ التوليد بيحصل في الـ worker
async function requestReport(req, res) {
  // On-demand: كل طلب تقرير جديد، فالمفتاح فريد
  const idempotencyKey = `report:${crypto.randomUUID()}`;
  const job = await db.enqueueJob(
    idempotencyKey,
    { requestedAt: new Date().toISOString() },
    'generate_report'
  );

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    statusUrl: `/reports/${job.id}`,
  });
}

// GET /reports/:jobId — الحالة، ولما تبقى done يظهر لينك التحميل
async function getReport(req, res) {
  const job = await db.getJob(req.params.jobId);
  if (!job || job.kind !== 'generate_report') {
    return res.status(404).json({ error: 'report not found' });
  }

  const body = {
    jobId: job.id,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.created_at,
  };
  if (job.status === 'failed') body.error = job.error;
  if (job.status === 'done') {
    body.stats = job.result.stats;
    body.downloadUrl = `/reports/${job.id}/download`;
  }
  res.json(body);
}

// GET /reports/:jobId/download — يبعت الملف نفسه
async function downloadReport(req, res) {
  const job = await db.getJob(req.params.jobId);
  if (!job || job.kind !== 'generate_report') {
    return res.status(404).json({ error: 'report not found' });
  }
  if (job.status !== 'done') {
    return res.status(409).json({ error: `report is ${job.status} — try again shortly` });
  }

  // المسار بيتبني من الـ job id (UUID متفحص في الراوتر) — منثقش في أي path من بره
  const filePath = path.join(REPORTS_DIR, `${job.id}.pdf`);
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: 'report file is gone — request a new one' });
  }
  res.download(filePath, `tasks-report-${job.id.slice(0, 8)}.pdf`);
}

module.exports = { requestReport, getReport, downloadReport };
