const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { pool } = require('../db');
const { indexDocument } = require('../indexer');
const { requireManager } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 } });
const MAX_CHARS = 200000; // a tsvector can't exceed ~1 MB, so cap indexed text

async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (['.txt', '.md', '.csv'].includes(ext)) return file.buffer.toString('utf8');
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: file.buffer });
    try { return (await parser.getText()).text.replace(/^-- \d+ of \d+ --$/gm, ''); } finally { await parser.destroy(); }
  }
  throw new Error('Unsupported file type (use PDF, DOCX, CSV, TXT or MD)');
}

router.get('/', requireManager, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, source, visibility, team, created_at FROM documents ORDER BY created_at DESC LIMIT 200`);
  res.json({ documents: rows });
});

// multipart/form-data: files[] plus visibility (org | team | managers) and team (when visibility=team)
router.post('/', requireManager, upload.array('files', 10), async (req, res) => {
  const visibility = ['org', 'team', 'managers'].includes(req.body.visibility) ? req.body.visibility : 'org';
  const team = visibility === 'team' ? String(req.body.team || req.user.team).slice(0, 50) : null;
  const results = [];
  for (const file of req.files || []) {
    try {
      const text = (await extractText(file)).replace(/\u0000/g, '').trim().slice(0, MAX_CHARS);
      if (!text) throw new Error('No readable text found in this file');
              const { rows } = await pool.query(
        'INSERT INTO documents (title, source, content, visibility, team, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [path.basename(file.originalname, path.extname(file.originalname)), 'Uploaded file', text, visibility, team, req.user.id]);
      const result = { name: file.originalname, status: 'indexed' };
      try {
        await indexDocument(rows[0].id, text);
      } catch (embedErr) {
        // The document is saved and keyword search works; only meaning-based search is missing.
        console.error('Embedding failed for document', rows[0].id, embedErr.message);
        result.warning = 'Saved, but meaning-based search is not ready for this file yet. Run "npm run embed" to retry.';
      }
      results.push(result);
    } catch (e) {
      results.push({ name: file.originalname, status: 'failed', error: e.message });
    }
  }
  res.status(201).json({ results });
});

router.delete('/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const { rowCount } = await pool.query('DELETE FROM documents WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'Document not found' });
  res.json({ ok: true });
});

module.exports = router;
