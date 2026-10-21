const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { jwtSecret, isProd } = require('../config');
const { requireAuth } = require('../middleware/auth');

const SESSION_MS = 8 * 60 * 60 * 1000;
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: SESSION_MS };
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps timing similar for unknown IDs

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true, // only failed attempts count
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});

const publicUser = (u) => ({ id: u.id, loginId: u.login_id, name: u.name, team: u.team, role: u.role });

router.post('/login', loginLimiter, async (req, res) => {
  const { id, password, role } = req.body || {};
  if (typeof id !== 'string' || typeof password !== 'string' || !id.trim() || !password) {
    return res.status(400).json({ error: 'Enter both an ID and a password to continue.' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(login_id) = lower($1)', [id.trim()]);
  const user = rows[0];
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk || (role && user.role !== role)) {
    return res.status(401).json({ error: 'Invalid ID, password, or role.' });
  }
  await pool.query('UPDATE users SET active = true WHERE id = $1', [user.id]);
  const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '8h' });
  res.cookie('token', token, cookieOpts).json({ user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/logout', async (req, res) => {
  try {
    const { sub } = jwt.verify(req.cookies.token, jwtSecret);
    await pool.query('UPDATE users SET active = false WHERE id = $1', [sub]);
  } catch { /* no valid session — still clear the cookie */ }
  res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: isProd }).json({ ok: true });
});

module.exports = router;
