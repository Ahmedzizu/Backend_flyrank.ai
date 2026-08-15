
const express = require('express');
const router = express.Router();
const { judgeTask } = require('../controllers/aiJudge.controller');

/**
 * @swagger
 * /tasks/judge:
 *   post:
 *     summary: Ask an AI model to triage raw task text
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
 *       200:
 *         description: Schema-validated AI judgement
 *       400:
 *         description: Invalid request body
 *       502:
 *         description: LLM unavailable or returned invalid output
 *       504:
 *         description: LLM call timed out
 */
router.post('/judge', judgeTask);

module.exports = router;