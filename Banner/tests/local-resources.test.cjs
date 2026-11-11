const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const notes = JSON.parse(read('nota_avalia.json').replace(/^\uFEFF/, ''));

function resources(protocol) {
  let loads = 0;
  const baseURI = `${protocol}//${protocol === 'file:' ? '/C:/projeto%20teste/Banner/' : 'localhost/Banner/' }banner-composer.html`;
  const context = vm.createContext({
    URL, location: { protocol },
    fetch: async () => ({ ok: true, json: async () => notes }),
    document: {
      baseURI,
      createElement: () => ({}),
      head: { appendChild(script) {
        loads++;
        assert.equal(script.src, new URL('./dados-locais.js', baseURI).href);
        vm.runInContext(read('dados-locais.js'), context);
        script.onload();
      } },
    },
  });
  vm.runInContext(read('local-resources.js'), context);
  return { context, api: context.BannerResources, loads: () => loads };
}

test('file: loads the current 55 scores and all 83 images without fetch', async () => {
  const runtime = resources('file:');
  runtime.context.fetch = () => { throw new Error('Local fetch is blocked'); };
  const [localNotes] = await Promise.all([
    runtime.api.loadNotes('./nota_avalia.json'),
    runtime.api.imageSource('./assets/CM - Diamante.png'),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(localNotes)), notes);
  const images = runtime.context.__BANNER_LOCAL_DATA__.images;
  assert.equal(Object.keys(images).length, 83);
  for (const name of Object.keys(images)) {
    const source = await runtime.api.imageSource('./' + name);
    assert.ok(source.startsWith('data:image/png;base64,'));
    assert.deepEqual(Buffer.from(source.split(',')[1], 'base64'), fs.readFileSync(path.join(root, name)));
  }
  assert.equal(runtime.loads(), 1);
  assert.equal(await runtime.api.imageSource('blob:null/manual-logo'), 'blob:null/manual-logo');
  await assert.rejects(runtime.api.imageSource('./assets/ausente.png'), /Imagem local ausente/);
});

test('HTTP continues to use the live JSON and normal image URLs', async () => {
  const runtime = resources('http:');
  assert.deepEqual(await runtime.api.loadNotes('./nota_avalia.json'), notes);
  assert.equal(await runtime.api.imageSource('./assets/CM - Ouro.png'), 'http://localhost/Banner/assets/CM%20-%20Ouro.png');
  assert.equal(runtime.loads(), 0);
});

function templateRuntime(fail) {
  const elements = new Map();
  const downloads = [];
  const document = {
    querySelectorAll: () => [],
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false });
      return elements.get(id);
    },
    createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }),
    body: { appendChild() {} },
  };
  let archive;
  const context = vm.createContext({
    document, Blob, Uint8Array, Uint32Array, DataView, TextEncoder,
    BannerSealRules: require('../seal-rules.js'),
    setTimeout(callback, delay) { if (delay < 60000) callback(); },
    URL: { createObjectURL(blob) { archive = blob; return 'blob:test'; }, revokeObjectURL() {} },
    console: { error() {} },
  });
  const source = read('template.js');
  const cut = source.lastIndexOf('  elements.tabButtons.forEach');
  vm.runInContext(source.slice(0, cut) + `
    state.records = ${JSON.stringify(notes)};
    renderRecordToPng = async record => {
      ${fail ? "throw new Error('Falha ao carregar ./assets/CM - Ouro.png');" : `return { agencyCode: getAgencyCode(getAgencyText(record)), city: getCity(record), hasLogo: true, blob: new Blob(['PNG']) };`}
    };
    globalThis.runBatch = downloadAllTemplates;
  })();`, context);
  return { context, elements, downloads, archive: () => archive };
}

test('ZIP includes only the 22 eligible entities and skips all 33 without a seal', async () => {
  const runtime = templateRuntime(false);
  await runtime.context.runBatch();
  assert.equal(runtime.downloads.length, 1);
  const zip = Buffer.from(await runtime.archive().arrayBuffer());
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 22);
  const status = runtime.elements.get('templateStatus').textContent;
  assert.match(status, /ZIP gerado com 22 entidade/);
  assert.match(status, /33 registro\(s\) sem selo/);
  assert.equal(runtime.elements.get('templateDownloadAllBtn').disabled, false);
});

test('render failures report the real error instead of claiming no valid scores', async () => {
  const runtime = templateRuntime(true);
  await runtime.context.runBatch();
  const status = runtime.elements.get('templateStatus').textContent;
  assert.match(status, /22 entidade\(s\) apta\(s\) ao selo/);
  assert.match(status, /Falha ao carregar/);
  assert.doesNotMatch(status, /Nenhuma entidade possui/);
  assert.equal(runtime.downloads.length, 0);
  assert.equal(runtime.elements.get('templateDownloadAllBtn').disabled, false);
});
