(function () {
  'use strict';

  const TSE_BASE = 'https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/listar';
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
    source: 'TSE',
    query: null
  };

  const elements = {
    form: document.querySelector('#searchForm'),
    year: document.querySelector('#yearInput'),
    election: document.querySelector('#electionInput'),
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
    elements.searchButton.querySelector('span').textContent = loading ? 'Consultando o TSE…' : 'Buscar candidatos';
  }

  function showMessage(html) {
    elements.message.innerHTML = html;
    elements.message.hidden = false;
  }

  function clearMessage() {
    elements.message.hidden = true;
    elements.message.textContent = '';
  }

  function buildRemoteUrl(query) {
    return `${TSE_BASE}/${encodeURIComponent(query.year)}/${encodeURIComponent(query.uf)}/${encodeURIComponent(query.election)}/${encodeURIComponent(query.role)}/candidatos`;
  }

  function buildLocalUrl(query) {
    const params = new URLSearchParams({
      ano: query.year,
      uf: query.uf,
      eleicao: query.election,
      cargo: query.role
    });
    return `/api/candidatos?${params.toString()}`;
  }

  async function fetchCandidates(query) {
    const isLocalServer = location.protocol === 'http:' || location.protocol === 'https:';
    const url = isLocalServer ? buildLocalUrl(query) : buildRemoteUrl(query);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`A consulta respondeu com status ${response.status}.`);
    const data = await response.json();
    if (!data || !Array.isArray(data.candidatos)) throw new Error('A resposta recebida não contém uma lista de candidatos.');
    return data;
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
    const election = elements.election.value.trim();
    const uf = elements.uf.value;
    const selectedRole = elements.role.value;
    const roleCodes = selectedRole === 'all' ? Object.keys(ROLES) : [selectedRole];
    const queries = roleCodes.map((role) => ({ year, election, role, uf: role === '1' ? 'BR' : uf }));

    clearMessage();
    setLoading(true);
    setApiState('loading', `Consultando ${queries.length} ${queries.length === 1 ? 'cargo' : 'cargos'}…`);

    try {
      const settled = await Promise.allSettled(queries.map(fetchCandidates));
      const failures = settled.filter((item) => item.status === 'rejected');
      const candidates = [];

      settled.forEach((item, index) => {
        if (item.status !== 'fulfilled') return;
        item.value.candidatos.forEach((candidate) => {
          candidates.push(normalizeCandidate(candidate, queries[index].role, queries[index].uf));
        });
      });

      if (!candidates.length && failures.length) throw failures[0].reason;

      state.candidates = deduplicate(candidates);
      state.source = 'TSE';
      state.query = { year, election, uf, selectedRole };
      resetFilters();
      updateFilterOptions();
      applyFilters();
      elements.results.hidden = false;
      elements.context.textContent = buildContext(uf, selectedRole, year);
      elements.time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      setApiState('success', `${state.candidates.length} candidaturas recebidas`);

      if (failures.length) {
        showMessage(`<strong>Consulta parcial.</strong> ${failures.length} ${failures.length === 1 ? 'cargo não respondeu' : 'cargos não responderam'}; os demais resultados foram exibidos.`);
      }
      elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error(error);
      setApiState('error', 'Não foi possível consultar');
      const localHint = location.protocol === 'file:'
        ? 'Abra esta página pelo servidor local: execute <code>python candidato/servidor_candidatos.py</code> na raiz do projeto e acesse <code>http://localhost:8877</code>.'
        : 'Confirme se o servidor local está ativo e tente novamente.';
      showMessage(`<strong>Não foi possível acessar a API do TSE.</strong> ${escapeHtml(error.message)} ${localHint} Você também pode usar “Importar JSON”.`);
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

  async function importJson(event) {
    const files = [...event.target.files];
    if (!files.length) return;
    clearMessage();
    setApiState('loading', `Lendo ${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}…`);

    try {
      const imported = [];
      for (const file of files) {
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
      resetFilters();
      updateFilterOptions();
      applyFilters();
      elements.context.textContent = `${files.length} ${files.length === 1 ? 'arquivo importado' : 'arquivos importados'}`;
      elements.time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      elements.results.hidden = false;
      setApiState('success', `${state.candidates.length} candidaturas importadas`);
      elements.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setApiState('error', 'Falha ao importar JSON');
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
  elements.jsonInput.addEventListener('change', importJson);
  [elements.textFilter, elements.roleFilter, elements.partyFilter, elements.statusFilter]
    .forEach((element) => element.addEventListener('input', applyFilters));
  elements.clearFilters.addEventListener('click', () => { resetFilters(); applyFilters(); });
  elements.copyButton.addEventListener('click', copyNames);
  elements.csvButton.addEventListener('click', exportCsv);
  elements.jsonButton.addEventListener('click', exportJson);
})();
