const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { jwtSecret } = require('../config');

// Verifies the session cookie and loads the user fresh from the DB on every request,
// so a deleted employee loses access immediately instead of when their token expires.
async function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  let payload;
  try { payload = jwt.verify(token, jwtSecret); }
  catch { return res.status(401).json({ error: 'Session expired — please sign in again' }); }

  const { rows } = await pool.query(
    'SELECT id, login_id, name, team, role, access FROM users WHERE id = $1', [payload.sub]);
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' });
  req.user = rows[0];
  next();
}

function requireManager(req, res, next) {
  if (req.user.role !== 'manager') return res.status(403).json({ error: 'Managers only' });
  next();
}

module.exports = { requireAuth, requireManager };
