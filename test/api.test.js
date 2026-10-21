// Integration tests. Start the server first (npm start), then: npm test
// Uses the seeded demo accounts, so run it against a freshly seeded local database.
const { test, after } = require('node:test');
const assert = require('node:assert');
require('dotenv').config();
const { pool } = require('../src/db');

// Close the database connection when all tests are done, so the test run can finish.
after(() => pool.end());

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// Tiny HTTP client that remembers the session cookie
function client() {
  let cookie = '';
  return async (method, path, body, isForm) => {
    const headers = { cookie };
    if (body && !isForm) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: isForm ? body : body && JSON.stringify(body) });
    const set = res.headers.getSetCookie?.()[0];
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
}
async function login(id, role) {
  const c = client();
  const r = await c('POST', '/api/auth/login', { id, password: 'demo1234', role });
  assert.equal(r.status, 200);
  return c;
}

test('rejects bad credentials and wrong role', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { id: 'AK-1042', password: 'nope', role: 'employee' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { id: 'AK-1042', password: 'demo1234', role: 'manager' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { id: '', password: '' })).status, 400);
});

test('API requires a session', async () => {
  assert.equal((await client()('GET', '/api/search?q=refund')).status, 401);
});

test('employees cannot use manager endpoints', async () => {
  const emp = await login('AK-1042', 'employee');
  assert.equal((await emp('GET', '/api/employees')).status, 403);
  assert.equal((await emp('DELETE', '/api/employees/3')).status, 403);
  assert.equal((await emp('POST', '/api/meetings', { title: 'x', date: '2030-01-01', time: '10:00' })).status, 403);
  assert.equal((await emp('POST', '/api/documents', new FormData(), true)).status, 403);
});

test('search permissions: employee is scoped, manager sees everything', async () => {
  const emp = await login('AK-1042', 'employee');   // Support employee
  const mgr = await login('RI-2001', 'manager');

  const e = await emp('GET', '/api/search?q=' + encodeURIComponent('Payments outage owner'));
  assert.ok(e.data.items.some((i) => i.title.startsWith('Incident #482')));
  assert.ok(!e.data.items.some((i) => i.title.startsWith('Owner: R. Iyer')), 'managers-only doc leaked');
  assert.ok(!e.data.items.some((i) => i.title.includes('runbook')), 'other team doc leaked');
  assert.ok(e.data.hidden >= 1);
  assert.ok(e.data.items.every((i) => i.snippet && !i.snippet.includes('<')));

  const f = await emp('GET', '/api/search?q=' + encodeURIComponent('Q3 finance forecast'));
  assert.ok(!f.data.items.some((i) => i.title === 'Q3 forecast summary'), 'finance doc leaked to employee');
  assert.equal(f.data.hidden, 1);

  const m = await mgr('GET', '/api/search?q=' + encodeURIComponent('Q3 finance forecast'));
  assert.equal(m.data.items[0].title, 'Q3 forecast summary');
  assert.equal(m.data.hidden, 0);

  const mine = await emp('GET', '/api/search?q=' + encodeURIComponent('escalate SLA'));   // own team's doc
  assert.equal(mine.data.items[0].title, 'Support escalation playbook');
});

test('chat: send, read back, presence list', async () => {
  const a = await login('AK-1042', 'employee');
  const b = await login('MN-1043', 'employee');
  const contacts = (await a('GET', '/api/chat')).data.contacts;
  const meera = contacts.find((c) => c.name === 'Meera Nair');
  const aisha = (await b('GET', '/api/chat')).data.contacts.find((c) => c.name === 'Aisha Khan');
  assert.equal((await a('POST', `/api/chat/${meera.id}`, { text: 'hello from test' })).status, 201);
  const thread = (await b('GET', `/api/chat/${aisha.id}`)).data.messages;
  assert.equal(thread.at(-1).text, 'hello from test');
  assert.equal(thread.at(-1).mine, false);
  assert.equal((await a('POST', `/api/chat/${meera.id}`, { text: '   ' })).status, 400);
});

test('meetings: private vs open, unknown invitee rejected, cancel', async () => {
  const mgr = await login('RI-2001', 'manager');
  const aisha = await login('AK-1042', 'employee');
  const devon = await login('DP-1044', 'employee');

  const bad = await mgr('POST', '/api/meetings', { title: 'T', date: '2030-01-01', time: '10:00', participants: ['Nobody Here'] });
  assert.equal(bad.status, 400);

  const priv = await mgr('POST', '/api/meetings', { title: 'Private sync', date: '2030-01-01', time: '10:00', participants: ['aisha khan'] });
  const open = await mgr('POST', '/api/meetings', { title: 'All hands', date: '2030-01-02', time: '09:30' });
  assert.equal(priv.status, 201);

  const titles = async (c) => (await c('GET', '/api/meetings')).data.meetings.map((m) => m.title);
  assert.ok((await titles(aisha)).includes('Private sync'));
  assert.ok(!(await titles(devon)).includes('Private sync'));
  assert.ok((await titles(devon)).includes('All hands'));

  const m = (await mgr('GET', '/api/meetings')).data.meetings.find((x) => x.title === 'Private sync');
  assert.deepEqual(m.participants, ['Aisha Khan']);
  assert.match(m.link, /^https:\/\/meet\.jit\.si\//);
  assert.equal((await mgr('DELETE', `/api/meetings/${priv.data.id}`)).status, 200);
  assert.equal((await mgr('DELETE', `/api/meetings/${open.data.id}`)).status, 200);
});

test('manager: upload becomes searchable with the right visibility, then delete', async () => {
  const mgr = await login('RI-2001', 'manager');
  const emp = await login('AK-1042', 'employee');
  const form = new FormData();
  form.append('visibility', 'managers');
  form.append('files', new Blob(['The zebrafish migration plan is confidential.']), 'zebrafish.txt');
  form.append('files', new Blob(['x']), 'malware.exe');
  const up = await mgr('POST', '/api/documents', form, true);
  assert.equal(up.status, 201);
  assert.equal(up.data.results[0].status, 'indexed');
  assert.equal(up.data.results[1].status, 'failed');

  assert.equal((await mgr('GET', '/api/search?q=zebrafish')).data.items.length, 1);
  const hidden = (await emp('GET', '/api/search?q=zebrafish')).data;
  assert.equal(hidden.items.length, 0);
  assert.equal(hidden.hidden, 1);

  const docs = (await mgr('GET', '/api/documents')).data.documents;
  const id = docs.find((d) => d.title === 'zebrafish').id;
  assert.equal((await mgr('DELETE', `/api/documents/${id}`)).status, 200);
});

test('manager: create, toggle presence, delete employee; deleted user is locked out', async () => {
  const mgr = await login('RI-2001', 'manager');
  const created = await mgr('POST', '/api/employees', { loginId: 'TT-9999', name: 'Temp Tester', team: 'Support', password: 'longenough1' });
  assert.equal(created.status, 201);
  assert.equal((await mgr('POST', '/api/employees', { loginId: 'tt-9999', name: 'Dup', team: 'S', password: 'longenough1' })).status, 409);
  const id = created.data.employee.id;

  const temp = client();
  assert.equal((await temp('POST', '/api/auth/login', { id: 'TT-9999', password: 'longenough1', role: 'employee' })).status, 200);
  assert.equal((await mgr('PATCH', `/api/employees/${id}/status`, { active: false })).data.employee.active, false);
  assert.equal((await mgr('DELETE', `/api/employees/${id}`)).status, 200);
  assert.equal((await temp('GET', '/api/auth/me')).status, 401, 'deleted user still has access');
  assert.equal((await mgr('DELETE', '/api/employees/5')).status, 404, 'managers must not be deletable here');
});

test('semantic search: restricted passages never reach an employee', async () => {
  const emp = await login('AK-1042', 'employee'); // Support employee
  const questions = [
    'How did revenue do last quarter?',
    'How much money did we make compared to what was predicted?',
    'Who is in charge when the payments system goes down?',
    'What should I do when the payment queue is stuck?',
  ];
  const secrets = ['Q3 forecast summary', '8% above', 'postmortem', 'Owner: R. Iyer', 'dead-letter', 'Payments on-call runbook'];
  for (const q of questions) {
    const r = await emp('GET', '/api/search?q=' + encodeURIComponent(q));
    assert.equal(r.status, 200);
    const body = JSON.stringify(r.data);
    for (const secret of secrets) {
      assert.ok(!body.includes(secret), `"${secret}" leaked to an employee for: ${q}`);
    }
  }
});

test('semantic search: a time-off question finds the PTO document', async () => {
  const emp = await login('AK-1042', 'employee');
  const r = await emp('GET', '/api/search?q=' + encodeURIComponent('How do I request time off?'));
  assert.equal(r.data.items[0].title, 'PTO request process');
});

test('deleting a document also removes its chunks', async () => {
  const mgr = await login('RI-2001', 'manager');
  const form = new FormData();
  form.append('visibility', 'org');
  form.append('files', new Blob(['Chunk cleanup test document about parking permits for visitors.']), 'chunk-cleanup.txt');
  const up = await mgr('POST', '/api/documents', form, true);
  assert.equal(up.status, 201);
  assert.equal(up.data.results[0].status, 'indexed');
  assert.ok(!up.data.results[0].warning, 'embedding failed during upload');

  const docs = (await mgr('GET', '/api/documents')).data.documents;
  const id = docs.find((d) => d.title === 'chunk-cleanup').id;
  const count = async () =>
    (await pool.query('SELECT count(*)::int AS n FROM document_chunks WHERE document_id = $1', [id])).rows[0].n;

  assert.ok((await count()) >= 1, 'no chunks were created for the upload');
  assert.equal((await mgr('DELETE', `/api/documents/${id}`)).status, 200);
  assert.equal(await count(), 0, 'chunks were left behind after deleting the document');
});
