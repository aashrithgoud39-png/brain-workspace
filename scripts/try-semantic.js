require('dotenv').config();
const { pool } = require('../src/db');
const { embed } = require('../src/embeddings');

(async () => {
  const question = process.argv.slice(2).join(' ');
  if (!question) {
    console.log('Usage: node scripts/try-semantic.js "your question"');
    await pool.end();
    return;
  }
  const [vec] = await embed([question]);
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.visibility,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM document_chunks c JOIN documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1::vector
     LIMIT 8`,
    ['[' + vec.join(',') + ']']);
  console.log('Question: "' + question + '"');
  for (const r of rows) {
    console.log(Number(r.similarity).toFixed(3) + '  #' + r.id + ' ' + r.title + ' (' + r.visibility + ')');
  }
  await pool.end();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});