// Google Sheets integration

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_HEADER = ['日付', 'クライアント', '開始', '終了', '稼働時間', 'タグ', 'メモ'];

// ── Auth ──────────────────────────────────────────────────────────────

async function getAuthToken(interactive = true) {
  const manifest = chrome.runtime.getManifest();
  if (!manifest.oauth2?.client_id || manifest.oauth2.client_id.startsWith('YOUR_')) {
    throw new Error('Google OAuth2の設定が必要です。manifest.json の oauth2.client_id を入力してください。');
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: [SCOPES] }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

// すべてのキャッシュ済みトークンを削除（403時・アカウント切替時に使用）
async function clearAuthToken() {
  await new Promise(resolve => chrome.identity.clearAllCachedAuthTokens(resolve));
}

// ── HTTP helper ───────────────────────────────────────────────────────

async function sheetsRequest(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(msg), { needsReauth: true });
    }
    throw new Error(msg);
  }
  return res.json();
}

// ── Sheet tab ─────────────────────────────────────────────────────────

async function ensureSheet(token, spreadsheetId, tabName) {
  const meta = await sheetsRequest(token, 'GET', `${API_BASE}/${spreadsheetId}?fields=sheets.properties`);
  const existing = meta.sheets?.find(s => s.properties.title === tabName);
  if (existing) return { sheetId: existing.properties.sheetId, isNew: false };

  const res = await sheetsRequest(token, 'POST', `${API_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [{
      addSheet: { properties: { title: tabName, gridProperties: { rowCount: 1000, columnCount: 10 } } }
    }]
  });
  return { sheetId: res.replies[0].addSheet.properties.sheetId, isNew: true };
}

// ── Row builders ──────────────────────────────────────────────────────

function sanitizeCell(val) {
  const s = String(val ?? '');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function buildRow(entry, clientMap) {
  const client = clientMap[entry.clientId] || { name: entry.clientId };
  const durationMin = Math.round((entry.duration || 0) / 60000);
  const h = Math.floor(durationMin / 60);
  const m = durationMin % 60;
  return [
    sanitizeCell(entry.date),
    sanitizeCell(client.name),
    sanitizeCell(entry.startTimeStr || ''),
    sanitizeCell(entry.endTimeStr || ''),
    `${h}:${String(m).padStart(2, '0')}`,
    sanitizeCell((entry.tags || []).join(', ')),
    sanitizeCell(entry.note || ''),
  ];
}

// buildMonthRows は外部（exportAsCSV）から参照されることがあるため残す
function buildMonthRows(entries, clients) {
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  return [SHEET_HEADER, ...entries.map(e => buildRow(e, clientMap))];
}

// ── Formatting ────────────────────────────────────────────────────────

function buildColorMap(clients) {
  return Object.fromEntries(clients.map(c => {
    const hex = c.color || '#A6B5A5';
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [sanitizeCell(c.name), { red: r, green: g, blue: b }];
  }));
}

function lightColor(c) {
  return {
    red:   Math.min(1, c.red   * 0.25 + 0.75),
    green: Math.min(1, c.green * 0.25 + 0.75),
    blue:  Math.min(1, c.blue  * 0.25 + 0.75),
  };
}

async function applyBaseFormatting(token, spreadsheetId, sheetId) {
  await sheetsRequest(token, 'POST', `${API_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount'
        }
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.95, green: 0.93, blue: 0.9 } } },
          fields: 'userEnteredFormat(textFormat,backgroundColor)'
        }
      },
      {
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 }
        }
      },
    ]
  });
}

async function applyRowColors(token, spreadsheetId, sheetId, dataRows, colorMap, startRowIndex) {
  const requests = dataRows.map((row, i) => {
    const color = colorMap[row[1]];
    if (!color) return null;
    return {
      repeatCell: {
        range: { sheetId, startRowIndex: startRowIndex + i, endRowIndex: startRowIndex + i + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: { backgroundColor: lightColor(color) } },
        fields: 'userEnteredFormat.backgroundColor'
      }
    };
  }).filter(Boolean);

  if (requests.length) {
    await sheetsRequest(token, 'POST', `${API_BASE}/${spreadsheetId}:batchUpdate`, { requests });
  }
}

async function autoResize(token, spreadsheetId, sheetId) {
  await sheetsRequest(token, 'POST', `${API_BASE}/${spreadsheetId}:batchUpdate`, {
    requests: [{
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 7 }
      }
    }]
  });
}

// ── Synced-ID tracking ────────────────────────────────────────────────

async function getSyncedIds(key) {
  const r = await chrome.storage.local.get('syncedIds');
  return (r.syncedIds || {})[key] || [];
}

async function addSyncedIds(key, newIds) {
  const r = await chrome.storage.local.get('syncedIds');
  const all = r.syncedIds || {};
  all[key] = [...new Set([...(all[key] || []), ...newIds])];
  await chrome.storage.local.set({ syncedIds: all });
}

// ── Generic tab sync (月別タブ・クライアント別タブ共通) ───────────────

async function _syncTab(token, spreadsheetId, tabName, entries, clientMap, colorMap, storageKey) {
  const { sheetId, isNew } = await ensureSheet(token, spreadsheetId, tabName);

  const syncedIds = await getSyncedIds(storageKey);
  const syncedSet = new Set(syncedIds);
  const newEntries = entries.filter(e => !syncedSet.has(e.id));

  // 初回同期：ヘッダー＋全エントリを書き込み
  if (syncedIds.length === 0 || isNew) {
    const rows = [SHEET_HEADER, ...entries.map(e => buildRow(e, clientMap))];
    const range = `${tabName}!A1`;
    await sheetsRequest(token, 'PUT',
      `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      { range, values: rows }
    );
    await applyBaseFormatting(token, spreadsheetId, sheetId);
    await applyRowColors(token, spreadsheetId, sheetId, rows.slice(1), colorMap, 1);
    await addSyncedIds(storageKey, entries.map(e => e.id));
    return { rowCount: entries.length, mode: 'full' };
  }

  // 新規エントリなし → スキップ
  if (newEntries.length === 0) {
    return { rowCount: 0, mode: 'skip' };
  }

  // 追記モード：新しいエントリだけ末尾に追加
  const newRows = newEntries.map(e => buildRow(e, clientMap));
  const appendRes = await sheetsRequest(token, 'POST',
    `${API_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${tabName}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { values: newRows }
  );

  // 追記行に色付け＋列幅自動調整
  const updatedRange = appendRes.updates?.updatedRange || '';
  const rowMatch = updatedRange.match(/!A(\d+)/);
  if (rowMatch) {
    const startRowIndex = parseInt(rowMatch[1]) - 1;
    await applyRowColors(token, spreadsheetId, sheetId, newRows, colorMap, startRowIndex);
  }
  await autoResize(token, spreadsheetId, sheetId);

  await addSyncedIds(storageKey, newEntries.map(e => e.id));
  return { rowCount: newEntries.length, mode: 'append' };
}

// ── Main sync ─────────────────────────────────────────────────────────

// allEntries: 全月分の全エントリ（クライアント別タブ用）
async function syncToSheet(spreadsheetId, monthEntries, clients, monthStr, allEntries = null) {
  let token = await getAuthToken();
  try {
    return await _syncAll(token, spreadsheetId, monthEntries, clients, monthStr, allEntries);
  } catch (e) {
    if (!e.needsReauth) throw e;
    await clearAuthToken();
    token = await getAuthToken();
    return await _syncAll(token, spreadsheetId, monthEntries, clients, monthStr, allEntries);
  }
}

async function _syncAll(token, spreadsheetId, monthEntries, clients, monthStr, allEntries) {
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  const colorMap  = buildColorMap(clients);

  // ① 月別タブ（例: "2026-05"）
  const monthResult = await _syncTab(
    token, spreadsheetId, monthStr, monthEntries, clientMap, colorMap, monthStr
  );

  // ② クライアント別タブ（例: "ハルカ企画"）
  if (allEntries && clients.length) {
    for (const client of clients) {
      const clientEntries = allEntries.filter(e => e.clientId === client.id);
      if (clientEntries.length === 0) continue;
      await _syncTab(
        token, spreadsheetId, client.name, clientEntries, clientMap, colorMap, `client_${client.id}`
      );
    }
  }

  return monthResult;
}

// ── 強制フル同期（上書きリセット） ───────────────────────────────────

async function fullResyncToSheet(spreadsheetId, monthEntries, clients, monthStr, allEntries = null) {
  const r = await chrome.storage.local.get('syncedIds');
  const all = r.syncedIds || {};
  // 月別タブのキーをリセット
  delete all[monthStr];
  // クライアント別タブのキーをリセット
  clients.forEach(c => delete all[`client_${c.id}`]);
  await chrome.storage.local.set({ syncedIds: all });
  return syncToSheet(spreadsheetId, monthEntries, clients, monthStr, allEntries);
}

// ── CSV export ────────────────────────────────────────────────────────

function csvCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportAsCSV(entries, clients) {
  const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
  const lines = ['日付,クライアント,開始,終了,稼働時間,タグ,メモ'];
  entries.forEach(e => {
    const client = clientMap[e.clientId] || { name: e.clientId };
    const durationMin = Math.round((e.duration || 0) / 60000);
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    lines.push([
      e.date, client.name, e.startTimeStr || '', e.endTimeStr || '',
      `${h}:${String(m).padStart(2, '0')}`,
      (e.tags || []).join(' '),
      e.note || '',
    ].map(v => csvCell(sanitizeCell(v))).join(','));
  });
  return lines.join('\n');
}
