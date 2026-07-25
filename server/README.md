# Task API — Postgres Migration

## Stack
- Node.js + Express
- PostgreSQL (Docker, with named volume `pgdata`)
- docker-compose runs app + db together

## Setup
1. Copy `.env.example` to `.env`
2. Run: `docker compose up --build`
3. API available at http://localhost:3000/tasks

## Architecture
The service and routes layers were NOT changed when swapping from
in-memory storage to Postgres. Only `db.js` (connection) and
`controllers/tasks.controller.js` (SQL queries) were updated to use
the `pg` Pool instead of the in-memory array. This proves the
repository pattern: storage is swappable without touching business logic.

## Persistence proof
1. Started stack with `docker compose up -d`, confirmed 3 seeded tasks via GET /tasks
2. Added a new task via POST /tasks → returned `{"id":5,"title":"Persistence check","done":false}`
3. Ran `docker compose down` — removed both app and db containers plus the network
4. Ran `docker compose up -d` — fresh containers created, same named volume `pgdata` reattached
5. GET /tasks returned all 4 tasks including id:5 — proving data survived a full
   container teardown/rebuild thanks to the Docker volume, not just an app restart.
## Endpoints
- GET /tasks
- GET /tasks/:id
- POST /tasks
- PUT /tasks/:id
- DELETE /tasks/:id
