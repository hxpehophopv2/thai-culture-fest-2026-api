/**
 * ROOTED 2026 — Admin Dashboard
 * ─────────────────────────────
 * SPA for on-site event management
 */

// ─── Login (server-side auth) ────────────────────────

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();

    if (data.ok && data.data?.token) {
      sessionStorage.setItem('rooted_admin_token', data.data.token);
      document.getElementById('login-screen').style.display = 'none';
      errEl.style.display = 'none';
      navigate('dashboard');
    } else {
      errEl.style.display = 'block';
      document.getElementById('login-pass').value = '';
      document.getElementById('login-pass').focus();
    }
  } catch {
    errEl.style.display = 'block';
  }
}

function checkAuth() {
  const token = sessionStorage.getItem('rooted_admin_token');
  if (token) {
    document.getElementById('login-screen').style.display = 'none';
    return true;
  }
  return false;
}

// ─── API Helper ──────────────────────────────────────
async function api(method, path, body) {
  const token = sessionStorage.getItem('rooted_admin_token');
  const headers = { 'X-Admin-Token': token || '' };
  const opts = { method, headers };
  // Fastify requires Content-Type + non-empty body for POST/PATCH/DELETE
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, opts);
  const data = await res.json();
  // If 401 → session expired, force re-login
  if (res.status === 401) {
    sessionStorage.removeItem('rooted_admin_token');
    document.getElementById('login-screen').style.display = 'flex';
    throw new Error('Session expired — please login again');
  }
  if (!data.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}

// ─── Navigation ──────────────────────────────────────
let currentPage = 'dashboard';

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.getElementById(`page-${page}`)?.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));

  const loaders = { dashboard: loadDashboard, participants: () => loadParticipants(1), live: loadLive, boothcodes: loadBoothCodes };
  loaders[page]?.();
  lucide.createIcons();
}

// ─── Toast ───────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Modal ───────────────────────────────────────────
function openModal(title, bodyHtml, footerHtml = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml;
  document.getElementById('modal-overlay').classList.add('open');
  lucide.createIcons();
}
function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal-overlay').classList.remove('open');
}

// ─── Dashboard ───────────────────────────────────────
let capacityChart = null;

async function loadDashboard() {
  try {
    const { data: d } = await api('GET', '/api/admin/dashboard');

    document.getElementById('dashboard-stats').innerHTML = `
      <div class="stat-card accent">
        <div class="label">Total Registered</div>
        <div class="value">${d.event.totalRegistered}</div>
        <div class="sub">Participants: ${d.event.participants} · Students: ${d.event.students}</div>
      </div>
      <div class="stat-card success">
        <div class="label">Attended</div>
        <div class="value">${d.event.uniqueAttendees}</div>
        <div class="sub">Attendance rate: ${d.event.attendanceRate}%</div>
      </div>
      <div class="stat-card warning">
        <div class="label">Not Yet Arrived</div>
        <div class="value">${d.event.notYetArrived}</div>
        <div class="sub">Walk-ins: ${d.event.walkins}</div>
      </div>
      <div class="stat-card info">
        <div class="label">Total Stamps</div>
        <div class="value">${d.checkin.checkedIn}</div>
        <div class="sub">Total scans: ${d.checkin.totalScans}</div>
      </div>
    `;

    // Render secondary stats (bookings + capacity)
    const secondaryEl = document.getElementById('dashboard-secondary');
    if (secondaryEl) {
      secondaryEl.innerHTML = `
        <div class="stat-card" style="border-left:3px solid #8b5cf6">
          <div class="label">Confirmed Bookings</div>
          <div class="value">${d.bookings.confirmed}</div>
          <div class="sub">Cancelled: ${d.bookings.cancelled}</div>
        </div>
        <div class="stat-card" style="border-left:3px solid #ec4899">
          <div class="label">Session Seats Left</div>
          <div class="value">${d.capacity.remainingSeats}</div>
          <div class="sub">Booked: ${d.capacity.totalBooked} / ${d.capacity.totalSeats} total seats</div>
        </div>
      `;
    }

    // Load live data for chart
    try {
      const { data: activities } = await api('GET', '/api/admin/activities/live');
      renderCapacityChart(activities);
      renderAttendanceDonut(d);
    } catch (_) { /* no activities yet */ }

    lucide.createIcons();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderCapacityChart(activities) {
  const ctx = document.getElementById('chart-capacity');
  if (!ctx) return;
  if (capacityChart) capacityChart.destroy();

  const labels = activities.map(a => a.nameTh || a.name);
  const booked = activities.map(a => a.totalBooked);
  const remaining = activities.map(a => a.totalRemaining);
  const checkedIn = activities.map(a => a.totalCheckedIn);

  capacityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Booked', data: booked, backgroundColor: '#3b82f6', borderRadius: 4 },
        { label: 'Remaining', data: remaining, backgroundColor: '#e5e7eb', borderRadius: 4 },
        { label: 'Checked In', data: checkedIn, backgroundColor: '#10b981', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, usePointStyle: true, pointStyle: 'circle' } }
      },
      scales: {
        x: { stacked: false, grid: { display: false }, ticks: { font: { family: 'Inter', size: 11 } } },
        y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { font: { family: 'Inter', size: 11 } } }
      }
    }
  });
}

let attendanceChart = null;

function renderAttendanceDonut(d) {
  const ctx = document.getElementById('chart-attendance');
  if (!ctx) return;
  if (attendanceChart) attendanceChart.destroy();

  attendanceChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Attended', 'Not Arrived', 'Walk-ins'],
      datasets: [{
        data: [
          Math.max(0, d.event.uniqueAttendees - d.event.walkins),
          d.event.notYetArrived,
          d.event.walkins
        ],
        backgroundColor: ['#10b981', '#e5e7eb', '#f59e0b'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 12 }, usePointStyle: true, pointStyle: 'circle', padding: 16 } }
      }
    }
  });
}

// ─── Participants ────────────────────────────────────
let searchTimeout;
function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadParticipants(1), 400);
}

async function loadParticipants(page = 1) {
  const search = document.getElementById('participant-search')?.value || '';
  try {
    const { data, pagination } = await api('GET', `/api/admin/participants?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
    const tbody = document.getElementById('participants-tbody');

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty"><div class="icon"><i data-lucide="search-x" style="width:40px;height:40px"></i></div><p>No participants found</p></div></td></tr>';
      lucide.createIcons();
      return;
    }

    tbody.innerHTML = data.map(p => {
      const activities = p.bookings?.map(b => b.session?.activity?.nameTh).filter(Boolean).join(', ') || '—';
      return `<tr>
        <td><strong>${esc(p.firstName)} ${esc(p.lastName)}</strong></td>
        <td>${esc(p.nickname) || '—'}</td>
        <td>${esc(p.phoneNumber) || '—'}</td>
        <td><span class="badge badge-info">${esc(p.participantType)}</span></td>
        <td class="truncate" title="${esc(activities)}">${esc(activities)}</td>
        <td class="flex gap-2">
          <button class="btn btn-outline btn-xs" onclick="viewParticipant('${p.id}')"><i data-lucide="eye" style="width:12px;height:12px"></i> View</button>
          <button class="btn btn-outline btn-xs" onclick="openEditModal('${p.id}')"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>
          <button class="btn btn-outline btn-xs" onclick="regenQr('participant','${p.id}')"><i data-lucide="qr-code" style="width:12px;height:12px"></i></button>
        </td>
      </tr>`;
    }).join('');

    if (pagination) {
      const pgEl = document.getElementById('participants-pagination');
      const pages = [];
      for (let i = 1; i <= Math.min(pagination.totalPages, 10); i++) {
        pages.push(`<button class="btn ${i === pagination.page ? 'btn-primary' : 'btn-outline'} btn-xs" onclick="loadParticipants(${i})">${i}</button>`);
      }
      pgEl.innerHTML = `<span class="text-sm text-muted">${pagination.total} total</span> ${pages.join('')}`;
    }
    lucide.createIcons();
  } catch (err) { toast(err.message, 'error'); }
}

async function viewParticipant(id) {
  try {
    const { data: p } = await api('GET', `/api/admin/participants/${id}`);
    const bookingsHtml = p.bookings?.length
      ? p.bookings.map(b => `<tr>
          <td class="font-mono">${b.id.slice(0,8)}…</td>
          <td>${b.session?.activity?.nameTh || '—'}</td>
          <td>${fmt(b.session?.startTime)} – ${fmt(b.session?.endTime)}</td>
          <td><span class="badge ${b.status === 'CONFIRMED' ? 'badge-success' : 'badge-danger'}">${b.status}</span></td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="text-muted">No bookings</td></tr>';

    const scansHtml = p.scanLogs?.length
      ? p.scanLogs.slice(0, 10).map(s => `<tr>
          <td>${fmt(s.scannedAt)}</td>
          <td>${s.actualActivity?.nameTh || '—'}</td>
          <td><span class="badge ${resultBadge(s.result)}">${s.result}</span></td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No scan logs</td></tr>';

    openModal(`${esc(p.firstName)} ${esc(p.lastName)}`, `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.85rem;margin-bottom:16px">
        <div><span class="text-muted">Nickname:</span> ${esc(p.nickname)}</div>
        <div><span class="text-muted">Type:</span> ${esc(p.participantType)}</div>
        <div><span class="text-muted">Phone:</span> ${esc(p.phoneNumber)}</div>
        <div><span class="text-muted">Email:</span> ${esc(p.email)}</div>
        <div><span class="text-muted">Org:</span> ${esc(p.organization)}</div>
        <div><span class="text-muted">ID:</span> <span class="font-mono">${p.id.slice(0,12)}…</span></div>
      </div>
      <h4 style="margin-bottom:8px">Bookings</h4>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Activity</th><th>Time</th><th>Status</th></tr></thead><tbody>${bookingsHtml}</tbody></table></div>
      <h4 style="margin:16px 0 8px">Scan History</h4>
      <div class="table-wrap"><table><thead><tr><th>Time</th><th>Activity</th><th>Result</th></tr></thead><tbody>${scansHtml}</tbody></table></div>
    `);
  } catch (err) { toast(err.message, 'error'); }
}

async function openEditModal(id) {
  try {
    const { data: p } = await api('GET', `/api/admin/participants/${id}`);
    openModal('Edit Participant', `
      <div class="form-group"><label>First Name</label><input type="text" id="edit-fn" value="${esc(p.firstName)}"></div>
      <div class="form-group"><label>Last Name</label><input type="text" id="edit-ln" value="${esc(p.lastName)}"></div>
      <div class="form-group"><label>Nickname</label><input type="text" id="edit-nn" value="${esc(p.nickname)}"></div>
      <div class="form-group"><label>Phone</label><input type="tel" id="edit-phone" value="${esc(p.phoneNumber)}"></div>
      <div class="form-group"><label>Email</label><input type="email" id="edit-email" value="${esc(p.email)}"></div>
    `, `<button class="btn btn-primary" onclick="saveEdit('${id}')"><i data-lucide="save" style="width:14px;height:14px"></i> Save</button>`);
  } catch (err) { toast(err.message, 'error'); }
}

async function saveEdit(id) {
  try {
    await api('PATCH', `/api/admin/participants/${id}`, {
      firstName: document.getElementById('edit-fn').value,
      lastName: document.getElementById('edit-ln').value,
      nickname: document.getElementById('edit-nn').value,
      phoneNumber: document.getElementById('edit-phone').value,
      email: document.getElementById('edit-email').value
    });
    closeModal();
    toast('Participant updated successfully');
    loadParticipants();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Walk-in ─────────────────────────────────────────
function openWalkinModal() {
  openModal('Walk-in Registration', `
    <div class="form-group"><label>First Name *</label><input type="text" id="wi-fn"></div>
    <div class="form-group"><label>Last Name *</label><input type="text" id="wi-ln"></div>
    <div class="form-group"><label>Nickname *</label><input type="text" id="wi-nn"></div>
    <div class="form-group"><label>Phone *</label><input type="tel" id="wi-phone"></div>
    <div class="form-group"><label>Email</label><input type="email" id="wi-email"></div>
    <div class="form-group"><label>Organization</label><input type="text" id="wi-org"></div>
  `, `<button class="btn btn-primary" onclick="submitWalkin()"><i data-lucide="user-plus" style="width:14px;height:14px"></i> Register</button>`);
}

async function submitWalkin() {
  try {
    const { data } = await api('POST', '/api/admin/participants/walkin', {
      firstName: document.getElementById('wi-fn').value,
      lastName: document.getElementById('wi-ln').value,
      nickname: document.getElementById('wi-nn').value,
      phoneNumber: document.getElementById('wi-phone').value,
      email: document.getElementById('wi-email').value || undefined,
      organization: document.getElementById('wi-org').value || undefined
    });
    closeModal();
    toast(`Walk-in registered: ${data.participant.firstName}`);
    if (data.qr?.dataUrl) {
      openModal('QR Code', `<div style="text-align:center"><img src="${data.qr.dataUrl}" alt="QR" style="max-width:250px;margin:10px auto"><p class="mt-2">${esc(data.participant.firstName)} ${esc(data.participant.lastName)}</p></div>`);
    }
  } catch (err) { toast(err.message, 'error'); }
}

// ─── QR Regenerate ───────────────────────────────────
async function regenQr(type, id) {
  try {
    const { data } = await api('POST', `/api/admin/qr/regenerate/${type}/${id}`);
    openModal('Regenerated QR Code', `<div style="text-align:center"><img src="${data.dataUrl}" alt="QR" style="max-width:250px;margin:10px auto"><p class="mt-2"><strong>${esc(data.person?.name ?? '')}</strong></p><p class="text-muted text-sm">${esc(data.message)}</p></div>`);
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Bookings ────────────────────────────────────────
async function searchBookings() {
  const pid = document.getElementById('booking-participant-id').value.trim();
  if (!pid) return toast('Please enter a Participant ID', 'error');
  try {
    const { data: p } = await api('GET', `/api/admin/participants/${pid}`);
    const tbody = document.getElementById('bookings-tbody');
    if (!p.bookings?.length) { tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No bookings found</td></tr>'; return; }
    tbody.innerHTML = p.bookings.map(b => `<tr>
      <td class="font-mono">${b.id.slice(0,8)}…</td>
      <td>${b.session?.activity?.nameTh || '—'}</td>
      <td>${fmt(b.session?.startTime)} – ${fmt(b.session?.endTime)}</td>
      <td><span class="badge ${b.status === 'CONFIRMED' ? 'badge-success' : 'badge-danger'}">${b.status}</span></td>
      <td>${b.status === 'CONFIRMED' ? `
        <button class="btn btn-warning btn-xs" onclick="openMoveModal('${b.id}')"><i data-lucide="move" style="width:12px;height:12px"></i> Move</button>
        <button class="btn btn-danger btn-xs" onclick="cancelBooking('${b.id}')"><i data-lucide="x" style="width:12px;height:12px"></i> Cancel</button>
      ` : ''}</td>
    </tr>`).join('');
    lucide.createIcons();
  } catch (err) { toast(err.message, 'error'); }
}

function openCreateBookingModal() {
  openModal('Create Booking', `
    <div class="form-group"><label>Participant ID</label><input type="text" id="cb-pid"></div>
    <div class="form-group"><label>Session ID</label><input type="text" id="cb-sid"></div>
  `, `<button class="btn btn-primary" onclick="createBooking()">Create</button>`);
}

async function createBooking() {
  try {
    const { data } = await api('POST', '/api/admin/bookings', {
      participantId: document.getElementById('cb-pid').value.trim(),
      sessionId: document.getElementById('cb-sid').value.trim()
    });
    closeModal(); toast(data.message);
  } catch (err) { toast(err.message, 'error'); }
}

function openForceBookingModal() {
  openModal('Force Booking (Override Capacity)', `
    <div class="form-group"><label>Participant ID</label><input type="text" id="fb-pid"></div>
    <div class="form-group"><label>Session ID</label><input type="text" id="fb-sid"></div>
    <div class="form-group"><label>Reason</label><input type="text" id="fb-reason" placeholder="Why force?"></div>
  `, `<button class="btn btn-warning" onclick="forceBooking()"><i data-lucide="zap" style="width:14px;height:14px"></i> Force</button>`);
}

async function forceBooking() {
  try {
    const { data } = await api('POST', '/api/admin/bookings/force', {
      participantId: document.getElementById('fb-pid').value.trim(),
      sessionId: document.getElementById('fb-sid').value.trim(),
      reason: document.getElementById('fb-reason').value.trim() || undefined
    });
    closeModal(); toast(data.message);
  } catch (err) { toast(err.message, 'error'); }
}

function openMoveModal(bookingId) {
  openModal('Move Booking', `
    <div class="form-group"><label>New Session ID</label><input type="text" id="mv-sid"></div>
  `, `<button class="btn btn-primary" onclick="moveBooking('${bookingId}')">Move</button>`);
}

async function moveBooking(bookingId) {
  try {
    const { data } = await api('PATCH', `/api/admin/bookings/${bookingId}/move`, { newSessionId: document.getElementById('mv-sid').value.trim() });
    closeModal(); toast(data.message); searchBookings();
  } catch (err) { toast(err.message, 'error'); }
}

async function cancelBooking(bookingId) {
  if (!confirm('Cancel this booking?')) return;
  try {
    const { data } = await api('DELETE', `/api/admin/bookings/${bookingId}`);
    toast(data.message); searchBookings();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Check-in ────────────────────────────────────────
function openForceCheckinModal() {
  openModal('Force Check-in', `
    <p class="text-muted mb-2">Stamp without QR scan (e.g. lost QR, dead battery)</p>
    <div class="form-group"><label>Participant ID</label><input type="text" id="fc-pid"></div>
    <div class="form-group"><label>Activity ID</label><input type="text" id="fc-aid"></div>
    <div class="form-group"><label>Note</label><input type="text" id="fc-note" placeholder="Reason for force check-in"></div>
  `, `<button class="btn btn-success" onclick="forceCheckin()"><i data-lucide="zap" style="width:14px;height:14px"></i> Force Stamp</button>`);
}

async function forceCheckin() {
  try {
    const { data } = await api('POST', '/api/admin/checkin/force', {
      participantId: document.getElementById('fc-pid').value.trim(),
      activityId: document.getElementById('fc-aid').value.trim(),
      note: document.getElementById('fc-note').value.trim() || undefined
    });
    closeModal(); toast(data.message);
  } catch (err) { toast(err.message, 'error'); }
}

async function loadCheckinHistory() {
  const type = document.getElementById('checkin-type').value;
  const id = document.getElementById('checkin-person-id').value.trim();
  if (!id) return toast('Please enter a UUID', 'error');
  try {
    const { data } = await api('GET', `/api/admin/checkin/history/${type}/${id}`);
    const tbody = document.getElementById('checkin-tbody');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><p>No scan history found</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = data.map(s => `<tr>
      <td>${fmt(s.scannedAt)}</td>
      <td>${esc(s.activity)}</td>
      <td><span class="badge ${resultBadge(s.result)}">${s.result}</span></td>
      <td>${s.isOverride ? '<span class="badge badge-warning">Yes</span>' : '—'}</td>
      <td class="font-mono">${(s.staffId || '').slice(0, 10)}…</td>
      <td class="truncate">${esc(s.note) || '—'}</td>
      <td>${s.result === 'checked_in' ? `<button class="btn btn-danger btn-xs" onclick="deleteStamp('${s.id}')"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>` : ''}</td>
    </tr>`).join('');
    lucide.createIcons();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteStamp(scanLogId) {
  const reason = prompt('Reason for removing this stamp:');
  if (reason === null) return;
  try {
    const { data } = await api('DELETE', `/api/admin/checkin/${scanLogId}`, { reason });
    toast(data.message); loadCheckinHistory();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Live Status ─────────────────────────────────────
async function loadLive() {
  try {
    const { data } = await api('GET', '/api/admin/activities/live');
    const grid = document.getElementById('live-grid');
    grid.innerHTML = data.map(act => {
      const pct = act.totalCapacity > 0 ? Math.round((act.totalBooked / act.totalCapacity) * 100) : 0;
      const fillClass = pct >= 90 ? 'full' : pct >= 60 ? 'mid' : 'ok';
      return `<div class="activity-card">
        <div class="name">${esc(act.nameTh || act.name)}</div>
        <div class="zone">${esc(act.zone || '—')} · ${esc(act.name)}</div>
        <div class="capacity-bar"><div class="fill ${fillClass}" style="width:${pct}%"></div></div>
        <div class="activity-stats">
          <div><div class="stat-label">Booked</div><div class="stat-val">${act.totalBooked}/${act.totalCapacity}</div></div>
          <div><div class="stat-label">Remaining</div><div class="stat-val">${act.totalRemaining}</div></div>
          <div><div class="stat-label">Checked In</div><div class="stat-val">${act.totalCheckedIn}</div></div>
        </div>
        ${act.sessions.length ? `<div class="mt-2 text-sm">${act.sessions.map(s =>
          `<div class="flex items-center gap-2" style="padding:3px 0;border-top:1px solid var(--border)">
            <span>${fmtTime(s.startTime)}–${fmtTime(s.endTime)}</span>
            <span class="badge ${s.isFull ? 'badge-danger' : 'badge-success'}">${s.booked}/${s.capacity}</span>
          </div>`).join('')}</div>` : ''}
        ${act.activeStaff.length ? `<div class="mt-2 text-sm text-muted"><i data-lucide="user" style="width:12px;height:12px;vertical-align:middle"></i> ${act.activeStaff.length} staff active</div>` : ''}
      </div>`;
    }).join('');
    lucide.createIcons();
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Sessions ────────────────────────────────────────
async function updateSession() {
  const sessionId = document.getElementById('session-id').value.trim();
  if (!sessionId) return toast('Please enter a Session ID', 'error');
  const body = {};
  const cap = document.getElementById('session-capacity').value;
  const vis = document.getElementById('session-visible').value;
  if (cap) body.capacity = parseInt(cap);
  if (vis) body.isVisible = vis === 'true';
  try {
    const { data } = await api('PATCH', `/api/admin/sessions/${sessionId}`, body);
    toast(data.message);
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Export ──────────────────────────────────────────
async function downloadCsv(type) {
  try {
    const token = sessionStorage.getItem('rooted_admin_token');
    const res = await fetch(`/api/admin/export/${type}`, {
      headers: { 'X-Admin-Token': token || '' }
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rooted_${type}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${type} exported successfully`);
  } catch (err) { toast(err.message, 'error'); }
}

// ─── Utils ───────────────────────────────────────────
function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function resultBadge(r) {
  return { checked_in:'badge-success', already_stamped:'badge-warning', wrong_base:'badge-warning', wrong_time:'badge-warning', no_booking:'badge-danger', rejected:'badge-danger' }[r] || 'badge-muted';
}
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  if (checkAuth()) {
    navigate('dashboard');
  }
  // Focus username input if login screen visible
  document.getElementById('login-user')?.focus();
});

// ─── Booth Codes ─────────────────────────────────────
async function loadBoothCodes() {
  try {
    const { data } = await api('GET', '/api/admin/booth-codes');
    const tbody = document.getElementById('boothcodes-tbody');
    tbody.innerHTML = data.map(a => `
      <tr>
        <td><strong>${esc(a.nameTh)}</strong><br><small style="color:#71717a">${esc(a.name)}</small></td>
        <td><span class="badge badge-${a.zone === 'LAB' ? 'info' : 'warning'}">${a.zone}</span></td>
        <td>
          ${a.boothCode
            ? `<code style="font-size:1.1rem;font-weight:700;letter-spacing:2px;color:#22c55e;background:rgba(34,197,94,0.1);padding:4px 10px;border-radius:6px">${esc(a.boothCode)}</code>`
            : '<span style="color:#71717a">— ยังไม่มี —</span>'
          }
        </td>
        <td>
          <div class="flex gap-1">
            <button class="btn btn-primary btn-sm" onclick="genBoothCode('${a.id}')">${a.boothCode ? '🔄 ใหม่' : '🔑 สร้าง'}</button>
            ${a.boothCode ? `<button class="btn btn-danger btn-sm" onclick="delBoothCode('${a.id}')">🗑️ ลบ</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
    lucide.createIcons();
  } catch (err) { toast(err.message, 'error'); }
}

async function genBoothCode(activityId) {
  try {
    const { data } = await api('POST', `/api/admin/booth-codes/${activityId}`);
    toast(`สร้างรหัส ${data.boothCode} สำหรับ ${data.name}`);
    loadBoothCodes();
  } catch (err) { toast(err.message, 'error'); }
}

async function delBoothCode(activityId) {
  if (!confirm('ลบรหัสฐานนี้?')) return;
  try {
    await api('DELETE', `/api/admin/booth-codes/${activityId}`);
    toast('ลบรหัสฐานแล้ว');
    loadBoothCodes();
  } catch (err) { toast(err.message, 'error'); }
}
