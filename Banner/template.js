(() => {
  const CANVAS_SIZE = 1080;
  const INITIAL_NOTES_PATH = './nota_avalia.json';
  const BATCH_DOWNLOAD_LABEL = 'Baixar todas (.zip)';
  const LOGO_PATH = './logos_sites_padronizadas';
  const SEAL_YEAR = 2026;
  const SEAL_FILE_OVERRIDES = Object.freeze({
    ouro_2026: 'ouro_2026_transparente.png',
  });
  const SEAL_SIZE = 498;
  const SEAL_LEFT = 628;
  const SEAL_BOTTOM = 612;
  const SEAL_ANGLE = 10 * Math.PI / 180;
  const LOGO_WIDTH = 400;
  const LOGO_RIGHT = 9;
  const LOGO_BOTTOM = 4;
  const LOGO_OUTLINE_COLOR = 'rgba(255, 255, 255, 0.95)';
  const LOGO_OUTLINE_BLUR = 2;
  const TEXT_LEFT = 49;
  const TEXT_RIGHT = 488;
  const TEXT_BOTTOM = 698;

  const CITY_NAMES = Object.freeze({
    ananas: 'Ananás',
    aparecida_do_rio_negro: 'Aparecida do Rio Negro',
    araguacu: 'Araguaçu',
    araguana: 'Araguanã',
    babaculandia: 'Babaçulândia',
    carmolandia: 'Carmolândia',
    centenario: 'Centenário',
    colmeia: 'Colméia',
    divinopolis_do_tocantins: 'Divinópolis do Tocantins',
    duere: 'Dueré',
    envira: 'Envira',
    filadelfia: 'Filadélfia',
    itaguatins: 'Itaguatins',
    lagoa_da_confusao: 'Lagoa da Confusão',
    lajeado: 'Lajeado',
    lizarda: 'Lizarda',
    luzinopolis: 'Luzinópolis',
    mateiros: 'Mateiros',
    miranorte: 'Miranorte',
    monte_do_carmo: 'Monte do Carmo',
    nazare: 'Nazaré',
    nova_olinda: 'Nova Olinda',
    novo_acordo: 'Novo Acordo',
    palmeirante: 'Palmeirante',
    palmeiras_do_tocantins: 'Palmeiras do Tocantins',
    pau_d_arco: "Pau D'Arco",
    pindorama_do_tocantins: 'Pindorama do Tocantins',
    piraque: 'Piraquê',
    ponte_alta_do_tocantins: 'Ponte Alta do Tocantins',
    pugmil: 'Pugmil',
    recursolandia: 'Recursolândia',
    riachinho: 'Riachinho',
    rio_sono: 'Rio Sono',
    santa_fe_do_araguaia: 'Santa Fé do Araguaia',
    santa_maria_do_tocantins: 'Santa Maria do Tocantins',
    sao_bento_do_tocantins: 'São Bento do Tocantins',
    sao_felix_do_tocantins: 'São Félix do Tocantins',
    silvanopolis: 'Silvanópolis',
    tabocao: 'Tabocão',
    tocantinopolis: 'Tocantinópolis',
    tupirama: 'Tupirama',
  });

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
    downloadAllBtn: document.getElementById('templateDownloadAllBtn'),
    status: document.getElementById('templateStatus'),
    sealName: document.getElementById('templateSealName'),
  };

  const state = {
    records: [],
    renderedBlob: null,
    manualLogoUrl: '',
    isBatchDownloading: false,
  };

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
      let value = index;

      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      }

      table[index] = value >>> 0;
    }

    return table;
  })();

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
    const normalizedSlug = String(slug || '').toLowerCase();

    if (CITY_NAMES[normalizedSlug]) {
      return CITY_NAMES[normalizedSlug];
    }

    return normalizedSlug
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

  function getBatchEligibleCount(records = state.records) {
    return records.filter((record) => {
      const score = getScoreFromRecord(record);
      const agencyCode = getAgencyCode(getAgencyText(record));
      return Boolean(getBaseTemplate(score, agencyCode));
    }).length;
  }

  function updateBatchDownloadButton() {
    const eligibleCount = getBatchEligibleCount();
    elements.downloadAllBtn.disabled = state.isBatchDownloading || eligibleCount === 0;
    elements.downloadAllBtn.textContent = eligibleCount
      ? `Baixar todas (${eligibleCount}) (.zip)`
      : BATCH_DOWNLOAD_LABEL;
    elements.downloadAllBtn.title = eligibleCount
      ? `${eligibleCount} entidade(s) com nota valida entre 75 e 100`
      : 'Nenhuma entidade possui nota valida entre 75 e 100';
    return eligibleCount;
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

    const fileName = SEAL_FILE_OVERRIDES[`${type}_${SEAL_YEAR}`] || `${type}_${SEAL_YEAR}.png`;

    return {
      type,
      fileName,
      path: `./Selo/${fileName}`,
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
    const eligibleCount = updateBatchDownloadButton();

    if (!records.length) {
      setStatus(`JSON carregado de ${sourceLabel}, mas sem registros.`);
      return;
    }

    elements.recordSelect.value = '0';
    applyRecord(0);
    await renderTemplate();
    setStatus(
      `JSON carregado de ${sourceLabel}. ${records.length} registro(s) disponivel(is); `
      + `${eligibleCount} apto(s) para o ZIP.`,
    );
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

  function fitText(ctx, text, targetWidth, referenceSize) {
    ctx.font = `800 ${referenceSize}px "Segoe UI", Tahoma, sans-serif`;
    const measuredWidth = ctx.measureText(text).width;

    if (!measuredWidth) {
      return referenceSize;
    }

    return referenceSize * (targetWidth / measuredWidth);
  }

  function drawSkipInkUnderline(ctx, text, x, baselineY, width, fontSize) {
    const layer = document.createElement('canvas');
    layer.width = CANVAS_SIZE;
    layer.height = CANVAS_SIZE;

    const layerCtx = layer.getContext('2d');
    const thickness = Math.max(2, Math.min(5, fontSize * 0.05));
    const offset = Math.max(3, Math.min(7, fontSize * 0.06));
    const underlineY = baselineY + offset;

    layerCtx.beginPath();
    layerCtx.moveTo(x, underlineY);
    layerCtx.lineTo(x + width, underlineY);
    layerCtx.lineWidth = thickness;
    layerCtx.lineCap = 'round';
    layerCtx.strokeStyle = '#ffffff';
    layerCtx.stroke();

    layerCtx.globalCompositeOperation = 'destination-out';
    layerCtx.font = ctx.font;
    layerCtx.textAlign = 'left';
    layerCtx.textBaseline = 'alphabetic';
    layerCtx.lineJoin = 'round';
    layerCtx.lineWidth = thickness + 4;
    layerCtx.strokeStyle = '#000000';
    layerCtx.fillStyle = '#000000';
    layerCtx.strokeText(text, x, baselineY);
    layerCtx.fillText(text, x, baselineY);

    ctx.drawImage(layer, 0, 0);
  }

  function drawCityName(ctx, city) {
    const text = String(city || '').trim();

    if (!text) {
      return;
    }

    const maxWidth = CANVAS_SIZE - TEXT_LEFT - TEXT_RIGHT;
    const cityName = text.toUpperCase();
    const fontSize = fitText(ctx, cityName, maxWidth, 56);
    const x = TEXT_LEFT;
    const visibleBottomY = CANVAS_SIZE - TEXT_BOTTOM;

    ctx.save();
    ctx.font = `800 ${fontSize}px "Segoe UI", Tahoma, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText(cityName);
    const y = visibleBottomY - (metrics.actualBoundingBoxDescent || 0);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillText(cityName, x, y);
    drawSkipInkUnderline(ctx, cityName, x, y, metrics.width, fontSize);
    ctx.restore();
  }

  async function getLogoImage(city, agencyCode, useManualLogo = true) {
    if (useManualLogo && state.manualLogoUrl) {
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
      image: await loadImageFromPath(`${LOGO_PATH}/${fileName}`),
      label: fileName,
    };
  }

  function drawLogo(ctx, logoImage) {
    if (!logoImage) {
      return;
    }

    const width = LOGO_WIDTH;
    const height = logoImage.height * (width / logoImage.width);
    const x = CANVAS_SIZE - LOGO_RIGHT - width;
    const y = CANVAS_SIZE - LOGO_BOTTOM - height;

    ctx.save();
    ctx.shadowColor = LOGO_OUTLINE_COLOR;
    ctx.shadowBlur = LOGO_OUTLINE_BLUR;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(logoImage, x, y, width, height);

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.drawImage(logoImage, x, y, width, height);
    ctx.restore();
  }

  function drawRotatedImage(ctx, image, x, y, width, height, angle) {
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(angle);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Nao foi possivel gerar o arquivo PNG.'));
      }, 'image/png');
    });
  }

  async function renderRecordToPng(record) {
    const city = String(getCity(record) || '').trim();
    const agencyCode = getAgencyCode(getAgencyText(record));
    const score = getScoreFromRecord(record);
    const baseTemplate = getBaseTemplate(score, agencyCode);
    const sealTemplate = getSealTemplate(score);

    if (!city) {
      throw new Error('registro sem cidade');
    }

    if (!baseTemplate) {
      throw new Error('nota abaixo de 75, vazia ou invalida');
    }

    const [baseImage, sealImage, logo] = await Promise.all([
      loadImageFromPath(baseTemplate.path),
      sealTemplate ? loadImageFromPath(sealTemplate.path) : Promise.resolve(null),
      getLogoImage(city, agencyCode, false).catch(() => null),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');

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

    return {
      agencyCode,
      blob: await canvasToPngBlob(canvas),
      city,
      hasLogo: Boolean(logo),
    };
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

  function calculateCrc32(bytes) {
    let crc = 0xffffffff;

    bytes.forEach((byte) => {
      crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });

    return (crc ^ 0xffffffff) >>> 0;
  }

  function getZipTimestamp(date = new Date()) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));

    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    };
  }

  async function createZipBlob(files) {
    const encoder = new TextEncoder();
    const timestamp = getZipTimestamp();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    let centralSize = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const crc = calculateCrc32(data);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);

      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, timestamp.time, true);
      localView.setUint16(12, timestamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);

      const centralHeader = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);

      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, timestamp.time, true);
      centralView.setUint16(14, timestamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralHeader.set(nameBytes, 46);

      localParts.push(localHeader, data);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + data.length;
      centralSize += centralHeader.length;
    }

    const endRecord = new Uint8Array(22);
    const endView = new DataView(endRecord.buffer);

    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
  }

  async function downloadAllTemplates() {
    if (state.isBatchDownloading) {
      return;
    }

    if (!state.records.length) {
      setStatus('Carregue um JSON com entidades antes de gerar o ZIP.');
      return;
    }

    if (!getBatchEligibleCount()) {
      setStatus(
        'O JSON carregado nao possui notas validas entre 75 e 100. '
        + 'Carregue um arquivo com notas preenchidas, como nota_avalia_exemplo.json.',
      );
      return;
    }

    state.isBatchDownloading = true;
    elements.downloadAllBtn.disabled = true;
    const files = [];
    const skipped = [];
    const withoutLogo = [];
    const usedNames = new Map();

    try {
      for (let index = 0; index < state.records.length; index += 1) {
        const progress = `${index + 1}/${state.records.length}`;
        elements.downloadAllBtn.textContent = `Gerando ${progress}...`;
        setStatus(`Gerando entidade ${progress} para o ZIP...`);
        await new Promise((resolve) => setTimeout(resolve, 0));

        try {
          const result = await renderRecordToPng(state.records[index]);
          const stem = `template-2026-${result.agencyCode}-${sanitizeFilePart(result.city)}`;
          const occurrence = usedNames.get(stem) || 0;
          usedNames.set(stem, occurrence + 1);
          const suffix = occurrence ? `-${occurrence + 1}` : '';

          files.push({
            blob: result.blob,
            name: `${stem}${suffix}.png`,
          });

          if (!result.hasLogo) {
            withoutLogo.push(result.city);
          }
        } catch (error) {
          skipped.push(`${getRecordLabel(state.records[index], index)}: ${error.message}`);
        }
      }

      if (!files.length) {
        throw new Error('Nenhuma entidade possui uma nota valida entre 75 e 100.');
      }

      elements.downloadAllBtn.textContent = 'Compactando...';
      setStatus(`Compactando ${files.length} imagem(ns) em um arquivo ZIP...`);
      const zipBlob = await createZipBlob(files);
      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');

      link.href = objectUrl;
      link.download = `templates-2026-${new Date().toISOString().slice(0, 10)}.zip`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }, 60000);

      const details = [`ZIP gerado com ${files.length} entidade(s).`];

      if (skipped.length) {
        details.push(`${skipped.length} registro(s) ignorado(s) por nota ausente ou invalida.`);
      }

      if (withoutLogo.length) {
        details.push(`${withoutLogo.length} imagem(ns) gerada(s) sem logo automatica.`);
      }

      setStatus(details.join('\n'));
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Nao foi possivel gerar o arquivo ZIP.');
    } finally {
      state.isBatchDownloading = false;
      updateBatchDownloadButton();
    }
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
  elements.downloadAllBtn.addEventListener('click', downloadAllTemplates);

  activateTab('banner');
  populateCitySelect([]);
  renderTemplate();
  loadInitialNotes();
})();
