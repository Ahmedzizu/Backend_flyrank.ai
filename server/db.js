require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
  async all(query, params = []) {
    const res = await pool.query(query, params);
    return res.rows;
  },
  async get(query, params = []) {
    const res = await pool.query(query, params);
    return res.rows[0];
  },
  async run(query, params = []) {
    const res = await pool.query(query, params);
    return res;
  },

  /**
   * Atomically claim the next due job. FOR UPDATE SKIP LOCKED means two
   * workers can never grab the same row — this is the queue's dequeue.
   * Also reclaims jobs stuck in 'processing' for over 5 minutes (crashed worker).
   */
  async claimNextJob() {
    const res = await pool.query(`
      UPDATE jobs
      SET status = 'processing', updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE (status = 'queued' AND run_at <= now())
           OR (status = 'processing' AND updated_at < now() - interval '5 minutes')
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    return res.rows[0];
  },

  async completeJob(id, result) {
    await pool.query(
      `UPDATE jobs SET status = 'done', result = $2, error = NULL, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(result)]
    );
  },

  /** Retry with backoff if attempts remain, otherwise dead-letter as failed. */
  async failJob(id, message) {
    await pool.query(`
      UPDATE jobs SET
        attempts = attempts + 1,
        status = CASE WHEN attempts + 1 < max_attempts THEN 'queued' ELSE 'failed' END,
        run_at = CASE WHEN attempts + 1 < max_attempts
                      THEN now() + (interval '1 second' * power(2, attempts) * 5)
                      ELSE run_at END,
        error = $2,
        updated_at = now()
      WHERE id = $1
    `, [id, message]);
  },

  async getJob(id) {
    const res = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    return res.rows[0];
  },

  /** Enqueue, or return the existing job if the key was seen before (idempotent). */
  async enqueueJob(idempotencyKey, payload) {
    const res = await pool.query(`
      INSERT INTO jobs (idempotency_key, payload)
      VALUES ($1, $2)
      ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING *, (xmax = 0) AS inserted
    `, [idempotencyKey, JSON.stringify(payload)]);
    return res.rows[0];
  }
};
