window.PAGE_ROLE = 'manager';

/* ---------- upload: files go to the server, which extracts text and indexes it ---------- */
const MAX_BYTES = 5 * 1024 * 1024;
const dropzone = byId('dropzone');
byId('file-input').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
['dragover', 'dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.toggle('dragover', evt === 'dragover');
    if (evt === 'drop') uploadFiles(e.dataTransfer.files);
  });
});
function setPill(row, cls, text, title) {
  const pill = row.querySelector('.status-pill');
  pill.className = 'status-pill ' + cls;
  pill.textContent = text;
  if (title) pill.title = title;
  if (cls === 'failed') pill.style.cssText = 'background:#F6E6E6;color:#B94A4A;';
}
async function uploadFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const [visibility, team] = byId('upload-visibility').value.split(':');
  const form = new FormData();
  form.append('visibility', visibility);
  if (team) form.append('team', team);

  const rows = [];
  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `<div><div class="f-name">${escapeHtml(f.name)}</div><div class="f-meta">${(f.size / 1024).toFixed(0)} KB</div></div><span class="status-pill processing">indexing…</span>`;
    byId('file-list').prepend(row);
    if (f.size > MAX_BYTES) { setPill(row, 'failed', 'too large', 'Files must be under 5 MB'); return; }
    rows.push({ row, file: f });
    form.append('files', f);
  });
  if (!rows.length) return;

  try {
    const { results } = await api('/documents', { method: 'POST', form });
        results.forEach((r, i) => {
      if (r.status !== 'indexed') { setPill(rows[i].row, 'failed', 'failed', r.error); return; }
      if (r.warning) {
        setPill(rows[i].row, 'indexed', 'saved, keyword only', r.warning);
        rows[i].row.querySelector('.status-pill').style.cssText = 'background:#FBF0DA;color:#B7791F;';
        const note = document.createElement('div');
        note.className = 'f-meta';
        note.style.color = '#B7791F';
        note.textContent = r.warning;
        rows[i].row.firstElementChild.appendChild(note);
      } else {
        setPill(rows[i].row, 'indexed', 'indexed');
      }
    });
    const ok = results.filter((r) => r.status === 'indexed' && !r.warning).length;
    const warned = results.filter((r) => r.warning).length;
    showToast(warned
      ? `${ok} of ${results.length} file(s) indexed, ${warned} saved without meaning-based search`
      : `${ok} of ${results.length} file(s) indexed`);
  } catch (e) {
    rows.forEach(({ row }) => setPill(row, 'failed', 'failed', e.message));
    showToast(e.message);
  }
}

/* ---------- employee table ---------- */
let employees = [];
let pendingDelete = null;
async function loadEmployees() {
  try { employees = (await api('/employees')).employees; } catch (e) { return; }
  renderEmployees();
}
function renderEmployees() {
  byId('employee-tbody').innerHTML = employees.map((e) => `
    <tr>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.team)}</td>
      <td><span class="access-tag ${e.access}">${e.access}</span></td>
      <td>
        <button class="status-row ${e.active ? 'online' : 'offline'}" onclick="toggleStatus(${e.id})" title="Click to mark as ${e.active ? 'inactive' : 'active'}">
          <span class="status-dot"></span>${e.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td><button class="del-btn" onclick="askDelete(${e.id})">Delete profile</button></td>
    </tr>`).join('') || '<tr><td colspan="5" style="color:var(--ink-faint);">No employees.</td></tr>';
}
async function toggleStatus(id) {
  const emp = employees.find((e) => e.id === id);
  try {
    await api(`/employees/${id}/status`, { method: 'PATCH', body: { active: !emp.active } });
    showToast(`${emp.name} marked as ${emp.active ? 'inactive' : 'active'}`);
  } catch (e) { showToast(e.message); }
  loadEmployees();
  refreshContacts();
}
function askDelete(id) {
  pendingDelete = id;
  byId('modal-title').textContent = `Delete ${employees.find((e) => e.id === id).name}'s profile?`;
  byId('modal-overlay').classList.add('open');
}
function closeModal() { byId('modal-overlay').classList.remove('open'); pendingDelete = null; }
async function confirmDelete() {
  const id = pendingDelete;
  closeModal();
  try {
    const { deleted } = await api('/employees/' + id, { method: 'DELETE' });
    showToast(`${deleted}'s profile was deleted`);
  } catch (e) { showToast(e.message); }
  loadEmployees();
  refreshContacts();
}

/* ---------- meetings: managers create / cancel ---------- */
function renderMeetingList() {
  const box = byId('meeting-list');
  if (!meetings.length) { box.innerHTML = '<div class="meeting-empty">No meetings scheduled yet — create one above.</div>'; return; }
  box.innerHTML = meetings.map((m) => `
    <div class="meeting-item">
      <div class="mi-top">
        <div>
          <div class="mi-title">${escapeHtml(m.title)}</div>
          <div class="mi-when">${fmtMeetingWhen(m)}</div>
          ${m.participants.length ? `<div class="mi-people">Invited: ${m.participants.map(escapeHtml).join(', ')}</div>` : '<div class="mi-people">Open to all employees</div>'}
        </div>
      </div>
      <div class="mi-actions">
        <button class="btn-join" onclick="joinMeeting(${m.id})">Join meeting</button>
        <button class="btn-cancel-meeting" onclick="cancelMeeting(${m.id})">Cancel meeting</button>
      </div>
    </div>`).join('');
}
function joinMeeting(id) {
  const m = meetings.find((x) => x.id === id);
  if (!m) return;
  window.open(m.link, '_blank', 'noopener');
  showToast(`Joining "${m.title}"…`);
}
async function createMeeting(e) {
  e.preventDefault();
  const raw = byId('mt-participants').value.trim();
  const body = {
    title: byId('mt-title').value.trim(),
    date: byId('mt-date').value,
    time: byId('mt-time').value,
    participants: raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [],
  };
  try {
    await api('/meetings', { method: 'POST', body });
  } catch (err) { showToast(err.message); return false; }   // e.g. "Unknown employee(s): ..." — keep the form filled in
  byId('meeting-form').reset();
  await refreshMeetings();
  showToast(`"${body.title}" scheduled`);
  return false;
}
async function cancelMeeting(id) {
  const m = meetings.find((x) => x.id === id);
  try { await api('/meetings/' + id, { method: 'DELETE' }); } catch (e) { showToast(e.message); return; }
  await refreshMeetings();
  if (m) showToast(`"${m.title}" cancelled`);
}

window.pageInit = loadEmployees;
window.pagePoll = loadEmployees;     // presence changes as people sign in and out