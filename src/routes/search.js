const router = require('express').Router();
const { pool } = require('../db');
const { embed } = require('../embeddings');

// A document counts as a meaning-based match only if its best passage scores at least this.
// On the demo data, unrelated questions score under 0.05 and related ones 0.25 or more.
const MIN_SIMILARITY = 0.25;
// Reciprocal rank fusion constant: standard value for merging two ranked lists.
const RRF_K = 60;

const shorten = (s) => (s.length > 240 ? s.slice(0, 240).trimEnd() + '...' : s);

// Keyword search with permissions applied IN THE QUERY, so restricted documents
// never reach the browser. Employees only get a count of what was hidden from them.
// Terms are OR-ed (then ranked) so natural questions like "What's our refund policy?" still match.
const KEYWORD_SQL = `
  WITH q AS (
    SELECT to_tsquery('english', replace(plainto_tsquery('english', $1)::text, '&', '|')) AS tsq
  ), matches AS (
    SELECT d.id, d.title, d.source, d.content, q.tsq, ts_rank(d.search, q.tsq) AS rank,
           (d.visibility = 'org' OR $2::boolean OR (d.visibility = 'team' AND d.team = $3)) AS allowed
    FROM documents d, q
    WHERE d.search @@ q.tsq
    ORDER BY rank DESC
    LIMIT 50
  )
  SELECT id, title, source, allowed,
         CASE WHEN allowed THEN ts_headline('english', content, tsq, 'MaxWords=32, MinWords=16, StartSel="", StopSel=""') END AS snippet
  FROM matches
  ORDER BY rank DESC`;

// Meaning-based search: nearest passages by cosine distance. The permission rule is the
// same as above and is read from the parent document. The passage text is only selected
// when the person is allowed to see the document.
const SEMANTIC_SQL = `
  SELECT d.id, d.title, d.source,
         1 - (c.embedding <=> $1::vector) AS similarity,
         (d.visibility = 'org' OR $2::boolean OR (d.visibility = 'team' AND d.team = $3)) AS allowed,
         CASE WHEN (d.visibility = 'org' OR $2::boolean OR (d.visibility = 'team' AND d.team = $3))
              THEN c.content END AS passage
  FROM document_chunks c
  JOIN documents d ON d.id = c.document_id
  ORDER BY c.embedding <=> $1::vector
  LIMIT 30`;

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return res.json({ items: [], hidden: 0 });
  const isManager = req.user.role === 'manager';
  const team = req.user.team;

  const keywordRows = (await pool.query(KEYWORD_SQL, [q, isManager, team])).rows;

  // If the embedding model cannot run, keyword search still works on its own.
  const semanticRows = [];
  try {
    const [vec] = await embed([q]);
    const result = await pool.query(SEMANTIC_SQL, ['[' + vec.join(',') + ']', isManager, team]);
    const seen = new Set();
    for (const r of result.rows) {
      if (Number(r.similarity) < MIN_SIMILARITY) break; // sorted, so the rest are lower
      if (seen.has(r.id)) continue; // keep only the best passage per document
      seen.add(r.id);
      semanticRows.push(r);
    }
  } catch (err) {
    console.error('Semantic search unavailable:', err.message);
  }

  // Merge the two ranked lists (reciprocal rank fusion): documents found by both rank higher.
  const merged = new Map();
  const add = (row, rank, snippet) => {
    const entry = merged.get(row.id) ||
      { id: row.id, title: row.title, source: row.source, allowed: row.allowed, snippet: null, score: 0 };
    entry.score += 1 / (RRF_K + rank);
    if (!entry.snippet && snippet) entry.snippet = snippet;
    merged.set(row.id, entry);
  };
  keywordRows.forEach((r, i) => add(r, i + 1, r.snippet));
  semanticRows.forEach((r, i) => add(r, i + 1, r.passage ? shorten(r.passage) : null));

  const all = [...merged.values()].sort((a, b) => b.score - a.score);
  res.json({
    items: all.filter((r) => r.allowed).slice(0, 10).map(({ title, source, snippet }) => ({ title, source, snippet })),
    hidden: all.filter((r) => !r.allowed).length,
  });
});

module.exports = router;