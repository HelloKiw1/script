import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const directory = path.dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse((await fs.readFile(path.join(directory, 'dados-fonte.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(rows.length, 55);
assert.equal(new Set(rows.map(row => row.codigo)).size, 55);
const awards = new Set(['Diamante', 'Ouro', 'Prata']);
const order = { Diamante: 0, Ouro: 1, Prata: 2, 'Sem selo': 3 };
rows.sort((a, b) => {
  const resultA = awards.has(a.nivel_2026) ? a.nivel_2026 : 'Sem selo';
  const resultB = awards.has(b.nivel_2026) ? b.nivel_2026 : 'Sem selo';
  return order[resultA] - order[resultB] || a.poder.localeCompare(b.poder) || a.municipio.localeCompare(b.municipio, 'pt-BR');
});
const matrix = rows.map(row => {
  assert.ok(row.indice_2026 !== '' && Number(row.indice_2026) >= 0 && Number(row.indice_2026) <= 100);
  assert.ok(['Diamante', 'Ouro', 'Prata', 'Elevado', 'Intermediário', 'Básico'].includes(row.nivel_2026));
  return [row.poder === 'Legislativo' ? 'CM' : 'PM', row.municipio, row.uf,
    Number(row.indice_2026), row.nivel_2026, null,
    row.essenciais_2026 === '' ? null : Number(row.essenciais_2026) / 100,
    null, row.codigo, row.site];
});
matrix.push(['CRP23', null, null, null, 'Não localizado', null, null, null, null, null]);
assert.equal(matrix.length, 56);

const workbook = Workbook.create();
const summary = workbook.worksheets.add('Resumo');
const clients = workbook.worksheets.add('Clientes');
const navy = '#18334D', ink = '#243B53', muted = '#52677B';
for (const [sheet, range] of [[summary, 'A1:F26'], [clients, 'A1:J62']]) {
  sheet.showGridLines = false;
  sheet.getRange(range).format.font = { name: 'Arial', size: 10, color: ink };
  sheet.getRange(range).format.verticalAlignment = 'center';
  sheet.getRange(range).format.rowHeight = 23;
}
summary.tabColor = navy;
clients.tabColor = '#7699B3';
summary.getRange('A:A').format.columnWidthPx = 220;
summary.getRange('B:D').format.columnWidthPx = 120;
summary.getRange('E:F').format.columnWidthPx = 115;
summary.getRange('A2').values = [['Clientes: transparência pública 2026']];
summary.getRange('A2').format.font = { name: 'Arial', size: 15, bold: true, color: navy };
summary.getRange('A3').values = [['Base de 56 clientes informados. Apuração em 10/11/2026.']];
summary.getRange('A3').format.font = { name: 'Arial', size: 10, color: muted };
summary.getRange('A4:F4').format.borders = { bottom: { style: 'thin', color: '#B9C8D4' } };
summary.getRange('A6:F6').values = [['Resultado', 'Câmaras', 'Prefeituras', 'CRP23', 'Total', '% da base']];
summary.getRange('A7:A11').values = [['Diamante'], ['Ouro'], ['Prata'], ['Sem selo'], ['Não localizado']];
for (let row = 7; row <= 11; row++) {
  summary.getRange(`B${row}:F${row}`).formulas = [[
    `=COUNTIFS(Clientes!$A$7:$A$62,"CM",Clientes!$F$7:$F$62,$A${row})`,
    `=COUNTIFS(Clientes!$A$7:$A$62,"PM",Clientes!$F$7:$F$62,$A${row})`,
    `=COUNTIFS(Clientes!$A$7:$A$62,"CRP23",Clientes!$F$7:$F$62,$A${row})`,
    `=SUM(B${row}:D${row})`, `=E${row}/$E$12`,
  ]];
}
summary.getRange('A12').values = [['Total de clientes']];
summary.getRange('B12:F12').formulas = [['=SUM(B7:B11)', '=SUM(C7:C11)', '=SUM(D7:D11)', '=SUM(E7:E11)', '=SUM(F7:F11)']];
summary.getRange('A15').values = [['Clientes com selo']];
summary.getRange('E15:F15').formulas = [['=SUM(E7:E9)', '=E15/E12']];
summary.getRange('A16').values = [['Clientes localizados no CSV']];
summary.getRange('E16:F16').formulas = [['=SUM(E7:E10)', '=E16/E12']];
summary.getRange('B7:E16').setNumberFormat('0');
summary.getRange('F7:F16').setNumberFormat('0.0%');
summary.getRange('A12:F12').format.fill = '#EAF0F5';
summary.getRange('A12:F12').format.font.bold = true;
summary.getRange('A12:F12').format.borders = { top: { style: 'thin', color: '#91A9BA' } };
summary.getRange('A15:F16').format.fill = '#F3F6F9';
summary.getRange('A15:F15').format.font.bold = true;
summary.getRange('A19').values = [['Critério de contagem']];
summary.getRange('A19').format.font.bold = true;
summary.getRange('A20').values = [['Resultado oficial: nivel_2026. “Sem selo” reúne Elevado, Intermediário e Básico.']];
summary.getRange('A21').values = [['O CRP23 não foi localizado; não foi contado como órgão sem selo.']];
summary.getRange('A23').values = [['Diferença entre nota e selo']];
summary.getRange('A23').format.font.bold = true;
summary.getRange('A24').formulas = [['=COUNTIFS(Clientes!$D$7:$D$62,">=75",Clientes!$E$7:$E$62,"Elevado")&" clientes têm nota a partir de 75 e nível Elevado, sem selo no CSV."']];
summary.getRange('A25').values = [['A faixa por nota aparece na aba Clientes para comparação; não define o resultado oficial.']];
summary.getRange('A20:F25').format.font.size = 10;
summary.getRange('A20:F25').format.wrapText = false;

clients.getRange('A2').values = [['Resultado de cada cliente']];
clients.getRange('A2').format.font = { name: 'Arial', size: 15, bold: true, color: navy };
clients.getRange('A3').values = [['Fonte: p7-lista-2026.csv. Notas: indice_2026. Classificação oficial: nivel_2026.']];
clients.getRange('A4').values = [['CM = Câmara Municipal. PM = Prefeitura Municipal. “Não localizado” indica ausência no CSV.']];
clients.getRange('A3:J4').format.font.color = muted;
clients.getRange('A6:J6').values = [['Órgão', 'Município', 'UF', 'Nota 2026', 'Nível no CSV', 'Resultado', 'Essenciais (%)', 'Faixa por nota', 'Código CSV', 'Site no CSV']];
clients.getRange('A7:J62').values = matrix;
clients.getRange('F7:F62').formulas = matrix.map((_, index) => {
  const row = index + 7;
  return [`=IF(OR(E${row}="Diamante",E${row}="Ouro",E${row}="Prata"),E${row},IF(E${row}="Não localizado","Não localizado","Sem selo"))`];
});
clients.getRange('H7:H62').formulas = matrix.map((_, index) => {
  const row = index + 7;
  return [`=IF(D${row}="","Não localizado",IF(D${row}>=95,"Diamante",IF(D${row}>=85,"Ouro",IF(D${row}>=75,"Prata","Sem selo"))))`];
});
clients.getRange('D7:D62').setNumberFormat('0.0');
clients.getRange('G7:G62').setNumberFormat('0.0%');
const widths = { A: 78, B: 225, C: 48, D: 100, E: 135, F: 140, G: 125, H: 145, I: 100, J: 420 };
for (const [col, width] of Object.entries(widths)) clients.getRange(`${col}:${col}`).format.columnWidthPx = width;
clients.getRange('D7:D62').format.horizontalAlignment = 'right';
clients.getRange('G7:G62').format.horizontalAlignment = 'right';
clients.getRange('I7:I62').format.horizontalAlignment = 'left';
const table = clients.tables.add('A6:J62', true, 'Clientes2026');
table.showFilterButton = true;
clients.freezePanes.freezeRows(6);
for (const [sheet, address] of [[summary, 'A6:F6'], [clients, 'A6:J6']]) {
  sheet.getRange(address).format = {
    fill: navy,
    font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: 29,
  };
}
const colors = {
  Diamante: ['#DDEEF7', '#1E536E'], Ouro: ['#FFF0C2', '#805D00'],
  Prata: ['#E6E9EE', '#465365'], 'Sem selo': ['#F3F4F6', '#52677B'],
  'Não localizado': ['#FCE4DE', '#9A3A25'],
};
for (const [category, [fill, color]] of Object.entries(colors)) {
  clients.getRange('F7:F62').conditionalFormats.addCustom(`=$F7="${category}"`, { fill, font: { bold: true, color } });
}
for (let row = 7; row <= 11; row++) {
  const category = summary.getRange(`A${row}`).values[0][0];
  summary.getRange(`A${row}`).format.fill = colors[category][0];
}

workbook.recalculate();
const stats = summary.getRange('B7:F12').values;
assert.deepEqual(stats.map(row => row[3]), [13, 4, 5, 33, 1, 56]);
assert.deepEqual(stats[5].slice(0, 4), [32, 23, 1, 56]);
assert.equal(summary.getRange('E15').values[0][0], 22);
assert.equal(summary.getRange('E16').values[0][0], 55);
assert.ok(String(summary.getRange('A24').values[0][0]).startsWith('24 '));
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options: { useRegex: true, maxResults: 20 }, maxChars: 1500 });
console.log(errors.ndjson);
console.log((await workbook.inspect({ kind: 'table', range: 'Resumo!A6:F16', tableMaxRows: 11, tableMaxCols: 6, maxChars: 2500 })).ndjson);
for (const [sheetName, range, filename] of [
  ['Resumo', 'A1:F26', 'previa-resumo.png'],
  ['Clientes', 'A1:H19', 'previa-clientes.png'],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.4, format: 'png' });
  await fs.writeFile(path.join(directory, filename), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(path.join(directory, 'Relatorio-clientes-PNTP-2026.xlsx'));
console.log('Relatório salvo; 56 clientes, 22 com selo, 33 sem selo, 1 não localizado.');
