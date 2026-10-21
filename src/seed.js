// Demo data. Runs automatically on first start (empty DB); `npm run seed` wipes and reloads it.
const bcrypt = require('bcryptjs');
const { pool, migrate } = require('./db');
const { indexDocument } = require('./indexer');

const DEMO_PASSWORD = 'demo1234';

const USERS = [
  ['AK-1042', 'Aisha Khan', 'Support', 'employee', 'view', true],
  ['MN-1043', 'Meera Nair', 'Support', 'employee', 'view', true],
  ['DP-1044', 'Devon Park', 'Payments', 'employee', 'edit', false],
  ['SO-1045', 'Sam Okafor', 'Payments', 'employee', 'edit', false],
  ['RI-2001', 'Rohan Iyer', 'Payments', 'manager', 'edit', true],
];

// [title, source, content, visibility, team]
const DOCS = [
  ['Enterprise refund policy', 'Policy doc · Finance/Drive',
    'Enterprise plans qualify for a full refund within 30 days of the annual invoice, prorated after that. Refund requests are filed through the billing queue and approved by finance.', 'org', null],
  ['PTO request process', 'HR handbook · Wiki',
    'Submit a PTO request through the HR portal at least 5 working days in advance for approval. Your manager receives a notification and responds within two working days.', 'org', null],
  ['Incident #482 summary', 'Tickets',
    'Payments outage traced to a queue backlog; owned by the Payments on-call team. Customer-facing impact lasted 42 minutes and checkout retries recovered automatically.', 'org', null],
  ['Owner: R. Iyer', 'Chat',
    'R. Iyer confirmed as on-call lead for the payments outage owner rotation and filed the postmortem.', 'managers', null],
  ['Q3 forecast summary', 'Finance/Drive',
    'Q3 revenue tracked 8% above forecast, driven by mid-enterprise renewals. Finance forecast figures are restricted to managers.', 'managers', null],
  ['Support escalation playbook', 'Team wiki — Support',
    'Escalate to tier two when a ticket breaches the response SLA or involves a payment dispute. Tag the on-call manager for severity one incidents.', 'team', 'Support'],
  ['Onboarding guide: your first week', 'Onboarding guides',
    'Week one covers account setup, shadowing a senior teammate, and reading the team wiki. Ask your manager for access to additional spaces.', 'org', null],
  ['Payments on-call runbook', 'Team wiki — Payments',
    'When the payments queue backs up, page the on-call engineer, pause retries, and drain the dead-letter queue. The outage owner coordinates communication.', 'team', 'Payments'],
];

async function seed({ reset = false } = {}) {
  await migrate();
  if (reset) await pool.query('TRUNCATE users, documents, messages, meetings, meeting_participants RESTART IDENTITY CASCADE');
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return false;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {};
  for (const [login, name, team, role, access, active] of USERS) {
    const r = await pool.query(
      'INSERT INTO users (login_id, name, team, role, access, active, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [login, name, team, role, access, active, hash]);
    ids[login] = r.rows[0].id;
  }
  for (const [title, source, content, visibility, team] of DOCS) {
    const r = await pool.query(
      'INSERT INTO documents (title, source, content, visibility, team, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [title, source, content, visibility, team, ids['RI-2001']]);
    try {
      await indexDocument(r.rows[0].id, content);
    } catch (err) {
      console.error('Could not index "' + title + '":', err.message, '(run "npm run embed" later)');
    }
  }
  await pool.query('INSERT INTO messages (sender_id, recipient_id, text) VALUES ($1,$2,$3)',
    [ids['RI-2001'], ids['AK-1042'], 'Welcome to Brain! Ping me here if you can’t find something.']);
  return true;
}

module.exports = { seed };

if (require.main === module) {
  seed({ reset: process.argv.includes('--reset') })
    .then((did) => { console.log(did ? 'Seeded demo data.' : 'Users already exist — nothing seeded.'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}