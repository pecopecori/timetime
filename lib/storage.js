const DEFAULT_SETTINGS = {
  theme: {
    id: 'spring-clover',
    accent: '#A6B5A5',
    base: '#F4EBDA',
    text: '#262724',
  },
  providerName: '',
  clients: [],
  spreadsheetId: '',
  autoSync: false,
  showEarnings: false,
  billingDay: 1,
  pomodoro: {
    enabled: false,
    workMinutes: 25,
    breakMinutes: 5,
  },
  idle: {
    enabled: true,
    thresholdMinutes: 10,
  },
  slack: {
    enabled: false,
    token: '',
    workingText: '稼働中',
    workingEmoji: ':computer:',
    breakText: '休憩中',
    breakEmoji: ':coffee:',
  },
  calendar: {
    enabled: false,
    calendarId: 'primary',
    titleTemplate: '⏱ {client}｜{note}',
    autoColor: true,
  },
  freetime: {
    startHour: 10,
    endHour: 18,
    weekdaysOnly: true,
    minSlotMinutes: 30,
    daysAhead: 7,
    skipPastToday: true,
  },
};

const DEFAULT_TIMER_STATE = {
  status: 'idle',
  clientId: null,
  startTime: null,
  breakDuration: 0,
  breakStartTime: null,
};

const DEFAULT_POMODORO_STATE = {
  active: false,
  phase: 'work',
  phaseStartTime: null,
  workMinutes: 25,
  breakMinutes: 5,
  completedPomodoros: 0,
};

async function getSettings() {
  const result = await chrome.storage.sync.get('settings');
  const s = result.settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...(s.pomodoro || {}) },
    idle:     { ...DEFAULT_SETTINGS.idle,     ...(s.idle     || {}) },
    slack:    { ...DEFAULT_SETTINGS.slack,    ...(s.slack    || {}) },
    calendar: { ...DEFAULT_SETTINGS.calendar, ...(s.calendar || {}) },
    freetime: { ...DEFAULT_SETTINGS.freetime, ...(s.freetime || {}) },
    clients: (s.clients || DEFAULT_SETTINGS.clients).map(c => ({
      hourlyRate: 0,
      monthlyGoalHours: 0,
      tags: [],
      ...c,
      // Normalize tasks to a stable shape after spreading c.
      // Filters out malformed entries (no title) and assigns ids to legacy items.
      tasks: (c.tasks || []).map(t => ({
        id:    t.id    || uuid(),
        title: t.title || '',
        done:  !!t.done,
      })).filter(t => t.title),
    })),
  };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

async function getTimerState() {
  const result = await chrome.storage.local.get('timerState');
  return result.timerState || DEFAULT_TIMER_STATE;
}

async function saveTimerState(state) {
  await chrome.storage.local.set({ timerState: state });
}

async function getPomodoroState() {
  const result = await chrome.storage.local.get('pomodoroState');
  return result.pomodoroState || { ...DEFAULT_POMODORO_STATE };
}

async function savePomodoroState(state) {
  await chrome.storage.local.set({ pomodoroState: state });
}

async function getEntries() {
  const result = await chrome.storage.local.get('entries');
  return result.entries || [];
}

async function addEntry(entry) {
  const entries = await getEntries();
  entries.push(entry);
  await chrome.storage.local.set({ entries });
  return entry;
}

async function getTodayEntries() {
  const entries = await getEntries();
  return entries.filter(e => e.date === todayStr());
}

async function getMonthEntries(monthStr) {
  const entries = await getEntries();
  return entries.filter(e => e.date && e.date.startsWith(monthStr));
}

async function getBillingPeriodEntries(billingDay) {
  const entries = await getEntries();
  const now = new Date();
  let start;
  if (now.getDate() >= billingDay) {
    start = new Date(now.getFullYear(), now.getMonth(), billingDay);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
  }
  const startStr = formatDate(start);
  return entries.filter(e => e.date >= startStr);
}

async function updateEntry(id, updates) {
  const entries = await getEntries();
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], ...updates };
  await chrome.storage.local.set({ entries });
}

async function clearEntries() {
  await chrome.storage.local.set({ entries: [] });
}
