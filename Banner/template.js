(() => {
  const CANVAS_SIZE = 1080;
  const INITIAL_NOTES_PATH = './nota_avalia.json';
  const SEAL_YEAR = 2025;
  const SEAL_SIZE = 498;
  const SEAL_LEFT = 628;
  const SEAL_BOTTOM = 612;
  const SEAL_ANGLE = 10 * Math.PI / 180;
  const LOGO_RIGHT = 22;
  const LOGO_BOTTOM = 30;
  const TEXT_LEFT = 45;
  const TEXT_RIGHT = 487;
  const TEXT_BOTTOM = 699;

  const LOGO_FILES = [
    'cm_ananas.png',
    'cm_aparecida_do_rio_negro.png',
    'cm_araguacu.png',
    'cm_araguana.png',
    'cm_carmolandia.png',
    'cm_centenario.png',
    'cm_colmeia.png',
    'cm_duere.png',
    'cm_envira.png',
    'cm_itaguatins.png',
    'cm_lajeado.png',
    'cm_lizarda.png',
    'cm_luzinopolis.png',
    'cm_mateiros.png',
    'cm_miranorte.png',
    'cm_nazare.png',
    'cm_nova_olinda.png',
    'cm_novo_acordo.png',
    'cm_palmeirante.png',
    'cm_palmeiras_do_tocantins.png',
    'cm_pau_d_arco.png',
    'cm_pindorama_do_tocantins.png',
    'cm_recursolandia.png',
    'cm_riachinho.png',
    'cm_rio_sono.png',
    'cm_santa_maria_do_tocantins.png',
    'cm_sao_bento_do_tocantins.png',
    'cm_sao_felix_do_tocantins.png',
    'cm_silvanopolis.png',
    'cm_tabocao.png',
    'pm_aparecida_do_rio_negro.png',
    'pm_babaculandia.png',
    'pm_carmolandia.png',
    'pm_centenario.png',
    'pm_divinopolis_do_tocantins.png',
    'pm_filadelfia.png',
    'pm_lagoa_da_confusao.png',
    'pm_lajeado.png',
    'pm_mateiros.png',
    'pm_miranorte.png',
    'pm_monte_do_carmo.png',
    'pm_nazare.png',
    'pm_piraque.png',
    'pm_ponte_alta_do_tocantins.png',
    'pm_pugmil.png',
    'pm_recursolandia.png',
    'pm_santa_fe_do_araguaia.png',
    'pm_santa_maria_do_tocantins.png',
    'pm_silvanopolis.png',
    'pm_tocantinopolis.png',
    'pm_tupirama.png',
  ];

  const elements = {
    tabButtons: Array.from(document.querySelectorAll('[data-tab-target]')),
    tabPanels: Array.from(document.querySelectorAll('[data-tab-panel]')),
    canvas: document.getElementById('templateCanvas'),
    jsonFile: document.getElementById('templateJsonFile'),
    recordSelect: document.getElementById('templateRecordSelect'),
    city: document.getElementById('templateCity'),
    agency: document.getElementById('templateAgency'),
    score: document.getElementById('templateScore'),
    logoFile: document.getElementById('templateLogoFile'),
    renderBtn: document.getElementById('templateRenderBtn'),
    downloadBtn: document.getElementById('templateDownloadBtn'),
    status: document.getElementById('templateStatus'),
    sealName: document.getElementById('templateSealName'),
  };

  const state = {
    records: [],
    renderedBlob: null,
    manualLogoUrl: '',
  };

  function setStatus(message) {
    elements.status.textContent = message;
  }

  function activateTab(tabName) {
    elements.tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === tabName;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    elements.tabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== tabName;
    });
  }

  function normalizeSlug(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  function sanitizeFilePart(value) {
    return normalizeSlug(value).replace(/_+/g, '-');
  }

  function titleCaseSlug(slug) {
    const lowercaseWords = new Set(['da', 'de', 'do', 'das', 'dos']);

    return String(slug || '')
      .split('_')
      .filter(Boolean)
      .map((word, index) => {
        if (index > 0 && lowercaseWords.has(word)) {
          return word;
        }

        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  }

  function getCityFromLogoFile(fileName) {
    return String(fileName || '')
      .replace(/^(cm|pm)_/i, '')
      .replace(/\.[^.]+$/, '');
  }

  function getRecordValue(record, keys) {
    return keys
      .map((key) => record?.[key])
      .find((value) => value !== undefined && value !== null && value !== '');
  }

  function getCity(record) {
    return getRecordValue(record, ['cidade', 'municipio', 'município', 'municÃ­pio']) || '';
  }

  function getAgencyText(record) {
    return getRecordValue(record, ['orgao', 'orgão', 'orgÃ£o', 'Ã³rgÃ£o']) || '';
  }

  function getAgencyCode(value) {
    const normalized = normalizeSlug(value);

    if (normalized.includes('prefeitura') || normalized === 'pm') {
      return 'pm';
    }

    return 'cm';
  }

  function getRecordLabel(record, index) {
    const agency = getAgencyText(record) || 'Entidade';
    const city = getCity(record) || `Registro ${index + 1}`;
    return `${agency} - ${city}`;
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

  function getScoreFromRecord(record) {
    return parseScore(getRecordValue(record, ['nota_2026', 'nota', 'nota_2025', 'nota_2024', 'nota_2023', 'nota_2022']));
  }

  function getSealType(score) {
    if (score >= 95 && score <= 100) {
      return 'diamante';
    }

    if (score >= 85 && score < 95) {
      return 'ouro';
    }

    if (score >= 75 && score < 85) {
      return 'prata';
    }

    return '';
  }

  function getBaseTemplate(score, agencyCode) {
    const type = getSealType(score);

    if (!type) {
      return null;
    }

    const agency = agencyCode === 'pm' ? 'PM' : 'CM';
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

    return {
      type,
      fileName: `${agency} - ${typeLabel}.png`,
      path: `./assets/${agency} - ${typeLabel}.png`,
    };
  }

  function getSealTemplate(score) {
    const type = getSealType(score);

    if (!type) {
      return null;
    }

    return {
      type,
      fileName: `${type}_${SEAL_YEAR}.png`,
      path: `./Selo/${type}_${SEAL_YEAR}.png`,
    };
  }

  function getLogoFileName(city, agencyCode) {
    const expected = `${agencyCode}_${normalizeSlug(city)}.png`;
    return LOGO_FILES.find((fileName) => fileName === expected) || '';
  }

  function loadImageFromPath(path) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Falha ao carregar ${path}`));
      image.src = new URL(encodeURI(path), document.baseURI).href;
    });
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

  function populateRecordSelect(records) {
    elements.recordSelect.innerHTML = '';

    if (!records.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum registro encontrado';
      elements.recordSelect.appendChild(option);
      return;
    }

    records.forEach((record, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = getRecordLabel(record, index);
      elements.recordSelect.appendChild(option);
    });
  }

  function populateCitySelect(records, agencyCode = elements.agency.value) {
    const currentValue = elements.city.value;
    const selectedAgency = agencyCode === 'pm' ? 'pm' : 'cm';
    const cityBySlug = new Map();

    LOGO_FILES.forEach((fileName) => {
      if (!fileName.toLowerCase().startsWith(`${selectedAgency}_`)) {
        return;
      }

      const slug = getCityFromLogoFile(fileName);

      if (slug && !cityBySlug.has(slug)) {
        cityBySlug.set(slug, titleCaseSlug(slug));
      }
    });

    records.forEach((record) => {
      if (getAgencyCode(getAgencyText(record)) !== selectedAgency) {
        return;
      }

      const city = getCity(record);
      const slug = normalizeSlug(city);

      if (city && slug) {
        cityBySlug.set(slug, city);
      }
    });

    const cities = Array.from(cityBySlug.values())
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    elements.city.innerHTML = '';

    if (!cities.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhuma cidade encontrada';
      elements.city.appendChild(option);
      return;
    }

    cities.forEach((city) => {
      const option = document.createElement('option');
      option.value = city;
      option.textContent = city;
      elements.city.appendChild(option);
    });

    if (cities.includes(currentValue)) {
      elements.city.value = currentValue;
    } else {
      elements.city.value = cities[0] || '';
    }
  }

  function applyRecord(index) {
    const record = state.records[index];

    if (!record) {
      return;
    }

    const city = getCity(record);
    const agencyText = getAgencyText(record);
    const score = getScoreFromRecord(record);

    elements.agency.value = getAgencyCode(agencyText);
    populateCitySelect(state.records, elements.agency.value);
    elements.city.value = city;
    elements.score.value = score === null ? '' : String(score);
  }

  async function loadRecords(records, sourceLabel) {
    if (!Array.isArray(records)) {
      throw new Error('O JSON precisa ser uma lista de registros.');
    }

    state.records = records;
    populateRecordSelect(records);
    populateCitySelect(records);

    if (!records.length) {
      setStatus(`JSON carregado de ${sourceLabel}, mas sem registros.`);
      return;
    }

    elements.recordSelect.value = '0';
    applyRecord(0);
    await renderTemplate();
    setStatus(`JSON carregado de ${sourceLabel}. ${records.length} registro(s) disponivel(is).`);
  }

  async function loadInitialNotes() {
    try {
      const response = await fetch(INITIAL_NOTES_PATH, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await loadRecords(await response.json(), INITIAL_NOTES_PATH);
    } catch (error) {
      console.warn(error);
      populateRecordSelect([]);
      populateCitySelect([]);
      setStatus('Nao foi possivel carregar ./nota_avalia.json automaticamente. Importe um JSON para listar as cidades.');
      await renderTemplate();
    }
  }

  function fitText(ctx, text, maxWidth, startSize) {
    let size = startSize;

    while (size > 18) {
      ctx.font = `800 ${size}px "Segoe UI", Tahoma, sans-serif`;

      if (ctx.measureText(text).width <= maxWidth) {
        return size;
      }

      size -= 2;
    }

    return size;
  }

  function drawCityName(ctx, city) {
    const text = String(city || '').trim();

    if (!text) {
      return;
    }

    const maxWidth = CANVAS_SIZE - TEXT_LEFT - TEXT_RIGHT;
    const fontSize = fitText(ctx, text.toUpperCase(), maxWidth, 56);
    const x = TEXT_LEFT;
    const y = CANVAS_SIZE - TEXT_BOTTOM;

    ctx.save();
    ctx.font = `800 ${fontSize}px "Segoe UI", Tahoma, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillText(text.toUpperCase(), x, y, maxWidth);
    ctx.restore();
  }

  async function getLogoImage(city, agencyCode) {
    if (state.manualLogoUrl) {
      return {
        image: await loadImageFromPath(state.manualLogoUrl),
        label: 'logo manual',
      };
    }

    const fileName = getLogoFileName(city, agencyCode);

    if (!fileName) {
      return null;
    }

    return {
      image: await loadImageFromPath(`./logos_sites/${fileName}`),
      label: fileName,
    };
  }

  function drawLogo(ctx, logoImage) {
    if (!logoImage) {
      return;
    }

    const x = CANVAS_SIZE - LOGO_RIGHT - logoImage.width;
    const y = CANVAS_SIZE - LOGO_BOTTOM - logoImage.height;
    ctx.drawImage(logoImage, x, y);
  }

  function drawRotatedImage(ctx, image, x, y, width, height, angle) {
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(angle);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  async function renderTemplate() {
    const ctx = elements.canvas.getContext('2d');
    const city = elements.city.value.trim();
    const agencyCode = elements.agency.value;
    const score = parseScore(elements.score.value);
    const baseTemplate = getBaseTemplate(score, agencyCode);
    const sealTemplate = getSealTemplate(score);
    const messages = [];

    elements.canvas.width = CANVAS_SIZE;
    elements.canvas.height = CANVAS_SIZE;
    elements.downloadBtn.disabled = true;
    state.renderedBlob = null;

    try {
      if (!baseTemplate) {
        throw new Error('Nota abaixo de 75, vazia ou invalida: nao existe imagem base para essa classificacao.');
      }

      const [baseImage, sealImage, logo] = await Promise.all([
        loadImageFromPath(baseTemplate.path),
        sealTemplate ? loadImageFromPath(sealTemplate.path) : Promise.resolve(null),
        getLogoImage(city, agencyCode).catch((error) => {
          messages.push(error.message);
          return null;
        }),
      ]);

      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.drawImage(baseImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

      if (sealImage) {
        drawRotatedImage(
          ctx,
          sealImage,
          SEAL_LEFT,
          CANVAS_SIZE - SEAL_BOTTOM - SEAL_SIZE,
          SEAL_SIZE,
          SEAL_SIZE,
          SEAL_ANGLE,
        );
      }

      drawLogo(ctx, logo?.image);
      drawCityName(ctx, city);

      state.renderedBlob = await new Promise((resolve) => elements.canvas.toBlob(resolve, 'image/png'));
      elements.downloadBtn.disabled = !state.renderedBlob;
      elements.sealName.textContent = `Imagem: ${baseTemplate.fileName} | Selo: ${sealTemplate?.fileName || 'sem selo'}`;

      if (!city) {
        messages.push('Nome da cidade vazio.');
      }

      if (!logo) {
        messages.push('Logo automatica nao encontrada; use Logo manual se necessario.');
      }

      setStatus(messages.length ? messages.join('\n') : 'Imagem gerada com sucesso.');
    } catch (error) {
      console.error(error);
      elements.sealName.textContent = 'Imagem: erro';
      setStatus(error.message || 'Nao foi possivel gerar a imagem.');
    }
  }

  function downloadTemplate() {
    if (!state.renderedBlob) {
      setStatus('Gere a imagem antes de baixar.');
      return;
    }

    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(state.renderedBlob);
    const city = sanitizeFilePart(elements.city.value || 'cidade');
    const agency = elements.agency.value || 'orgao';

    link.href = objectUrl;
    link.download = `template-2026-${agency}-${city}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
  });

  elements.recordSelect.addEventListener('change', async () => {
    applyRecord(Number(elements.recordSelect.value));
    await renderTemplate();
  });

  elements.jsonFile.addEventListener('change', async () => {
    const [file] = elements.jsonFile.files;

    if (!file) {
      return;
    }

    try {
      setStatus('Lendo JSON importado...');
      await loadRecords(await readJsonFile(file), file.name);
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Nao foi possivel importar o JSON.');
    }
  });

  [elements.city, elements.score].forEach((input) => {
    input.addEventListener('input', renderTemplate);
    input.addEventListener('change', renderTemplate);
  });

  elements.agency.addEventListener('change', async () => {
    populateCitySelect(state.records);
    await renderTemplate();
  });

  elements.logoFile.addEventListener('change', async () => {
    if (state.manualLogoUrl) {
      URL.revokeObjectURL(state.manualLogoUrl);
      state.manualLogoUrl = '';
    }

    const [file] = elements.logoFile.files;

    if (file) {
      state.manualLogoUrl = URL.createObjectURL(file);
    }

    await renderTemplate();
  });

  elements.renderBtn.addEventListener('click', renderTemplate);
  elements.downloadBtn.addEventListener('click', downloadTemplate);

  activateTab('banner');
  populateCitySelect([]);
  renderTemplate();
  loadInitialNotes();
})();
