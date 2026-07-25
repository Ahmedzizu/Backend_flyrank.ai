const db = require('../db');

function getAllTasks(req, res) {
  const tasks = db.prepare('SELECT * FROM tasks').all();
  res.json(tasks);
}

function getTask(req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
}


function createTask(req, res) {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }

  const insert = db.prepare('INSERT INTO tasks (title, done) VALUES (?, 0)');
  const result = insert.run(title);

  const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(newTask);
}


function updateTask(req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const { title, done } = req.body;
  const newTitle = title !== undefined ? title : task.title;
  const newDone = done !== undefined ? (done ? 1 : 0) : task.done;

  db.prepare('UPDATE tasks SET title = ?, done = ? WHERE id = ?').run(newTitle, newDone, req.params.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(updated);
}

function deleteTask(req, res) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).send();
}

module.exports = { createTask, getTask, updateTask, deleteTask, getAllTasks };

