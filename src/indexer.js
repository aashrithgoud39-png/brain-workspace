const { pool } = require('./db');
const { chunkText } = require('./chunker');
const { embed } = require('./embeddings');

const toVector = (numbers) => '[' + numbers.join(',') + ']';

async function indexDocument(documentId, text) {
  const chunks = chunkText(text);

  // The title is added to the text that gets embedded (not to the stored passage),
  // so a question like "money back" can match a document titled "refund policy".
  const found = await pool.query('SELECT title FROM documents WHERE id = $1', [documentId]);
  const title = found.rows.length ? found.rows[0].title : '';
  const vectors = chunks.length ? await embed(chunks.map((c) => title + '. ' + c)) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [documentId, i, chunks[i], toVector(vectors[i])]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return chunks.length;
}

module.exports = { indexDocument };