const tbody = document.getElementById('tbody');
const empty = document.getElementById('empty');
const tablePanel = document.getElementById('tablePanel');
const copyJsonButton = document.getElementById('copyJson');
const downloadJsonButton = document.getElementById('downloadJson');

let rows = [];

copyJsonButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
});

downloadJsonButton.addEventListener('click', () => downloadRows(rows));

load();

async function load() {
  const data = await chrome.storage.local.get('lastAtriconResult');
  rows = Array.isArray(data.lastAtriconResult?.rows) ? data.lastAtriconResult.rows : [];
  if (!rows.length) {
    empty.hidden = false;
    tablePanel.hidden = true;
    copyJsonButton.disabled = true;
    downloadJsonButton.disabled = true;
    return;
  }

  empty.hidden = true;
  tablePanel.hidden = false;
  tbody.innerHTML = rows.map(renderRow).join('');
}

function renderRow(row) {
  return `
    <tr>
      <td>${escapeHtml(row.orgao)}</td>
      <td>${escapeHtml(row.cidade)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.setor_atual)}</td>
      <td>${escapeHtml(row.data)}</td>
      <td>${escapeHtml(row.porcentagem)}</td>
      <td>${escapeHtml(evidenceCount(row))}</td>
      <td class="${row.erro ? 'error' : ''}">${escapeHtml(row.erro || 'Sem erro')}</td>
    </tr>
  `;
}

function evidenceCount(row) {
  const total = Number(row.total_evidencias_validacao || 0);
  if (total) return `${total} validacao`;
  const evidences = Array.isArray(row.evidencias_validacao) ? row.evidencias_validacao.length : 0;
  return evidences ? `${evidences} validacao` : '0';
}

function downloadRows(rowsToDownload) {
  if (!Array.isArray(rowsToDownload) || !rowsToDownload.length) return;
  const json = JSON.stringify(rowsToDownload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `resultado_atricon_extensao_${timestampForFilename()}.json`,
    saveAs: true
  });
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function timestampForFilename() {
  const pad = (value) => String(value).padStart(2, '0');
  const now = new Date();
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
