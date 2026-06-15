const BANNER_WIDTH = 2000;
const BANNER_HEIGHT = 542;

const TEMPLATE_BY_COUNT = {
  0: 'Sem Selo - Banner - Tranpsarencia .png',
  1: '1 Selo - Banner - Tranpsarencia Padrão.png',
  2: '2 Selo - Banner - Tranpsarencia Padrão.png',
  3: '3 Selo - Banner - Tranpsarencia Padrão.png',
};

const SEAL_FILES = [
  'diamante_2022.png',
  'diamante_2023.png',
  'diamante_2024.png',
  'diamante_2025.png',
  'ouro_2022.png',
  'ouro_2023.png',
  'ouro_2024.png',
  'ouro_2025.png',
  'prata_2022.png',
  'prata_2023.png',
  'prata_2024.png',
  'prata_2025.png',
];

const SEAL_LAYOUTS = {
  1: [{ centerX: 577, centerY: 278, size: 471 }],
  2: [
    { centerX: 365, centerY: 261, size: 490 },
    { centerX: 701, centerY: 366, size: 300 },
  ],
  3: [
    { centerX: 365, centerY: 261, size: 490 },
    { centerX: 701, centerY: 366, size: 300 },
    { centerX: 609, centerY: 144, size: 281 },
  ],
};

const elements = {
  sealCount: document.getElementById('sealCount'),
  backgroundColor: document.getElementById('backgroundColor'),
  sealSelect1: document.getElementById('sealSelect1'),
  sealSelect2: document.getElementById('sealSelect2'),
  sealSelect3: document.getElementById('sealSelect3'),
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
  sealChoices: ['', '', ''],
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
    layout.forEach((box, index) => {
      const image = sealImages[index];
      if (image) {
        const halfSize = box.size / 2;
        ctx.drawImage(image, box.centerX - halfSize, box.centerY - halfSize, box.size, box.size);
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

function downloadBanner() {
  if (!state.renderedBlob) {
    setStatus('Gere o banner antes de baixar.');
    return;
  }

  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(state.renderedBlob);
  link.href = objectUrl;
  link.download = `banner-${state.sealCount}-selos.png`;
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
  await renderBanner();
});

elements.renderBtn.addEventListener('click', renderBanner);
elements.downloadBtn.addEventListener('click', downloadBanner);
elements.panelModeBtn.addEventListener('click', toggleFloatingPanel);
elements.minimizeFloatingBtns.forEach((button) => {
  button.addEventListener('click', toggleCurrentFloatingMinimized);
});

populateSealPicker(elements.sealSelect1, 'diamante_2025.png');
populateSealPicker(elements.sealSelect2, 'prata_2024.png');
populateSealPicker(elements.sealSelect3, 'ouro_2024.png');

wireSealPicker(elements.sealSelect1, 0);
wireSealPicker(elements.sealSelect2, 1);
wireSealPicker(elements.sealSelect3, 2);
wireFloatingDrag(elements.previewWindow, elements.previewHandle, () => !isConfigFloating());
wireFloatingDrag(elements.configWindow, elements.configHandle, () => isConfigFloating());
updateFloatingButtons();

state.sealChoices[0] = elements.sealSelect1.dataset.value;
state.sealChoices[1] = elements.sealSelect2.dataset.value;
state.sealChoices[2] = elements.sealSelect3.dataset.value;

updateSealSlotVisibility();

const initialContext = elements.previewCanvas.getContext('2d');
initialContext.fillStyle = elements.backgroundColor.value;
initialContext.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
setStatus('Selecione os selos e clique em Gerar banner.');
