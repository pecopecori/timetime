const SWATCH_COLORS = [
  '#A6B5A5','#D99AAD','#769CBF','#CF7F72','#CD8858',
  '#D49B65','#A883A9','#9EC2C2','#AA4D53','#135389',
  '#CB5457','#28A6A5','#E97F12','#D86F87','#007A02',
];

let settings = null;
let editingClientId = null;

// ── Init ──

async function init() {
  settings = await getSettings();
  applyTheme(settings.theme);
  renderPaletteGrid();
  loadThemeColors();
  renderClientList();
  document.getElementById('providerName').value = settings.providerName || '';
  loadSheetsConfig();
  loadEarningsConfig();
  loadPomodoroConfig();
  loadIdleConfig();
  loadSlackConfig();
  loadCalendarConfig();
  loadFreetimeConfig();
  bindEvents();
}

// ── Theme ──

function renderPaletteGrid() {
  const grid = document.getElementById('paletteGrid');
  grid.innerHTML = PRESET_THEMES.map(t => `
    <div class="palette-card${settings.theme.id === t.id ? ' active' : ''}"
         data-id="${t.id}" style="background:${t.base}; color:${t.text}">
      <div class="palette-swatch">
        <span class="swatch-circle" style="background:${t.accent}"></span>
      </div>
      <div class="palette-name">${t.name}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.palette-card').forEach(el => {
    el.addEventListener('click', () => selectPreset(el.dataset.id));
  });
}

function selectPreset(id) {
  const preset = PRESET_THEMES.find(t => t.id === id);
  if (!preset) return;
  settings.theme = { ...preset };
  applyTheme(settings.theme);
  loadThemeColors();
  renderPaletteGrid();
  updatePreview();
}

function loadThemeColors() {
  document.getElementById('colorAccent').value = settings.theme.accent;
  document.getElementById('colorBase').value   = settings.theme.base;
  document.getElementById('colorText').value   = settings.theme.text;
  updatePreview();
}

function updatePreview() {
  const preview = document.getElementById('themePreview');
  const accent  = document.getElementById('colorAccent').value;
  const base    = document.getElementById('colorBase').value;
  const text    = document.getElementById('colorText').value;
  preview.style.background = base;
  preview.style.color      = text;
  preview.querySelector('.preview-dot').style.background = accent;
  preview.querySelector('.preview-btn:not(.preview-btn-ghost)').style.background = accent;
  preview.querySelector('.preview-btn.preview-btn-ghost').style.borderColor = accent + '66';
  preview.querySelector('.preview-btn.preview-btn-ghost').style.color = text;
}

function bindColorPicker(inputId, prop) {
  const input = document.getElementById(inputId);
  input.addEventListener('input', () => {
    settings.theme[prop] = input.value;
    settings.theme.id = 'custom';
    applyTheme(settings.theme);
    updatePreview();
    document.querySelectorAll('.palette-card').forEach(el => el.classList.remove('active'));
  });
}

// ── Clients ──

function renderClientList() {
  const list    = document.getElementById('clientSettingList');
  const clients = settings.clients || [];

  if (!clients.length) {
    list.innerHTML = '<p style="color:rgba(var(--text-rgb),0.4);font-size:13px;text-align:center;padding:16px 0">クライアントがいません</p>';
    return;
  }

  list.innerHTML = clients.map((c, i) => {
    const meta = [];
    if (c.hourlyRate > 0)      meta.push(`¥${c.hourlyRate.toLocaleString('ja-JP')}/h`);
    if (c.monthlyGoalHours > 0) meta.push(`目標${c.monthlyGoalHours}h`);
    const metaStr = meta.length ? `<span class="client-meta">${escapeHtml(meta.join(' · '))}</span>` : '';

    return `
      <div class="client-setting-item" data-id="${escapeHtml(c.id)}">
        <span class="client-swatch" style="background:${escapeHtml(c.color)}"></span>
        <span class="client-setting-name">${escapeHtml(c.name)}</span>
        ${metaStr}
        <button class="btn-icon" data-action="up"   data-id="${escapeHtml(c.id)}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn-icon" data-action="down" data-id="${escapeHtml(c.id)}" ${i === clients.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn-icon" data-action="edit"   data-id="${escapeHtml(c.id)}">編集</button>
        <button class="btn-icon danger" data-action="delete" data-id="${escapeHtml(c.id)}">削除</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const { action, id } = el.dataset;
      if (action === 'edit')   openModal(id);
      if (action === 'delete') deleteClient(id);
      if (action === 'up')     moveClient(id, -1);
      if (action === 'down')   moveClient(id, +1);
    });
  });
}

function openModal(clientId) {
  editingClientId = clientId || null;
  const client = clientId ? settings.clients.find(c => c.id === clientId) : null;

  document.getElementById('modalTitle').textContent = clientId ? 'クライアント編集' : 'クライアント追加';
  document.getElementById('clientNameInput').value    = client?.name  || '';
  document.getElementById('clientColorInput').value   = client?.color || '#A6B5A5';
  document.getElementById('clientHourlyRate').value   = client?.hourlyRate      || '';
  document.getElementById('clientGoalHours').value    = client?.monthlyGoalHours || '';

  renderColorSwatches(client?.color || '#A6B5A5');
  renderModalTagEditor(client?.tags || []);
  renderModalTaskEditor(client?.tasks || []);
  document.getElementById('modalOverlay').hidden = false;
  document.getElementById('clientNameInput').focus();
}

function renderColorSwatches(selected) {
  const container = document.getElementById('colorSwatches');
  container.innerHTML = SWATCH_COLORS.map(c => `
    <span class="color-swatch-btn${c === selected ? ' active' : ''}"
          style="background:${c}" data-color="${c}" tabindex="0" role="button"></span>
  `).join('');
  container.querySelectorAll('.color-swatch-btn').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('clientColorInput').value = el.dataset.color;
      container.querySelectorAll('.color-swatch-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
    });
  });
}

async function saveClient() {
  const name        = document.getElementById('clientNameInput').value.trim();
  const color       = document.getElementById('clientColorInput').value;
  const hourlyRate  = parseInt(document.getElementById('clientHourlyRate').value) || 0;
  const monthlyGoalHours = parseFloat(document.getElementById('clientGoalHours').value) || 0;
  const tags        = getModalTags();
  const tasks       = getModalTasks();

  if (!name) { document.getElementById('clientNameInput').focus(); return; }

  if (editingClientId) {
    const c = settings.clients.find(c => c.id === editingClientId);
    if (c) {
      c.name = name; c.color = color; c.hourlyRate = hourlyRate;
      c.monthlyGoalHours = monthlyGoalHours; c.tags = tags; c.tasks = tasks;
    }
  } else {
    settings.clients.push({ id: uuid(), name, color, hourlyRate, monthlyGoalHours, tags, tasks });
  }

  await saveSettings(settings);
  document.getElementById('modalOverlay').hidden = true;
  renderClientList();
  showToast('保存しました ✓');
}

async function deleteClient(id) {
  if (!confirm('このクライアントを削除しますか？')) return;
  settings.clients = settings.clients.filter(c => c.id !== id);
  await saveSettings(settings);
  renderClientList();
  showToast('削除しました');
}

async function moveClient(id, dir) {
  const idx    = settings.clients.findIndex(c => c.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= settings.clients.length) return;
  const arr = [...settings.clients];
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  settings.clients = arr;
  await saveSettings(settings);
  renderClientList();
}

// ── Sheets ──

function loadSheetsConfig() {
  document.getElementById('spreadsheetId').value = settings.spreadsheetId || '';
  document.getElementById('autoSync').checked    = settings.autoSync      || false;
}

// ── Earnings / Billing ──

function loadEarningsConfig() {
  document.getElementById('showEarnings').checked = settings.showEarnings || false;
  document.getElementById('billingDay').value     = settings.billingDay   || 1;
}

// ── Pomodoro ──

function loadPomodoroConfig() {
  const p = settings.pomodoro || {};
  document.getElementById('pomodoroEnabled').checked = p.enabled      || false;
  document.getElementById('pomoWork').value          = p.workMinutes  || 25;
  document.getElementById('pomoBreak').value         = p.breakMinutes || 5;
}

// ── Per-client tags (modal) ──

let _modalTags = [];

function getModalTags() { return [..._modalTags]; }

function renderModalTagEditor(tags) {
  _modalTags = [...tags];
  const editor = document.getElementById('modalTagEditor');

  if (!_modalTags.length) {
    editor.innerHTML = '<span style="font-size:12px;color:rgba(var(--text-rgb),0.35)">タグがありません</span>';
    return;
  }

  editor.innerHTML = _modalTags.map(t => `
    <span class="tag-pill">
      ${escapeHtml(t)}
      <button class="tag-pill-del" data-tag="${escapeHtml(t)}">×</button>
    </span>
  `).join('');

  editor.querySelectorAll('.tag-pill-del').forEach(el => {
    el.addEventListener('click', () => {
      _modalTags = _modalTags.filter(t => t !== el.dataset.tag);
      renderModalTagEditor(_modalTags);
    });
  });
}

function addModalTag() {
  const input = document.getElementById('modalNewTagInput');
  const tag   = input.value.trim();
  if (!tag) { input.focus(); return; }
  if (_modalTags.includes(tag)) {
    showToast('同じ名前のタグが既にあります');
    return;
  }
  _modalTags = [..._modalTags, tag];
  input.value = '';
  renderModalTagEditor(_modalTags);
}

// ── Per-client tasks (modal) ──

let _modalTasks = [];

function getModalTasks() { return _modalTasks.map(t => ({ ...t })); }

function renderModalTaskEditor(tasks) {
  _modalTasks = tasks.map(t => ({
    id:    t.id    || uuid(),
    title: t.title || '',
    done:  !!t.done,
  })).filter(t => t.title);
  const editor = document.getElementById('modalTaskEditor');

  if (!_modalTasks.length) {
    editor.innerHTML = '<span style="font-size:12px;color:rgba(var(--text-rgb),0.35)">タスクがありません</span>';
    return;
  }

  editor.innerHTML = _modalTasks.map(t => `
    <span class="tag-pill"${t.done ? ' style="opacity:0.5;text-decoration:line-through"' : ''}>
      ${escapeHtml(t.title)}
      <button class="tag-pill-del" data-id="${escapeHtml(t.id)}">×</button>
    </span>
  `).join('');

  editor.querySelectorAll('.tag-pill-del').forEach(el => {
    el.addEventListener('click', () => {
      _modalTasks = _modalTasks.filter(t => t.id !== el.dataset.id);
      renderModalTaskEditor(_modalTasks);
    });
  });
}

function addModalTask() {
  const input = document.getElementById('modalNewTaskInput');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  if (_modalTasks.some(t => t.title === title)) {
    showToast('同じ名前のタスクが既にあります');
    return;
  }
  _modalTasks = [..._modalTasks, { id: uuid(), title, done: false }];
  input.value = '';
  renderModalTaskEditor(_modalTasks);
}

// ── Idle ──

function loadIdleConfig() {
  const id = settings.idle || {};
  document.getElementById('idleEnabled').checked   = id.enabled          ?? true;
  document.getElementById('idleThreshold').value   = id.thresholdMinutes || 10;
}

// ── Slack ──

function loadSlackConfig() {
  const sl = settings.slack || {};
  document.getElementById('slackEnabled').checked  = sl.enabled      || false;
  document.getElementById('slackToken').value      = sl.token        || '';
  document.getElementById('slackWorkText').value   = sl.workingText  || '稼働中';
  document.getElementById('slackWorkEmoji').value  = sl.workingEmoji || ':computer:';
  document.getElementById('slackBreakText').value  = sl.breakText    || '休憩中';
  document.getElementById('slackBreakEmoji').value = sl.breakEmoji   || ':coffee:';
}

// ── Calendar ──

function loadCalendarConfig() {
  const cal = settings.calendar || {};
  document.getElementById('calendarEnabled').checked       = cal.enabled       || false;
  document.getElementById('calendarTitleTemplate').value   = cal.titleTemplate || '⏱ {client}｜{note}';
  document.getElementById('calendarAutoColor').checked     = cal.autoColor     ?? true;
  // Seed the dropdown with the currently-saved id so the value survives reload
  // even before the user fetches the full calendar list.
  const select = document.getElementById('calendarId');
  const savedId = cal.calendarId || 'primary';
  if (savedId !== 'primary' && !Array.from(select.options).some(o => o.value === savedId)) {
    const opt = document.createElement('option');
    opt.value = savedId;
    opt.textContent = savedId;
    select.appendChild(opt);
  }
  select.value = savedId;
}

function loadFreetimeConfig() {
  const ft = settings.freetime || {};
  document.getElementById('freetimeStartHour').value     = ft.startHour      ?? 10;
  document.getElementById('freetimeEndHour').value       = ft.endHour        ?? 18;
  document.getElementById('freetimeMinSlot').value       = ft.minSlotMinutes ?? 30;
  document.getElementById('freetimeDaysAhead').value     = ft.daysAhead      ?? 7;
  document.getElementById('freetimeWeekdaysOnly').checked = ft.weekdaysOnly  ?? true;
}

async function loadCalendarList() {
  const btn = document.getElementById('loadCalendarsBtn');
  const select = document.getElementById('calendarId');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = '取得中…';
  try {
    const calendars = await listCalendars();
    if (!calendars.length) {
      showToast('書き込み可能なカレンダーが見つかりませんでした');
      return;
    }
    const currentValue = select.value;
    select.innerHTML = calendars.map(c => {
      const label = c.primary ? `${c.summary}（メイン）` : c.summary;
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    // Restore selection if still present, else default to primary
    const found = calendars.find(c => c.id === currentValue);
    select.value = found ? currentValue : (calendars.find(c => c.primary)?.id || calendars[0].id);
    showToast(`${calendars.length}件のカレンダーを取得しました`);
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// ── Save ──

async function saveAll() {
  settings.providerName  = document.getElementById('providerName').value.trim();
  settings.spreadsheetId = document.getElementById('spreadsheetId').value.trim();
  settings.autoSync      = document.getElementById('autoSync').checked;
  settings.showEarnings  = document.getElementById('showEarnings').checked;
  settings.billingDay    = parseInt(document.getElementById('billingDay').value) || 1;

  settings.pomodoro = {
    enabled:     document.getElementById('pomodoroEnabled').checked,
    workMinutes:  parseInt(document.getElementById('pomoWork').value)  || 25,
    breakMinutes: parseInt(document.getElementById('pomoBreak').value) || 5,
  };

  settings.idle = {
    enabled:          document.getElementById('idleEnabled').checked,
    thresholdMinutes: parseInt(document.getElementById('idleThreshold').value) || 10,
  };

  settings.slack = {
    enabled:      document.getElementById('slackEnabled').checked,
    token:        document.getElementById('slackToken').value.trim(),
    workingText:  document.getElementById('slackWorkText').value.trim()  || '稼働中',
    workingEmoji: document.getElementById('slackWorkEmoji').value.trim() || ':computer:',
    breakText:    document.getElementById('slackBreakText').value.trim() || '休憩中',
    breakEmoji:   document.getElementById('slackBreakEmoji').value.trim()|| ':coffee:',
  };

  settings.calendar = {
    enabled:       document.getElementById('calendarEnabled').checked,
    calendarId:    document.getElementById('calendarId').value || 'primary',
    titleTemplate: document.getElementById('calendarTitleTemplate').value.trim() || '⏱ {client}｜{note}',
    autoColor:     document.getElementById('calendarAutoColor').checked,
  };

  const startH = parseInt(document.getElementById('freetimeStartHour').value, 10);
  const endH   = parseInt(document.getElementById('freetimeEndHour').value, 10);
  settings.freetime = {
    startHour:      Number.isFinite(startH) ? Math.min(23, Math.max(0, startH)) : 10,
    endHour:        Number.isFinite(endH)   ? Math.min(24, Math.max(1, endH))   : 18,
    minSlotMinutes: parseInt(document.getElementById('freetimeMinSlot').value, 10)   || 30,
    daysAhead:      parseInt(document.getElementById('freetimeDaysAhead').value, 10) || 7,
    weekdaysOnly:   document.getElementById('freetimeWeekdaysOnly').checked,
    skipPastToday:  true,
  };
  // Enforce end > start
  if (settings.freetime.endHour <= settings.freetime.startHour) {
    settings.freetime.endHour = Math.min(24, settings.freetime.startHour + 1);
  }

  await saveSettings(settings);
  applyTheme(settings.theme);

  // Update idle detection interval in background
  chrome.runtime.sendMessage({
    type: 'UPDATE_IDLE_THRESHOLD',
    minutes: settings.idle.thresholdMinutes,
  }).catch(() => {});

  showToast('設定を保存しました ✓');
}

// ── Export / Invoice ──

async function exportCSV() {
  const entries = await getEntries();
  const csv     = await exportAsCSV(entries, settings.clients);
  downloadFile(csv, `timecard-${monthStr()}.csv`, 'text/csv');
}

async function exportJSON() {
  const entries = await getEntries();
  const data    = JSON.stringify({ entries, settings }, null, 2);
  downloadFile(data, `timecard-${monthStr()}.json`, 'application/json');
}

function downloadFile(content, filename, type) {
  const a  = document.createElement('a');
  a.href   = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}

async function clearAllData() {
  if (!confirm('全ての稼働データを削除します。この操作は取り消せません。\n\n本当に削除しますか？')) return;
  await clearEntries();
  showToast('データを削除しました');
}

// ── Toast ──

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Event Binding ──

function bindEvents() {
  bindColorPicker('colorAccent', 'accent');
  bindColorPicker('colorBase',   'base');
  bindColorPicker('colorText',   'text');

  document.getElementById('clientColorInput').addEventListener('input', e => {
    renderColorSwatches(e.target.value);
  });

  document.getElementById('addClientBtn').addEventListener('click', () => openModal(null));
  document.getElementById('modalCancelBtn').addEventListener('click', () => {
    document.getElementById('modalOverlay').hidden = true;
  });
  document.getElementById('modalSaveBtn').addEventListener('click', saveClient);
  document.getElementById('clientNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveClient();
  });
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  document.getElementById('modalAddTagBtn').addEventListener('click', addModalTag);
  document.getElementById('modalNewTagInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addModalTag();
  });

  document.getElementById('modalAddTaskBtn').addEventListener('click', addModalTask);
  document.getElementById('modalNewTaskInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addModalTask();
  });

  document.getElementById('saveBtn').addEventListener('click', saveAll);
  document.getElementById('exportBtn').addEventListener('click', exportCSV);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJSON);
  document.getElementById('clearDataBtn').addEventListener('click', clearAllData);

  document.getElementById('reauthSheetsBtn').addEventListener('click', async () => {
    const btn = document.getElementById('reauthSheetsBtn');
    btn.disabled = true;
    btn.textContent = '認証中...';
    try {
      await clearAuthToken();
      await getAuthToken(true);
      btn.textContent = '✅ 完了！';
    } catch (e) {
      btn.textContent = '❌ ' + e.message;
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = '🔄 Google 再認証'; }, 3000);
    }
  });

  document.getElementById('fullResyncBtn').addEventListener('click', async () => {
    if (!confirm('今月のシートをローカルデータで上書きします。シートに手動で書いた内容は消えます。よろしいですか？')) return;
    const btn = document.getElementById('fullResyncBtn');
    btn.disabled = true;
    btn.textContent = '同期中...';
    try {
      const settings = await getSettings();
      if (!settings.spreadsheetId) throw new Error('スプレッドシートIDが未設定です');
      const monthStr   = new Date().toISOString().slice(0, 7);
      const entries    = await getMonthEntries(monthStr);
      const allEntries = await getEntries();
      await fullResyncToSheet(settings.spreadsheetId, entries, settings.clients, monthStr, allEntries);
      btn.textContent = '✅ 完了！';
    } catch (e) {
      btn.textContent = '❌ ' + e.message;
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = '⚠️ 今月を上書き同期'; }, 3000);
    }
  });
  document.getElementById('invoiceBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('invoice.html') });
  });

  document.getElementById('loadCalendarsBtn').addEventListener('click', loadCalendarList);

  // ── Setup-guide shortcuts ──
  const openExt = document.getElementById('openExtensionsPageBtn');
  if (openExt) openExt.addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/' });
  });
  const openCloud = document.getElementById('openCloudConsoleBtn');
  if (openCloud) openCloud.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://console.cloud.google.com/' });
  });
  const openCred = document.getElementById('openCredentialsBtn');
  if (openCred) openCred.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://console.cloud.google.com/apis/credentials' });
  });
}

init();
