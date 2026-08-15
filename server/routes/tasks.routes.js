const express = require('express');
const router = express.Router();
const {
  createTask,
  getTask,
  updateTask,
  deleteTask,
  getAllTasks
} = require('../controllers/tasks.controller');

// Wraps async handlers so a rejected promise becomes a 500 instead of
// crashing the whole process (Express 4 does not catch async errors).
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// /tasks/:id must be numeric — otherwise requests like GET /tasks/judge
// fall through to getTask and explode inside Postgres.
function validateId(req, res, next) {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: "id must be an integer" });
  }
  next();
}

/**
 * @swagger
 * /tasks:
 *   post:
 *     summary: Create a new task
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *     responses:
 *       201:
 *         description: Task created
 */
router.post('/', asyncHandler(createTask));

/**
 * @swagger
 * /tasks:
 *   get:
 *     summary: Get all tasks
 *     responses:
 *       200:
 *         description: List of tasks
 */
router.get('/', asyncHandler(getAllTasks));

/**
 * @swagger
 * /tasks/{id}:
 *   get:
 *     summary: Get a task by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Task found
 *       400:
 *         description: id must be an integer
 *       404:
 *         description: Task not found
 */
router.get('/:id', validateId, asyncHandler(getTask));

/**
 * @swagger
 * /tasks/{id}:
 *   put:
 *     summary: Update a task by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               done:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Task updated
 *       400:
 *         description: id must be an integer
 *       404:
 *         description: Task not found
 */
router.put('/:id', validateId, asyncHandler(updateTask));

/**
 * @swagger
 * /tasks/{id}:
 *   delete:
 *     summary: Delete a task by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Task deleted
 *       400:
 *         description: id must be an integer
 *       404:
 *         description: Task not found
 */
router.delete('/:id', validateId, asyncHandler(deleteTask));

module.exports = router;
