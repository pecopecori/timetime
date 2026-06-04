// Service Worker — badge, pomodoro, idle detection, weekly report

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('timerTick', { periodInMinutes: 1 });

  // Weekly report: every Monday at 9am
  const now = new Date();
  const daysUntilMonday = ((8 - now.getDay()) % 7) || 7;
  const nextMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 9, 0, 0);
  chrome.alarms.create('weeklyReport', {
    when: nextMonday.getTime(),
    periodInMinutes: 7 * 24 * 60,
  });

  // Apply idle threshold from settings
  const result = await chrome.storage.sync.get('settings');
  const idleMin = result.settings?.idle?.thresholdMinutes || 10;
  chrome.idle.setDetectionInterval(idleMin * 60);
});

// ── Alarm dispatcher ──

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'timerTick')    await handleTimerTick();
  if (alarm.name === 'pomodoroEnd')  await handlePomodoroEnd();
  if (alarm.name === 'weeklyReport') await handleWeeklyReport();
});

// ── Badge (every minute) ──

async function handleTimerTick() {
  const result = await chrome.storage.local.get('timerState');
  const state = result.timerState;
  if (!state || state.status === 'idle') {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (state.status === 'running') {
    const elapsed = Date.now() - state.startTime - (state.breakDuration || 0);
    const hours = Math.floor(elapsed / 3600000);
    const mins  = Math.floor((elapsed % 3600000) / 60000);
    const label = hours > 0 ? `${hours}h` : `${mins}m`;
    chrome.action.setBadgeText({ text: label });
    chrome.action.setBadgeBackgroundColor({ color: '#A6B5A5' });
  } else {
    chrome.action.setBadgeText({ text: '休憩' });
    chrome.action.setBadgeBackgroundColor({ color: '#D49B65' });
  }
}

// ── Pomodoro ──

async function handlePomodoroEnd() {
  const result = await chrome.storage.local.get('pomodoroState');
  const pomo = result.pomodoroState;
  if (!pomo?.active) return;

  if (pomo.phase === 'work') {
    const newPomo = {
      ...pomo,
      phase: 'break',
      phaseStartTime: Date.now(),
      completedPomodoros: pomo.completedPomodoros + 1,
    };
    await chrome.storage.local.set({ pomodoroState: newPomo });
    chrome.alarms.create('pomodoroEnd', { delayInMinutes: pomo.breakMinutes });
    chrome.notifications.create('pomodoroBreak', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${pomo.workMinutes}分経過しました🍀`,
      message: `お疲れさまです！${pomo.breakMinutes}分休憩しましょう☕`,
      priority: 2,
    });
    playChime();
  } else {
    const newPomo = { ...pomo, phase: 'work', phaseStartTime: Date.now() };
    await chrome.storage.local.set({ pomodoroState: newPomo });
    chrome.alarms.create('pomodoroEnd', { delayInMinutes: pomo.workMinutes });
    chrome.notifications.create('pomodoroWork', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '休憩終了です🌿',
      message: 'さあ、また一緒にがんばりましょう！',
      priority: 2,
    });
    playChime();
  }
}

// ── Idle detection ──

chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState !== 'idle' && newState !== 'locked') return;

  const [timerResult, settingsResult] = await Promise.all([
    chrome.storage.local.get('timerState'),
    chrome.storage.sync.get('settings'),
  ]);
  const timer    = timerResult.timerState;
  const settings = settingsResult.settings;

  if (!timer || timer.status !== 'running') return;
  if (!settings?.idle?.enabled) return;

  chrome.notifications.create('idleDetected', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Time!Time! — 席を外していませんか？',
    message: '稼働タイマーが動いています。休憩に切り替えますか？',
    buttons: [{ title: '休憩に切り替える' }, { title: 'そのまま続ける' }],
    requireInteraction: true,
    priority: 2,
  });
});

chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  chrome.notifications.clear(notifId);
  if (notifId === 'idleDetected' && btnIdx === 0) {
    const [timerResult, settingsResult] = await Promise.all([
      chrome.storage.local.get('timerState'),
      chrome.storage.sync.get('settings'),
    ]);
    const timer    = timerResult.timerState;
    const settings = settingsResult.settings;
    if (timer && timer.status === 'running') {
      await chrome.storage.local.set({
        timerState: { ...timer, status: 'break', breakStartTime: Date.now() },
      });
      chrome.action.setBadgeText({ text: '休憩' });
      chrome.action.setBadgeBackgroundColor({ color: '#D49B65' });
      // Sync Slack break status if enabled
      if (settings?.slack?.enabled && settings.slack.token) {
        updateSlackStatusBg(
          settings.slack.token,
          settings.slack.breakText  || '休憩中',
          settings.slack.breakEmoji || ':coffee:',
        ).catch(() => {});
      }
    }
  }
});

async function updateSlackStatusBg(token, text, emoji) {
  await fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profile: { status_text: text, status_emoji: emoji, status_expiration: 0 },
    }),
  });
}

// ── Weekly report notification ──

async function handleWeeklyReport() {
  const result = await chrome.storage.local.get('entries');
  const entries = result.entries || [];

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = dateBg(weekAgo);
  const weekEntries = entries.filter(e => e.date >= weekAgoStr);

  if (weekEntries.length === 0) return;

  const totalMs = weekEntries.reduce((s, e) => s + (e.duration || 0), 0);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);

  chrome.notifications.create('weeklyReportNotif', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Time!Time! — 週次レポート',
    message: `先週の稼働合計：${h}時間${m}分（${weekEntries.length}件）`,
    priority: 1,
  });
}

// ── Message handler ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'UPDATE_IDLE_THRESHOLD') {
    const secs = (msg.minutes || 10) * 60;
    chrome.idle.setDetectionInterval(secs);
    sendResponse({ ok: true });
  }
});

// ── Offscreen audio chime ──

async function playChime() {
  try {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (!hasDoc) {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play pomodoro chime sound',
      });
    }
    chrome.runtime.sendMessage({ type: 'PLAY_CHIME' }).catch(() => {});
  } catch (_) {
    // Audio not critical — ignore if offscreen API unavailable
  }
}

function dateBg(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
