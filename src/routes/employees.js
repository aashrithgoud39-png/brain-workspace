const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireManager } = require('../middleware/auth');

const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// Manager console: employee table
router.get('/', requireManager, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, team, access, active FROM users WHERE role = 'employee' ORDER BY name");
  res.json({ employees: rows });
});

router.post('/', requireManager, async (req, res) => {
  const { loginId, name, team, access = 'view', password } = req.body || {};
  if (![loginId, name, team, password].every((v) => typeof v === 'string' && v.trim())) {
    return res.status(400).json({ error: 'loginId, name, team and password are required' });
  }
  if (!['view', 'edit'].includes(access)) return res.status(400).json({ error: 'access must be view or edit' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (login_id, name, team, role, access, password_hash)
       VALUES ($1,$2,$3,'employee',$4,$5) RETURNING id, name, team, access, active`,
      [loginId.trim(), name.trim(), team.trim(), access, hash]);
    res.status(201).json({ employee: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That ID is already taken' });
    throw e;
  }
});

router.patch('/:id/status', requireManager, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id || typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Invalid request' });
  const { rows } = await pool.query(
    "UPDATE users SET active = $1 WHERE id = $2 AND role = 'employee' RETURNING id, name, active", [req.body.active, id]);
  if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
  res.json({ employee: rows[0] });
});

router.delete('/:id', requireManager, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const { rows } = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'employee' RETURNING name", [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
  res.json({ deleted: rows[0].name });
});

module.exports = router;
