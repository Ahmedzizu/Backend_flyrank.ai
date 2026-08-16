const express = require('express');
const router = express.Router();
const {
  requestReport,
  getReport,
  downloadReport
} = require('../controllers/report.controller');

// Wraps async handlers so a rejected promise becomes a 500 instead of
// crashing the whole process (Express 4 does not catch async errors).
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// jobId must be a UUID — same idea as validateId in tasks.routes.js:
// keeps junk input from exploding inside Postgres or the filesystem.
function validateJobId(req, res, next) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.jobId)) {
    return res.status(400).json({ error: "jobId must be a UUID" });
  }
  next();
}

/**
 * @swagger
 * /reports:
 *   post:
 *     summary: Request a new PDF report (generated as a background job)
 *     responses:
 *       202:
 *         description: Report job queued — poll the returned statusUrl
 */
router.post('/', asyncHandler(requestReport));

/**
 * @swagger
 * /reports/{jobId}:
 *   get:
 *     summary: Check a report job's status
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Job status — downloadUrl appears when done
 *       400:
 *         description: jobId must be a UUID
 *       404:
 *         description: Report not found
 */
router.get('/:jobId', validateJobId, asyncHandler(getReport));

/**
 * @swagger
 * /reports/{jobId}/download:
 *   get:
 *     summary: Download the generated PDF
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The PDF file
 *       400:
 *         description: jobId must be a UUID
 *       404:
 *         description: Report not found
 *       409:
 *         description: Report not ready yet
 */
router.get('/:jobId/download', validateJobId, asyncHandler(downloadReport));

module.exports = router;
