const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build, status, score, csv, reportHtml } = require('../extension/analise.js');
const { rows, criterion } = require('./fixtures.cjs');

test('majority, coverage, scores and failure totals use observed data', () => {
  const result = build(rows);
  assert.equal(result.resumo.total, 5);
  assert.equal(result.resumo.com_detalhes, 3);
  assert.equal(result.resumo.sem_detalhes, 2);
  assert.equal(result.resumo.com_falhas, 2);
  assert.equal(result.resumo.falhas, 5);
  assert.equal(result.resumo.essenciais, 3);
  assert.equal(result.resumo.divergencias, 5);
  assert.equal(result.resumo.erros_coleta, 1);
  assert.equal(result.resumo.notas_disponiveis, 3);
  assert.equal(result.resumo.nota_media, (60.5 + 80 + 100) / 3);
  assert.equal(result.resumo.nota_mediana, 80);
  const receipts = result.criterios.find(c => c.criterio === '1.1 Receitas');
  assert.equal(receipts.avaliados, 3);
  assert.equal(receipts.afetados.length, 2);
  assert.equal(receipts.taxa, 200 / 3);
  assert.equal(receipts.maioria, true);
  const availability = result.tipos.find(t => t.item === 'Disponibilidade');
  assert.equal(availability.afetados.length, 2);
  assert.equal(availability.avaliados, 3);
  assert.equal(availability.verificacoes, 6);
  assert.equal(availability.falhas, 4);
});

test('pairs and groups count entities, rather than messages or subitems', () => {
  const result = build(rows);
  assert.equal(result.pares.length, 1);
  assert.equal(result.pares[0].afetados.length, 2);
  assert.equal(result.pares[0].similaridade, 100);
  assert.equal(result.pares[0].suporte, 200 / 3);
  const group = result.por_orgao.find(g => g.nome === 'Prefeitura');
  assert.equal(group.total, 3);
  assert.equal(group.cobertura, 2);
  assert.equal(group.falhas, 5);
  assert.equal(result.dimensoes[0].afetados.length, 2);
});

test('duplicate evidence and local response IDs do not inflate metrics', () => {
  const duplicate = structuredClone(rows[0]);
  duplicate.criterios_validacao.push(structuredClone(duplicate.criterios_validacao[0]));
  duplicate.evidencias_validacao = Array(20).fill(criterion('Old history', 'Não'));
  assert.equal(build([duplicate, rows[1], rows[2]]).resumo.falhas, 5);
  assert.equal(build([duplicate, rows[1], rows[2]]).criterios.length, 2);
});

test('latest snapshot wins, with stable last occurrence fallback for undated data', () => {
  const old = { ...rows[0], coletado_em: '2025-01-01', criterios_validacao: [] };
  const result = build([rows[0], old]);
  assert.equal(result.resumo.total, 1);
  assert.equal(result.resumo.duplicados_descartados, 1);
  assert.equal(result.resumo.falhas, 3);
  assert.equal(build([{ orgao: 'A', cidade: 'B', porcentagem: '1' }, { orgao: 'A', cidade: 'B', porcentagem: '0%' }]).resumo.nota_media, 0);
  assert.equal(build([{ orgao: 'Prefeitura', cidade: 'Alfa' }, { orgao: 'Câmara', cidade: 'Alfa' }]).resumo.total, 2);
});

test('unknown, N/A, conflicting and missing statuses are never successes or new failures', () => {
  ['Não se aplica', 'Não aplicável', 'Não avaliado', 'Não validado', 'Pendente', '??', ''].forEach(s => assert.equal(status(s), null));
  assert.equal(status('Não'), false);
  assert.equal(status('Sim'), true);
  const conflict = { orgao: 'A', criterios_validacao: [criterion('1.1', 'Não'), criterion('1.1', 'Sim')] };
  assert.equal(build([conflict]).resumo.falhas, 0);
  assert.equal(build([conflict]).resumo.com_detalhes, 0);
  assert.equal(build([{ ...rows[0], criterios_validacao: [criterion('1.1', 'Sim', 'Pendente')] }]).criterios[0].avaliados, 0);
  assert.equal(build([{ ...rows[0], criterios_validacao: [criterion('1.1', 'Sim', 'Não se aplica')] }]).criterios[0].avaliados, 1);
  assert.equal(build([{ ...rows[0], criterios_validacao: [criterion('1.1', 'Não se aplica')] }]).criterios[0].avaliados, 0);
});

test('exactly half is not a majority; empty and legacy data expose partial coverage', () => {
  const result = build([rows[0], rows[2]]);
  assert.equal(result.criterios[0].maioria, false);
  assert.equal(build([]).resumo.nota_media, null);
  assert.equal(build([{}]).resumo.com_detalhes, 0);
  const legacy = { orgao: 'A', evidencias_validacao: [{ titulo: 'D', criterio: 'C', validacoes_nao_atendidas: ['Atualidade'], mensagens_evidencia: [{}, {}] }] };
  const report = build([legacy]);
  assert.equal(report.resumo.falhas, 1);
  assert.equal(report.orgaos[0].cobertura, 'legado_parcial');
  assert.equal(report.resumo.completas, 0);
});

test('percentage parsing accepts Brazilian decimals and zero, and rejects absent or invalid values', () => {
  assert.equal(score('0%'), 0);
  assert.equal(score('85,25 %'), 85.25);
  [null, '', 'não disponível', '101%', '-1', '1abc'].forEach(s => assert.equal(score(s), null));
});

test('exports contain detail without credentials, escape HTML and neutralize CSV formulas', () => {
  const report = build([{ ...rows[0], cidade: '=HYPERLINK(1)', senha: 'DO_NOT_EXPORT', user: 'PRIVATE_USER' }, { orgao: '<script>alert(1)</script>', cidade: 'A' }]);
  const exported = JSON.stringify(report);
  assert.ok(!exported.includes('DO_NOT_EXPORT'));
  assert.ok(!exported.includes('PRIVATE_USER'));
  assert.ok(!reportHtml(report).includes('<script>'));
  assert.ok(csv(report).includes("'=HYPERLINK(1)"));
  assert.ok(csv(report).includes('Essencial'));
});
