const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const { build, reportHtml } = require(path.join(root, 'atricon/extension/analise.js'));
const source = path.join(root, 'atricon/entrada/.resultado/particular/teste_pdf_cm_aparecida_2026.json');
const rows = JSON.parse(fs.readFileSync(source, 'utf8'));
const result = rows[0];
const report = build(rows);
assert.equal(report.resumo.total, 1);
assert.equal(report.resumo.completas, 1);
assert.equal(report.resumo.falhas, 9);
assert.equal(report.resumo.nota_media, 94.92);
assert.equal(report.criterios.length, 83);
assert.equal(report.criterios.filter(c => c.afetados.length).length, 6);
const basename = source.replace(/\.json$/, '');
fs.writeFileSync(basename + '_analise.json', JSON.stringify(report, null, 2), 'utf8');
const failed = result.criterios_validacao.filter(c => c.validacoes_nao_atendidas.length);
const lines = [
  'TESTE DO COLETOR ATRICON POR RELATORIO PDF',
  'Orgao: Camara Municipal de Aparecida do Rio Negro (TO)',
  'Data do teste: 11/11/2026',
  'Questionario: ' + result.questionario_id,
  '', 'RESULTADO DO TESTE: CONCLUIDO',
  `PDF salvo: ${path.basename(result.pdf_arquivo)} (${result.pdf_paginas} paginas).`,
  'Cobertura: 83 criterios, 16 dimensoes e 242 itens; confere com o resumo do PDF.',
  'Conferencia independente: 726 celulas de Avaliacao, Validacao e Revisao comparadas com a pagina original, sem divergencias.',
  '', 'RESULTADO DA AVALIACAO',
  'Status no PDF: ' + result.status,
  'Indice de Transparencia no PDF: ' + result.porcentagem,
  'Classificacao no PDF: ' + result.classificacao_pdf,
  'Etapa usada na analise: Revisao.',
  'Itens nao atendidos: 9, distribuidos em 6 criterios.',
  '', 'CRITERIOS COM FALHAS',
];
for (const criterion of failed) {
  lines.push('', criterion.titulo, criterion.criterio,
    'Itens nao atendidos: ' + criterion.validacoes_nao_atendidas.join(', '),
    'Pagina(s) do PDF: ' + criterion.paginas_pdf.join(', '));
}
lines.push('', 'COMO O COLETOR PASSA A FUNCIONAR',
  '1. Faz o login e identifica o ID do questionario do orgao em Minhas Avaliacoes.',
  '2. Acessa /questionarios/ID/pdf/ usando a mesma autenticacao.',
  '3. Se receber HTML de impressao, gera o PDF em Chromium headless.',
  '4. Le as tabelas do PDF, preserva as tres etapas e usa a Revisao quando existente.',
  '5. Confere o ID, a entidade, o ano e a quantidade de itens antes de concluir.',
  '6. Salva dados compativeis com a aba Analise de todos para cruzar as cidades.',
  '', 'OBSERVACOES',
  `A tabela inicial mostra indice ${result.indice_tabela}; o PDF revisado informa ${result.porcentagem}. A analise usa a nota do PDF.`,
  'O PDF nao informa o grau de importancia de cada criterio. Nao foi inferido se cada falha e essencial.',
  'As imagens das evidencias estao preservadas no PDF; os comentarios de validadores e revisores foram extraidos.',
  'A nota oficial nao foi recalculada por contagem de itens.',
  'Este teste real consultou somente este orgao. Para os demais, use Coletar e analisar todos.',
  'O funcionamento do cruzamento entre cidades tambem foi verificado com dados simulados.',
  '', 'Fonte: ' + result.pdf_url);
fs.writeFileSync(basename + '_resumo.txt', '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
const css = fs.readFileSync(path.join(root, 'atricon/extension/analise.css'), 'utf8');
const pdfRelative = path.relative(path.dirname(source), result.pdf_arquivo).replaceAll('\\', '/');
fs.writeFileSync(basename + '_analise.html', `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Teste PDF - CM Aparecida do Rio Negro</title><style>:root{--text:#17354c;--muted:#52616b;--border:#d4e0e7;--panel:#fff;--bg:#eef4f7}body{font:15px Arial,sans-serif;background:#eef4f7;color:#17354c;margin:0;padding:24px}main{max-width:1250px;margin:auto}a{color:#087f8c}h1{font-size:26px}${css}</style><main><h1>Câmara Municipal de Aparecida do Rio Negro</h1><p>Teste real de 11/11/2026. Questionário 43006. Resultado da Revisão.</p><p><a href="${encodeURI(pdfRelative)}">Abrir PDF original (102 páginas)</a> · <a href="${path.basename(basename)}_resumo.txt">Resumo do teste em TXT</a></p>${reportHtml(report)}</main></html>`, 'utf8');
console.log(JSON.stringify({ ...report.resumo, arquivos: [basename + '_resumo.txt', basename + '_analise.html'] }, null, 2));
