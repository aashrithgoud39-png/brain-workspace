const router = require('express').Router();
const { pool } = require('../db');

const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// Contact list: everyone else, with presence and the latest message of each conversation
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.role, u.active,
            m.text AS last_text, m.created_at AS last_ts, (m.sender_id = $1) AS last_mine
     FROM users u
     LEFT JOIN LATERAL (
       SELECT text, created_at, sender_id FROM messages
       WHERE (sender_id = $1 AND recipient_id = u.id) OR (sender_id = u.id AND recipient_id = $1)
       ORDER BY created_at DESC, id DESC LIMIT 1
     ) m ON true
     WHERE u.id <> $1
     ORDER BY m.created_at DESC NULLS LAST, u.name`, [req.user.id]);
  res.json({
    contacts: rows.map((r) => ({
      id: r.id, name: r.name, role: r.role, active: r.active,
      last: r.last_text ? { text: r.last_text, mine: r.last_mine, ts: r.last_ts } : null,
    })),
  });
});

// Conversation with one person (latest 200 messages, oldest first)
router.get('/:id', async (req, res) => {
  const other = parseId(req.params.id);
  if (!other) return res.status(400).json({ error: 'Invalid id' });
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT id, (sender_id = $1) AS mine, text, created_at AS ts FROM messages
       WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC, id DESC LIMIT 200
     ) t ORDER BY ts, id`, [req.user.id, other]);
  res.json({ messages: rows });
});

router.post('/:id', async (req, res) => {
  const other = parseId(req.params.id);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!other || other === req.user.id) return res.status(400).json({ error: 'Invalid recipient' });
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Message must be 1–2000 characters' });
  const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [other]);
  if (!exists.rowCount) return res.status(404).json({ error: 'Recipient not found' });
  const { rows } = await pool.query(
    'INSERT INTO messages (sender_id, recipient_id, text) VALUES ($1,$2,$3) RETURNING id, text, created_at AS ts',
    [req.user.id, other, text]);
  res.status(201).json({ message: { ...rows[0], mine: true } });
});

module.exports = router;
