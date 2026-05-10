// ─── ROOTED 2026 Staff Scanner ──────────────────────────
// SPA สำหรับ staff ประจำฐาน — login ด้วยรหัสฐาน → แสกน QR

const STATE = {
  staffSessionId: sessionStorage.getItem('rooted_staff_session'),
  activityName: sessionStorage.getItem('rooted_staff_activity') || '',
  activityZone: sessionStorage.getItem('rooted_staff_zone') || '',
  lastScanLogId: null,
  scanner: null,
  scanning: false
};

// ─── Init ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 400));

  // ถ้ามี session เก่า → ตรวจว่ายัง valid ไหม
  if (STATE.staffSessionId) {
    verifySession();
  }
});

// ─── API Helper ──────────────────────────────────────────

async function api(method, path, body) {
  const headers = {};
  if (STATE.staffSessionId) headers['X-Staff-Session'] = STATE.staffSessionId;
  const opts = { method, headers };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}

// ─── Login ───────────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  const code = document.getElementById('booth-code').value.trim();
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!code) { errorEl.textContent = 'กรุณากรอกรหัสฐาน'; return; }

  btn.disabled = true;
  btn.textContent = 'กำลังเข้าสู่ระบบ...';
  errorEl.textContent = '';

  try {
    const { data } = await api('POST', '/api/staff/login', { boothCode: code });
    STATE.staffSessionId = data.sessionId;
    STATE.activityName = data.activity.nameTh || data.activity.name;
    STATE.activityZone = data.activity.zone || '';

    sessionStorage.setItem('rooted_staff_session', data.sessionId);
    sessionStorage.setItem('rooted_staff_activity', STATE.activityName);
    sessionStorage.setItem('rooted_staff_zone', STATE.activityZone);

    showScanner();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'เข้าสู่ระบบ';
  }
}

async function verifySession() {
  try {
    await api('GET', '/api/staff/session/active');
    showScanner();
  } catch {
    // Session expired
    sessionStorage.removeItem('rooted_staff_session');
    STATE.staffSessionId = null;
  }
}

function handleLogout() {
  if (STATE.scanner) {
    try { STATE.scanner.stop(); } catch {}
  }
  sessionStorage.removeItem('rooted_staff_session');
  sessionStorage.removeItem('rooted_staff_activity');
  sessionStorage.removeItem('rooted_staff_zone');
  STATE.staffSessionId = null;
  STATE.scanning = false;

  document.getElementById('scanner-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
}

// ─── Scanner ─────────────────────────────────────────────

function showScanner() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('scanner-screen').classList.add('active');
  document.getElementById('activity-name').textContent = STATE.activityName;
  document.getElementById('activity-zone').textContent = STATE.activityZone;

  startCamera();
}

async function startCamera() {
  if (STATE.scanning) return;

  const resultEl = document.getElementById('scan-result');
  resultEl.classList.add('hidden');

  try {
    STATE.scanner = new Html5Qrcode('qr-reader');
    STATE.scanning = true;

    await STATE.scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      onScanSuccess,
      () => {} // ignore errors
    );
  } catch (err) {
    console.error('Camera error:', err);
    document.querySelector('.scan-hint').textContent = '⚠️ ไม่สามารถเปิดกล้องได้ — ใช้ช่องค้นหาด้านล่างแทน';
  }
}

async function onScanSuccess(qrData) {
  if (!STATE.scanning) return;

  // หยุด scanner ชั่วคราว
  STATE.scanning = false;
  try { await STATE.scanner.stop(); } catch {}

  // ส่ง scan
  try {
    const { data } = await api('POST', '/api/checkin/scan', { qrData });
    showResult(data);
  } catch (err) {
    showError(err.message);
  }
}

// ─── Scan Result ─────────────────────────────────────────

const RESULT_CONFIG = {
  checked_in:      { icon: '✅', title: 'เข้าฐานสำเร็จ', color: '#22c55e' },
  already_stamped: { icon: '⚠️', title: 'เข้าฐานนี้แล้ว', color: '#f59e0b' },
  wrong_base:      { icon: '⚠️', title: 'ผิดฐาน', color: '#f59e0b' },
  wrong_time:      { icon: '⏰', title: 'ผิดเวลา', color: '#f59e0b' },
  no_booking:      { icon: '❌', title: 'ไม่มีการจอง', color: '#ef4444' }
};

function showResult(data) {
  const el = document.getElementById('scan-result');
  const cfg = RESULT_CONFIG[data.result] || { icon: '❓', title: data.result, color: '#71717a' };

  el.classList.remove('hidden');
  el.dataset.result = data.result;

  document.getElementById('result-icon').textContent = cfg.icon;
  document.getElementById('result-title').textContent = cfg.title;
  document.getElementById('result-name').textContent = data.person.name;
  document.getElementById('result-message').textContent = data.message;

  // Show override/reject buttons for wrong_base, wrong_time, no_booking
  const actions = document.getElementById('result-actions');
  if (['wrong_base', 'wrong_time', 'no_booking'].includes(data.result)) {
    actions.classList.remove('hidden');
    STATE.lastScanLogId = data.scanLogId;
  } else {
    actions.classList.add('hidden');
  }

  // Stamp card
  renderStamps(data.stamps || []);
}

function showError(msg) {
  const el = document.getElementById('scan-result');
  el.classList.remove('hidden');
  el.dataset.result = 'error';
  document.getElementById('result-icon').textContent = '💥';
  document.getElementById('result-title').textContent = 'เกิดข้อผิดพลาด';
  document.getElementById('result-name').textContent = '';
  document.getElementById('result-message').textContent = msg;
  document.getElementById('result-actions').classList.add('hidden');
  document.getElementById('stamp-card').innerHTML = '';
}

function renderStamps(stamps) {
  const el = document.getElementById('stamp-card');
  el.innerHTML = stamps.map(s => {
    const cls = s.scannedAt ? 'done' : s.hasBooking ? 'booked' : '';
    const icon = s.scannedAt ? '✅' : s.hasBooking ? '🔄' : '⬜';
    return `<div class="stamp ${cls}"><span class="stamp-icon">${icon}</span>${esc(s.activityName.substring(0, 8))}</div>`;
  }).join('');
}

// ─── Override / Reject ───────────────────────────────────

async function doOverride() {
  if (!STATE.lastScanLogId) return;
  try {
    await api('POST', `/api/checkin/${STATE.lastScanLogId}/override`, { note: 'Staff อนุมัติ' });
    document.getElementById('result-icon').textContent = '✅';
    document.getElementById('result-title').textContent = 'อนุมัติแล้ว';
    document.getElementById('result-actions').classList.add('hidden');
  } catch (err) { alert(err.message); }
}

async function doReject() {
  if (!STATE.lastScanLogId) return;
  try {
    await api('POST', `/api/checkin/${STATE.lastScanLogId}/reject`, { note: 'Staff ปฏิเสธ' });
    document.getElementById('result-icon').textContent = '🚫';
    document.getElementById('result-title').textContent = 'ปฏิเสธแล้ว';
    document.getElementById('result-actions').classList.add('hidden');
  } catch (err) { alert(err.message); }
}

function nextScan() {
  document.getElementById('scan-result').classList.add('hidden');
  STATE.lastScanLogId = null;
  startCamera();
}

// ─── Manual Search ───────────────────────────────────────

async function handleSearch() {
  const q = document.getElementById('search-input').value.trim();
  const el = document.getElementById('search-results');
  if (q.length < 2) { el.innerHTML = ''; return; }

  try {
    const { data } = await api('GET', `/api/checkin/search?q=${encodeURIComponent(q)}`);
    const all = [
      ...data.participants.map(p => ({ ...p, label: p.org })),
      ...data.students.map(s => ({ ...s, label: s.schoolName }))
    ];

    if (all.length === 0) {
      el.innerHTML = '<p style="color:#71717a;padding:8px">ไม่พบผลลัพธ์</p>';
      return;
    }

    el.innerHTML = all.map(p =>
      `<div class="search-item" onclick="manualCheckin('${p.type}','${p.id}')">
        <div><span class="name">${esc(p.name)}</span><br><span class="org">${esc(p.label || '')}</span></div>
      </div>`
    ).join('');
  } catch { el.innerHTML = ''; }
}

async function manualCheckin(type, id) {
  // TODO: implement manual check-in via admin force endpoint
  alert(`Manual check-in: ${type}/${id} — ใช้ admin dashboard แทน`);
}

// ─── Helpers ─────────────────────────────────────────────

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function debounce(fn, ms) {
  let timer;
  return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}
