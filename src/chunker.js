// Splits a document's text into short, overlapping passages ("chunks").
// The embedding model works best on passages of about 100 to 150 words.
// A little overlap means an idea that falls on a boundary is not cut in half.

const TARGET_WORDS = 120;  // aim for about this many words per chunk
const MAX_WORDS = 150;     // never go above this
const OVERLAP_WORDS = 20;  // how many words from the end of one chunk repeat at the start of the next

const countWords = (s) => s.split(/\s+/).filter(Boolean).length;

// Break text into sentences (or lines), keeping paragraph breaks as boundaries.
function toPieces(text) {
  const pieces = [];
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const para of paragraphs) {
    const sentences = para
      .replace(/\n/g, ' ')
      .match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      // A single huge "sentence" (for example CSV rows or a table) is cut by words.
      if (countWords(trimmed) > MAX_WORDS) {
        const words = trimmed.split(/\s+/);
        for (let i = 0; i < words.length; i += TARGET_WORDS) {
          pieces.push(words.slice(i, i + TARGET_WORDS).join(' '));
        }
      } else {
        pieces.push(trimmed);
      }
    }
  }
  return pieces;
}

function chunkText(text) {
  if (!text || !text.trim()) return [];
  const pieces = toPieces(text);
  const chunks = [];
  let current = [];
  let currentWords = 0;

  for (const piece of pieces) {
    const w = countWords(piece);
    if (currentWords + w > MAX_WORDS && current.length > 0) {
      chunks.push(current.join(' '));
      // start the next chunk with the last few words of this one
      const tail = current.join(' ').split(/\s+/).slice(-OVERLAP_WORDS).join(' ');
      current = [tail];
      currentWords = countWords(tail);
    }
    current.push(piece);
    currentWords += w;
    if (currentWords >= TARGET_WORDS) {
      chunks.push(current.join(' '));
      const tail = current.join(' ').split(/\s+/).slice(-OVERLAP_WORDS).join(' ');
      current = [tail];
      currentWords = countWords(tail);
    }
  }
  // Keep the leftover, unless it is only the overlap tail that was already saved.
  if (current.length > 1 || (current.length === 1 && chunks.length === 0)) {
    chunks.push(current.join(' '));
  }
  return chunks;
}

module.exports = { chunkText };