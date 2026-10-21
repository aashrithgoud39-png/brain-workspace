// Quick check that the embedding model works. Run it with:  node scripts/try-embedding.js
// It does not touch the database or the server.
const { embed, DIMENSIONS } = require('../src/embeddings');

// The embeddings are already normalized, so a plain dot product is the cosine similarity.
// Closer to 1 = more similar in meaning.
const similarity = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

(async () => {
  const started = Date.now();
  console.log('Loading the model (the first run downloads it, so this can take a minute)...');

  const [question, ptoSentence, outageSentence] = await embed([
    'How do I ask for time off work?',
    'Submit a PTO request through the HR portal at least 5 working days in advance.',
    'Payments outage traced to a queue backlog.',
  ]);

  const toPto = similarity(question, ptoSentence);
  const toOutage = similarity(question, outageSentence);

  console.log('');
  console.log(`Embedding size: ${question.length} numbers (expected ${DIMENSIONS})`);
  console.log(`"time off" question vs PTO sentence:    ${toPto.toFixed(3)}`);
  console.log(`"time off" question vs outage sentence: ${toOutage.toFixed(3)}`);
  console.log(
    question.length === DIMENSIONS && toPto > toOutage
      ? 'PASS: the model matched by meaning, even though the two sentences share no important words.'
      : 'FAIL: something is off. Copy this output and send it to me.'
  );
  console.log(`Time: ${((Date.now() - started) / 1000).toFixed(1)} seconds`);
})().catch((err) => {
  console.error('The embedding step failed:', err.message);
  process.exit(1);
});