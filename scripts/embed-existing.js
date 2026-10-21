// Indexes every document already in the database (safe to run again at any time).
// Run it with:  npm run embed
require('dotenv').config();
const { pool } = require('../src/db');
const { indexDocument } = require('../src/indexer');

(async () => {
  const { rows } = await pool.query('SELECT id, title, content FROM documents ORDER BY id');
  console.log(`Found ${rows.length} document(s). The first run loads the model, so give it a moment...`);

  let done = 0;
  let failed = 0;
  for (const doc of rows) {
    try {
      const count = await indexDocument(doc.id, doc.content);
      console.log(`  OK   #${doc.id} "${doc.title}": ${count} chunk(s)`);
      done++;
    } catch (err) {
      console.log(`  FAIL #${doc.id} "${doc.title}": ${err.message}`);
      failed++;
    }
  }

  console.log(`Finished: ${done} indexed, ${failed} failed.`);
  await pool.end();
})().catch((err) => {
  console.error('The backfill failed:', err.message);
  process.exit(1);
});