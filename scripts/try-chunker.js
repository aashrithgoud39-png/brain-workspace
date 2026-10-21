// Quick check that the chunker splits text sensibly. Run it with:  node scripts/try-chunker.js
const { chunkText } = require('../src/chunker');

const words = (s) => s.split(/\s+/).filter(Boolean).length;

// Build a long sample: 30 numbered sentences of about 12 words each.
const long = Array.from({ length: 30 }, (_, i) =>
  `Sentence number ${i + 1} explains one small part of the company leave policy in detail.`
).join(' ');

const short = 'Submit a PTO request through the HR portal at least 5 working days in advance.';

const longChunks = chunkText(long);
const shortChunks = chunkText(short);
const emptyChunks = chunkText('   ');

console.log(`Long text: ${words(long)} words -> ${longChunks.length} chunks`);
longChunks.forEach((c, i) => {
  console.log(`  chunk ${i + 1}: ${words(c)} words, starts "${c.slice(0, 40)}..."`);
});
console.log(`Short text -> ${shortChunks.length} chunk(s)`);
console.log(`Empty text -> ${emptyChunks.length} chunk(s)`);

const tooBig = longChunks.some((c) => words(c) > 170);
const ok =
  longChunks.length >= 2 &&
  !tooBig &&
  shortChunks.length === 1 &&
  shortChunks[0] === short &&
  emptyChunks.length === 0;

console.log(ok ? 'PASS: the chunker behaves as expected.' : 'FAIL: copy this output and send it to me.');