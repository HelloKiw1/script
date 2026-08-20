const BANNER_WIDTH = 2000;
const BANNER_HEIGHT = 542;

const TEMPLATE_BY_COUNT = {
  0: 'Sem Selo - Banner - Tranpsarencia .png',
  1: '1 Selo - Banner - Tranpsarencia Padrão.png',
  2: '2 Selo - Banner - Tranpsarencia Padrão.png',
  3: '3 Selo - Banner - Tranpsarencia Padrão.png',
  4: '4 Selo - Banner - Tranpsarencia Padrão.png',
  5: '5 Selo - Banner - Tranpsarencia Padrão.png',
};

const SEAL_FILE_OVERRIDES = {
  ouro_2026: 'ouro_2026_transparente.png',
};

const SEAL_FILES = [
  'diamante_2022.png',
  'diamante_2023.png',
  'diamante_2024.png',
  'diamante_2025.png',
  'diamante_2026.png',
  'ouro_2022.png',
  'ouro_2023.png',
  'ouro_2024.png',
  'ouro_2025.png',
  'ouro_2026_transparente.png',
  'prata_2022.png',
  'prata_2023.png',
  'prata_2024.png',
  'prata_2025.png',
  'prata_2026.png',
];

const INITIAL_NOTES_PATH = '../.venv/nota_avalia.json';
const SUPPORTED_YEARS = [2022, 2023, 2024, 2025, 2026];
const SEAL_PRIORITY = {
  diamante: 3,
  ouro: 2,
  prata: 1,
};

const SEAL_LAYOUTS = {
  1: [{ centerX: 577, centerY: 278, size: 471 }],
  2: [
    { centerX: 365, centerY: 261, size: 490 },
    { centerX: 701, centerY: 366, size: 379 },
  ],
  3: [
    { centerX: 365, centerY: 261, size: 490 },
    { centerX: 701, centerY: 366, size: 379 },
    { centerX: 609, centerY: 144, size: 281 },
  ],
  4: [
    { x: 176, y: 71, width: 285, height: 288 },
    { x: 423, y: 9, width: 285, height: 286 },
    { x: 614, y: 190, width: 286, height: 288 },
    { x: 373, y: 247, width: 284, height: 286 },
  ],
  5: [
    { x: 165, y: 51, width: 243, height: 244 },
    { x: 605, y: 51, width: 246, height: 244 },
    { x: 149, y: 210, width: 241, height: 241 },
    { x: 638, y: 210, width: 241, height: 241 },
    { x: 338, y: 114, width: 353, height: 353 },
  ],
};

const SEAL_OVERLAP_PRIORITY = {
  4: [3, 1, 0, 2],
  5: [0, 1, 4, 2, 3],
};

const elements = {
  sealCount: document.getElementById('sealCount'),
  backgroundColor: document.getElementById('backgroundColor'),
  sealSelect1: document.getElementById('sealSelect1'),
  sealSelect2: document.getElementById('sealSelect2'),
  sealSelect3: document.getElementById('sealSelect3'),
  sealSelect4: document.getElementById('sealSelect4'),
  sealSelect5: document.getElementById('sealSelect5'),
  jsonFile: document.getElementById('jsonFile'),
  recordSelect: document.getElementById('recordSelect'),
  scorePreview: document.getElementById('scorePreview'),
  renderBtn: document.getElementById('renderBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  panelModeBtn: document.getElementById('panelModeBtn'),
  minimizeFloatingBtns: Array.from(document.querySelectorAll('[data-minimize-floating]')),
  status: document.getElementById('status'),
  previewCanvas: document.getElementById('previewCanvas'),
  templateName: document.getElementById('templateName'),
  previewWindow: document.querySelector('.workspace'),
  previewHandle: document.querySelector('.preview-head'),
  configWindow: document.querySelector('.sidebar'),
  configHandle: document.querySelector('.config-head'),
  sealSlots: Array.from(document.querySelectorAll('.seal-slot')),
};

const state = {
  sealCount: Number(elements.sealCount.value),
  backgroundColor: elements.backgroundColor.value,
  manualBackgroundColor: elements.backgroundColor.value,
  sealChoices: ['', '', '', '', ''],
  noteRecords: [],
  currentRecord: null,
  currentSeals: [],
  renderedBlob: null,
};

function getSealMeta(fileName) {
  const name = fileName.replace(/\.[^.]+$/, '');
  const year = name.match(/\d{4}/)?.[0] ?? '';
  const type = name.replace(/[_-]?\d{4}.*/, '').replace(/[_-]+/g, ' ');

  return {
    type,
    year,
  };
}

function getSealFileName(type, year) {
  return SEAL_FILE_OVERRIDES[`${type}_${year}`] || `${type}_${year}.png`;
}

function getRecordValue(record, keys) {
  return keys.map((key) => record?.[key]).find((value) => value !== undefined && value !== null && value !== '');
}

function getRecordLabel(record, index) {
  const agency = getRecordValue(record, ['órgão', 'orgão', 'orgao', 'orgÃ£o']) || 'Entidade';
  const city = getRecordValue(record, ['cidade', 'município', 'municipio']) || `Registro ${index + 1}`;
  return `${agency} - ${city}`;
}

function getSolidColorFromRecord(record) {
  const value = getRecordValue(record, ['cor_solida', 'cor_sólida', 'corSolida']);
  const color = String(value || '').trim();

  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : null;
}

function parseScore(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(String(value).replace('%', '').replace(',', '.').trim());

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function getSealTypeFromScore(score) {
  if (score >= 95 && score <= 100) {
    return 'diamante';
  }

  if (score >= 85 && score < 95) {
    return 'ouro';
  }

  if (score >= 75 && score < 85) {
    return 'prata';
  }

  return null;
}

function getSealsFromRecord(record) {
  const seals = SUPPORTED_YEARS
    .map((year) => {
      const score = parseScore(record?.[`nota_${year}`]);
      const type = score === null ? null : getSealTypeFromScore(score);
      const fileName = type ? getSealFileName(type, year) : '';

      return {
        year,
        score,
        type,
        fileName,
        isAvailable: Boolean(fileName && SEAL_FILES.includes(fileName)),
      };
    })
    .filter((seal) => seal.type && seal.isAvailable)
    .sort((a, b) => {
      const priorityDiff = SEAL_PRIORITY[b.type] - SEAL_PRIORITY[a.type];

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const scoreDiff = b.score - a.score;

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return b.year - a.year;
    });

  return seals.slice(0, 5);
}

function renderScorePreview(seals) {
  elements.scorePreview.innerHTML = '';

  if (!seals.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Nenhuma nota entre 75% e 100% nos anos com selo disponivel.';
    elements.scorePreview.appendChild(empty);
    return;
  }

  seals.forEach((seal, index) => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    const value = document.createElement('span');

    title.textContent = `${index + 1}. ${seal.type} ${seal.year}`;
    value.textContent = `${seal.score.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}%`;

    item.append(title, value);
    elements.scorePreview.appendChild(item);
  });
}

function syncPickerSelections() {
  [
    elements.sealSelect1,
    elements.sealSelect2,
    elements.sealSelect3,
    elements.sealSelect4,
    elements.sealSelect5,
  ].forEach((picker, index) => {
    selectSealChoice(picker, state.sealChoices[index] || '');
  });
}

function selectSealChoice(picker, fileName) {
  picker.dataset.value = fileName;

  picker.querySelectorAll('.seal-option').forEach((option) => {
    const isSelected = option.dataset.value === fileName;
    option.classList.toggle('is-selected', isSelected);
    option.setAttribute('aria-pressed', String(isSelected));
  });
}

function populateSealPicker(picker, defaultValue = '') {
  picker.innerHTML = '';

  SEAL_FILES.forEach((fileName) => {
    const meta = getSealMeta(fileName);
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'seal-option';
    option.dataset.value = fileName;
    option.setAttribute('aria-pressed', 'false');
    option.setAttribute('title', fileName);

    const image = document.createElement('img');
    image.src = new URL(encodeURI(`./Selo/${fileName}`), document.baseURI).href;
    image.alt = `${meta.type} ${meta.year}`.trim();
    image.loading = 'lazy';

    const label = document.createElement('span');
    label.className = 'seal-label';

    const type = document.createElement('span');
    type.className = 'seal-type';
    type.textContent = meta.type;

    const year = document.createElement('span');
    year.className = 'seal-year';
    year.textContent = meta.year;

    label.append(type, year);
    option.append(image, label);
    picker.appendChild(option);
  });

  selectSealChoice(picker, defaultValue);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function populateRecordSelect(records) {
  elements.recordSelect.innerHTML = '';

  if (!records.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Nenhum registro encontrado';
    elements.recordSelect.appendChild(option);
    renderScorePreview([]);
    return;
  }

  records.forEach((record, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = getRecordLabel(record, index);
    elements.recordSelect.appendChild(option);
  });
}

async function applyRecordByIndex(index) {
  const record = state.noteRecords[index];

  if (!record) {
    return;
  }

  const seals = getSealsFromRecord(record);
  const solidColor = getSolidColorFromRecord(record);

  state.currentRecord = record;
  state.currentSeals = seals;
  state.sealChoices = ['', '', '', '', ''];
  seals.forEach((seal, sealIndex) => {
    state.sealChoices[sealIndex] = seal.fileName;
  });

  elements.sealCount.value = String(seals.length);
  elements.backgroundColor.value = solidColor || state.manualBackgroundColor;
  syncPickerSelections();
  updateSealSlotVisibility();
  renderScorePreview(seals);
  await renderBanner();
}

async function loadNoteRecords(records, sourceLabel) {
  if (!Array.isArray(records)) {
    throw new Error('O JSON precisa ser uma lista de registros.');
  }

  state.noteRecords = records;
  populateRecordSelect(records);

  if (!records.length) {
    state.currentRecord = null;
    state.currentSeals = [];
    state.sealChoices = ['', '', '', '', ''];
    elements.sealCount.value = '0';
    syncPickerSelections();
    updateSealSlotVisibility();
    renderScorePreview([]);
    await renderBanner();
    setStatus(`JSON carregado de ${sourceLabel}, mas sem registros.`);
    return;
  }

  elements.recordSelect.value = '0';
  await applyRecordByIndex(0);
  setStatus(`JSON carregado de ${sourceLabel}. ${records.length} registro(s) disponivel(is).`);
}

async function loadInitialNotes() {
  try {
    const response = await fetch(INITIAL_NOTES_PATH, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const records = await response.json();
    await loadNoteRecords(records, INITIAL_NOTES_PATH);
  } catch (error) {
    console.warn(error);
    populateRecordSelect([]);
    setStatus('Nao foi possivel carregar ../.venv/nota_avalia.json automaticamente. Importe um JSON para gerar por nota.');
  }
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (error) {
        reject(new Error('Arquivo JSON invalido.'));
      }
    };
    reader.onerror = () => reject(new Error('Nao foi possivel ler o arquivo JSON.'));
    reader.readAsText(file);
  });
}

function updateSealSlotVisibility() {
  const visibleCount = Number(elements.sealCount.value);

  elements.sealSlots.forEach((slot, index) => {
    slot.classList.toggle('is-visible', index < visibleCount);
  });
}

function getTemplatePath(count) {
  const fileName = TEMPLATE_BY_COUNT[count] ?? TEMPLATE_BY_COUNT[3];
  return {
    fileName,
    path: `./tipos de banner Sem Fundo/${fileName}`,
  };
}

function loadImageFromPath(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Falha ao carregar ${path}`));
    image.src = new URL(encodeURI(path), document.baseURI).href;
  });
}

async function renderBanner() {
  const canvas = elements.previewCanvas;
  const ctx = canvas.getContext('2d');
  const count = Number(elements.sealCount.value);
  const sealFiles = state.sealChoices.slice(0, count);
  const template = getTemplatePath(count);

  state.sealCount = count;
  state.backgroundColor = elements.backgroundColor.value;
  elements.templateName.textContent = `Template: ${template.fileName}`;

  if (count > 0 && sealFiles.some((sealFile) => !sealFile)) {
    setStatus(`Selecione os ${count} selos antes de gerar o banner.`);
    elements.downloadBtn.disabled = true;
    return;
  }

  try {
    setStatus('Carregando imagens...');

    const sealImages = await Promise.all(sealFiles.map((sealFile) => loadImageFromPath(`./Selo/${sealFile}`)));
    const templateImage = await loadImageFromPath(template.path);

    canvas.width = BANNER_WIDTH;
    canvas.height = BANNER_HEIGHT;

    ctx.clearRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
    ctx.fillStyle = state.backgroundColor;
    ctx.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);

    ctx.drawImage(templateImage, 0, 0, BANNER_WIDTH, BANNER_HEIGHT);

    const layout = SEAL_LAYOUTS[count] ?? [];
    const overlapPriority = SEAL_OVERLAP_PRIORITY[count] ?? layout.map((_, index) => index);

    overlapPriority
      .slice()
      .reverse()
      .forEach((index) => {
        const box = layout[index];
        const image = sealImages[index];

        if (box && image) {
          const width = box.width ?? box.size;
          const height = box.height ?? box.size;
          const x = box.x ?? box.centerX - width / 2;
          const y = box.y ?? box.centerY - height / 2;
          ctx.drawImage(image, x, y, width, height);
        }
      });

    state.renderedBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    elements.downloadBtn.disabled = !state.renderedBlob;
    setStatus(`Banner gerado com sucesso. Template usado: ${template.fileName}`);
  } catch (error) {
    console.error(error);
    state.renderedBlob = null;
    elements.downloadBtn.disabled = true;
    setStatus(error.message || 'Não foi possível gerar o banner.');
  }
}

function sanitizeFilePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function downloadBanner() {
  if (!state.renderedBlob) {
    setStatus('Gere o banner antes de baixar.');
    return;
  }

  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(state.renderedBlob);
  const recordName = state.currentRecord
    ? sanitizeFilePart(getRecordLabel(state.currentRecord, elements.recordSelect.value || 0))
    : '';
  link.href = objectUrl;
  link.download = recordName
    ? `banner-${recordName}.png`
    : `banner-${state.sealCount}-selos.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function resetFloatingPosition(panel) {
  panel.style.left = '';
  panel.style.top = '';
  panel.style.right = '';
  panel.style.bottom = '';
}

function isConfigFloating() {
  return document.body.classList.contains('config-floating');
}

function isFloatingMinimized() {
  return isConfigFloating()
    ? document.body.classList.contains('config-minimized')
    : document.body.classList.contains('preview-minimized');
}

function clearFloatingMinimized() {
  document.body.classList.remove('preview-minimized', 'config-minimized');
}

function updateFloatingButtons() {
  const configIsFloating = isConfigFloating();

  elements.panelModeBtn.textContent = configIsFloating
    ? 'Flutuar pre-visualizacao'
    : 'Flutuar configuracao';

  elements.minimizeFloatingBtns.forEach((button) => {
    button.textContent = isFloatingMinimized() ? 'Restaurar' : 'Minimizar';
  });
}

function toggleFloatingPanel() {
  document.body.classList.toggle('config-floating');

  clearFloatingMinimized();
  resetFloatingPosition(elements.previewWindow);
  resetFloatingPosition(elements.configWindow);
  updateFloatingButtons();
}

function toggleCurrentFloatingMinimized() {
  if (isConfigFloating()) {
    document.body.classList.toggle('config-minimized');
    document.body.classList.remove('preview-minimized');
  } else {
    document.body.classList.toggle('preview-minimized');
    document.body.classList.remove('config-minimized');
  }

  updateFloatingButtons();
}

function wireSealPicker(picker, index) {
  picker.addEventListener('click', async (event) => {
    const option = event.target.closest('.seal-option');

    if (!option) {
      return;
    }

    selectSealChoice(picker, option.dataset.value);
    state.sealChoices[index] = option.dataset.value;

    if (!option.dataset.value) {
      setStatus(`Selo ${index + 1} removido.`);
      return;
    }

    setStatus(`Selo ${index + 1} selecionado: ${option.dataset.value}`);
    await renderBanner();
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wireFloatingDrag(panel, handle, isEnabled) {
  if (!panel || !handle) {
    return;
  }

  let dragStart = null;

  handle.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 980px)').matches) {
      return;
    }

    if (!isEnabled()) {
      return;
    }

    if (event.target.closest('button')) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    dragStart = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };

    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener('pointermove', (event) => {
    if (!dragStart) {
      return;
    }

    const nextLeft = dragStart.left + event.clientX - dragStart.pointerX;
    const nextTop = dragStart.top + event.clientY - dragStart.pointerY;
    const maxLeft = Math.max(8, window.innerWidth - dragStart.width - 8);
    const maxTop = Math.max(8, window.innerHeight - dragStart.height - 8);

    panel.style.left = `${clamp(nextLeft, 8, maxLeft)}px`;
    panel.style.top = `${clamp(nextTop, 8, maxTop)}px`;
  });

  handle.addEventListener('pointerup', () => {
    dragStart = null;
  });

  handle.addEventListener('pointercancel', () => {
    dragStart = null;
  });
}

elements.sealCount.addEventListener('change', async () => {
  updateSealSlotVisibility();
  await renderBanner();
});

elements.backgroundColor.addEventListener('input', async () => {
  state.manualBackgroundColor = elements.backgroundColor.value;
  await renderBanner();
});

elements.recordSelect.addEventListener('change', async () => {
  await applyRecordByIndex(Number(elements.recordSelect.value));
});

elements.jsonFile.addEventListener('change', async () => {
  const [file] = elements.jsonFile.files;

  if (!file) {
    return;
  }

  try {
    setStatus('Lendo JSON importado...');
    const records = await readJsonFile(file);
    await loadNoteRecords(records, file.name);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Nao foi possivel importar o JSON.');
  }
});

elements.renderBtn.addEventListener('click', renderBanner);
elements.downloadBtn.addEventListener('click', downloadBanner);
elements.panelModeBtn.addEventListener('click', toggleFloatingPanel);
elements.minimizeFloatingBtns.forEach((button) => {
  button.addEventListener('click', toggleCurrentFloatingMinimized);
});

populateSealPicker(elements.sealSelect1, 'diamante_2026.png');
populateSealPicker(elements.sealSelect2, 'prata_2026.png');
populateSealPicker(elements.sealSelect3, 'ouro_2026_transparente.png');
populateSealPicker(elements.sealSelect4, 'diamante_2025.png');
populateSealPicker(elements.sealSelect5, 'ouro_2025.png');

wireSealPicker(elements.sealSelect1, 0);
wireSealPicker(elements.sealSelect2, 1);
wireSealPicker(elements.sealSelect3, 2);
wireSealPicker(elements.sealSelect4, 3);
wireSealPicker(elements.sealSelect5, 4);
wireFloatingDrag(elements.previewWindow, elements.previewHandle, () => !isConfigFloating());
wireFloatingDrag(elements.configWindow, elements.configHandle, () => isConfigFloating());
updateFloatingButtons();

state.sealChoices[0] = elements.sealSelect1.dataset.value;
state.sealChoices[1] = elements.sealSelect2.dataset.value;
state.sealChoices[2] = elements.sealSelect3.dataset.value;
state.sealChoices[3] = elements.sealSelect4.dataset.value;
state.sealChoices[4] = elements.sealSelect5.dataset.value;

updateSealSlotVisibility();

const initialContext = elements.previewCanvas.getContext('2d');
initialContext.fillStyle = elements.backgroundColor.value;
initialContext.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
setStatus('Carregando notas...');
loadInitialNotes();
