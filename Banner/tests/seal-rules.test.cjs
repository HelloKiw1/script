const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { evaluate, parsePercentage } = require('../seal-rules.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const notes = JSON.parse(read('nota_avalia.json').replace(/^\uFEFF/, ''));

test('essential scores below 100 or missing never grant a seal, even with general score 100', () => {
  for (const value of [undefined, null, '', ' ', 0, 1, 0.99, 96.2, 99.99, 100.01, 101, true, false, 'abc']) {
    const result = evaluate({ nota_2026: 100, essenciais_2026: value });
    assert.equal(result.eligible, false, String(value));
    assert.equal(result.type, '');
    assert.match(result.reason, /essenciais/);
  }
});

test('100% essentials still require a sufficient general score, with exact seal thresholds', () => {
  for (const [score, expected] of [[null, ''], ['', ''], [0, ''], [1, ''], [74.99, ''], [75, 'prata'], [84.99, 'prata'], [85, 'ouro'], [94.99, 'ouro'], [95, 'diamante'], [100, 'diamante'], [101, '']]) {
    const result = evaluate({ nota_2026: score, essenciais_2026: 100 });
    assert.equal(result.type, expected, String(score));
    assert.equal(result.eligible, Boolean(expected));
  }
  assert.equal(evaluate({ indice_2026: '95,2%', essenciais_2026: '100%' }).type, 'diamante');
  assert.equal(parsePercentage('1'), 1);
});

test('a 2026 record never borrows the previous year score or essential percentage', () => {
  assert.equal(evaluate({ nota_2025: 100, essenciais_2025: 100, essenciais_2026: 100 }).eligible, false);
  assert.equal(evaluate({ nota_2026: 100, essenciais_2025: 100 }).eligible, false);
  assert.equal(evaluate({ nota_2025: 100, essenciais_2025: 100 }, 2025).eligible, true);
});

test('all 55 clients agree with the CSV classification: 13 diamond, 4 gold, 5 silver', () => {
  const totals = {};
  for (const record of notes) {
    assert.equal(typeof record.essenciais_2026, 'number');
    const result = evaluate(record);
    const official = ['Diamante', 'Ouro', 'Prata'].includes(record.nivel_2026);
    assert.equal(result.eligible, official, record.cidade);
    if (result.eligible) {
      assert.equal(result.type, record.nivel_2026.toLowerCase());
      totals[result.type] = (totals[result.type] || 0) + 1;
    }
  }
  assert.deepEqual(totals, { diamante: 13, prata: 5, ouro: 4 });
});

function templateRuntime() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, getContext: () => ({}) });
    return elements.get(id);
  };
  const context = vm.createContext({
    BannerSealRules: { evaluate, parsePercentage },
    document: { querySelectorAll: () => [], getElementById: get },
    console: { error() {} },
  });
  const source = read('template.js');
  vm.runInContext(source.slice(0, source.lastIndexOf('  elements.tabButtons.forEach')) + `
    state.records = ${JSON.stringify(notes)};
    globalThis.api = { renderTemplate, renderRecordToPng, applyRecord, getBatchEligibleCount,
      setLoader(loader) { loadImageFromPath = loader; }, getBlob() { return state.renderedBlob; } };
  })();`, context);
  return { api: context.api, elements: get };
}

test('single record and manual rendering both reject an otherwise diamond score with essentials below 100', async () => {
  const runtime = templateRuntime();
  const blocked = notes.find(r => r.cidade === 'Silvanópolis' && r['orgão'] === 'Câmara Municipal');
  await assert.rejects(runtime.api.renderRecordToPng(blocked), /essenciais 96,2%/);
  runtime.elements('templateCity').value = blocked.cidade;
  runtime.elements('templateAgency').value = 'cm';
  runtime.elements('templateScore').value = String(blocked.nota_2026);
  runtime.elements('templateEssentials').value = String(blocked.essenciais_2026);
  await runtime.api.renderTemplate();
  assert.match(runtime.elements('templateStatus').textContent, /essenciais 96,2%/);
  assert.equal(runtime.elements('templateDownloadBtn').disabled, true);
  assert.equal(runtime.api.getBatchEligibleCount(), 22);
});

test('a pending eligible preview cannot restore a downloadable image after essentials become invalid', async () => {
  const runtime = templateRuntime();
  const resumes = [];
  runtime.api.setLoader(() => new Promise(resolve => resumes.push(resolve)));
  runtime.elements('templateCity').value = 'Araguaçu';
  runtime.elements('templateAgency').value = 'cm';
  runtime.elements('templateScore').value = '96.4';
  runtime.elements('templateEssentials').value = '100';
  const pending = runtime.api.renderTemplate();
  runtime.elements('templateEssentials').value = '96.2';
  await runtime.api.renderTemplate();
  for (const resume of resumes) resume({});
  await pending;
  assert.equal(runtime.api.getBlob(), null);
  assert.equal(runtime.elements('templateDownloadBtn').disabled, true);
  assert.match(runtime.elements('templateStatus').textContent, /essenciais 96,2%/);
});

test('multi-year banners filter essential scores and prevent selecting an unearned seal manually', async () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { value: '1', textContent: '', disabled: false, getContext: () => ({ clearRect() {} }) });
    return elements.get(id);
  };
  const context = vm.createContext({ BannerSealRules: { evaluate, parsePercentage }, document: {
    getElementById: get, querySelectorAll: () => [], querySelector: () => ({}),
  } });
  const source = read('banner-composer.js');
  // Load definitions, stopping before the first event registration.
  const firstEvent = source.indexOf('elements.sealCount.addEventListener');
  vm.runInContext(source.slice(0, firstEvent) + `
    globalThis.api = { getSealsFromRecord, renderBanner, select(record, fileName) {
      state.currentRecord = record; state.sealChoices = [fileName];
    } };
  `, context);
  let eligible = 0;
  for (const record of notes) {
    const seals = context.api.getSealsFromRecord(record);
    assert.equal(seals.length, evaluate(record).eligible ? 1 : 0, record.cidade);
    eligible += seals.length;
  }
  assert.equal(eligible, 22);
  context.api.select({ nota_2026: 99, essenciais_2026: 96.2 }, 'diamante_2026.png');
  await context.api.renderBanner();
  assert.match(get('status').textContent, /essenciais 96,2%/);
  assert.equal(get('downloadBtn').disabled, true);
});
