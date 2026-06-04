let settings  = null;
let allEntries = [];
let weekOffset = 0; // 0 = current week, -1 = last week, etc.

async function init() {
  settings   = await getSettings();
  allEntries = await getEntries();
  applyTheme(settings.theme);
  render();
  bindEvents();
}

function getWeekRange(offset) {
  const now  = new Date();
  const dow  = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday, end: sunday };
}

function render() {
  const { start, end } = getWeekRange(weekOffset);
  const startStr = formatDate(start);
  const endStr   = formatDate(end);

  // Period label
  const label = document.getElementById('periodLabel');
  if (weekOffset === 0) {
    label.textContent = '今週';
  } else {
    const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`;
    label.textContent = `${fmt(start)} 〜 ${fmt(end)}`;
  }

  // Filter entries for this week
  const weekEntries = allEntries.filter(e => e.date >= startStr && e.date <= endStr);

  // Billing-period entries (use same 締め日 logic as popup)
  const billingDay   = settings?.billingDay || 1;
  const now2         = new Date();
  const periodStart  = now2.getDate() >= billingDay
    ? new Date(now2.getFullYear(), now2.getMonth(), billingDay)
    : new Date(now2.getFullYear(), now2.getMonth() - 1, billingDay);
  const periodStartStr = formatDate(periodStart);
  const periodEntries  = allEntries.filter(e => e.date >= periodStartStr);

  renderPieChart(weekEntries);
  renderDayList(weekEntries, start);
  renderTable(weekEntries, periodEntries);
  renderTagReport(weekEntries);
}

// ── Pie Chart ──

function renderPieChart(entries) {
  const clientMap = Object.fromEntries((settings.clients || []).map(c => [c.id, c]));
  const byClient  = {};

  entries.forEach(e => {
    byClient[e.clientId] = (byClient[e.clientId] || 0) + (e.duration || 0);
  });

  const totalMs = Object.values(byClient).reduce((s, v) => s + v, 0);
  document.getElementById('chartTotal').textContent = `合計 ${formatDurationShort(totalMs)}`;

  const svg    = document.getElementById('pieChart');
  const legend = document.getElementById('chartLegend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  if (totalMs === 0) {
    svg.innerHTML = `<circle cx="100" cy="100" r="70" fill="rgba(0,0,0,0.06)"/>
      <text x="100" y="108" text-anchor="middle" font-size="13" fill="rgba(0,0,0,0.3)">データなし</text>`;
    return;
  }

  const cx = 100, cy = 100, r = 70;
  let startAngle = -Math.PI / 2;
  const entries2 = Object.entries(byClient).sort((a, b) => b[1] - a[1]);

  entries2.forEach(([clientId, ms]) => {
    const client  = clientMap[clientId] || { name: clientId, color: '#A6B5A5' };
    const pct     = ms / totalMs;
    const angle   = pct * 2 * Math.PI;
    const endAngle = startAngle + angle;

    if (pct === 1) {
      // Full circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', client.color);
      svg.appendChild(circle);
    } else {
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const large = angle > Math.PI ? 1 : 0;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z`);
      path.setAttribute('fill', client.color);
      svg.appendChild(path);
    }

    // Legend item
    const pctStr = Math.round(pct * 100);
    const item   = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-dot" style="background:${escapeHtml(client.color)}"></span>
      <span class="legend-name">${escapeHtml(client.name)}</span>
      <span class="legend-time">${formatDurationShort(ms)}</span>
      <span class="legend-pct">${pctStr}%</span>
    `;
    legend.appendChild(item);

    startAngle = endAngle;
  });

  // Center hole — use theme base so it blends with the card background
  const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hole.setAttribute('cx', cx);
  hole.setAttribute('cy', cy);
  hole.setAttribute('r', 38);
  hole.setAttribute('fill', settings?.theme?.base || '#FFFFFF');
  svg.appendChild(hole);
}

// ── Day List ──

function renderDayList(weekEntries, weekStart) {
  const list = document.getElementById('dayList');
  const days = ['月', '火', '水', '木', '金', '土', '日'];
  const clientMap = Object.fromEntries((settings.clients || []).map(c => [c.id, c]));

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d    = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dStr = formatDate(d);
    const dayEntries = weekEntries.filter(e => e.date === dStr);
    const dayMs  = dayEntries.reduce((s, e) => s + (e.duration || 0), 0);
    const isToday = dStr === todayStr();

    html += `<div class="day-row${isToday ? ' today' : ''}">
      <div class="day-head">
        <span class="day-name">${days[i]}<span class="day-date">${d.getMonth() + 1}/${d.getDate()}</span></span>
        <span class="day-total">${dayMs > 0 ? formatDurationShort(dayMs) : '—'}</span>
      </div>`;

    if (dayEntries.length > 0) {
      html += '<div class="day-entries">';
      dayEntries.forEach(e => {
        const client = clientMap[e.clientId] || { name: e.clientId, color: '#A6B5A5' };
        const tags   = (e.tags || []).map(t => `<span class="entry-tag">${escapeHtml(t)}</span>`).join('');
        html += `
          <div class="entry-row" data-entry-id="${escapeHtml(e.id)}" title="クリックして編集">
            <span class="entry-dot" style="background:${escapeHtml(client.color)}"></span>
            <span class="entry-client">${escapeHtml(client.name)}</span>
            <span class="entry-time-range">${e.startTimeStr || ''}〜${e.endTimeStr || ''}</span>
            <span class="entry-tags">${tags}</span>
            <span class="entry-dur">${formatDurationShort(e.duration)}</span>
            <span class="entry-edit-icon">✎</span>
          </div>`;
      });
      html += '</div>';
    }

    html += '</div>';
  }
  list.innerHTML = html;

  list.querySelectorAll('.entry-row[data-entry-id]').forEach(el => {
    el.addEventListener('click', () => openEditModal(el.dataset.entryId));
  });
}

// ── Summary Table ──

function renderTable(weekEntries, monthEntries) {
  const tbody  = document.getElementById('reportTableBody');
  const clients = settings.clients || [];

  tbody.innerHTML = clients.map(c => {
    const weekMs  = weekEntries.filter(e => e.clientId === c.id).reduce((s, e) => s + (e.duration || 0), 0);
    const monthMs = monthEntries.filter(e => e.clientId === c.id).reduce((s, e) => s + (e.duration || 0), 0);

    let goalCell = '—';
    if (c.monthlyGoalHours > 0) {
      const pct = Math.round(monthMs / (c.monthlyGoalHours * 3600000) * 100);
      const bar = `<div class="mini-bar"><div class="mini-fill" style="width:${Math.min(100,pct)}%"></div></div>`;
      goalCell  = `${bar}<span>${pct}%</span>`;
    }

    return `
      <tr>
        <td>
          <span class="t-dot" style="background:${escapeHtml(c.color)}"></span>
          ${escapeHtml(c.name)}
        </td>
        <td>${formatDurationShort(weekMs)}</td>
        <td>${formatDurationShort(monthMs)}</td>
        <td class="goal-cell">${goalCell}</td>
      </tr>
    `;
  }).join('');
}

// ── Tag Report ──

function renderTagReport(weekEntries) {
  const section = document.getElementById('tagSection');
  const report  = document.getElementById('tagReport');
  const byTag   = {};

  weekEntries.forEach(e => {
    (e.tags || []).forEach(t => {
      byTag[t] = (byTag[t] || 0) + (e.duration || 0);
    });
  });

  const tags = Object.entries(byTag).sort((a, b) => b[1] - a[1]);
  if (!tags.length) { section.hidden = true; return; }
  section.hidden = false;

  const total = tags.reduce((s, [, ms]) => s + ms, 0);
  report.innerHTML = tags.map(([tag, ms]) => {
    const pct = Math.round(ms / total * 100);
    return `
      <div class="tag-bar-row">
        <span class="tag-label">${escapeHtml(tag)}</span>
        <div class="tag-bar-track">
          <div class="tag-bar-fill" style="width:${pct}%;background:var(--accent)"></div>
        </div>
        <span class="tag-dur">${formatDurationShort(ms)}</span>
      </div>
    `;
  }).join('');
}

// ── Entry Edit Modal ──

let editingEntryId = null;
let editTagSelected = [];

function openEditModal(entryId) {
  const entry  = allEntries.find(e => e.id === entryId);
  if (!entry) return;

  editingEntryId = entryId;
  editTagSelected = [...(entry.tags || [])];

  // Date badge
  document.getElementById('editDateBadge').textContent = entry.date;

  // Times
  document.getElementById('editStartTime').value = entry.startTimeStr || '';
  document.getElementById('editEndTime').value   = entry.endTimeStr   || '';

  // Client dropdown
  const sel = document.getElementById('editClient');
  sel.innerHTML = (settings.clients || []).map(c =>
    `<option value="${escapeHtml(c.id)}"${c.id === entry.clientId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
  ).join('');

  // Tags
  renderEditTagChips();

  // Note
  document.getElementById('editNote').value = entry.note || '';

  // Duration preview
  updateDurationPreview();

  document.getElementById('editModalOverlay').hidden = false;
}

function renderEditTagChips() {
  const container = document.getElementById('editTagGroup');
  const chips     = document.getElementById('editTagChips');
  const clientId  = document.getElementById('editClient').value;
  const client    = (settings?.clients || []).find(c => c.id === clientId);
  const tags      = client?.tags || [];

  container.hidden = tags.length === 0;
  chips.innerHTML  = tags.map(t => `
    <button class="edit-tag-chip${editTagSelected.includes(t) ? ' selected' : ''}"
            data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
  `).join('');

  chips.querySelectorAll('.edit-tag-chip').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      if (editTagSelected.includes(tag)) {
        editTagSelected = editTagSelected.filter(t => t !== tag);
      } else {
        editTagSelected.push(tag);
      }
      renderEditTagChips();
    });
  });
}

function updateDurationPreview() {
  const startVal = document.getElementById('editStartTime').value;
  const endVal   = document.getElementById('editEndTime').value;
  const preview  = document.getElementById('durationPreview');

  if (!startVal || !endVal) { preview.textContent = '—'; return; }

  const [sh, sm] = startVal.split(':').map(Number);
  const [eh, em] = endVal.split(':').map(Number);
  let diffMin = (eh * 60 + em) - (sh * 60 + sm);
  if (diffMin < 0) diffMin += 24 * 60; // past midnight

  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  preview.textContent = `${h}:${String(m).padStart(2, '0')}`;
  preview.classList.toggle('warn', diffMin <= 0);
}

async function saveEditedEntry() {
  const startVal = document.getElementById('editStartTime').value;
  const endVal   = document.getElementById('editEndTime').value;
  const clientId = document.getElementById('editClient').value;
  const note     = document.getElementById('editNote').value.trim();

  if (!startVal || !endVal) return;

  const entry = allEntries.find(e => e.id === editingEntryId);
  if (!entry) return;

  // Parse times using the entry's original date
  const [sh, sm] = startVal.split(':').map(Number);
  const [eh, em] = endVal.split(':').map(Number);
  const [dy, dm, dd] = entry.date.split('-').map(Number);
  const startTs  = new Date(dy, dm - 1, dd, sh, sm, 0).getTime();
  let   endTs    = new Date(dy, dm - 1, dd, eh, em, 0).getTime();
  if (endTs <= startTs) endTs += 24 * 60 * 60 * 1000; // next day

  const duration = endTs - startTs;
  if (duration < 60000) { return; } // < 1 min, ignore

  // Update entry
  entry.clientId    = clientId;
  entry.startTime   = startTs;
  entry.endTime     = endTs;
  entry.startTimeStr = startVal;
  entry.endTimeStr  = endVal;
  entry.duration    = duration;
  entry.tags        = [...editTagSelected];
  entry.note        = note;

  // Persist
  const entries = await getEntries();
  const idx = entries.findIndex(e => e.id === editingEntryId);
  if (idx !== -1) entries[idx] = entry;
  await chrome.storage.local.set({ entries });

  allEntries = entries;
  closeEditModal();
  render();
}

async function deleteEntry() {
  if (!confirm('この記録を削除しますか？')) return;
  const entries = await getEntries();
  const updated = entries.filter(e => e.id !== editingEntryId);
  await chrome.storage.local.set({ entries: updated });
  allEntries = updated;
  closeEditModal();
  render();
}

function closeEditModal() {
  document.getElementById('editModalOverlay').hidden = true;
  editingEntryId  = null;
  editTagSelected = [];
}

// ── Events ──

function bindEvents() {
  document.getElementById('prevBtn').addEventListener('click', () => { weekOffset--; render(); });
  document.getElementById('nextBtn').addEventListener('click', () => { weekOffset++; render(); });
  document.getElementById('invoiceBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('invoice.html') });
  });

  document.getElementById('editSaveBtn').addEventListener('click', saveEditedEntry);
  document.getElementById('editDeleteBtn').addEventListener('click', deleteEntry);
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEditModal();
  });

  document.getElementById('editStartTime').addEventListener('input', updateDurationPreview);
  document.getElementById('editEndTime').addEventListener('input', updateDurationPreview);
  document.getElementById('editClient').addEventListener('change', () => {
    editTagSelected = [];
    renderEditTagChips();
  });
}

init();
