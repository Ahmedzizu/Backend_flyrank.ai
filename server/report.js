"use strict";

/**
 * Report pipeline: aggregate -> render PDF -> store artifact.
 *
 * Artifact handling rule: the job's `result` carries the file path and a few
 * headline numbers only — never the PDF itself. The file lives on disk under
 * uploads/reports/ and clients get a download link (store and link).
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const db = require('./db');

const REPORTS_DIR = path.join(__dirname, 'uploads', 'reports');

/** SQL aggregation over the real data: tasks + the queue itself. */
async function collectStats() {
  const totals = await db.get(`
    SELECT count(*)::int                         AS total,
           count(*) FILTER (WHERE done)::int     AS done,
           count(*) FILTER (WHERE NOT done)::int AS pending
    FROM tasks
  `);

  const pending = await db.all(
    'SELECT id, title FROM tasks WHERE NOT done ORDER BY id LIMIT 10'
  );

  const queue = await db.all(`
    SELECT kind, status, count(*)::int AS count
    FROM jobs
    GROUP BY kind, status
    ORDER BY kind, status
  `);

  return { generatedAt: new Date().toISOString(), totals, pending, queue };
}

/** Render straight to disk — no 20 MB buffers moving around the app. */
function renderPdf(stats, filePath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).text('Tasks Report', { align: 'center' });
    doc
      .fontSize(10)
      .fillColor('gray')
      .text(`Generated at: ${stats.generatedAt}`, { align: 'center' });
    doc.moveDown(1.5);

    const { total, done, pending } = stats.totals;
    const pct = total ? Math.round((done / total) * 100) : 0;
    doc.fillColor('black').fontSize(14).text('Summary');
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Total tasks:     ${total}`);
    doc.text(`Done:            ${done}`);
    doc.text(`Pending:         ${pending}`);
    doc.text(`Completion rate: ${pct}%`);
    doc.moveDown();

    doc.fontSize(14).text('Oldest pending tasks');
    doc.moveDown(0.5);
    doc.fontSize(11);
    if (stats.pending.length === 0) doc.text('Nothing pending — all done.');
    for (const t of stats.pending) doc.text(`#${t.id}  ${t.title}`);
    doc.moveDown();

    doc.fontSize(14).text('Background queue');
    doc.moveDown(0.5);
    doc.fontSize(11);
    for (const row of stats.queue) doc.text(`${row.kind} / ${row.status}: ${row.count}`);

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Handler for kind='generate_report'. Deps are injectable so tests never
 * touch the DB or the filesystem — same pattern as worker.js.
 */
async function handleReportJob(job, deps = { collectStats, renderPdf }) {
  const stats = await deps.collectStats();
  const filePath = path.join(REPORTS_DIR, `${job.id}.pdf`);
  await deps.renderPdf(stats, filePath);

  return {
    file: path.relative(__dirname, filePath),
    stats: stats.totals,
  };
}

module.exports = { collectStats, renderPdf, handleReportJob, REPORTS_DIR };
