let tasks = [];
let nextId = 1;

function createTask(req, res) {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }
  const newTask = { id: nextId++, title, done: false };
  tasks.push(newTask);
  res.status(201).json(newTask);
}

function getTask(req, res) {
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "task not found" });
  res.json(task);
}

function updateTask(req, res) {
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: "task not found" });
  const { title, done } = req.body;
  if (title !== undefined) task.title = title;
  if (done !== undefined) task.done = done;
  res.json(task);
}

function deleteTask(req, res) {
  const index = tasks.findIndex(t => t.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: "task not found" });
  tasks.splice(index, 1);
  res.status(204).send();
}

function getAllTasks(req, res) {
  res.json(tasks);
}

module.exports = { createTask, getTask, updateTask, deleteTask, getAllTasks };