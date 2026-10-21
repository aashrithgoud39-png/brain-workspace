window.PAGE_ROLE = 'employee';

// Employees can view and join meetings, not create them
function renderMeetingList() {
  const box = byId('meeting-list');
  if (!meetings.length) { box.innerHTML = '<div class="meeting-empty">No meetings scheduled yet.</div>'; return; }
  box.innerHTML = meetings.map((m) => `
    <div class="meeting-item">
      <div class="mi-top">
        <div>
          <div class="mi-title">${escapeHtml(m.title)}</div>
          <div class="mi-when">${fmtMeetingWhen(m)}</div>
          <div class="mi-people">Hosted by ${escapeHtml(m.host)}</div>
        </div>
      </div>
      <div class="mi-actions">
        <button class="btn-join" onclick="joinMeeting(${m.id})">Join meeting</button>
      </div>
    </div>`).join('');
}
function joinMeeting(id) {
  const m = meetings.find((x) => x.id === id);
  if (!m) return;
  window.open(m.link, '_blank', 'noopener');
  showToast(`Joining "${m.title}"…`);
}
