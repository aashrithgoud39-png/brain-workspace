// Turns text into a 384-number "meaning fingerprint" (an embedding).
// The model is small and free, and it runs inside this Node process: no API key,
// and the text never leaves your server.
//
// @huggingface/transformers is an ES module, so this CommonJS project loads it with
// a dynamic import() instead of require().
const path = require('path');

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMENSIONS = 384; // must match vector(384) in schema.sql

let extractorPromise = null;

// The model loads once, the first time it is needed, and is then reused.
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.join(__dirname, '..', '.model-cache'); // downloaded model files are kept here
      // q8 = a compressed version of the model: smaller download, less memory.
      // Always use the same setting for documents and questions, or results get inconsistent.
      return pipeline('feature-extraction', MODEL, { dtype: 'q8' });
    })().catch((err) => {
      extractorPromise = null; // allow a retry if the download failed
      throw err;
    });
  }
  return extractorPromise;
}

// texts: array of strings  ->  array of embeddings (each one is an array of 384 numbers)
async function embed(texts) {
  const extractor = await getExtractor();
  const result = [];
  for (let i = 0; i < texts.length; i += 16) { // small batches keep memory use low
    const batch = texts.slice(i, i + 16);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    result.push(...tensor.tolist());
  }
  return result;
}

async function embedOne(text) {
  return (await embed([text]))[0];
}

module.exports = { embed, embedOne, DIMENSIONS, MODEL };