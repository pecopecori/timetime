// Google Calendar integration
// Setup: Same OAuth2 client as Sheets — add Calendar API to scopes
// Enable: Google Calendar API at console.cloud.google.com

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Google Calendar has 11 fixed event colors. Pick the closest match for each client.
// Hex values are Google's reference palette (https://developers.google.com/calendar/api/v3/reference/colors)
const CAL_COLOR_PALETTE = [
  { id: '1',  hex: '#7986CB' }, // Lavender
  { id: '2',  hex: '#33B679' }, // Sage
  { id: '3',  hex: '#8E24AA' }, // Grape
  { id: '4',  hex: '#E67C73' }, // Flamingo
  { id: '5',  hex: '#F6BF26' }, // Banana
  { id: '6',  hex: '#F4511E' }, // Tangerine
  { id: '7',  hex: '#039BE5' }, // Peacock
  { id: '8',  hex: '#616161' }, // Graphite
  { id: '9',  hex: '#3F51B5' }, // Blueberry
  { id: '10', hex: '#0B8043' }, // Basil
  { id: '11', hex: '#D50000' }, // Tomato
];

// Parse #RRGGBB → {r,g,b}. Returns null on malformed input (safer than utils.hexToRgb,
// which assumes a well-formed string and would yield NaN on bad input).
function parseHexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Pick the Calendar colorId whose palette entry is closest to the client's hex color.
function nearestCalendarColorId(hex) {
  const target = parseHexColor(hex);
  if (!target) return null;
  let best = null;
  let bestDist = Infinity;
  for (const c of CAL_COLOR_PALETTE) {
    const p = parseHexColor(c.hex);
    const d = (p.r - target.r) ** 2 + (p.g - target.g) ** 2 + (p.b - target.b) ** 2;
    if (d < bestDist) { bestDist = d; best = c.id; }
  }
  return best;
}

async function getCalendarAuthToken() {
  const manifest = chrome.runtime.getManifest();
  if (!manifest.oauth2?.client_id || manifest.oauth2.client_id.startsWith('YOUR_')) {
    throw new Error(
      'Google OAuth2の設定が必要です。\n' +
      'manifest.json の oauth2.client_id にGoogle Cloud ConsoleのクライアントIDを入力してください。'
    );
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true, scopes: CALENDAR_SCOPES }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!token) {
        reject(new Error('認証トークンの取得に失敗しました'));
      } else {
        resolve(token);
      }
    });
  });
}

async function calendarRequest(token, method, path, body) {
  const url = path.startsWith('http') ? path : `${CALENDAR_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// List the user's writable calendars for the settings dropdown.
async function listCalendars() {
  const token = await getCalendarAuthToken();
  const data  = await calendarRequest(token, 'GET', '/users/me/calendarList?minAccessRole=writer&fields=items(id,summary,primary,backgroundColor)');
  const items = data.items || [];
  // Sort: primary first, then alphabetical
  items.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return (a.summary || '').localeCompare(b.summary || '', 'ja');
  });
  return items.map(c => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
  }));
}

// Build event title from template. Supported tokens: {client}, {note}, {tags}
// Uses a single substitution pass with replaceAll so repeated tokens are all filled.
function renderTitle(template, { client, note, tags }) {
  const t = template || '⏱ {client}｜{note}';
  return t
    .replaceAll('{client}', client || '')
    .replaceAll('{note}',   note || '作業')
    .replaceAll('{tags}',   (tags || []).join(', '))
    .replace(/\s*｜\s*$/,'')      // trailing ｜ when note is empty
    .replace(/\s+$/, '')
    .trim();
}

// Push a single TimeCard entry to Google Calendar as a new event.
// Returns the created event's id, or throws on failure.
async function pushEntryToCalendar(entry, client, calConfig) {
  if (!entry?.startTime || !entry?.endTime) {
    throw new Error('開始/終了時刻がありません');
  }
  const calendarId = calConfig?.calendarId || 'primary';
  const title = renderTitle(calConfig?.titleTemplate, {
    client: client?.name,
    note:   entry.note,
    tags:   entry.tags,
  });

  const body = {
    summary: title,
    description: buildDescription(entry, client),
    start: { dateTime: new Date(entry.startTime).toISOString() },
    end:   { dateTime: new Date(entry.endTime).toISOString() },
    // Prevent invitee notification email storms in shared calendars
    reminders: { useDefault: false },
  };

  if (calConfig?.autoColor && client?.color) {
    const colorId = nearestCalendarColorId(client.color);
    if (colorId) body.colorId = colorId;
  }

  const token = await getCalendarAuthToken();
  const res = await calendarRequest(
    token,
    'POST',
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    body
  );
  return res.id;
}

function buildDescription(entry, client) {
  const lines = [];
  if (client?.name) lines.push(`クライアント: ${client.name}`);
  if (entry.tags?.length) lines.push(`タグ: ${entry.tags.join(', ')}`);
  if (entry.note) lines.push(`メモ: ${entry.note}`);
  const mins = Math.round((entry.duration || 0) / 60000);
  if (mins > 0) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    lines.push(`稼働: ${h}:${String(m).padStart(2, '0')}`);
  }
  lines.push('— TimeCard Pro より自動投入');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Free-time finder
// ─────────────────────────────────────────────────────────────

// Fetch all "busy" intervals from a calendar within [timeMin, timeMax].
// Skips events the user has declined or marked as transparent (free).
// Walks all pages via nextPageToken so packed calendars aren't silently truncated.
async function listBusyIntervals(calendarId, timeMin, timeMax) {
  const token = await getCalendarAuthToken();
  const id    = encodeURIComponent(calendarId || 'primary');
  const all   = [];
  let pageToken;
  let pages   = 0;
  const MAX_PAGES = 20;  // hard cap: ~5000 events. Safety against runaway pagination.

  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      fields: 'nextPageToken,items(start,end,transparency,status,attendees)',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await calendarRequest(
      token,
      'GET',
      `/calendars/${id}/events?${params.toString()}`
    );
    if (Array.isArray(data.items)) all.push(...data.items);
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  return all
    .filter(ev => ev.status !== 'cancelled')
    .filter(ev => ev.transparency !== 'transparent')   // event marked "free"
    .filter(ev => {
      // If user is among attendees and declined, treat as free
      const me = (ev.attendees || []).find(a => a.self);
      return !me || me.responseStatus !== 'declined';
    })
    .map(ev => ({
      start: new Date(ev.start.dateTime || ev.start.date).getTime(),
      end:   new Date(ev.end.dateTime   || ev.end.date).getTime(),
    }))
    .filter(iv => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
}

// Merge overlapping busy intervals.
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const out = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const last = out[out.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end);
    } else {
      out.push({ ...intervals[i] });
    }
  }
  return out;
}

// Pure: given busy intervals + working-hour config, return free slots grouped by day.
// freetime = { startHour, endHour, weekdaysOnly, minSlotMinutes, daysAhead }
function computeFreeSlots(busyIntervals, freetime, now = new Date()) {
  const startHour       = clamp(freetime.startHour ?? 10, 0, 23);
  const endHour         = clamp(freetime.endHour   ?? 18, startHour + 1, 24);
  const weekdaysOnly    = freetime.weekdaysOnly ?? true;
  const minSlotMs       = (freetime.minSlotMinutes ?? 30) * 60000;
  const daysAhead       = clamp(freetime.daysAhead ?? 7, 1, 30);
  const skipPastToday   = freetime.skipPastToday ?? true;

  const merged = mergeIntervals(busyIntervals);
  const days = [];

  for (let d = 0; d < daysAhead; d++) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + d);
    const dow = day.getDay();
    if (weekdaysOnly && (dow === 0 || dow === 6)) continue;

    const dayStart = new Date(day);
    dayStart.setHours(startHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(endHour, 0, 0, 0);

    let cursor = dayStart.getTime();
    if (d === 0 && skipPastToday) cursor = Math.max(cursor, now.getTime());
    const end = dayEnd.getTime();

    const slots = [];
    const overlap = merged.filter(iv => iv.start < end && iv.end > cursor);
    for (const iv of overlap) {
      if (iv.start > cursor) {
        const slotEnd = Math.min(iv.start, end);
        if (slotEnd - cursor >= minSlotMs) slots.push({ start: cursor, end: slotEnd });
      }
      cursor = Math.max(cursor, iv.end);
      if (cursor >= end) break;
    }
    if (cursor < end && end - cursor >= minSlotMs) {
      slots.push({ start: cursor, end });
    }

    if (slots.length) days.push({ date: day, slots });
  }
  return days;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// Format free slots into a Japanese-style block of text ready to paste into mail/chat.
function formatFreeSlots(days) {
  if (!days.length) return '今週・来週、空き時間が見つかりませんでした。';
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const lines = ['以下の時間帯でしたらご都合いかがでしょうか🌷'];
  for (const d of days) {
    const m  = d.date.getMonth() + 1;
    const dd = d.date.getDate();
    const dow = dayNames[d.date.getDay()];
    const ranges = d.slots.map(s => `${fmtHm(s.start)}〜${fmtHm(s.end)}`).join(' / ');
    lines.push(`・${m}/${dd}(${dow}) ${ranges}`);
  }
  return lines.join('\n');
}

function fmtHm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Fetch upcoming events for display (different from listBusyIntervals which is filter-heavy).
// Returns events grouped by day, including all-day events.
async function listUpcomingEvents(calendarId, daysAhead = 7) {
  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + daysAhead);
  future.setHours(23, 59, 59, 999);

  const token = await getCalendarAuthToken();
  const id    = encodeURIComponent(calendarId || 'primary');
  const all   = [];
  let pageToken;
  let pages = 0;
  const MAX_PAGES = 20;

  do {
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      fields: 'nextPageToken,items(summary,start,end,status,attendees,location)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await calendarRequest(token, 'GET', `/calendars/${id}/events?${params.toString()}`);
    if (Array.isArray(data.items)) all.push(...data.items);
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  const events = all
    .filter(ev => ev.status !== 'cancelled')
    .map(ev => {
      const isAllDay = !!ev.start.date && !ev.start.dateTime;
      return {
        title:    ev.summary || '（無題）',
        start:    new Date(ev.start.dateTime || ev.start.date).getTime(),
        end:      new Date(ev.end.dateTime   || ev.end.date).getTime(),
        allDay:   isAllDay,
        location: ev.location || '',
        declined: ((ev.attendees || []).find(a => a.self) || {}).responseStatus === 'declined',
      };
    });

  // Group by local-date string
  const byDay = new Map();
  for (const ev of events) {
    const d = new Date(ev.start);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (!byDay.has(key)) byDay.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), events: [] });
    byDay.get(key).events.push(ev);
  }
  // Sort each day's events by start time
  for (const day of byDay.values()) day.events.sort((a, b) => a.start - b.start);

  return Array.from(byDay.values()).sort((a, b) => a.date - b.date);
}

// Top-level: fetch + compute + format. Used by popup.
async function findFreeSlots(calendarId, freetime) {
  const now    = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + (freetime.daysAhead ?? 7));
  future.setHours(23, 59, 59, 999);

  const busy = await listBusyIntervals(calendarId || 'primary', now, future);
  const days = computeFreeSlots(busy, freetime, now);
  return {
    days,
    text: formatFreeSlots(days),
  };
}
