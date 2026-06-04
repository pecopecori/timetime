let timerInterval    = null;
let selectedClientId = null;
let timerState       = null;
let settings         = null;
let pomoState        = null;
let selectedTags     = [];
let selectedTaskId   = null;   // Task chosen for the next start (becomes the note)
let _processing      = false;
let _freetimeText    = '';      // Most recently rendered free-time text (for copy)
let _lastSavedEntryId = null;  // Entry saved on stop — used for optional memo append
let _memoTimeout     = null;

// Cached completed-entry totals
let _cachedTodayMs        = 0;
let _cachedMonthMs        = 0;
let _cachedClientTodayMs  = {};
let _cachedClientMonthMs  = {};
let _periodStartStr       = '';

// ── Init ──

async function init() {
  settings   = await getSettings();
  timerState = await getTimerState();
  pomoState  = await getPomodoroState();

  applyTheme(settings.theme);

  if (timerState.clientId) selectedClientId = timerState.clientId;
  if (timerState.pendingTags?.length) selectedTags = [...timerState.pendingTags];
  if (timerState.pendingTaskId) selectedTaskId = timerState.pendingTaskId;

  await renderClients();
  await updateSummary();
  renderTags();
  renderTasks();
  updateTimerDisplay();
  updatePomodoroBar();
  updateGoalAndEarnings();

  timerInterval = setInterval(tick, 1000);
  bindEvents();
}

function tick() {
  updateTimerDisplay();
  updateSummaryDisplay();
  updateActiveClientTime();
  updatePomodoroBar();
  updateGoalAndEarnings();
  updateBadge();
}

function updateBadge() {
  if (timerState?.status === 'running') {
    const elapsed = getElapsedMs(timerState);
    const hours = Math.floor(elapsed / 3600000);
    const mins  = Math.floor((elapsed % 3600000) / 60000);
    chrome.action.setBadgeText({ text: hours > 0 ? `${hours}h` : `${mins}m` });
    chrome.action.setBadgeBackgroundColor({ color: '#A6B5A5' });
  } else if (timerState?.status === 'idle') {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Timer display ──

function updateTimerDisplay() {
  const elapsed = getElapsedMs(timerState);
  document.getElementById('timerDisplay').textContent = formatDuration(elapsed);

  const dot        = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const clientLabel = document.getElementById('timerClient');

  dot.className = 'status-dot ' + (timerState?.status || 'idle');

  if (timerState?.status === 'running') {
    statusText.textContent = '稼働中';
    const client = settings?.clients?.find(c => c.id === timerState.clientId);
    clientLabel.textContent = client ? client.name : '';
    clientLabel.className = 'timer-client active';
  } else if (timerState?.status === 'break') {
    statusText.textContent = '休憩中';
    const client = settings?.clients?.find(c => c.id === timerState.clientId);
    clientLabel.textContent = client ? `${client.name} — 休憩中` : '休憩中';
    clientLabel.className = 'timer-client';
  } else {
    statusText.textContent = '未開始';
    clientLabel.textContent = 'クライアントを選択してください';
    clientLabel.className = 'timer-client';
    document.getElementById('timerDisplay').textContent = '00:00:00';
  }
}

// ── Summary ──

async function updateSummary() {
  const today   = todayStr();
  const entries = await getEntries();

  // Today
  const todayEntries = entries.filter(e => e.date === today);
  _cachedTodayMs = todayEntries.reduce((s, e) => s + (e.duration || 0), 0);
  _cachedClientTodayMs = {};
  todayEntries.forEach(e => {
    _cachedClientTodayMs[e.clientId] = (_cachedClientTodayMs[e.clientId] || 0) + (e.duration || 0);
  });

  // Billing period (締め日対応)
  const billingDay  = settings?.billingDay || 1;
  const now         = new Date();
  const periodStart = now.getDate() >= billingDay
    ? new Date(now.getFullYear(), now.getMonth(), billingDay)
    : new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
  _periodStartStr = formatDate(periodStart);

  const periodEntries = entries.filter(e => e.date >= _periodStartStr);
  _cachedMonthMs = periodEntries.reduce((s, e) => s + (e.duration || 0), 0);
  _cachedClientMonthMs = {};
  periodEntries.forEach(e => {
    _cachedClientMonthMs[e.clientId] = (_cachedClientMonthMs[e.clientId] || 0) + (e.duration || 0);
  });

  updateSummaryDisplay();
}

function updateSummaryDisplay() {
  let activeTodayMs = 0;
  let activeMonthMs = 0;
  if (timerState?.status !== 'idle' && timerState?.startTime) {
    const elapsed    = getElapsedMs(timerState);
    const entryDate  = formatDate(timerState.startTime);
    if (entryDate === todayStr())                             activeTodayMs = elapsed;
    if (_periodStartStr && entryDate >= _periodStartStr)      activeMonthMs = elapsed;
  }
  document.getElementById('todayTotal').textContent = formatDurationShort(_cachedTodayMs + activeTodayMs);
  document.getElementById('monthTotal').textContent = formatDurationShort(_cachedMonthMs + activeMonthMs);
}

function updateActiveClientTime() {
  if (!timerState || timerState.status === 'idle') return;
  const chip = document.querySelector('.client-item.active .client-time');
  if (!chip) return;
  const completedMs = _cachedClientTodayMs[timerState.clientId] || 0;
  chip.textContent  = formatDurationShort(completedMs + getElapsedMs(timerState));
}

// ── Pomodoro bar ──

function updatePomodoroBar() {
  const bar = document.getElementById('pomodoroBar');
  if (!pomoState?.active) { bar.hidden = true; return; }
  bar.hidden = false;

  const phaseSecs  = (pomoState.phase === 'work' ? pomoState.workMinutes : pomoState.breakMinutes) * 60;
  const elapsedSec = (Date.now() - pomoState.phaseStartTime) / 1000;
  const remaining  = Math.max(0, phaseSecs - elapsedSec);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');

  const countdownEl = document.getElementById('pomoCountdown');
  countdownEl.textContent = `${mm}:${ss}`;
  countdownEl.classList.remove('pomo-tick');
  void countdownEl.offsetWidth; // reflow でアニメをリセット
  countdownEl.classList.add('pomo-tick');
  document.getElementById('pomoFill').style.width  = `${(1 - remaining / phaseSecs) * 100}%`;
  document.getElementById('pomoPhase').textContent = pomoState.phase === 'work' ? 'ポモドーロ' : '☕ 休憩中';
}

// ── Goal & Earnings ──

function updateGoalAndEarnings() {
  const client     = settings?.clients?.find(c => c.id === selectedClientId);
  const goalBar    = document.getElementById('goalBar');
  const earningsEl = document.getElementById('earningsRow');

  // Per-client month total (completed + active)
  let clientMonthMs = _cachedClientMonthMs[selectedClientId] || 0;
  if (timerState?.status !== 'idle' && timerState?.clientId === selectedClientId) {
    const entryDate = timerState.startTime ? formatDate(timerState.startTime) : '';
    if (_periodStartStr && entryDate >= _periodStartStr) clientMonthMs += getElapsedMs(timerState);
  }

  // Goal
  if (client?.monthlyGoalHours > 0) {
    goalBar.hidden = false;
    const goalMs = client.monthlyGoalHours * 3600000;
    const pct    = Math.min(100, Math.round(clientMonthMs / goalMs * 100));
    document.getElementById('goalFill').style.width = `${pct}%`;
    document.getElementById('goalPct').textContent  = `${pct}%`;
  } else {
    goalBar.hidden = true;
  }

  // 今月合計 / Earnings — both controlled by showEarnings
  const monthBar = document.getElementById('monthBar');
  if (settings?.showEarnings) {
    monthBar.hidden = false;
    if (client?.hourlyRate > 0) {
      earningsEl.hidden = false;
      const earned = Math.floor(clientMonthMs / 3600000 * client.hourlyRate);
      document.getElementById('earningsValue').textContent = `¥${earned.toLocaleString('ja-JP')}`;
    } else {
      earningsEl.hidden = true;
    }
  } else {
    monthBar.hidden = true;
    earningsEl.hidden = true;
  }
}

// ── Tags ──

function renderTags() {
  const section = document.getElementById('tagSection');
  const chips   = document.getElementById('tagChips');
  const client  = settings?.clients?.find(c => c.id === selectedClientId);
  const tags    = client?.tags || [];

  if (!tags.length) { section.hidden = true; return; }
  section.hidden = false;

  chips.innerHTML = tags.map(t => `
    <button class="tag-chip${selectedTags.includes(t) ? ' selected' : ''}"
            data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>
  `).join('');

  chips.querySelectorAll('.tag-chip').forEach(el => {
    el.addEventListener('click', async () => {
      const tag = el.dataset.tag;
      if (selectedTags.includes(tag)) {
        selectedTags = selectedTags.filter(t => t !== tag);
      } else {
        selectedTags.push(tag);
      }
      // Persist so tags survive popup close/reopen during active timer
      if (timerState?.status !== 'idle') {
        timerState = { ...timerState, pendingTags: [...selectedTags] };
        await saveTimerState(timerState);
      }
      renderTags();
    });
  });
}

// ── Client list ──

async function renderClients() {
  const list    = document.getElementById('clientList');
  const clients = settings?.clients || [];
  const todayEntries = await getTodayEntries();

  if (!clients.length) {
    list.innerHTML = `
      <div class="client-empty">
        <div class="client-empty-msg">クライアントが登録されていません🌷</div>
        <button class="client-empty-btn" id="goToSettingsBtn">⚙ 設定からクライアントを追加</button>
      </div>
    `;
    const btn = document.getElementById('goToSettingsBtn');
    if (btn) btn.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  list.innerHTML = clients.map(c => {
    const isActive   = timerState?.status !== 'idle' && timerState?.clientId === c.id;
    const isSelected = c.id === selectedClientId;

    const todayMs = todayEntries
      .filter(e => e.clientId === c.id)
      .reduce((sum, e) => sum + (e.duration || 0), 0)
      + (isActive ? getElapsedMs(timerState) : 0);

    const spinnerSvg = isActive
      ? `<svg class="client-active-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
           <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
         </svg>`
      : '';

    return `
      <div class="client-item${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}"
           data-id="${escapeHtml(c.id)}">
        <span class="client-dot" style="background:${escapeHtml(c.color)}"></span>
        <span class="client-name-text">${escapeHtml(c.name)}</span>
        ${spinnerSvg}
        <span class="client-time">${todayMs > 0 ? formatDurationShort(todayMs) : '—'}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.client-item').forEach(el => {
    el.addEventListener('click', () => selectClient(el.dataset.id));
  });
}

function selectClient(clientId) {
  if (timerState?.status !== 'idle') return;
  selectedClientId = clientId;
  selectedTags = [];
  selectedTaskId = null;
  renderClients();
  renderTags();
  renderTasks();
  updateButtonStates();
  updateGoalAndEarnings();
}

// ── Tasks (per-client checklist) ──

function renderTasks() {
  const section = document.getElementById('taskSection');
  const list    = document.getElementById('taskList');
  const hint    = document.getElementById('taskCountHint');
  const client  = settings?.clients?.find(c => c.id === selectedClientId);
  const tasks   = client?.tasks || [];

  if (!tasks.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  // Sort: pending first (preserve order), then done
  const sorted = [...tasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  const pending = tasks.filter(t => !t.done).length;
  hint.textContent = `${pending}/${tasks.length} 未完了`;

  list.innerHTML = sorted.map(t => `
    <div class="task-item${t.done ? ' done' : ''}${selectedTaskId === t.id ? ' selected' : ''}"
         data-id="${escapeHtml(t.id)}">
      <span class="task-check${t.done ? ' checked' : ''}" data-action="toggle" data-id="${escapeHtml(t.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
      <span class="task-title">${escapeHtml(t.title)}</span>
      ${!t.done ? `<svg class="task-start-icon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('.task-item').forEach(el => {
    el.addEventListener('click', (e) => {
      const checkEl = e.target.closest('[data-action="toggle"]');
      if (checkEl) {
        e.stopPropagation();
        toggleTaskDone(checkEl.dataset.id);
      } else {
        selectTask(el.dataset.id);
      }
    });
  });
}

async function selectTask(taskId) {
  if (timerState?.status !== 'idle') return;
  const client = settings?.clients?.find(c => c.id === selectedClientId);
  const task   = client?.tasks?.find(t => t.id === taskId);
  if (!task || task.done) return;
  selectedTaskId = taskId;
  renderTasks();
  // Auto-start the timer with this task as the pending note
  await handleStart();
}

async function toggleTaskDone(taskId) {
  // Block toggling the currently-running task — would desync timerState.pendingTaskId / pendingNote
  if (timerState?.status !== 'idle' && timerState?.pendingTaskId === taskId) {
    showToast('稼働中のタスクは終了後に完了にしてください');
    return;
  }
  const client = settings?.clients?.find(c => c.id === selectedClientId);
  const task   = client?.tasks?.find(t => t.id === taskId);
  if (!task) return;
  const prevDone     = task.done;
  const prevSelected = selectedTaskId;
  task.done = !task.done;
  if (task.done && selectedTaskId === taskId) selectedTaskId = null;
  try {
    await saveSettings(settings);
  } catch (e) {
    // Roll back everything on save failure
    task.done      = prevDone;
    selectedTaskId = prevSelected;
    showToast(`保存に失敗: ${e.message || e}`);
  }
  renderTasks();
}

function updateButtonStates() {
  const status       = timerState?.status || 'idle';
  const hasClient    = !!selectedClientId;
  const noteBarOpen  = !document.getElementById('noteBar').hidden;

  document.getElementById('startBtn').disabled = !hasClient || status === 'running' || noteBarOpen;
  document.getElementById('breakBtn').disabled = status !== 'running' || noteBarOpen;
  document.getElementById('stopBtn').disabled  = status === 'idle' || noteBarOpen;

  const startLabel = document.getElementById('startBtnLabel');
  if (status === 'break') {
    startLabel.textContent = '再開';
    document.getElementById('startBtn').disabled = noteBarOpen;
  } else {
    startLabel.textContent = '開始';
  }
}

// ── Timer actions ──

async function handleStart() {
  if (_processing) return;
  _processing = true;
  try { await _handleStart(); } finally { _processing = false; }
}

async function _handleStart() {
  if (timerState?.status === 'break') {
    const breakMs = timerState.breakStartTime ? Date.now() - timerState.breakStartTime : 0;
    timerState = {
      ...timerState,
      status: 'running',
      breakDuration: (timerState.breakDuration || 0) + breakMs,
      breakStartTime: null,
    };
    await saveTimerState(timerState);
    await triggerSlack('running');
    showToast('再開しました');
  } else if (!selectedClientId) {
    showToast('クライアントを選択してください');
    return;
  } else {
    // If a task is selected, carry its title into the timer state so it becomes the note on stop.
    const client = settings?.clients?.find(c => c.id === selectedClientId);
    const task   = client?.tasks?.find(t => t.id === selectedTaskId && !t.done);
    timerState = {
      status: 'running',
      clientId: selectedClientId,
      startTime: Date.now(),
      breakDuration: 0,
      breakStartTime: null,
      pendingTags: [],
      pendingNote: task?.title || '',
      pendingTaskId: task?.id  || null,
    };
    await saveTimerState(timerState);
    await startPomodoro();
    await triggerSlack('running');
    selectedTags = [];
    renderTags();
    renderTasks();
    showToast(task ? `「${task.title}」を開始しました` : '稼働を開始しました');
  }
  updateTimerDisplay();
  await renderClients();
  updateButtonStates();
  updateGoalAndEarnings();
}

async function handleBreak() {
  if (_processing || timerState?.status !== 'running') return;
  _processing = true;
  try { await _handleBreak(); } finally { _processing = false; }
}

async function _handleBreak() {
  if (timerState?.status !== 'running') return;
  timerState = { ...timerState, status: 'break', breakStartTime: Date.now() };
  await saveTimerState(timerState);
  await triggerSlack('break');
  showToast('休憩中...');
  updateTimerDisplay();
  await renderClients();
  updateButtonStates();
}

async function handleStop() {
  if (_processing || !timerState || timerState.status === 'idle') return;
  _processing = true;
  try { await _handleStop(); } finally { _processing = false; updateButtonStates(); }
}

// Called after entry is already saved — appends note to the saved entry.
async function confirmStop(skipNote) {
  clearTimeout(_memoTimeout);
  document.getElementById('noteBar').hidden = true;
  if (!skipNote && _lastSavedEntryId) {
    const note = document.getElementById('noteInput').value.trim();
    if (note) {
      await updateEntry(_lastSavedEntryId, { note });
    }
  }
  _lastSavedEntryId = null;
}

function _showMemoBar(prefill = '') {
  clearTimeout(_memoTimeout);
  const bar   = document.getElementById('noteBar');
  const input = document.getElementById('noteInput');
  input.value = prefill;
  bar.hidden  = false;
  input.focus();
  if (prefill) input.select();
  _memoTimeout = setTimeout(() => {
    bar.hidden = true;
    _lastSavedEntryId = null;
  }, 8000);
}

async function _handleStop() {
  const pendingNote = timerState.pendingNote || '';
  let finalState = timerState;
  if (timerState.status === 'break' && timerState.breakStartTime) {
    finalState = {
      ...timerState,
      status: 'running',
      breakDuration: (timerState.breakDuration || 0) + (Date.now() - timerState.breakStartTime),
      breakStartTime: null,
    };
  }

  const duration = getElapsedMs(finalState);
  if (duration < 60000) {
    showToast('稼働時間が短すぎます（1分未満）');
    return;
  }

  timerState = finalState;
  const now   = Date.now();
  const entry = {
    id:           uuid(),
    clientId:     timerState.clientId,
    date:         formatDate(timerState.startTime),
    startTime:    timerState.startTime,
    endTime:      now,
    startTimeStr: formatTime(timerState.startTime),
    endTimeStr:   formatTime(now),
    duration,
    tags:         [...selectedTags],
    note:         '',
  };

  // ── Persist FIRST. Calendar push must not block / risk losing the timer record. ──
  await addEntry(entry);
  _lastSavedEntryId = entry.id;

  const clientForCalendar = settings?.clients?.find(c => c.id === entry.clientId);
  const calendarEnabled   = !!settings?.calendar?.enabled;

  timerState = { status: 'idle', clientId: null, startTime: null, breakDuration: 0, breakStartTime: null };
  await saveTimerState(timerState);
  await stopPomodoro();
  await triggerSlack('idle');
  selectedTags = [];
  selectedTaskId = null;
  renderTasks();

  showToast(`記録しました（${formatDurationShort(duration)}）`);
  await checkGoalAlert(entry.clientId, duration);
  _showMemoBar(pendingNote);

  // ── Calendar push (best-effort, post-commit). May open the OAuth consent UI
  // on first use, which can close the popup — but the timer record is already saved.
  // NOTE: We intentionally don't persist the returned eventId. Writing it back to the
  // entries[] array would race with concurrent addEntry / report.js edits & deletes
  // and could clobber unrelated changes. A future sync-log feature should use its own
  // storage key. ──
  if (calendarEnabled) {
    pushEntryToCalendar(entry, clientForCalendar, settings.calendar)
      .then(eventId => {
        if (eventId) showToast(`カレンダーに追記しました🍀`);
      })
      .catch(err => {
        showToast(`カレンダー失敗: ${err.message || err}`);
      });
  }

  // Sheets 自動同期（終了時・ベストエフォート）
  if (settings?.spreadsheetId) {
    const month = monthStr();
    Promise.all([getMonthEntries(month), getEntries()])
      .then(([monthEntries, allEntries]) =>
        syncToSheet(settings.spreadsheetId, monthEntries, settings.clients, month, allEntries)
      )
      .then(result => {
        if (result?.mode !== 'skip') showToast('スプシに追記しました📊');
      })
      .catch(() => {});
  }
  updateTimerDisplay();
  await updateSummary();
  await renderClients();
  updateButtonStates();
  renderTags();
  updateGoalAndEarnings();
}

// ── Goal alert ──

async function checkGoalAlert(clientId, addedMs) {
  const client = settings?.clients?.find(c => c.id === clientId);
  if (!client?.monthlyGoalHours) return;

  const goalMs = client.monthlyGoalHours * 3600000;
  // _cachedClientMonthMs is still the old value (updateSummary hasn't run yet)
  const before = _cachedClientMonthMs[clientId] || 0;
  const after  = before + addedMs;

  if (before < goalMs && after >= goalMs) {
    chrome.notifications.create('goalAchieved', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Time!Time! — 目標達成！',
      message: `${client.name}の月間目標時間を達成しました！`,
      priority: 2,
    });
  }
}

// ── Pomodoro ──

async function startPomodoro() {
  if (!settings?.pomodoro?.enabled) return;
  const pomo = {
    active: true,
    phase: 'work',
    phaseStartTime: Date.now(),
    workMinutes: settings.pomodoro.workMinutes,
    breakMinutes: settings.pomodoro.breakMinutes,
    completedPomodoros: 0,
  };
  await savePomodoroState(pomo);
  pomoState = pomo;
  chrome.alarms.create('pomodoroEnd', { delayInMinutes: pomo.workMinutes });
}

async function stopPomodoro() {
  chrome.alarms.clear('pomodoroEnd');
  pomoState = { active: false, phase: 'work', phaseStartTime: null, workMinutes: 25, breakMinutes: 5, completedPomodoros: 0 };
  await savePomodoroState(pomoState);
}

// ── Slack status ──

async function triggerSlack(status) {
  if (!settings?.slack?.enabled || !settings.slack.token) return;
  const { token, workingText, workingEmoji, breakText, breakEmoji } = settings.slack;
  if (status === 'running') {
    await updateSlackStatus(token, workingText, workingEmoji);
  } else if (status === 'break') {
    await updateSlackStatus(token, breakText, breakEmoji);
  } else {
    await clearSlackStatus(token);
  }
}

// ── Calendar view ──

function openCalendarModal() {
  document.getElementById('calendarOverlay').hidden = false;
  loadCalendarView();
}

function closeCalendarModal() {
  document.getElementById('calendarOverlay').hidden = true;
}

async function loadCalendarView() {
  const body = document.getElementById('calendarBody');
  body.innerHTML = '<div class="freetime-loading">読み込み中...</div>';

  try {
    const days     = settings.freetime?.daysAhead ?? 7;
    const calId    = settings.calendar?.calendarId || 'primary';
    const grouped  = await listUpcomingEvents(calId, days);

    if (!grouped.length) {
      body.innerHTML = `<div class="freetime-empty">この${days}日間に予定はありません🌸<br>「🕒 空き時間を見る」を押すと、提案できる空き枠を整形できます。</div>`;
      return;
    }

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    body.innerHTML = grouped.map(d => {
      const m = d.date.getMonth() + 1;
      const dd = d.date.getDate();
      const dow = dayNames[d.date.getDay()];
      const events = d.events.map(ev => {
        const timeLabel = ev.allDay
          ? `<span class="cal-event-allday">終日</span>`
          : `<span class="cal-event-time">${escapeHtml(formatHm(ev.start))}〜${escapeHtml(formatHm(ev.end))}</span>`;
        const loc = ev.location ? `<span class="cal-event-loc">📍 ${escapeHtml(ev.location)}</span>` : '';
        return `<div class="cal-event${ev.declined ? ' declined' : ''}">
          ${timeLabel}
          <span class="cal-event-title">${escapeHtml(ev.title)}${loc}</span>
        </div>`;
      }).join('');
      return `<div class="cal-day">
        <div class="cal-day-head">${m}/${dd}<span class="cal-day-dow">(${dow})</span></div>
        ${events}
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<div class="freetime-error">エラー: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

// ── Free-time finder ──

function openFreetimeModal() {
  closeCalendarModal();   // never show both overlays at once
  document.getElementById('freetimeOverlay').hidden = false;
  loadFreetime();
}

function closeFreetimeModal() {
  document.getElementById('freetimeOverlay').hidden = true;
}

async function loadFreetime() {
  const body = document.getElementById('freetimeBody');
  body.innerHTML = '<div class="freetime-loading">読み込み中...</div>';
  _freetimeText = '';

  try {
    const ft = settings.freetime || {};
    const calId = settings.calendar?.calendarId || 'primary';
    const result = await findFreeSlots(calId, ft);
    _freetimeText = result.text;

    if (!result.days.length) {
      body.innerHTML = '<div class="freetime-empty">この期間に空き時間が見つかりませんでした。<br>設定の営業時間や日数を見直してみてください🌷</div>';
      return;
    }

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    body.innerHTML = result.days.map(d => {
      const m  = d.date.getMonth() + 1;
      const dd = d.date.getDate();
      const dow = dayNames[d.date.getDay()];
      const ranges = d.slots
        .map(s => `${escapeHtml(formatHm(s.start))}〜${escapeHtml(formatHm(s.end))}`)
        .join(' / ');
      return `<div class="freetime-day"><span class="freetime-day-label">${m}/${dd}(${dow})</span>${ranges}</div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<div class="freetime-error">エラー: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function formatHm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function copyFreetimeText() {
  if (!_freetimeText) {
    showToast('コピーする内容がありません');
    return;
  }
  try {
    await navigator.clipboard.writeText(_freetimeText);
    showToast('コピーしました📋');
  } catch (e) {
    showToast('コピーに失敗しました');
  }
}

// ── Sync ──

async function handleSync() {
  settings = await getSettings();
  if (!settings.spreadsheetId) {
    showToast('設定でスプレッドシートIDを入力してください');
    return;
  }
  showToast('同期中...');
  try {
    const month      = monthStr();
    const entries    = await getMonthEntries(month);
    const allEntries = await getEntries();
    await syncToSheet(settings.spreadsheetId, entries, settings.clients, month, allEntries);
    showToast(`${month} を同期しました（${entries.length}件）`);
  } catch (e) {
    showToast(`エラー: ${e.message}`);
  }
}

// ── Toast ──

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ── React to external timerState changes (e.g. idle detection in background) ──

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.timerState) {
    timerState = changes.timerState.newValue;
    updateTimerDisplay();
    await renderClients();
    updateButtonStates();
    updateGoalAndEarnings();
  }
  if (changes.pomodoroState) {
    pomoState = changes.pomodoroState.newValue;
    updatePomodoroBar();
  }
});

// ── Events ──

function bindEvents() {
  document.getElementById('startBtn').addEventListener('click', handleStart);
  document.getElementById('breakBtn').addEventListener('click', handleBreak);
  document.getElementById('stopBtn').addEventListener('click', handleStop);
  document.getElementById('noteConfirmBtn').addEventListener('click', () => confirmStop(false));
  document.getElementById('noteSkipBtn').addEventListener('click', () => confirmStop(true));
  document.getElementById('noteInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  confirmStop(false);
    if (e.key === 'Escape') confirmStop(true);
  });
  document.getElementById('syncBtn').addEventListener('click', handleSync);

  document.getElementById('reportBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
  });
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Header 📅 now opens the Calendar (events) view, not the free-time finder directly.
  document.getElementById('freetimeBtn').addEventListener('click', openCalendarModal);
  document.getElementById('calendarCloseBtn').addEventListener('click', closeCalendarModal);
  document.getElementById('calendarReloadBtn').addEventListener('click', loadCalendarView);
  document.getElementById('gotoFreetimeBtn').addEventListener('click', openFreetimeModal);
  document.getElementById('calendarOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCalendarModal();
  });

  document.getElementById('freetimeCloseBtn').addEventListener('click', closeFreetimeModal);
  document.getElementById('freetimeReloadBtn').addEventListener('click', loadFreetime);
  document.getElementById('freetimeCopyBtn').addEventListener('click', copyFreetimeText);
  document.getElementById('freetimeOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeFreetimeModal();
  });

  window.addEventListener('unload', async () => {
    const s = await getSettings();
    if (s.autoSync && s.spreadsheetId) {
      const st = await getTimerState();
      if (st.status === 'idle') {
        const month      = monthStr();
        const entries    = await getMonthEntries(month);
        const allEntries = await getEntries();
        if (entries.length > 0) {
          syncToSheet(s.spreadsheetId, entries, s.clients, month, allEntries).catch(() => {});
        }
      }
    }
  });

  updateButtonStates();
}

init();
