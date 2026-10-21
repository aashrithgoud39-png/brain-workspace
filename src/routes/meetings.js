const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireManager } = require('../middleware/auth');

const SELECT = `
  SELECT m.id, m.title, to_char(m.date, 'YYYY-MM-DD') AS date, to_char(m.time, 'HH24:MI') AS time,
         m.link, h.name AS host,
         COALESCE(array_agg(pu.name ORDER BY pu.name) FILTER (WHERE pu.id IS NOT NULL), '{}') AS participants
  FROM meetings m
  JOIN users h ON h.id = m.host_id
  LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
  LEFT JOIN users pu ON pu.id = mp.user_id`;

// Managers see the meetings they host; employees see meetings they're invited to (or open ones)
router.get('/', async (req, res) => {
  const where = req.user.role === 'manager'
    ? 'WHERE m.host_id = $1'
    : `WHERE NOT EXISTS (SELECT 1 FROM meeting_participants x WHERE x.meeting_id = m.id)
          OR EXISTS (SELECT 1 FROM meeting_participants x WHERE x.meeting_id = m.id AND x.user_id = $1)`;
  const { rows } = await pool.query(`${SELECT} ${where} GROUP BY m.id, h.name ORDER BY m.date, m.time`, [req.user.id]);
  res.json({ meetings: rows });
});

router.post('/', requireManager, async (req, res) => {
  const { title, date, time, participants = [] } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 120) return res.status(400).json({ error: 'A title (max 120 chars) is required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Valid date and time are required' });
  if (!Array.isArray(participants) || participants.length > 50) return res.status(400).json({ error: 'Invalid participants' });

  // Resolve invited names -> user ids; refuse unknown names so a typo can't turn a private meeting into an open one
  const names = participants.map((p) => String(p).trim()).filter(Boolean);
  let userIds = [];
  if (names.length) {
    const found = await pool.query(
      "SELECT id, name FROM users WHERE role = 'employee' AND lower(name) = ANY($1::text[])", [names.map((n) => n.toLowerCase())]);
    const known = new Set(found.rows.map((r) => r.name.toLowerCase()));
    const unknown = names.filter((n) => !known.has(n.toLowerCase()));
    if (unknown.length) return res.status(400).json({ error: `Unknown employee(s): ${unknown.join(', ')}` });
    userIds = found.rows.map((r) => r.id);
  }

  const link = `https://meet.jit.si/brain-${crypto.randomBytes(6).toString('hex')}`; // real, free video room
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query(
      'INSERT INTO meetings (title, date, time, link, host_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [title.trim(), date, time, link, req.user.id]);
    for (const uid of userIds) {
      await client.query('INSERT INTO meeting_participants (meeting_id, user_id) VALUES ($1,$2)', [m.rows[0].id, uid]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: m.rows[0].id });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const { rowCount } = await pool.query('DELETE FROM meetings WHERE id = $1 AND host_id = $2', [id, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: 'Meeting not found' });
  res.json({ ok: true });
});

module.exports = router;
