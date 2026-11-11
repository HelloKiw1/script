/* Local, deterministic analysis. No credentials or remote services are used. */
(function (root) {
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const array = value => Array.isArray(value) ? value : [];
  const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const percent = (part, total) => total ? 100 * part / total : null;
  const fmt = value => value === null ? 'Sem dados' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const itemName = value => ({ 'filtro de pesquisa': 'filtros de pesquisa' })[norm(value)] || norm(value);

  function status(value) {
    const label = norm(value);
    if (!label || /aplic|pendente|aguard|nao avaliad|nao validad/.test(label)) return null;
    if (/^(nao|nao atendid[oa]s?|nao atende|reprovad[oa]|inadequad[oa]|no|false|0)$/.test(label)) return false;
    if (/^(sim|atendid[oa]s?|atende|aprovad[oa]|adequad[oa]|yes|true|1)$/.test(label)) return true;
    return null;
  }

  function score(value) {
    if (value === null || value === undefined || text(value) === '') return null;
    const cleaned = text(value).replace(/\s*%$/, '').replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const number = Number(cleaned);
    return number >= 0 && number <= 100 ? number : null;
  }

  function latestRows(input) {
    const rows = new Map();
    array(input).forEach((wrapper, index) => {
      if (!wrapper || typeof wrapper !== 'object') return;
      const row = wrapper.raw || wrapper;
      const orgao = text(row.orgao ?? row['orgão'] ?? row['órgão']);
      const cidade = text(row.cidade);
      const key = orgao || cidade ? `${norm(orgao)}|${norm(cidade)}` : `sem-identificacao-${index}`;
      const previous = rows.get(key);
      const date = Date.parse(row.coletado_em) || 0;
      if (!previous || date >= previous.date) rows.set(key, { row, key, orgao, cidade, date });
    });
    return [...rows.values()];
  }

  function build(input, now = new Date()) {
    const unique = latestRows(input);
    const criteria = new Map();
    const entities = unique.map(({ row, key, orgao, cidade, date }) => {
      const source = array(row.criterios_validacao).length ? row.criterios_validacao : array(row.evidencias_validacao);
      const entity = {
        key, orgao, cidade, label: [orgao, cidade].filter(Boolean).join(' · ') || 'Órgão não identificado',
        status: text(row.status) || 'Não informado', setor: text(row.setor_atual) || 'Não informado',
        nota: score(row.porcentagem ?? row.porcetagem), coletado_em: date ? new Date(date).toISOString() : null,
        erro: text(row.erro), erro_detalhes: text(row.erro_evidencias),
        cobertura: row.coleta_detalhada || (source.length ? 'legado_parcial' : 'nao_solicitada'),
        criterios: [], falhas: 0, essenciais: 0, divergencias: 0, avaliados: 0, desconhecidos: 0
      };
      const local = new Map();
      source.forEach(entry => {
        const label = text(entry.criterio);
        if (!label) return; // A local response ID cannot identify a criterion across entities.
        const chapter = text(entry.titulo) || 'Sem dimensão';
        const id = `${norm(chapter)}|${norm(label)}`;
        if (!local.has(id)) local.set(id, { key: id, criterio: label, dimensao: chapter, importancia: text(entry.grau_importancia), itens: new Map(), auto: new Map() });
        const criterion = local.get(id);
        const merge = (map, name, value, notApplicable = false) => {
          const key = itemName(name);
          if (!key) return;
          if (!map.has(key)) map.set(key, { item: text(name), valores: new Set(), nao_aplicavel: true });
          map.get(key).valores.add(value);
          map.get(key).nao_aplicavel = map.get(key).nao_aplicavel && notApplicable;
        };
        array(entry.validacoes_validacao).forEach(item => merge(criterion.itens, item.item, status(item.status), /aplic/.test(norm(item.status))));
        array(entry.validacoes_avaliacao).forEach(item => merge(criterion.auto, item.item, status(item.status)));
        // Legacy evidence JSON can contain only the failed items; never invent passing items.
        const failures = array(entry.validacoes_nao_atendidas).length ? entry.validacoes_nao_atendidas : text(entry.validacoes_nao_atendidas_texto).split(',').filter(Boolean);
        failures.forEach(name => {
          if (!criterion.itens.has(itemName(name))) merge(criterion.itens, name, false);
        });
      });
      for (const criterion of local.values()) {
        const resolved = values => values.size === 1 ? [...values][0] : null;
        const items = [...criterion.itens].map(([key, item]) => {
          const validation = resolved(item.valores);
          const assessment = criterion.auto.has(key) ? resolved(criterion.auto.get(key).valores) : null;
          const divergence = validation === false && assessment === true;
          entity.falhas += validation === false ? 1 : 0;
          entity.avaliados += validation !== null ? 1 : 0;
          entity.desconhecidos += validation === null ? 1 : 0;
          entity.divergencias += divergence ? 1 : 0;
          if (validation === false && norm(criterion.importancia).includes('essencial')) entity.essenciais++;
          return { key, item: item.item, validacao: validation, avaliacao: assessment, divergencia: divergence, nao_aplicavel: item.nao_aplicavel };
        });
        const failed = items.some(item => item.validacao === false);
        const known = failed || (items.some(item => item.validacao === true) && items.every(item => item.validacao === true || item.nao_aplicavel));
        const result = { ...criterion, itens: items, auto: undefined, resultado: known ? !failed : null };
        entity.criterios.push(result);
        if (!criteria.has(criterion.key)) criteria.set(criterion.key, {
          key: criterion.key, criterio: criterion.criterio, dimensao: criterion.dimensao,
          avaliados: 0, afetados: [], falhas: 0, essenciais: 0, divergencias: 0
        });
        const global = criteria.get(criterion.key);
        if (known) global.avaliados++;
        if (failed) global.afetados.push(entity.label);
        global.falhas += items.filter(item => item.validacao === false).length;
        global.essenciais += norm(criterion.importancia).includes('essencial') && failed ? 1 : 0;
        global.divergencias += items.filter(item => item.divergencia).length;
      }
      return entity;
    });
    const covered = entities.filter(entity => entity.avaliados > 0);
    const finish = values => [...values].map(item => ({ ...item, taxa: percent(item.afetados.length, item.avaliados), maioria: item.afetados.length > item.avaliados / 2 && item.avaliados > 0 }))
      .sort((a, b) => b.afetados.length - a.afetados.length || b.falhas - a.falhas || a.criterio?.localeCompare(b.criterio || '') || 0);
    const rankedCriteria = finish(criteria.values());
    const types = new Map();
    entities.forEach(entity => {
      entity.criterios.forEach(criterion => criterion.itens.forEach(item => {
        if (!types.has(item.key)) types.set(item.key, { item: item.item, eligible: new Set(), affected: new Set(), falhas: 0, verificacoes: 0 });
        const type = types.get(item.key);
        if (item.validacao !== null) { type.eligible.add(entity.key); type.verificacoes++; }
        if (item.validacao === false) { type.affected.add(entity.key); type.falhas++; }
      }));
    });
    const typeRows = [...types.values()].map(type => ({
      item: type.item, avaliados: type.eligible.size, afetados: entities.filter(e => type.affected.has(e.key)).map(e => e.label),
      falhas: type.falhas, verificacoes: type.verificacoes, taxa: percent(type.affected.size, type.eligible.size),
      maioria: type.affected.size > type.eligible.size / 2 && type.eligible.size > 0
    })).sort((a, b) => b.afetados.length - a.afetados.length || b.falhas - a.falhas);
    const groupBy = field => {
      const groups = new Map();
      entities.forEach(entity => {
        const name = entity[field] || 'Não informado';
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(entity);
      });
      return [...groups].map(([nome, rows]) => {
        const scores = rows.map(r => r.nota).filter(n => n !== null);
        const detailed = rows.filter(r => r.avaliados > 0);
        return { nome, total: rows.length, cobertura: detailed.length, com_falhas: detailed.filter(r => r.falhas > 0).length,
          falhas: rows.reduce((n, r) => n + r.falhas, 0), nota_media: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
          taxa: percent(detailed.filter(r => r.falhas > 0).length, detailed.length) };
      }).sort((a, b) => b.falhas - a.falhas || a.nome.localeCompare(b.nome));
    };
    const dimensions = new Map();
    entities.forEach(entity => {
      const names = new Set(entity.criterios.map(c => c.dimensao));
      names.forEach(name => {
        if (!dimensions.has(name)) dimensions.set(name, { nome: name, avaliados: 0, afetados: [], falhas: 0 });
        const dimension = dimensions.get(name);
        const rows = entity.criterios.filter(c => c.dimensao === name);
        if (rows.some(c => c.resultado !== null)) dimension.avaliados++;
        if (rows.some(c => c.resultado === false)) dimension.afetados.push(entity.label);
        dimension.falhas += rows.reduce((n, c) => n + c.itens.filter(i => i.validacao === false).length, 0);
      });
    });
    // Count each pair once per entity, regardless of the number of messages or failed subitems.
    const pairCounts = new Map();
    const failedSets = new Map();
    covered.forEach(entity => {
      const keys = entity.criterios.filter(c => c.resultado === false).map(c => c.key).sort();
      keys.forEach(key => {
        if (!failedSets.has(key)) failedSets.set(key, new Set());
        failedSets.get(key).add(entity.key);
      });
      keys.forEach((a, i) => keys.slice(i + 1).forEach(b => {
        const key = JSON.stringify([a, b]);
        if (!pairCounts.has(key)) pairCounts.set(key, { a, b, afetados: [] });
        pairCounts.get(key).afetados.push(entity.label);
      }));
    });
    const pairs = [...pairCounts.values()].filter(p => p.afetados.length >= 2).map(p => ({
      primeiro: criteria.get(p.a).criterio, segundo: criteria.get(p.b).criterio,
      afetados: p.afetados, suporte: percent(p.afetados.length, covered.length),
      similaridade: percent(p.afetados.length, new Set([...failedSets.get(p.a), ...failedSets.get(p.b)]).size)
    })).sort((a, b) => b.afetados.length - a.afetados.length || b.similaridade - a.similaridade);
    const scores = entities.map(e => e.nota).filter(n => n !== null).sort((a, b) => a - b);
    const dates = entities.map(e => e.coletado_em).filter(Boolean).sort();
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return {
      gerado_em: now.toISOString(), periodo_coleta: { inicio: dates[0] || null, fim: dates.at(-1) || null, sem_data: entities.length - dates.length },
      resumo: { total: entities.length, duplicados_descartados: array(input).length - unique.length,
        com_detalhes: covered.length, sem_detalhes: entities.length - covered.length,
        completas: entities.filter(e => e.cobertura === 'concluida').length,
        com_falhas: covered.filter(e => e.falhas > 0).length, falhas: entities.reduce((n, e) => n + e.falhas, 0),
        essenciais: entities.reduce((n, e) => n + e.essenciais, 0), divergencias: entities.reduce((n, e) => n + e.divergencias, 0),
        erros_coleta: entities.filter(e => e.erro || e.erro_detalhes).length,
        nota_media: average, notas_disponiveis: scores.length,
        nota_mediana: scores.length ? (scores[Math.floor((scores.length - 1) / 2)] + scores[Math.floor(scores.length / 2)]) / 2 : null },
      criterios: rankedCriteria, tipos: typeRows, dimensoes: finish(dimensions.values()), pares: pairs,
      por_orgao: groupBy('orgao'), por_cidade: groupBy('cidade'), por_status: groupBy('status'), por_setor: groupBy('setor'),
      orgaos: entities.sort((a, b) => b.essenciais - a.essenciais || b.falhas - a.falhas || (a.nota ?? 101) - (b.nota ?? 101) || a.label.localeCompare(b.label))
    };
  }

  const details = labels => labels.length ? `<details><summary>${labels.length} órgão(s) afetado(s)</summary><ul>${labels.map(label => `<li>${esc(label)}</li>`).join('')}</ul></details>` : 'Nenhuma falha observada';
  const table = (headers, rows) => `<div class="analysis-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Sem dados suficientes neste recorte.</td></tr>`}</tbody></table></div>`;
  const section = (title, body) => `<section class="analysis-card"><h3>${esc(title)}</h3>${body}</section>`;
  const ratio = row => `${row.afetados.length}/${row.avaliados} · ${fmt(row.taxa)}${row.maioria ? ' <strong class="analysis-bad">Maioria</strong>' : ''}`;
  const bar = row => `<div class="analysis-bar"><span style="width:${row.taxa || 0}%"></span></div>${ratio(row)}`;

  function reportHtml(report) {
    const r = report.resumo;
    const cards = [ ['Órgãos no recorte', r.total], ['Com validação observável', `${r.com_detalhes}/${r.total}`],
      ['Com falhas observadas', `${r.com_falhas}/${r.com_detalhes}`], ['Itens não atendidos', r.falhas],
      ['Falhas em essenciais', r.essenciais], ['Divergências avaliação × validação', r.divergencias],
      ['Nota média informada', fmt(r.nota_media)], ['Erros de coleta', r.erros_coleta] ];
    const top = report.criterios.find(c => c.afetados.length);
    const dates = report.periodo_coleta;
    const formatDate = value => value ? new Date(value).toLocaleString('pt-BR') : 'Não informada';
    const overview = `<div class="analysis-metrics">${cards.map(([name, value]) => `<div><span>${esc(name)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      <p class="analysis-note">Coletas: ${esc(formatDate(dates.inicio))} a ${esc(formatDate(dates.fim))}. ${dates.sem_data} órgão(s) sem data de coleta. Esta análise descreve o arquivo carregado.</p>
      <p class="analysis-note">${r.completas} coleta(s) detalhada(s) concluída(s); ${r.sem_detalhes} órgão(s) sem validação observável. ${r.duplicados_descartados} duplicata(s) descartada(s). Nota média/mediana calculadas sobre ${r.notas_disponiveis} nota(s); mediana: ${fmt(r.nota_mediana)}.</p>
      ${r.com_detalhes < r.total ? '<p class="analysis-alert">Cobertura incompleta: registros sem detalhes, pendentes ou com erro não representam órgãos sem falhas. Use “Coletar e analisar todos” para ampliar a base.</p>' : ''}
      ${r.completas < r.com_detalhes ? '<p class="analysis-alert">Parte dos detalhes vem de coletas parciais ou arquivos antigos. As taxas representam somente os resultados observados; evidências isoladas podem conter apenas falhas e superestimar sua frequência. Recolha todos os critérios antes de generalizar.</p>' : ''}
      <p>${top ? `Maior alcance observado: <strong>${esc(top.criterio)}</strong>, com falha em ${top.afetados.length} de ${top.avaliados} órgão(s) com resultado conhecido nesse critério (${fmt(top.taxa)}). ${top.maioria ? 'A maioria dessa base apresenta falha.' : 'Esse problema não atinge a maioria dessa base.'}` : 'Nenhuma falha estruturada observada. Isso não comprova conformidade dos registros sem detalhes.'}</p>`;
    const criteriaTable = table(['Critério / dimensão', 'Órgãos com falha / avaliados', 'Itens não atendidos', 'Essenciais afetados', 'Quem está errando'], report.criterios.map(c => [
      `${esc(c.criterio)}<small>${esc(c.dimensao)}</small>`, bar(c), c.falhas, c.essenciais, details(c.afetados)
    ]));
    const types = table(['Tipo de falha', 'Órgãos com falha / avaliados', 'Itens não atendidos / verificados', 'Afetados'], report.tipos.map(t => [esc(t.item), bar(t), `${t.falhas}/${t.verificacoes}`, details(t.afetados)]));
    const ranking = table(['Órgão / cidade', 'Nota', 'Itens não atendidos / verificados', 'Essenciais', 'Divergências', 'Detalhes das falhas', 'Cobertura / coleta'], report.orgaos.map(e => [
      esc(e.label), fmt(e.nota), `${e.falhas}/${e.avaliados}`, e.essenciais, e.divergencias,
      e.falhas ? `<details><summary>Ver critérios e itens</summary><ul>${e.criterios.filter(c => c.resultado === false).map(c => `<li><strong>${esc(c.criterio)}</strong><small>${esc(c.dimensao)} · ${esc(c.importancia || 'Importância não informada')}</small>${esc(c.itens.filter(i => i.validacao === false).map(i => i.item).join(', '))}</li>`).join('')}</ul></details>` : 'Nenhuma falha observada',
      `${esc(e.cobertura)}${e.desconhecidos ? `<small>${e.desconhecidos} item(ns) sem resultado aplicável conhecido</small>` : ''}${e.erro || e.erro_detalhes ? `<small class="analysis-bad">${esc([e.erro, e.erro_detalhes].filter(Boolean).join(' · '))}</small>` : ''}`
    ]));
    const groupTable = rows => table(['Grupo', 'Órgãos', 'Com detalhes', 'Com falha / com detalhes', 'Itens não atendidos', 'Nota média'], rows.map(g => [esc(g.nome), g.total, g.cobertura, `${g.com_falhas}/${g.cobertura} · ${fmt(g.taxa)}`, g.falhas, fmt(g.nota_media)]));
    const matrixCriteria = report.criterios.filter(c => c.afetados.length);
    const matrix = table(['Órgão', ...matrixCriteria.map(c => `${c.dimensao} · ${c.criterio}`)], report.orgaos.map(e => [esc(e.label), ...matrixCriteria.map(c => {
      const found = e.criterios.find(item => item.key === c.key);
      return found?.resultado === false ? '<span class="analysis-bad">Falha</span>' : found?.resultado === true ? 'Atendido' : '<span class="analysis-muted">Sem resultado</span>';
    })]));
    const divergenceRows = report.orgaos.flatMap(e => e.criterios.flatMap(c => c.itens.filter(i => i.divergencia).map(i => [esc(e.label), esc(c.criterio), esc(i.item), 'Sim → Não'])));
    const priorities = report.criterios.filter(c => c.afetados.length).slice().sort((a, b) => b.essenciais - a.essenciais || b.afetados.length - a.afetados.length || b.falhas - a.falhas);
    return overview + section('Prioridades de correção', `<p>Ordem: órgãos com falha em critérios essenciais, alcance entre órgãos e quantidade de itens não atendidos. A prioridade é operacional; não estima pontos da nota oficial.</p>${table(['Prioridade', 'Critério', 'Essenciais afetados', 'Alcance', 'Ação sugerida'], priorities.map((c, i) => [i + 1, esc(c.criterio), c.essenciais, ratio(c), 'Conferir os itens não atendidos e as evidências dos órgãos listados no ranking de critérios.']))}`)
      + section('O que mais estão errando', criteriaTable)
      + section('Tipos de falha', types)
      + section('Falhas por dimensão', table(['Dimensão', 'Órgãos com falha / avaliados', 'Itens não atendidos', 'Afetados'], report.dimensoes.map(d => [esc(d.nome), bar(d), d.falhas, details(d.afetados)])))
      + section('Quais órgãos precisam de atenção', ranking)
      + section('Matriz órgão × critério com falha', matrix)
      + section('Problemas que aparecem juntos', `<p>Coocorrências em pelo menos dois órgãos. Suporte usa os ${r.com_detalhes} órgãos com validação observável; similaridade usa a união dos órgãos com uma das duas falhas. Associação não comprova causa.</p>${table(['Primeiro critério', 'Segundo critério', 'Suporte', 'Similaridade', 'Afetados'], report.pares.map(p => [esc(p.primeiro), esc(p.segundo), fmt(p.suporte), fmt(p.similaridade), details(p.afetados)]))}`)
      + section('Avaliação marcou Sim e validação marcou Não', table(['Órgão', 'Critério', 'Item', 'Divergência'], divergenceRows))
      + section('Cruzamento por tipo de órgão', groupTable(report.por_orgao))
      + section('Cruzamento por cidade', groupTable(report.por_cidade))
      + section('Cruzamento por status', groupTable(report.por_status))
      + section('Cruzamento por setor atual', groupTable(report.por_setor))
      + section('Como os indicadores são calculados', `<p>Cada órgão/cidade conta uma vez. Se houver duplicatas, vale a coleta mais recente; sem data, vale a última ocorrência. Critérios são cruzados pelo nome e dimensão, nunca pelo ID local da resposta. Mensagens repetidas da mesma evidência não aumentam os contadores.</p><p>“Maioria” significa mais de 50% dos órgãos com resultado conhecido naquele critério ou tipo de item. Itens sem status reconhecido ou não aplicáveis ficam fora dos denominadores. Uma falha explícita já caracteriza falha no critério; “Atendido” exige Sim em todos os itens aplicáveis observados, com ao menos um Sim. Arquivos antigos com apenas evidências fornecem cobertura parcial. Falhas são itens explicitamente Não; texto livre de manifestações não é convertido em diagnóstico.</p><p>Essenciais seguem o grau de importância coletado. Notas são as porcentagens informadas pelo sistema, sem recalcular pesos oficiais. Status diferentes podem representar etapas distintas; use os filtros para comparar a mesma etapa. Os dados descrevem a coleta e não demonstram evolução histórica.</p>`);
  }

  function csv(report) {
    const rows = [['orgao', 'cidade', 'status', 'setor', 'nota', 'coletado_em', 'cobertura', 'dimensao', 'criterio', 'importancia', 'item', 'avaliacao', 'validacao', 'divergencia', 'erro_coleta']];
    report.orgaos.forEach(e => {
      const base = [e.orgao, e.cidade, e.status, e.setor, e.nota ?? '', e.coletado_em || '', e.cobertura];
      if (!e.criterios.length) rows.push([...base, '', '', '', '', '', '', '', [e.erro, e.erro_detalhes].filter(Boolean).join(' · ')]);
      e.criterios.forEach(c => (c.itens.length ? c.itens : [{}]).forEach(i => rows.push([...base, c.dimensao, c.criterio, c.importancia, i.item || '',
        i.avaliacao === true ? 'Sim' : i.avaliacao === false ? 'Não' : 'Sem resultado',
        i.validacao === true ? 'Sim' : i.validacao === false ? 'Não' : 'Sem resultado', i.divergencia ? 'Sim' : '', [e.erro, e.erro_detalhes].filter(Boolean).join(' · ')])));
    });
    return '\uFEFF' + rows.map(row => row.map(value => {
      const safe = /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(';')).join('\r\n');
  }

  function mount(container, getRows) {
    container.innerHTML = `<div class="analysis-head"><div><h2>Análise de todos os dados</h2><p>Recorrência de falhas, órgãos afetados e prioridades de correção no arquivo carregado.</p></div><div class="analysis-actions"><button type="button" data-action="json">Baixar análise JSON</button><button type="button" data-action="csv">Exportar dados CSV</button></div></div>
      <div class="analysis-filters"><label>Tipo de órgão<select data-filter="orgao"><option value="">Todos</option></select></label><label>Status<select data-filter="status"><option value="">Todos</option></select></label><label>Buscar órgão ou cidade<input type="search" data-filter="query" placeholder="Nome do órgão ou cidade"></label><button type="button" data-action="clear">Limpar filtros</button></div><div data-output aria-live="polite"></div>`;
    let report;
    let lastSignature;
    const controls = [...container.querySelectorAll('[data-filter]')];
    function refresh(reset = false) {
      const rows = latestRows(getRows()).map(entry => entry.row);
      const signature = JSON.stringify(rows.map(r => [r.orgao ?? r['orgão'] ?? r['órgão'], r.status]));
      if (reset || signature !== lastSignature) {
        controls.filter(c => c.tagName === 'SELECT').forEach(control => {
          const values = [...new Set(rows.map(r => control.dataset.filter === 'orgao' ? text(r.orgao ?? r['orgão'] ?? r['órgão']) : text(r.status)))].filter(Boolean).sort();
          control.innerHTML = '<option value="">Todos</option>' + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        });
        controls.find(c => c.dataset.filter === 'query').value = '';
        lastSignature = signature;
      }
      const filters = Object.fromEntries(controls.map(c => [c.dataset.filter, c.value]));
      const selected = rows.filter(r => (!filters.orgao || text(r.orgao ?? r['orgão'] ?? r['órgão']) === filters.orgao)
        && (!filters.status || text(r.status) === filters.status)
        && (!filters.query || norm(`${r.orgao ?? r['orgão'] ?? r['órgão'] ?? ''} ${r.cidade || ''}`).includes(norm(filters.query))));
      report = build(selected);
      // Keep duplicate accounting for the full scope while filtering after entity deduplication.
      if (!filters.orgao && !filters.status && !filters.query) report.resumo.duplicados_descartados = array(getRows()).length - rows.length;
      report.filtros = filters;
      container.querySelector('[data-output]').innerHTML = rows.length ? reportHtml(report) : '<p class="analysis-alert">Carregue um resultado JSON ou execute “Coletar e analisar todos”.</p>';
      container.querySelectorAll('.analysis-actions button').forEach(button => { button.disabled = !selected.length; });
    }
    controls.forEach(c => c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input', () => refresh()));
    container.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'clear') { controls.forEach(c => { c.value = ''; }); refresh(); }
      if (action !== 'csv' && action !== 'json') return;
      const content = action === 'csv' ? csv(report) : JSON.stringify(report, null, 2);
      const blob = new Blob([content], { type: action === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `analise_atricon_${new Date().toISOString().slice(0, 10)}.${action}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    refresh();
    return { refresh };
  }

  const api = { build, status, score, csv, reportHtml, mount };
  root.AtriconAnalysis = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
