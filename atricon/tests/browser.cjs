// Run with ATRICON_PLAYWRIGHT_MODULE pointing at an installed Playwright package if needed.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.ATRICON_PLAYWRIGHT_MODULE || 'playwright');
const { rows } = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const captures = path.join(root, 'tmp/atricon-analysis');
let requestPayload;
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (pathname === '/api/coletor/contas') {
    response.setHeader('Content-Type', 'application/json');
    return response.end(JSON.stringify({ accounts: [{ orgao: 'Prefeitura', cidade: 'Alfa', user: 'demo' }] }));
  }
  if (pathname === '/api/coletor/executar') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestPayload = JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('Content-Type', 'application/json');
    return response.end(JSON.stringify({ ok: true, json_url: '/fixture.json', output_path: 'resultado_simulado.json', stdout: 'Teste local' }));
  }
  if (pathname === '/fixture.json') {
    response.setHeader('Content-Type', 'application/json');
    return response.end(JSON.stringify(rows));
  }
  // Never read or serve the real account files during UI tests.
  if (/credentials|orgaos_avalia|\/entrada\//.test(pathname)) {
    response.setHeader('Content-Type', 'application/json');
    return response.end('[]');
  }
  const file = path.resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !/\.(html|js|css|png|svg)$/.test(file)) {
    response.statusCode = 404; return response.end();
  }
  try {
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
    response.setHeader('Content-Type', mime[path.extname(file)] || 'text/plain');
    response.end(await fs.readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    await fs.mkdir(captures, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/atricon/visualizador_atricon.html`);
    await page.locator('[data-tab="collectorPanel"]').click();
    await page.locator('#runAllAnalysisCollector').click();
    await page.waitForFunction(() => !document.getElementById('analysisPanel').hidden && document.getElementById('analysisPanel').textContent.includes('1.1 Receitas'));
    assert.deepEqual(requestPayload, { mode: 'all', analysis: true });
    const panel = page.locator('#analysisContent');
    assert.ok((await panel.innerText()).includes('Maioria'));
    assert.ok((await panel.innerText()).includes('Cobertura incompleta'));
    await page.screenshot({ path: path.join(captures, 'desktop.png') });
    await panel.locator('[data-filter="orgao"]').selectOption('Câmara');
    assert.ok(!(await panel.locator('.analysis-card').first().innerText()).includes('1.1 Receitas'));
    const jsonDownload = page.waitForEvent('download');
    await panel.locator('[data-action="json"]').click();
    const jsonPath = await (await jsonDownload).path();
    const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    assert.equal(json.resumo.total, 2);
    assert.equal(json.resumo.falhas, 0);
    await panel.locator('[data-action="clear"]').click();
    await panel.locator('[data-filter="query"]').fill('Beta');
    assert.ok((await panel.locator('.analysis-card').filter({ has: page.getByRole('heading', { name: 'Quais órgãos precisam de atenção', exact: true }) }).innerText()).includes('Beta'));
    await panel.locator('[data-action="clear"]').click();
    const csvDownload = page.waitForEvent('download');
    await panel.locator('[data-action="csv"]').click();
    const csvPath = await (await csvDownload).path();
    assert.ok((await fs.readFile(csvPath, 'utf8')).includes('Atualidade'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(captures, 'mobile.png') });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, 'Mobile layout must not overflow the page');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-shell-theme]').click();
    await page.screenshot({ path: path.join(captures, 'light.png') });

    // Extension results use the same analysis with Chrome storage mocked locally.
    await page.addInitScript(data => {
      window.chrome = { storage: { local: { get: async () => ({ lastAtriconResult: { rows: data } }) } }, downloads: { download() {} } };
    }, rows);
    await page.goto(`${base}/atricon/extension/resultado.html`);
    await page.waitForFunction(() => document.getElementById('analysisPanel').open);
    assert.ok((await page.locator('#analysisContent').innerText()).includes('Itens não atendidos'));
    await page.screenshot({ path: path.join(captures, 'extension.png') });

    // DOM fixture includes passing, failing, N/A and evidence-free cards.
    await page.setContent(`<nav id="dimensoes"><a class="nav-link" href="#d1">Transparência</a></nav><div id="d1" class="tab-pane">
      <div class="card"><button data-bs-target="#Criterio1">1.1 Receitas <span class="badge">Essencial</span></button>
        <div class="col-6"><h6>Avaliação</h6><div class="mb-2">Disponibilidade <span class="badge">Sim</span></div></div>
        <div class="col-6"><h6>Validação</h6><div class="mb-2">Disponibilidade <span class="badge">Não</span></div><div class="mb-2">Atualidade <span class="badge">Não se aplica</span></div></div></div>
      <div class="card"><button data-bs-target="#Criterio2">1.2 Despesas <span class="badge">Obrigatório</span></button><div class="col-6"><h6>Validação</h6><div class="mb-2">Disponibilidade <span class="badge">Sim</span></div></div></div></div>`);
    await page.addScriptTag({ path: path.join(root, 'atricon/extension/criterios.js') });
    const criteria = await page.evaluate(() => AtriconCriteria.read(document.getElementById('d1'), 'Transparência'));
    assert.equal(criteria.length, 2);
    assert.equal(criteria[0].criterio, '1.1 Receitas');
    assert.equal(criteria[0].grau_importancia, 'Essencial');
    assert.deepEqual(criteria[0].validacoes_nao_atendidas, ['Disponibilidade']);
    assert.equal(criteria[1].validacoes_validacao[0].status, 'Sim');
    const source = await fs.readFile(path.join(root, 'atricon/extension/painel.js'), 'utf8');
    const start = source.indexOf('async function extractDeepEvidencesFromForm(');
    const end = source.indexOf('\nasync function startLoginFlowInPage', start);
    const extraction = await page.evaluate(async functionSource => {
      const fn = (0, eval)(`(${functionSource})`);
      return await fn('test-questionnaire');
    }, source.slice(start, end));
    assert.equal(extraction.ok, true);
    assert.equal(extraction.criterios.length, 2);
    assert.equal(extraction.evidencias.length, 0);
    const partial = await page.evaluate(async functionSource => {
      const button = document.createElement('button');
      button.textContent = '1 Evidência';
      button.setAttribute('data-bs-target', '#modalEvidencias999');
      document.querySelector('#d1 .card').append(button);
      const fn = (0, eval)(`(${functionSource})`);
      return await fn('test-questionnaire');
    }, source.slice(start, end));
    assert.equal(partial.ok, false);
    assert.equal(partial.criterios.length, 2, 'Modal failure must preserve all criteria');
    assert.ok(partial.error.includes('nenhuma evidencia'));
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: collector option, filters, JSON/CSV downloads, desktop/mobile/light layouts, extension results, shared DOM reader and evidence-free detailed collection.');
    console.log(`Screenshots: ${captures}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
