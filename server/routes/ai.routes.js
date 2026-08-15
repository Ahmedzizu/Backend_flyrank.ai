const express = require('express');
const router = express.Router();
const { judgeTask, getJudgeJob } = require('../controllers/aiJudge.controller');

const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @swagger
 * /tasks/judge:
 *   post:
 *     summary: Enqueue an AI task-triage job (answers instantly)
 *     description: Accepts raw task text, queues a background AI judgement, returns 202 with a job id. Poll the status link for the result.
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         description: Optional. Retrying with the same key returns the same job.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *                 example: Fix the login page crash before the demo on Monday
 *     responses:
 *       202:
 *         description: Job queued
 *       400:
 *         description: Invalid request body
 */
router.post('/judge', asyncHandler(judgeTask));

/**
 * @swagger
 * /tasks/judge/{jobId}:
 *   get:
 *     summary: Get the status/result of an AI triage job
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Job status (queued | processing | done | failed)
 *       400:
 *         description: jobId must be a UUID
 *       404:
 *         description: Job not found
 */
router.get('/judge/:jobId', asyncHandler(getJudgeJob));

module.exports = router;
