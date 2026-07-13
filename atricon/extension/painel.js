const BASE_URL = 'https://avalia.atricon.org.br';
const HOME_URL = `${BASE_URL}/`;
const LOGIN_URL = `${BASE_URL}/login/`;
const OAUTH_START_URL = `${BASE_URL}/oauth/authenticate/`;
const MINHAS_AVALIACOES_URL = `${BASE_URL}/avaliacoes/minhas-avaliacoes/`;
const LOGOUT_URL = `${BASE_URL}/logout/`;
const VIEWER_FILE_URL = 'file:///C:/Users/Suporte%2001/Documents/Github/script/atricon/visualizador_atricon.html';

const collectButton = document.getElementById('collect');
const openAtriconButton = document.getElementById('openAtricon');
const clearLogButton = document.getElementById('clearLog');
const openResultButton = document.getElementById('openResult');
const downloadAgainButton = document.getElementById('downloadAgain');
const statusTitle = document.getElementById('statusTitle');
const statusDetail = document.getElementById('statusDetail');
const progress = document.getElementById('progress');
const logBox = document.getElementById('log');
const resultPanel = document.getElementById('resultPanel');
const resultCount = document.getElementById('resultCount');
const citySummary = document.getElementById('citySummary');
const cityList = document.getElementById('cityList');
const citySearch = document.getElementById('citySearch');
const selectAllCitiesButton = document.getElementById('selectAllCities');
const clearCitiesButton = document.getElementById('clearCities');
const modeButtons = Array.from(document.querySelectorAll('.mode'));
const reloadCredentialsButton = document.getElementById('reloadCredentials');
const credentialSummary = document.getElementById('credentialSummary');

let lastRows = [];
let cityOptions = [];
let selectedCityKeys = new Set();
let selectionMode = 'all';
let credentialAccounts = [];
let credentialsByKey = new Map();

openAtriconButton.addEventListener('click', () => chrome.tabs.create({ url: HOME_URL }));
clearLogButton.addEventListener('click', () => {
  logBox.textContent = '';
});
collectButton.addEventListener('click', collectAssessments);
openResultButton.addEventListener('click', () => openVisualizerRows(lastRows));
downloadAgainButton.addEventListener('click', () => downloadRows(lastRows));
citySearch.addEventListener('input', renderCityList);
selectAllCitiesButton.addEventListener('click', selectAllCities);
clearCitiesButton.addEventListener('click', clearCities);
reloadCredentialsButton.addEventListener('click', loadEmbeddedCredentials);
modeButtons.forEach((button) => {
  button.addEventListener('click', () => setSelectionMode(button.dataset.mode));
});

restoreLastResult();
loadCityOptions();
loadEmbeddedCredentials();

async function restoreLastResult() {
  const data = await chrome.storage.local.get('lastAtriconResult');
  if (Array.isArray(data.lastAtriconResult?.rows)) {
    lastRows = data.lastAtriconResult.rows;
    showResultSummary(lastRows);
  }
}

async function collectAssessments() {
  collectButton.disabled = true;
  progress.value = 0;
  lastRows = [];
  resultPanel.hidden = true;
  const selectedKeys = selectedKeysForCollection();
  if (selectionMode !== 'all' && !selectedKeys.size) {
    collectButton.disabled = false;
    setStatus('Selecione uma cidade', 'Escolha uma cidade ou mude para Todas.');
    return;
  }
  log(`Iniciando coleta no modo ${selectionMode}. Use uma conta ja logada no Avalia Atricon.`);

  try {
    const automaticAccounts = credentialAccountsForCollection(selectedKeys);
    if (automaticAccounts.length) {
      log(`${automaticAccounts.length} credencial(is) encontrada(s). Usando login automatico.`);
      await collectWithAutomaticLogin(automaticAccounts, selectedKeys);
      return;
    }

    setStatus('Abrindo Minhas Avaliacoes', 'Carregando tabela de avaliacoes...');
    const tab = await openOrReuseAtriconTab(MINHAS_AVALIACOES_URL);
    await waitForTabComplete(tab.id, 45000);
    await sleep(1200);

    const rowsResult = await executeInTab(tab.id, extractAssessmentRowsFromPage);
    if (!rowsResult.ok) throw new Error(rowsResult.error || 'Nao foi possivel ler a tabela.');

    const assessmentRows = rowsResult.rows.filter((row) => rowMatchesSelection(row, selectedKeys));
    log(`${rowsResult.rows.length} avaliacao(oes) encontrada(s) na tabela.`);
    log(`${assessmentRows.length} avaliacao(oes) selecionada(s) para processar.`);
    if (!assessmentRows.length) {
      throw new Error('nenhuma avaliacao da tabela corresponde as cidades selecionadas.');
    }
    const outputRows = [];

    for (let index = 0; index < assessmentRows.length; index += 1) {
      const row = assessmentRows[index];
      const current = index + 1;
      const parsedEntity = splitEntity(row.entidade);
      const output = {
        orgao: parsedEntity.orgao,
        cidade: parsedEntity.cidade,
        entidade: row.entidade,
        status: row.status,
        setor_atual: row.setor_atual,
        data: row.data,
        porcentagem: normalizePercentageText(row.indice),
        questionario_id: row.questionario_id,
        total_evidencias_validacao: 0,
        evidencias_validacao: []
      };

      setStatus(`Coletando ${current}/${assessmentRows.length}`, row.entidade || row.numero || 'avaliacao');
      progress.value = Math.round((index / Math.max(assessmentRows.length, 1)) * 100);

      if (normalizeText(row.status) !== 'validado') {
        output.erro = `login ainda nao validado. Status atual: ${row.status}`;
        log(`[${current}/${assessmentRows.length}] ${row.entidade}: ${output.erro}`);
        outputRows.push(output);
        continue;
      }

      if (!row.link) {
        output.erro = 'link do questionario nao encontrado.';
        log(`[${current}/${assessmentRows.length}] ${row.entidade}: ${output.erro}`);
        outputRows.push(output);
        continue;
      }

      try {
        await chrome.tabs.update(tab.id, { url: row.link, active: true });
        await waitForTabComplete(tab.id, 45000);
        await sleep(900);
        const percentResult = await executeInTab(tab.id, extractPercentageFromQuestionnaire, [row.indice]);
        output.porcentagem = percentResult.porcentagem || output.porcentagem;
        if (!output.porcentagem) output.erro = 'porcentagem nao encontrada no questionario.';
        log(`[${current}/${assessmentRows.length}] ${row.entidade}: ${output.porcentagem || 'sem porcentagem'}`);
      } catch (error) {
        output.erro = `erro ao abrir questionario: ${error.message}`;
        log(`[${current}/${assessmentRows.length}] ${row.entidade}: ${output.erro}`);
      }

      outputRows.push(output);
    }

    progress.value = 100;
    setStatus('Coleta concluida', `${outputRows.length} registro(s) gerado(s).`);
    lastRows = outputRows;
    await chrome.storage.local.set({
      lastAtriconResult: {
        created_at: new Date().toISOString(),
        rows: outputRows
      }
    });
    showResultSummary(outputRows);
    await openVisualizerRows(outputRows);
  } catch (error) {
    setStatus('Erro na coleta', error.message);
    log(`ERRO: ${error.message}`);
  } finally {
    collectButton.disabled = false;
  }
}

async function collectWithAutomaticLogin(accounts, selectedKeys) {
  const tab = await openOrReuseAnyAtriconTab(HOME_URL);
  const outputRows = [];
  const expectedKeys = keysForSelectedOptions(selectedKeys);
  const accountsByKey = new Set(accounts.map((account) => account.key));

  for (const key of expectedKeys) {
    if (accountsByKey.has(key)) continue;
    const option = cityOptions.find((item) => item.key === key);
    if (!option) continue;
    outputRows.push({
      orgao: option.orgao,
      cidade: option.cidade,
      status: '',
      setor_atual: '',
      data: '',
      porcentagem: '',
      total_evidencias_validacao: 0,
      evidencias_validacao: [],
      erro: 'credencial nao encontrada para esta cidade.'
    });
  }

  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    const current = index + 1;
    const output = {
      orgao: account.orgao,
      cidade: account.cidade,
      status: '',
      setor_atual: '',
      data: '',
      porcentagem: '',
      total_evidencias_validacao: 0,
      evidencias_validacao: []
    };

    try {
      setStatus(`Login ${current}/${accounts.length}`, `${account.orgao} de ${account.cidade}`);
      progress.value = Math.round((index / Math.max(accounts.length, 1)) * 100);
      log(`[${current}/${accounts.length}] Fazendo login: ${account.orgao} de ${account.cidade}`);
      await loginWithCredentials(tab.id, account);

      await chrome.tabs.update(tab.id, { url: MINHAS_AVALIACOES_URL, active: true });
      await waitForTabComplete(tab.id, 45000);
      await sleep(1200);

      const rowsResult = await executeInTab(tab.id, extractAssessmentRowsFromPage);
      if (!rowsResult.ok) throw new Error(rowsResult.error || 'Nao foi possivel ler a tabela.');

      const row = rowsResult.rows.find((item) => entityMatchesOption(item.entidade, account));
      if (!row) throw new Error('avaliacao da cidade nao encontrada na tabela da conta logada.');

      output.entidade = row.entidade;
      output.status = row.status;
      output.setor_atual = row.setor_atual;
      output.data = row.data;
      output.questionario_id = row.questionario_id;
      output.porcentagem = normalizePercentageText(row.indice);

      if (normalizeText(row.status) !== 'validado') {
        output.erro = `login ainda nao validado. Status atual: ${row.status}`;
        outputRows.push(output);
        log(`[${current}/${accounts.length}] ${account.cidade}: ${output.erro}`);
        continue;
      }

      if (!row.link) {
        output.erro = 'link do questionario nao encontrado.';
        outputRows.push(output);
        log(`[${current}/${accounts.length}] ${account.cidade}: ${output.erro}`);
        continue;
      }

      await chrome.tabs.update(tab.id, { url: row.link, active: true });
      await waitForTabComplete(tab.id, 45000);
      await sleep(900);
      const percentResult = await executeInTab(tab.id, extractPercentageFromQuestionnaire, [row.indice]);
      output.porcentagem = percentResult.porcentagem || output.porcentagem;
      if (!output.porcentagem) output.erro = 'porcentagem nao encontrada no questionario.';
      outputRows.push(output);
      log(`[${current}/${accounts.length}] ${account.cidade}: ${output.porcentagem || 'sem porcentagem'}`);
    } catch (error) {
      output.erro = error.message;
      outputRows.push(output);
      log(`[${current}/${accounts.length}] ${account.cidade}: ERRO - ${error.message}`);
    }
  }

  progress.value = 100;
  setStatus('Coleta concluida', `${outputRows.length} registro(s) gerado(s).`);
  lastRows = outputRows;
  await chrome.storage.local.set({
    lastAtriconResult: {
      created_at: new Date().toISOString(),
      rows: outputRows
    }
  });
  showResultSummary(outputRows);
  await openVisualizerRows(outputRows);
}

async function loginWithCredentials(tabId, account) {
  await chrome.tabs.update(tabId, { url: LOGOUT_URL, active: true });
  try {
    await waitForTabComplete(tabId, 20000);
  } catch {
    // Logout can redirect or finish without a normal load event.
  }
  await sleep(700);

  await chrome.tabs.update(tabId, { url: LOGIN_URL, active: true });
  await waitForTabComplete(tabId, 45000);
  await sleep(800);

  let tab = await chrome.tabs.get(tabId);
  if (isAvaliaAuthenticatedUrl(tab.url)) return;

  if (String(tab.url || '').startsWith(LOGIN_URL) || String(tab.url || '').startsWith(BASE_URL)) {
    const start = await executeInTab(tabId, startLoginFlowInPage, [OAUTH_START_URL]);
    if (!start.ok) throw new Error(start.error || 'nao foi possivel iniciar o fluxo de login.');
  }

  tab = await waitForTabUrl(tabId, (url) => {
    return String(url || '').includes('conta.atricon.org.br') || isAvaliaAuthenticatedUrl(url);
  }, 45000);

  if (isAvaliaAuthenticatedUrl(tab.url)) return;

  try {
    await waitForTabComplete(tabId, 30000);
  } catch {
    // Some login pages continue loading while the form is already usable.
  }
  await sleep(500);
  const submitted = await executeInTab(tabId, submitCredentialsInPage, [account.user, account.senha]);
  if (!submitted.ok) throw new Error(submitted.error || 'formulario de login nao apareceu completo.');

  try {
    tab = await waitForTabUrl(tabId, (url) => isAvaliaAuthenticatedUrl(url), 45000);
    await chrome.tabs.update(tabId, { url: HOME_URL, active: true });
    await waitForTabComplete(tabId, 30000);
    return;
  } catch {
    const loginError = await executeInTab(tabId, readLoginErrorInPage);
    if (loginError.error) throw new Error(loginError.error);
    tab = await chrome.tabs.get(tabId);
    throw new Error(`login nao redirecionou para o Avalia. URL atual: ${tab.url}`);
  }
}

async function loadEmbeddedCredentials() {
  try {
    const response = await fetch(chrome.runtime.getURL('orgaos_avalia_credentials.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await response.json();
    const accounts = normalizeCredentialAccounts(parsed);
    if (!accounts.length) throw new Error('nenhuma credencial completa encontrada no arquivo interno.');

    credentialAccounts = accounts;
    credentialsByKey = new Map(accounts.map((account) => [account.key, account]));
    mergeCredentialsIntoCityOptions();
    renderCityList();
    updateCredentialSummary();
    log(`${accounts.length} credencial(is) interna(s) carregada(s).`);
  } catch (error) {
    credentialAccounts = [];
    credentialsByKey = new Map();
    updateCredentialSummary();
    setStatus('Erro nas credenciais', error.message);
    log(`ERRO ao carregar credenciais internas: ${error.message}`);
  }
}

async function loadCityOptions() {
  try {
    const response = await fetch(chrome.runtime.getURL('orgaos_avalia_public.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    cityOptions = rows.map((row, index) => ({
      index,
      orgao: String(row.orgao || '').trim(),
      cidade: String(row.cidade || '').trim(),
      has_access: Boolean(row.has_access),
      key: cityKey(row.orgao, row.cidade)
    })).filter((row) => row.orgao && row.cidade && row.key);
    selectedCityKeys = new Set(cityOptions.map((row) => row.key));
    mergeCredentialsIntoCityOptions();
    renderCityList();
    updateCitySummary();
  } catch (error) {
    citySummary.textContent = `Lista indisponivel: ${error.message}`;
    cityList.innerHTML = '<div class="empty-list">Nao foi possivel carregar orgaos_avalia_public.json.</div>';
  }
}

function renderCityList() {
  const query = normalizeText(citySearch.value);
  const visible = cityOptions.filter((row) => {
    if (!query) return true;
    return normalizeText(`${row.orgao} ${row.cidade}`).includes(query);
  });

  cityList.innerHTML = visible.map((row) => `
    <label class="city-item">
      <input type="checkbox" value="${escapeAttr(row.key)}" ${selectedCityKeys.has(row.key) ? 'checked' : ''}>
      <span>
        <strong>${escapeHtml(row.cidade)}</strong>
        <span>${escapeHtml(row.orgao)}${row.has_access ? '' : ' - <span class="warning">sem credencial no JSON</span>'}</span>
      </span>
    </label>
  `).join('');

  cityList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => toggleCity(input.value, input.checked));
  });
  updateCitySummary();
}

function setSelectionMode(mode) {
  selectionMode = mode;
  modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'all') {
    selectedCityKeys = new Set(cityOptions.map((row) => row.key));
  }
  if (mode === 'single' && selectedCityKeys.size > 1) {
    selectedCityKeys = new Set([selectedCityKeys.values().next().value]);
  }
  renderCityList();
}

function selectAllCities() {
  selectedCityKeys = new Set(cityOptions.map((row) => row.key));
  if (selectionMode === 'single') selectionMode = 'specific';
  modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === selectionMode));
  renderCityList();
}

function clearCities() {
  selectedCityKeys = new Set();
  if (selectionMode === 'all') selectionMode = 'specific';
  modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === selectionMode));
  renderCityList();
}

function toggleCity(key, checked) {
  if (selectionMode === 'all') {
    selectionMode = 'specific';
    modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === selectionMode));
  }
  if (selectionMode === 'single') {
    selectedCityKeys = checked ? new Set([key]) : new Set();
  } else if (checked) {
    selectedCityKeys.add(key);
  } else {
    selectedCityKeys.delete(key);
  }
  renderCityList();
}

function selectedKeysForCollection() {
  if (selectionMode === 'all') return new Set();
  return new Set(selectedCityKeys);
}

function rowMatchesSelection(row, selectedKeys) {
  if (!selectedKeys.size) return true;
  const parsed = splitEntity(row.entidade);
  if (selectedKeys.has(cityKey(parsed.orgao, parsed.cidade))) return true;
  return cityOptions.some((option) => {
    if (!selectedKeys.has(option.key)) return false;
    return entityMatchesOption(row.entidade, option);
  });
}

function entityMatchesOption(entidade, option) {
  const entityTokens = new Set(normalizeText(entidade).split(' ').filter(Boolean));
  const expectedTokens = normalizeText(`${option.orgao} ${option.cidade}`).split(' ').filter(Boolean);
  return expectedTokens.every((token) => entityTokens.has(token));
}

function updateCitySummary() {
  const selected = selectionMode === 'all' ? cityOptions.length : selectedCityKeys.size;
  const label = selectionMode === 'all'
    ? 'todas selecionadas'
    : selectionMode === 'single'
      ? 'modo cidade unica'
      : 'modo cidades especificas';
  citySummary.textContent = `${selected}/${cityOptions.length} cidade(s) - ${label}`;
}

function updateCredentialSummary() {
  if (!credentialAccounts.length) {
    credentialSummary.textContent = 'Nenhum JSON de credenciais carregado.';
    return;
  }
  credentialSummary.textContent = `${credentialAccounts.length} credencial(is) carregada(s). Login automatico ativo.`;
}

function mergeCredentialsIntoCityOptions() {
  if (!credentialAccounts.length) return;
  const existingKeys = new Set(cityOptions.map((option) => option.key));
  cityOptions = cityOptions.map((option) => ({
    ...option,
    has_access: credentialsByKey.has(option.key) || option.has_access
  }));

  for (const account of credentialAccounts) {
    if (existingKeys.has(account.key)) continue;
    cityOptions.push({
      orgao: account.orgao,
      cidade: account.cidade,
      has_access: true,
      key: account.key
    });
    existingKeys.add(account.key);
  }

  cityOptions.sort((a, b) => {
    const city = a.cidade.localeCompare(b.cidade, 'pt-BR', { numeric: true });
    return city || a.orgao.localeCompare(b.orgao, 'pt-BR', { numeric: true });
  });
  if (!selectedCityKeys.size || selectionMode === 'all') {
    selectedCityKeys = new Set(cityOptions.map((row) => row.key));
  }
}

function credentialAccountsForCollection(selectedKeys) {
  if (!credentialAccounts.length) return [];
  const allowedKeys = keysForSelectedOptions(selectedKeys);
  return credentialAccounts.filter((account) => allowedKeys.has(account.key));
}

function keysForSelectedOptions(selectedKeys) {
  if (selectedKeys.size) return new Set(selectedKeys);
  return new Set(cityOptions.map((option) => option.key));
}

function normalizeCredentialAccounts(input) {
  const rows = Array.isArray(input) ? input : [];
  const accounts = [];
  const seen = new Set();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const orgao = String(firstValueByNormalizedKey(row, ['orgao']) || '').trim();
    const cidade = String(firstValueByNormalizedKey(row, ['cidade']) || '').trim();
    const user = String(firstValueByNormalizedKey(row, ['user', 'usuario']) || '').trim();
    const senha = String(firstValueByNormalizedKey(row, ['senha', 'password']) || '').trim();
    if (!orgao || !cidade || !user || !senha) continue;

    const key = cityKey(orgao, cidade);
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({ orgao, cidade, user, senha, key, has_access: true });
  }

  accounts.sort((a, b) => {
    const city = a.cidade.localeCompare(b.cidade, 'pt-BR', { numeric: true });
    return city || a.orgao.localeCompare(b.orgao, 'pt-BR', { numeric: true });
  });
  return accounts;
}

function firstValueByNormalizedKey(row, names) {
  const wanted = new Set(names.map((name) => normalizeText(name)));
  for (const [key, value] of Object.entries(row)) {
    if (wanted.has(normalizeText(key))) return value;
  }
  return '';
}

async function openOrReuseAtriconTab(url) {
  const tabs = await chrome.tabs.query({ url: `${BASE_URL}/*` });
  const tab = tabs.find((item) => item.id);
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    return tab;
  }
  return chrome.tabs.create({ url, active: true });
}

async function openOrReuseAnyAtriconTab(url) {
  const avaliaTabs = await chrome.tabs.query({ url: `${BASE_URL}/*` });
  const contaTabs = await chrome.tabs.query({ url: 'https://conta.atricon.org.br/*' });
  const tab = [...avaliaTabs, ...contaTabs].find((item) => item.id);
  if (tab) {
    await chrome.tabs.update(tab.id, { url, active: true });
    return tab;
  }
  return chrome.tabs.create({ url, active: true });
}

function waitForTabUrl(tabId, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tempo esgotado aguardando redirecionamento.'));
    }, timeoutMs);

    const done = (tab) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };

    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && predicate(changeInfo.url || tab.url || '')) done(tab);
    };

    chrome.tabs.onUpdated.addListener(listener);
    const poll = async () => {
      while (!finished) {
        const tab = await chrome.tabs.get(tabId);
        if (predicate(tab.url || '')) {
          done(tab);
          return;
        }
        await sleep(400);
      }
    };
    poll();
  });
}

function isAvaliaAuthenticatedUrl(url) {
  const text = String(url || '');
  return text.startsWith(BASE_URL) && !text.includes('/login');
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('tempo esgotado ao carregar a pagina.'));
    }, timeoutMs);

    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') done();
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.status === 'complete') done();
    });
  });
}

async function executeInTab(tabId, func, args = []) {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return injection.result;
}

async function downloadRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const json = JSON.stringify(rows, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const filename = `resultado_atricon_extensao_${timestampForFilename()}.json`;
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function openVisualizerRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const json = JSON.stringify(rows, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  try {
    await chrome.tabs.create({ url: dataUrl, active: false });
  } catch (error) {
    log(`Aviso: nao foi possivel abrir aba JSON separada: ${error.message}`);
  }
  const viewerUrl = `${VIEWER_FILE_URL}?json=${encodeURIComponent(dataUrl)}`;
  await chrome.tabs.create({ url: viewerUrl, active: true });
}

function showResultSummary(rows) {
  resultPanel.hidden = false;
  resultCount.textContent = `${rows.length} registro(s)`;
}

function setStatus(title, detail) {
  statusTitle.textContent = title;
  statusDetail.textContent = detail || '';
}

function log(message) {
  const now = new Date().toLocaleTimeString('pt-BR');
  logBox.textContent += `[${now}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePercentageText(value) {
  const match = String(value || '').match(/\b(\d{1,3}(?:[,.]\d+)?)\s*%/);
  return match ? `${match[1].trim()}%` : '';
}

function splitEntity(entidade) {
  const text = String(entidade || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(.*?)\s+de\s+(.+)$/i);
  if (!match) return { orgao: text, cidade: '' };
  const orgaoNormalizado = normalizeText(match[1]);
  const orgaosConhecidos = new Map([
    ['prefeitura municipal', 'Prefeitura Municipal'],
    ['camara municipal', 'Camara Municipal']
  ]);
  const orgao = orgaosConhecidos.get(orgaoNormalizado) || match[1];
  return {
    orgao,
    cidade: match[2]
  };
}

function cityKey(orgao, cidade) {
  return `${normalizeText(orgao)}|${normalizeText(cidade)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
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

async function extractAssessmentRowsFromPage() {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (document.querySelectorAll('table tbody tr').length) break;
    await wait(500);
  }

  const rows = Array.from(document.querySelectorAll('table tbody tr')).map((row) => {
    const cells = Array.from(row.querySelectorAll('td')).map((cell) => clean(cell.innerText || cell.textContent));
    if (cells.length < 6) return null;

    const linkNode = row.querySelector("a[href*='/questionarios/'][href*='/view/']");
    let link = linkNode ? linkNode.getAttribute('href') || '' : '';
    if (link) link = new URL(link, 'https://avalia.atricon.org.br').href;

    const idMatch = cells[0].match(/(\d+)\s*\/\s*\d{4}/);
    const questionarioId = idMatch ? idMatch[1] : '';
    if (!link && questionarioId) {
      link = `https://avalia.atricon.org.br/questionarios/${questionarioId}/view/`;
    }

    return {
      numero: cells[0],
      questionario_id: questionarioId,
      entidade: cells[1],
      status: cells[2],
      setor_atual: cells[3],
      data: cells[4],
      indice: cells[5],
      link
    };
  }).filter(Boolean);

  if (!rows.length) {
    const bodyText = clean(document.body.innerText || '');
    const isLogin = location.href.includes('/login') || location.hostname.includes('conta.atricon.org.br');
    return {
      ok: false,
      error: isLogin
        ? 'A pagina esta no login. Entre no Atricon e rode novamente.'
        : `nenhuma avaliacao encontrada na tabela. URL atual: ${location.href}. Texto: ${bodyText.slice(0, 180)}`
    };
  }

  return { ok: true, rows };
}

async function extractPercentageFromQuestionnaire(fallback) {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const readPercentage = (value) => {
    const match = clean(value).match(/\b(\d{1,3}(?:[,.]\d+)?)\s*%/);
    return match ? `${match[1].trim()}%` : '';
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const boxes = Array.from(document.querySelectorAll('div.display-6.fw-bold'));
    for (const box of boxes) {
      const percentage = readPercentage(box.innerText || box.textContent);
      if (percentage) return { porcentagem: percentage };
    }
    await wait(500);
  }

  return { porcentagem: readPercentage(fallback) };
}

async function startLoginFlowInPage(oauthStartUrl) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const buttons = Array.from(document.querySelectorAll('#submitBtn, button, a'));
    const button = buttons.find((item) => {
      const text = clean(item.innerText || item.textContent);
      return item.id === 'submitBtn' || /entrar/i.test(text);
    });
    if (button && !button.disabled) {
      button.click();
      return { ok: true, action: 'clicked' };
    }
    await wait(250);
  }

  if (oauthStartUrl) {
    location.href = oauthStartUrl;
    return { ok: true, action: 'oauth' };
  }

  return { ok: false, error: 'botao de entrada nao encontrado.' };
}

async function submitCredentialsInPage(username, password) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const find = (selector) => document.querySelector(selector);

  let usernameField = null;
  let passwordField = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    usernameField = find("input[name='username'], #username");
    passwordField = find("input[name='password'], #password");
    if (usernameField && passwordField) break;
    await wait(250);
  }

  if (!usernameField || !passwordField) {
    return { ok: false, error: 'campos de usuario/senha nao encontrados.' };
  }

  usernameField.focus();
  usernameField.value = username;
  usernameField.dispatchEvent(new Event('input', { bubbles: true }));
  usernameField.dispatchEvent(new Event('change', { bubbles: true }));

  passwordField.focus();
  passwordField.value = password;
  passwordField.dispatchEvent(new Event('input', { bubbles: true }));
  passwordField.dispatchEvent(new Event('change', { bubbles: true }));

  const submitButton = find("form button[type='submit'], #submitBtn") || Array.from(document.querySelectorAll('button')).find((button) => /entrar/i.test(button.innerText || button.textContent || ''));
  if (submitButton) {
    submitButton.click();
  } else if (passwordField.form) {
    passwordField.form.requestSubmit();
  } else {
    passwordField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  return { ok: true };
}

function readLoginErrorInPage() {
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const selectors = '.alert-danger, .alert-error, .invalid-feedback, .error, .text-danger, [role="alert"]';
  const text = Array.from(document.querySelectorAll(selectors))
    .map((item) => clean(item.innerText || item.textContent))
    .filter(Boolean)
    .join(' ');
  return { error: text ? `login nao foi aceito pela Conta Atricon. Texto da pagina: ${text.slice(0, 300)}` : '' };
}
