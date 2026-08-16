const express = require('express');
const mainRoutes = require('./routes/main.routes');
const tasksRoutes = require('./routes/tasks.routes');
const aiRoutes = require('./routes/ai.routes');
const reportRoutes = require('./routes/report.routes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const app = express();
const PORT = 3000;

app.use(express.json());

app.use('/', mainRoutes);
app.use('/tasks', aiRoutes);      // الأول — /judge و /judge/:jobId
app.use('/tasks', tasksRoutes);   // بعدها — CRUD بالأرقام
// ...
app.use('/reports', reportRoutes);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});