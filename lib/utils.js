function formatDuration(ms) {
  if (!ms || ms < 0) return '0:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDurationShort(ms) {
  if (!ms || ms < 0) return '0:00';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function todayStr() {
  return formatDate(new Date());
}

function monthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function uuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getElapsedMs(timerState) {
  if (!timerState || timerState.status === 'idle') return 0;
  const now = Date.now();
  let elapsed = now - timerState.startTime - (timerState.breakDuration || 0);
  if (timerState.status === 'break' && timerState.breakStartTime) {
    elapsed -= (now - timerState.breakStartTime);
  }
  return Math.max(0, elapsed);
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--base', theme.base);
  root.style.setProperty('--text', theme.text);
  const { r, g, b } = hexToRgb(theme.accent);
  root.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  const { r: tr, g: tg, b: tb } = hexToRgb(theme.text);
  root.style.setProperty('--text-rgb', `${tr},${tg},${tb}`);
}
