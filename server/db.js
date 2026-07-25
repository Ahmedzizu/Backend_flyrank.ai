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
  }
};