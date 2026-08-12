(function () {
  'use strict';

  const TSE_DATA_BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand';
  const ROLES = {
    1: 'Presidente',
    3: 'Governador',
    5: 'Senador',
    6: 'Deputado Federal',
    7: 'Deputado Estadual'
  };

  const state = {
    candidates: [],
    filtered: [],
    source: 'Dados Abertos TSE',
    query: null,
    generatedAt: ''
  };
  const archiveCache = new Map();
  const csvCache = new Map();

  const elements = {
    form: document.querySelector('#searchForm'),
    year: document.querySelector('#yearInput'),
    uf: document.querySelector('#stateSelect'),
    role: document.querySelector('#roleSelect'),
    searchButton: document.querySelector('#searchButton'),
    apiState: document.querySelector('#apiState'),
    apiStateText: document.querySelector('#apiStateText'),
    message: document.querySelector('#messageBox'),
    results: document.querySelector('#resultsSection'),
    rows: document.querySelector('#candidateRows'),
    empty: document.querySelector('#emptyResults'),
    context: document.querySelector('#resultContext'),
    total: document.querySelector('#totalMetric'),
    totalDetail: document.querySelector('#totalDetail'),
    parties: document.querySelector('#partyMetric'),
    roles: document.querySelector('#roleMetric'),
    time: document.querySelector('#timeMetric'),
    source: document.querySelector('#sourceMetric'),
    textFilter: document.querySelector('#textFilter'),
    roleFilter: document.querySelector('#roleFilter'),
    partyFilter: document.querySelector('#partyFilter'),
    statusFilter: document.querySelector('#statusFilter'),
    clearFilters: document.querySelector('#clearFilters'),
    jsonInput: document.querySelector('#jsonInput'),
    zipDownloadLink: document.querySelector('#zipDownloadLink'),
    datasetPageLink: document.querySelector('#datasetPageLink'),
    copyButton: document.querySelector('#copyButton'),
    csvButton: document.querySelector('#csvButton'),
    jsonButton: document.querySelector('#jsonButton'),
    toast: document.querySelector('#toast')
  };

  function setApiState(kind, text) {
    elements.apiState.dataset.state = kind;
    elements.apiStateText.textContent = text;
  }

  function setLoading(loading) {
    elements.searchButton.disabled = loading;
    elements.searchButton.querySelector('span').textContent = loading ? 'Carregando base…' : 'Buscar candidatos';
  }

  function showMessage(html) {
    elements.message.innerHTML = html;
    elements.message.hidden = false;
  }

  function clearMessage() {
    elements.message.hidden = true;
    elements.message.textContent = '';
  }

  function archiveUrl(year) {
    return `${TSE_DATA_BASE}/consulta_cand_${encodeURIComponent(year)}.zip`;
  }

  function updateDownloadLink() {
    const year = elements.year.value.trim() || '2026';
    elements.zipDownloadLink.href = archiveUrl(year);
    elements.datasetPageLink.href = `https://dadosabertos.tse.jus.br/dataset/candidatos-${encodeURIComponent(year)}`;
  }

  async function downloadArchive(year) {
    if (archiveCache.has(year)) return archiveCache.get(year);

    const request = (async () => {
      const response = await fetch(archiveUrl(year), { mode: 'cors', cache: 'no-cache' });
      if (!response.ok) {
        if (response.status === 404) throw new Error(`A base de candidatos de ${year} ainda não está disponível no TSE.`);
        throw new Error(`O download da base respondeu com status ${response.status}.`);
      }

      const total = Number(response.headers.get('Content-Length')) || 0;
      if (!response.body || !total) return new Uint8Array(await response.arrayBuffer());

      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const percent = Math.min(100, Math.round((received / total) * 100));
        setApiState('loading', `Baixando base oficial… ${percent}%`);
      }

      const bytes = new Uint8Array(received);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.length;
      });
      return bytes;
    })();

    archiveCache.set(year, request);
    try {
      return await request;
    } catch (error) {
      archiveCache.delete(year);
      throw error;
    }
  }

  function findEndOfCentralDirectory(view) {
    const minimum = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error('O arquivo baixado não é um ZIP válido.');
  }

  function findZipEntry(bytes, wantedName) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEndOfCentralDirectory(view);
    const entries = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');

    for (let index = 0; index < entries; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('O diretório do ZIP está corrompido.');
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const filenameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));

      if (name.toLocaleLowerCase() === wantedName.toLocaleLowerCase()) {
        if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('O arquivo interno do ZIP está corrompido.');
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        return { method, compressed: bytes.slice(start, start + compressedSize) };
      }
      offset += 46 + filenameLength + extraLength + commentLength;
    }
    throw new Error(`O TSE não forneceu o arquivo ${wantedName} dentro da base.`);
  }

  async function decompressZipEntry(entry) {
    if (entry.method === 0) return entry.compressed;
    if (entry.method !== 8) throw new Error(`Método de compactação ZIP não suportado: ${entry.method}.`);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador não consegue descompactar a base. Use uma versão atual do Chrome ou Edge.');
    }
    const stream = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ';') {
        row.push(field);
        field = '';
      } else if (character === '\n') {
        row.push(field);
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        field = '';
      } else if (character !== '\r') {
        field += character;
      }
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    if (rows.length < 2) return [];

    const headers = rows.shift();
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
  }

  async function loadCsv(year, unit) {
    const cacheKey = `${year}-${unit}`;
    if (csvCache.has(cacheKey)) return csvCache.get(cacheKey);

    const request = (async () => {
      const archive = await downloadArchive(year);
      setApiState('loading', `Extraindo dados de ${unit}…`);
      const filename = `consulta_cand_${year}_${unit}.csv`;
      const content = await decompressZipEntry(findZipEntry(archive, filename));
      const text = new TextDecoder('windows-1252').decode(content);
      return parseCsv(text);
    })();
    csvCache.set(cacheKey, request);
    try {
      return await request;
    } catch (error) {
      csvCache.delete(cacheKey);
      throw error;
    }
  }

  function cleanTseValue(value, fallback = '') {
    const cleaned = String(value ?? '').trim();
    return !cleaned || cleaned === '-1' || /^#(?:NULO|NE)$/i.test(cleaned) ? fallback : cleaned;
  }

  function normalizeCsvCandidate(row) {
    const roleCode = Number(row.CD_CARGO);
    const situation = cleanTseValue(
      row.DS_SITUACAO_CANDIDATURA,
      cleanTseValue(row.DS_SIT_TOT_TURNO, 'Não informada')
    );
    return {
      id: cleanTseValue(row.SQ_CANDIDATO) || null,
      numero: cleanTseValue(row.NR_CANDIDATO),
      nomeUrna: cleanTseValue(row.NM_URNA_CANDIDATO, 'Nome não informado'),
      nomeCompleto: cleanTseValue(row.NM_CANDIDATO),
      cargoCodigo: roleCode,
      cargo: ROLES[roleCode] || cleanTseValue(row.DS_CARGO, 'Cargo não informado'),
      partido: cleanTseValue(row.SG_PARTIDO, 'Sem partido'),
      situacao: situation,
      totalizacao: cleanTseValue(row.DS_SIT_TOT_TURNO),
      coligacao: cleanTseValue(row.NM_COLIGACAO, cleanTseValue(row.NM_FEDERACAO, 'Partido isolado')),
      uf: cleanTseValue(row.SG_UF),
      tituloEleitor: cleanTseValue(row.NR_TITULO_ELEITORAL_CANDIDATO),
      eleicao: cleanTseValue(row.CD_ELEICAO) || null,
      ano: Number(row.ANO_ELEICAO) || null
    };
  }

  async function loadCandidates(year, uf, selectedRole) {
    const wantedRoles = new Set(selectedRole === 'all' ? Object.keys(ROLES) : [selectedRole]);
    const units = selectedRole === '1' ? ['BR'] : selectedRole === 'all' ? ['BR', uf] : [uf];
    const datasets = await Promise.all(units.map((unit) => loadCsv(year, unit)));
    const rows = datasets.flat();
    const first = rows[0] || {};
    return {
      candidates: rows
        .filter((row) => wantedRoles.has(String(row.CD_CARGO)))
        .map(normalizeCsvCandidate),
      generatedAt: [cleanTseValue(first.DT_GERACAO), cleanTseValue(first.HH_GERACAO)].filter(Boolean).join(' às ')
    };
  }

  function normalizeCandidate(candidate, fallbackRole, fallbackUf) {
    const roleCode = Number(candidate?.cargo?.codigo || fallbackRole);
    return {
      id: candidate.id ?? null,
      numero: candidate.numero ?? '',
      nomeUrna: candidate.nomeUrna || 'Nome não informado',
      nomeCompleto: candidate.nomeCompleto || '',
      cargoCodigo: roleCode,
      cargo: candidate?.cargo?.nome || ROLES[roleCode] || 'Cargo não informado',
      partido: candidate?.partido?.sigla || 'Sem partido',
      situacao: candidate.descricaoSituacao || candidate.descricaoTotalizacao || 'Não informada',
      totalizacao: candidate.descricaoTotalizacao || '',
      coligacao: candidate.nomeColigacao || '—',
      uf: candidate.ufCandidatura || fallbackUf || '',
      tituloEleitor: candidate.tituloEleitor || '',
      eleicao: candidate?.eleicao?.id || null,
      ano: candidate?.eleicao?.ano || null
    };
  }

  async function runSearch(event) {
    event.preventDefault();
    if (!elements.form.reportValidity()) return;

    const year = elements.year.value.trim();
    const uf = elements.uf.value;
    const selectedRole = elements.role.value;

    clearMessage();
    if (location.protocol === 'file:' && !archiveCache.has(year)) {
      setApiState('error', 'Importe a base ou use a extensão');
      showMessage(`<strong>A busca automática precisa ser aberta pela extensão.</strong> Se preferir continuar no HTML, <a href="${escapeHtml(archiveUrl(year))}" target="_blank" rel="noopener noreferrer">baixe o ZIP oficial de ${escapeHtml(year)}</a> e clique em “Importar ZIP/JSON”.`);
      return;
    }
    setLoading(true);
    setApiState('loading', 'Preparando a base oficial…');

    try {
      const result = await loadCandidates(year, uf, selectedRole);
      state.candidates = deduplicate(result.candidates);
      state.source = 'Dados Abertos TSE';
      state.query = { year, uf, selectedRole };
      state.generatedAt = result.generatedAt;
      resetFilters();
      updateFilterOptions();
      applyFilters();
      elements.results.hidden = false;
      elements.context.textContent = `${buildContext(uf, selectedRole, year)}${result.generatedAt ? ` · Base de ${result.generatedAt}` : ''}`;
      elements.time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      setApiState('success', `${state.candidates.length} candidaturas carregadas`);
      elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error(error);
      setApiState('error', 'Não foi possível consultar');
      const extensionHint = location.protocol === 'chrome-extension:'
        ? 'Confirme sua conexão e tente novamente.'
        : 'Para busca automática, carregue a raiz do projeto como extensão no Chrome/Edge. Como alternativa, baixe e importe o ZIP oficial.';
      showMessage(`<strong>Não foi possível carregar automaticamente os Dados Abertos do TSE.</strong> ${escapeHtml(error.message)} ${extensionHint} <a href="${escapeHtml(archiveUrl(year))}" target="_blank" rel="noopener noreferrer">Baixar ZIP de ${escapeHtml(year)}</a>.`);
    } finally {
      setLoading(false);
    }
  }

  function deduplicate(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
      const key = `${candidate.id || candidate.nomeUrna}-${candidate.cargoCodigo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function buildContext(uf, role, year) {
    const roleLabel = role === 'all' ? 'cinco cargos' : ROLES[role];
    const place = role === '1' ? 'Brasil' : uf;
    return `${roleLabel} · ${place} · Eleições ${year}`;
  }

  function uniqueValues(key) {
    return [...new Set(state.candidates.map((candidate) => candidate[key]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
  }

  function fillSelect(select, values, initialLabel) {
    const current = select.value;
    select.innerHTML = '';
    select.append(new Option(initialLabel, ''));
    values.forEach((value) => select.append(new Option(value, value)));
    if (values.includes(current)) select.value = current;
  }

  function updateFilterOptions() {
    fillSelect(elements.roleFilter, uniqueValues('cargo'), 'Todos os cargos');
    fillSelect(elements.partyFilter, uniqueValues('partido'), 'Todos os partidos');
    fillSelect(elements.statusFilter, uniqueValues('situacao'), 'Todas as situações');
  }

  function normalized(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function applyFilters() {
    const search = normalized(elements.textFilter.value.trim());
    const role = elements.roleFilter.value;
    const party = elements.partyFilter.value;
    const status = elements.statusFilter.value;

    state.filtered = state.candidates.filter((candidate) => {
      const searchable = normalized([candidate.nomeUrna, candidate.nomeCompleto, candidate.numero, candidate.coligacao].join(' '));
      return (!search || searchable.includes(search)) &&
        (!role || candidate.cargo === role) &&
        (!party || candidate.partido === party) &&
        (!status || candidate.situacao === status);
    });

    renderRows();
    updateMetrics();
  }

  function renderRows() {
    const fragment = document.createDocumentFragment();
    const sorted = [...state.filtered].sort((a, b) => {
      return a.cargoCodigo - b.cargoCodigo || Number(a.numero) - Number(b.numero) || a.nomeUrna.localeCompare(b.nomeUrna, 'pt-BR');
    });

    sorted.forEach((candidate) => {
      const row = document.createElement('tr');
      const statusClass = normalized(candidate.totalizacao).includes('concorrendo')
        ? 'is-running'
        : normalized(candidate.situacao).includes('inapto') ? 'is-unfit' : '';
      row.innerHTML = `
        <td><span class="candidate-number">${escapeHtml(candidate.numero)}</span></td>
        <td><span class="candidate-name"><strong>${escapeHtml(candidate.nomeUrna)}</strong><span title="${escapeHtml(candidate.nomeCompleto)}">${escapeHtml(candidate.nomeCompleto)}</span></span></td>
        <td><span class="role-label">${escapeHtml(candidate.cargo)}</span></td>
        <td><span class="party-badge">${escapeHtml(candidate.partido)}</span></td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(candidate.situacao)}</span></td>
        <td>${escapeHtml(candidate.coligacao)}</td>`;
      fragment.append(row);
    });

    elements.rows.replaceChildren(fragment);
    elements.empty.hidden = sorted.length !== 0;
  }

  function updateMetrics() {
    elements.total.textContent = state.filtered.length.toLocaleString('pt-BR');
    elements.totalDetail.textContent = state.filtered.length === state.candidates.length
      ? 'candidaturas recebidas'
      : `de ${state.candidates.length.toLocaleString('pt-BR')} candidaturas`;
    elements.parties.textContent = new Set(state.filtered.map((item) => item.partido)).size;
    elements.roles.textContent = new Set(state.filtered.map((item) => item.cargo)).size;
    elements.source.textContent = `Fonte: ${state.source}`;
  }

  function resetFilters() {
    elements.textFilter.value = '';
    elements.roleFilter.value = '';
    elements.partyFilter.value = '';
    elements.statusFilter.value = '';
  }

  async function importData(event) {
    const files = [...event.target.files];
    if (!files.length) return;
    clearMessage();
    setApiState('loading', `Lendo ${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}…`);

    try {
      const zipFiles = files.filter((file) => file.name.toLocaleLowerCase().endsWith('.zip'));
      if (zipFiles.length) {
        if (files.length !== 1) throw new Error('Para importar uma base ZIP, selecione somente um arquivo por vez.');
        const file = zipFiles[0];
        const inferredYear = file.name.match(/consulta_cand_(\d{4})\.zip$/i)?.[1];
        const year = inferredYear || elements.year.value.trim();
        if (!/^\d{4}$/.test(year)) throw new Error('Não foi possível identificar o ano do arquivo ZIP.');

        elements.year.value = year;
        updateDownloadLink();
        archiveCache.set(year, Promise.resolve(new Uint8Array(await file.arrayBuffer())));
        [...csvCache.keys()].filter((key) => key.startsWith(`${year}-`)).forEach((key) => csvCache.delete(key));

        const uf = elements.uf.value;
        const selectedRole = elements.role.value;
        const result = await loadCandidates(year, uf, selectedRole);
        state.candidates = deduplicate(result.candidates);
        state.source = 'ZIP oficial importado';
        state.query = { year, uf, selectedRole };
        state.generatedAt = result.generatedAt;
        resetFilters();
        updateFilterOptions();
        applyFilters();
        elements.context.textContent = `${buildContext(uf, selectedRole, year)}${result.generatedAt ? ` · Base de ${result.generatedAt}` : ''}`;
        elements.time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
        elements.results.hidden = false;
        setApiState('success', `${state.candidates.length} candidaturas importadas`);
        elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const imported = [];
      for (const file of files) {
        if (!file.name.toLocaleLowerCase().endsWith('.json')) throw new Error(`Formato não reconhecido: ${file.name}.`);
        const data = JSON.parse(await file.text());
        const lists = Array.isArray(data) ? [data] : [data.candidatos];
        const candidates = lists.flat().filter(Boolean);
        if (!candidates.length) throw new Error(`${file.name} não contém a chave “candidatos”.`);
        const fallbackRole = data?.cargo?.codigo || '';
        const fallbackUf = data?.unidadeEleitoral?.sigla || '';
        candidates.forEach((candidate) => imported.push(normalizeCandidate(candidate, fallbackRole, fallbackUf)));
      }

      state.candidates = deduplicate(imported);
      state.source = 'JSON importado';
      state.query = null;
      state.generatedAt = '';
      resetFilters();
      updateFilterOptions();
      applyFilters();
      elements.context.textContent = `${files.length} ${files.length === 1 ? 'arquivo importado' : 'arquivos importados'}`;
      elements.time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      elements.results.hidden = false;
      setApiState('success', `${state.candidates.length} candidaturas importadas`);
      elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setApiState('error', 'Falha ao importar arquivo');
      showMessage(`<strong>Arquivo inválido.</strong> ${escapeHtml(error.message)}`);
    } finally {
      event.target.value = '';
    }
  }

  function exportRows() {
    return state.filtered.map(({ tituloEleitor, ...candidate }) => candidate);
  }

  function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function filename(extension) {
    const uf = state.query?.uf || 'importado';
    const date = new Date().toISOString().slice(0, 10);
    return `candidatos-${uf.toLowerCase()}-${date}.${extension}`;
  }

  function exportCsv() {
    const headers = ['numero', 'nomeUrna', 'nomeCompleto', 'cargo', 'partido', 'situacao', 'coligacao', 'uf', 'ano', 'eleicao'];
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(';'), ...exportRows().map((row) => headers.map((key) => quote(row[key])).join(';'))];
    download(`\ufeff${lines.join('\r\n')}`, 'text/csv;charset=utf-8', filename('csv'));
    showToast(`${state.filtered.length} registros exportados em CSV.`);
  }

  function exportJson() {
    download(JSON.stringify(exportRows(), null, 2), 'application/json;charset=utf-8', filename('json'));
    showToast(`${state.filtered.length} registros exportados em JSON.`);
  }

  async function copyNames() {
    const groups = new Map();

    state.filtered.forEach((candidate) => {
      const heading = candidate.cargoCodigo === 1 || normalized(candidate.cargo) === 'presidente'
        ? candidate.cargo
        : `${candidate.cargo} - ${candidate.uf || state.query?.uf || 'UF não informada'}`;
      if (!groups.has(heading)) groups.set(heading, []);
      groups.get(heading).push(`${candidate.nomeUrna} (${candidate.numero}) - ${candidate.partido}`);
    });

    const content = [...groups.entries()]
      .map(([heading, candidates]) => [heading, ...candidates].join('\n'))
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(content);
      showToast(`${state.filtered.length} nomes copiados.`);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = content;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      showToast(`${state.filtered.length} nomes copiados.`);
    }
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2800);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  elements.form.addEventListener('submit', runSearch);
  elements.year.addEventListener('input', updateDownloadLink);
  elements.jsonInput.addEventListener('change', importData);
  [elements.textFilter, elements.roleFilter, elements.partyFilter, elements.statusFilter]
    .forEach((element) => element.addEventListener('input', applyFilters));
  elements.clearFilters.addEventListener('click', () => { resetFilters(); applyFilters(); });
  elements.copyButton.addEventListener('click', copyNames);
  elements.csvButton.addEventListener('click', exportCsv);
  elements.jsonButton.addEventListener('click', exportJson);

  updateDownloadLink();
})();
