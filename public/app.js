/* Shared client code for employee.html and manager.html.
   All data now comes from the backend API — nothing is stored in localStorage except the theme. */

const MUTED = 'color:var(--ink-faint);font-size:13.5px;padding:6px 2px;';
const byId = (id) => document.getElementById(id);

/* ---------- API helper ---------- */
async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) { location.href = 'login.html'; throw new Error('Not signed in'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ---------- small utilities ---------- */
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function initials(name) { return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
function timeAgo(ts) {
  const m = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd';
}
function showToast(msg) {
  const t = byId('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- theme (the one thing that stays in localStorage) ---------- */
const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg>';
function applyThemeIcon() {
  const btn = byId('theme-toggle-btn');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark ? SUN_ICON : MOON_ICON;
  btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('brain-theme', 'light'); }
  else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('brain-theme', 'dark'); }
  applyThemeIcon();
}
applyThemeIcon();

/* ---------- session ---------- */
let ME = null;
async function loadMe() {
  ME = (await api('/auth/me')).user;
  byId('user-name').textContent = ME.name;
  byId('user-avatar').textContent = initials(ME.name);
  const meta = byId('user-meta');
  if (meta) meta.textContent = `${ME.team} · ${ME.role === 'manager' ? 'Manager' : 'Employee'}`;
}
async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { /* redirect anyway */ }
  location.href = 'login.html';
}

/* ---------- search ---------- */
let searchSeq = 0;
function fillAndRun(chip) { byId('q-input').value = chip.textContent; runSearch(); }
async function runSearch() {
  const q = byId('q-input').value.trim();
  const box = byId('results');
  if (!q) return;
  const seq = ++searchSeq;                       // ignore out-of-order responses
  const isManager = ME && ME.role === 'manager';
  box.innerHTML = `<div style="${MUTED}" class="mono">${isManager ? 'retrieving across all sources…' : 'searching within your permissions…'}</div>`;
  let r;
  try { r = await api('/search?q=' + encodeURIComponent(q)); }
  catch (e) { if (seq === searchSeq) box.innerHTML = `<div style="${MUTED}">Search failed: ${escapeHtml(e.message)}</div>`; return; }
  if (seq !== searchSeq) return;

  const hiddenNote = r.hidden > 0
    ? `<div class="hidden-note">${r.hidden} additional result${r.hidden > 1 ? 's' : ''} hidden — outside your team's access.</div>` : '';
  if (!r.items.length) {
    box.innerHTML = `<div style="${MUTED}">${isManager
      ? 'No matching sources found. Try rephrasing.'
      : 'No matching sources found within your access. Try rephrasing, or ask your manager if this should be visible to you.'}</div>${hiddenNote}`;
    return;
  }
  // everything from the API is escaped: uploaded documents are user-generated content
  box.innerHTML = '<div class="result-list">' + r.items.map((it) =>
    `<div class="result-item"><div class="r-head"><span class="r-title">${escapeHtml(it.title)}</span><span class="r-source">${escapeHtml(it.source)}</span></div><p>${escapeHtml(it.snippet || '')}</p></div>`
  ).join('') + '</div>' + hiddenNote;
}

/* ---------- chat ---------- */
let contacts = [];
let activeContact = null;
let threadSig = '';

async function refreshContacts() {
  try { contacts = (await api('/chat')).contacts; } catch (e) { return; }
  if (!activeContact) renderContactList();
}
function renderContactList() {
  byId('chat-sidebar').classList.remove('thread-open');
  byId('chat-panel-title').textContent = 'Messages';
  const term = (byId('chat-search-input').value || '').trim().toLowerCase();
  const list = contacts.filter((c) => !term || c.name.toLowerCase().includes(term));
  byId('chat-contact-list').innerHTML = list.map((c) => {
    const preview = c.last ? (c.last.mine ? 'You: ' : '') + escapeHtml(c.last.text) : (c.active ? 'Online' : 'Offline');
    return `<div class="chat-contact-item" onclick="openThread(${c.id})">
      <div class="avatar">${initials(c.name)}</div>
      <div class="cc-info">
        <div class="cc-name">${escapeHtml(c.name)}<span class="cc-dot" style="background:${c.active ? '#2FAE60' : '#C6CCD8'};"></span></div>
        <div class="cc-preview">${preview}</div>
      </div>
      ${c.last ? `<div class="cc-meta">${timeAgo(c.last.ts)}</div>` : ''}
    </div>`;
  }).join('') || '<div class="chat-empty">No contacts yet.</div>';
}
function openThread(id) {
  activeContact = contacts.find((c) => c.id === id);
  if (!activeContact) return;
  threadSig = '';
  byId('chat-sidebar').classList.add('thread-open');
  byId('chat-panel-title').textContent = activeContact.name;
  byId('chat-thread').innerHTML = '';
  renderThread(true);
  setTimeout(() => byId('chat-input').focus(), 50);
}
function closeThread() {
  activeContact = null;
  renderContactList();
  refreshContacts();
}
async function renderThread(force) {
  if (!activeContact) return;
  const id = activeContact.id;
  let msgs;
  try { msgs = (await api('/chat/' + id)).messages; } catch (e) { return; }
  if (!activeContact || activeContact.id !== id) return;       // user switched away while loading
  const sig = msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].id : 0);
  if (!force && sig === threadSig) return;                      // nothing new — don't disturb scrolling
  threadSig = sig;
  const box = byId('chat-thread');
  box.innerHTML = msgs.length
    ? msgs.map((m) => {
        const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="chat-bubble ${m.mine ? 'me' : 'them'}">${escapeHtml(m.text)}<span class="cb-time">${time}</span></div>`;
      }).join('')
    : '<div class="chat-empty">No messages yet — say hi 👋</div>';
  box.scrollTop = box.scrollHeight;
}
async function sendChatMessage() {
  const input = byId('chat-input');
  const text = input.value.trim();
  if (!text || !activeContact) return;
  input.value = '';
  try { await api('/chat/' + activeContact.id, { method: 'POST', body: { text } }); }
  catch (e) { input.value = text; showToast(e.message); return; }
  renderThread(true);
}

/* ---------- meetings (shared bits; each page defines its own renderMeetingList) ---------- */
let meetings = [];
let meetingSig = '';
function fmtMeetingWhen(m) {
  const d = new Date(m.date + 'T' + m.time);
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
async function refreshMeetings() {
  let list;
  try { list = (await api('/meetings')).meetings; } catch (e) { return; }
  const sig = JSON.stringify(list);
  if (sig === meetingSig) return;
  meetingSig = sig;
  meetings = list;
  const badge = byId('meeting-badge');
  badge.textContent = meetings.length;
  badge.classList.toggle('show', meetings.length > 0);
  if (byId('meeting-modal-overlay').classList.contains('open')) renderMeetingList();
}
function openMeetingModal() { renderMeetingList(); byId('meeting-modal-overlay').classList.add('open'); }
function closeMeetingModal() { byId('meeting-modal-overlay').classList.remove('open'); }

/* ---------- boot ---------- */
async function boot() {
  try { await loadMe(); } catch (e) { return; }
  if (window.PAGE_ROLE && ME.role !== window.PAGE_ROLE) {       // e.g. an employee opening manager.html
    location.replace(ME.role === 'manager' ? 'manager.html' : 'employee.html');
    return;
  }
  byId('q-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  byId('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });
  byId('chat-search-input').addEventListener('input', renderContactList);

  await Promise.all([refreshContacts(), refreshMeetings(), window.pageInit ? window.pageInit() : null]);
  setInterval(() => {                                           // light polling keeps chat/meetings/presence fresh
    if (document.hidden) return;
    activeContact ? renderThread() : refreshContacts();
    refreshMeetings();
    if (window.pagePoll) window.pagePoll();
  }, 5000);
}
document.addEventListener('DOMContentLoaded', boot);