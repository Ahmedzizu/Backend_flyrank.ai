const db = require('../db');

async function getAllTasks(req, res) {
  const tasks = await db.all('SELECT * FROM tasks ORDER BY id');
  res.json(tasks);
}

async function getTask(req, res) {
  const task = await db.get('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
}

async function createTask(req, res) {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });

  const result = await db.run(
    'INSERT INTO tasks (title, done) VALUES ($1, false) RETURNING *',
    [title]
  );
  res.status(201).json(result.rows[0]);
}

async function updateTask(req, res) {
  const task = await db.get('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const { title, done } = req.body;
  const newTitle = title !== undefined ? title : task.title;
  const newDone = done !== undefined ? done : task.done;

  const result = await db.run(
    'UPDATE tasks SET title = $1, done = $2 WHERE id = $3 RETURNING *',
    [newTitle, newDone, req.params.id]
  );
  res.json(result.rows[0]);
}

async function deleteTask(req, res) {
  const task = await db.get('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: "Task not found" });

  await db.run('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.status(204).send();
}

module.exports = { createTask, getTask, updateTask, deleteTask, getAllTasks };