const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { databaseUrl } = require('./config');

// Hosted Postgres (Neon, Supabase...) puts sslmode=require in the URL; pg honours it.
const pool = new Pool({ connectionString: databaseUrl });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, migrate };
