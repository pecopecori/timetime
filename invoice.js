let settings   = null;
let allEntries = [];

async function init() {
  settings   = await getSettings();
  allEntries = await getEntries();
  applyTheme(settings.theme);

  // Set default invoice date to today
  document.getElementById('invoiceDate').value = todayStr();

  // Populate client select
  populateClientSelect();
  loadSavedInvoiceConfig();
  bindEvents();
  generateInvoice();
}

function populateClientSelect() {
  const sel = document.getElementById('clientSelect');
  sel.innerHTML = (settings.clients || []).map(c =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
  ).join('');
}

function loadSavedInvoiceConfig() {
  const saved = JSON.parse(localStorage.getItem('invoiceConfig') || '{}');
  document.getElementById('fromName').value    = saved.fromName    || settings?.providerName || '';
  document.getElementById('fromDetail').value  = saved.fromDetail  || '';
  document.getElementById('payInfo').value     = saved.payInfo     || '';
  document.getElementById('invNumber').value   = saved.invNumber   || '001';
  document.getElementById('taxRate').value     = saved.taxRate     ?? 10;
  document.getElementById('noteText').value    = saved.noteText    || '';
}

function saveInvoiceConfig() {
  const config = {
    fromName:  document.getElementById('fromName').value,
    fromDetail: document.getElementById('fromDetail').value,
    payInfo:   document.getElementById('payInfo').value,
    invNumber: document.getElementById('invNumber').value,
    taxRate:   document.getElementById('taxRate').value,
    noteText:  document.getElementById('noteText').value,
  };
  localStorage.setItem('invoiceConfig', JSON.stringify(config));
}

function generateInvoice() {
  saveInvoiceConfig();

  const clientId = document.getElementById('clientSelect').value;
  const client   = settings.clients?.find(c => c.id === clientId);
  if (!client) return;

  const invoiceDateStr = document.getElementById('invoiceDate').value || todayStr();
  const [iy, im, id_] = invoiceDateStr.split('-').map(Number);
  const invoiceDate    = new Date(iy, im - 1, id_);
  const dueDate        = new Date(iy, im - 1, id_ + 30);

  const fromName    = document.getElementById('fromName').value   || settings?.providerName || '';
  const fromDetail  = document.getElementById('fromDetail').value || '';
  const payInfo     = document.getElementById('payInfo').value    || '';
  const invNumber   = document.getElementById('invNumber').value  || '001';
  const taxRate     = parseFloat(document.getElementById('taxRate').value) || 0;
  const noteText    = document.getElementById('noteText').value   || '';

  // Get entries for this client in the current billing period
  const billingDay   = settings.billingDay || 1;
  const now          = new Date();
  let billingStart;
  if (now.getDate() >= billingDay) {
    billingStart = new Date(now.getFullYear(), now.getMonth(), billingDay);
  } else {
    billingStart = new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
  }
  const billingEnd = new Date(billingStart);
  billingEnd.setMonth(billingEnd.getMonth() + 1);
  billingEnd.setDate(billingEnd.getDate() - 1);

  const startStr = formatDate(billingStart);
  const endStr   = formatDate(billingEnd);
  const entries  = allEntries
    .filter(e => e.clientId === clientId && e.date >= startStr && e.date <= endStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Set header fields
  document.getElementById('invNum').textContent   = `No. ${invNumber}`;
  document.getElementById('invDate').textContent  = formatJpDate(invoiceDate);
  document.getElementById('invDue').textContent   = formatJpDate(dueDate);
  document.getElementById('invToName').textContent = client.name;
  document.getElementById('invFromName').textContent = fromName;
  document.getElementById('invFromDetail').textContent = fromDetail;
  document.getElementById('paymentDetail').textContent = payInfo || '—';
  document.getElementById('invNote').textContent  = noteText;
  document.getElementById('taxRateLabel').textContent = taxRate;

  // Build table rows
  const hourlyRate = client.hourlyRate || 0;
  const tbody = document.getElementById('invTableBody');
  let subtotal = 0;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:rgba(0,0,0,0.35);padding:20px">
      この期間の稼働記録がありません
    </td></tr>`;
  } else {
    tbody.innerHTML = entries.map(e => {
      const hrs     = (e.duration || 0) / 3600000;
      const hStr    = formatDurationShort(e.duration);
      const tags    = (e.tags || []).join(', ');
      const desc    = tags ? `稼働（${tags}）` : '稼働';
      const amount  = Math.round(hrs * hourlyRate);
      subtotal += amount;
      return `
        <tr>
          <td>${escapeHtml(desc)}</td>
          <td>${e.date}</td>
          <td class="num">${hStr}</td>
          <td class="num">${hourlyRate > 0 ? `¥${hourlyRate.toLocaleString('ja-JP')}` : '—'}</td>
          <td class="num amt">${hourlyRate > 0 ? `¥${amount.toLocaleString('ja-JP')}` : '—'}</td>
        </tr>`;
    }).join('');
  }

  const tax   = Math.round(subtotal * taxRate / 100);
  const total = subtotal + tax;

  document.getElementById('invSubtotal').textContent = `¥${subtotal.toLocaleString('ja-JP')}`;
  document.getElementById('invTax').textContent      = `¥${tax.toLocaleString('ja-JP')}`;
  document.getElementById('invTotal').textContent    = `¥${total.toLocaleString('ja-JP')}`;
}

function formatJpDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function bindEvents() {
  document.getElementById('clientSelect').addEventListener('change', generateInvoice);
  document.getElementById('invoiceDate').addEventListener('change', generateInvoice);
  document.getElementById('generateBtn').addEventListener('click', generateInvoice);
}

init();
