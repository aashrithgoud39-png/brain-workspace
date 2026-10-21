const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { port } = require('./config');
const { pool } = require('./db');
const { seed } = require('./seed');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.set('trust proxy', 1); // Render/Railway sit behind a proxy; needed for correct IPs in rate limiting

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],      // the pages use inline handlers (onclick=...)
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(500).json({ ok: false }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', requireAuth);                       // everything below needs a valid session
app.use('/api/employees', require('./routes/employees'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/search', require('./routes/search'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {                  // last-resort error handler
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (5 MB max)' });
  res.status(500).json({ error: 'Something went wrong on the server' });
});

(async () => {
  const seeded = await seed();                      // creates tables; loads demo data only if the DB is empty
  if (seeded) console.log('Loaded demo data');
  app.listen(port, () => console.log(`Brain running on http://localhost:${port}`));
})().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
