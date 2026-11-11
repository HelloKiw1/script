// Usage: node Banner/extrair-selos-oficiais.cjs caminho/para/Selos.pdf
// Renders the original PDF vectors directly with transparency; no color replacement.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error('Informe o caminho do PDF oficial.');
  const runtime = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
  const dependencies = createRequire(runtime);
  const { createCanvas, loadImage } = dependencies('@napi-rs/canvas');
  const pdfjs = await import(pathToFileURL(dependencies.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(source)), useSystemFonts: true }).promise;
  assert.equal(pdf.numPages, 3, 'Esperadas as paginas Prata, Ouro e Diamante, nessa ordem.');
  const size = 1254;
  const output = path.join(__dirname, 'Selo');
  const staged = [];

  for (const [index, name] of ['prata', 'ouro', 'diamante'].entries()) {
    const page = await pdf.getPage(index + 1);
    const probeScale = 4;
    const viewport = page.getViewport({ scale: probeScale });
    const probe = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const probeContext = probe.getContext('2d', { alpha: true });
    // canvas:null keeps the supplied alpha-enabled context. Otherwise PDF.js
    // obtains an opaque context from the canvas and fills the outside white.
    await page.render({ canvas: null, canvasContext: probeContext, viewport, background: 'rgba(0,0,0,0)' }).promise;
    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
    let left = probe.width, top = probe.height, right = 0, bottom = 0;
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if (!pixels[(y * probe.width + x) * 4 + 3]) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
    }
    assert.ok(right > left && bottom > top, `Arte ausente: ${name}`);
    const width = (right - left) / probeScale;
    const height = (bottom - top) / probeScale;
    const scale = (size - 2) / Math.max(width, height);
    const finalView = page.getViewport({
      scale,
      offsetX: (size - width * scale) / 2 - left / probeScale * scale,
      offsetY: (size - height * scale) / 2 - top / probeScale * scale,
    });
    const canvas = createCanvas(size, size);
    const context = canvas.getContext('2d', { alpha: true });
    await page.render({ canvas: null, canvasContext: context, viewport: finalView, background: 'rgba(0,0,0,0)' }).promise;
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      assert.equal(context.getImageData(x, y, 1, 1).data[3], 0, `Fundo opaco: ${name}`);
    }
    assert.equal(context.getImageData(size / 2, size / 2, 1, 1).data[3], 255, `Centro transparente: ${name}`);
    const png = canvas.toBuffer('image/png');
    const decoded = await loadImage(png);
    assert.equal(decoded.width, size); assert.equal(decoded.height, size);
    staged.push({ name: `${name}_2026.png`, png });
    if (name === 'ouro') staged.push({ name: 'ouro_2026_transparente.png', png });
  }

  for (const { name, png } of staged) {
    fs.writeFileSync(path.join(output, name), png);
    console.log(`${name}: ${size}x${size}, PNG com transparencia, ${png.length} bytes`);
  }
  await pdf.destroy();
}

main().catch(error => { console.error(error); process.exitCode = 1; });
