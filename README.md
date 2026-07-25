BE-01: Build Your First API Endpoint
A minimal Express server exposing two JSON endpoints.

Endpoints
GET / -> { "message": "Hello, world!" }

GET /time -> { "currentTime": "<ISO timestamp>" }

Run locally
text
npm install
npm start
Test
text
curl http://localhost:3000/
curl http://localhost:3000/time
Or open http://localhost:3000/ and http://localhost:3000/time in your browser.
## Database

- SQLite chosen for zero-config, file-based storage — ideal for learning persistence without running a separate DB server.
- Database file: `server/tasks.db` (auto-created on first run).
- Run: `npm install && npm start`

### Example query
\`\`\`sql
SELECT * FROM tasks WHERE done = 1;
\`\`\`

![DB Browser screenshot](./assets/db-screenshot.png)