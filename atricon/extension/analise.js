/* Local, deterministic analysis. No credentials or remote services are used. */
(function (root) {
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const array = value => Array.isArray(value) ? value : [];
  const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const percent = (part, total) => total ? 100 * part / total : null;
  const fmt = value => value === null ? 'Sem dados' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  const itemName = value => ({ 'filtro de pesquisa': 'filtros de pesquisa' })[norm(value)] || norm(value);

  /** Ignora apenas variações tipográficas do mesmo enunciado, preservando suas palavras e números. */
  const chaveEnunciado = valor => norm(valor).replace(/[\s\p{P}\p{Cf}]+/gu, '');

  /** Classifica o órgão sem depender de variações na grafia do nome. */
  const grupoOrgao = nome => /prefeitura/.test(norm(nome)) ? 'prefeituras' : /camara/.test(norm(nome)) ? 'camaras' : 'outros';

  /** Preserva as quebras de linha dos comentários e escapa marcação externa. */
  const escaparComentario = valor => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** Associa comentários ao enunciado e dimensão, nunca ao ID de resposta local. */
  const extrairEvidencias = (indiceEvidencias, criterio) => {
    const enunciado = chaveEnunciado(criterio.criterio);
    const chaves = [...new Set([`${norm(criterio.titulo)}|${enunciado}`,`|${enunciado}`])];
    const candidatos = [criterio, ...chaves.flatMap(chave => indiceEvidencias.get(chave) || [])];
    const mensagens = candidatos.flatMap(e => array(e.mensagens_evidencia).length ? e.mensagens_evidencia : e.conteudo_texto ? [{ tipo:e.tipo, etapa:e.etapa, data_evidencia:e.data_evidencia, conteudo_texto:e.conteudo_texto, paginas_pdf:e.paginas_pdf }] : []);
    const unicas = new Map();
    mensagens.forEach(m => {
      const tipo = text(m.tipo);
      const etapa = text(m.etapa) || (/revisor/.test(norm(tipo)) ? 'revisao' : /validador/.test(norm(tipo)) ? 'validacao' : /avaliador/.test(norm(tipo)) ? 'avaliacao' : 'nao_informada');
      const mensagem = { tipo, etapa, data:text(m.data_evidencia), texto:String(m.conteudo_texto || '').trim(), paginas:array(m.paginas_pdf).filter(p => Number.isInteger(p) && p > 0), imagem_no_pdf:Boolean(m.imagem_no_pdf), url_evidencia:/^https?:\/\//i.test(m.url_evidencia || '') ? text(m.url_evidencia) : '', transcricao_conferida:Boolean(m.transcricao_conferida) };
      const chave = JSON.stringify([mensagem.etapa,mensagem.tipo,mensagem.data,mensagem.texto,mensagem.paginas]);
      if (mensagem.texto || mensagem.imagem_no_pdf) unicas.set(chave,mensagem);
    });
    return [...unicas.values()];
  };

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

  function build(input, now = new Date(), filtros = {}) {
    const unique = latestRows(input);
    const criteria = new Map();
    const entities = unique.map(({ row, key, orgao, cidade, date }) => {
      const source = array(row.criterios_validacao).length ? row.criterios_validacao : array(row.evidencias_validacao);
      // Indexa cada enunciado uma vez por órgão, evitando reler todo o PDF a cada critério.
      const indiceEvidencias = new Map();
      array(row.evidencias_validacao).forEach(evidencia => {
        const chave = `${norm(evidencia.titulo)}|${chaveEnunciado(evidencia.criterio)}`;
        if (!indiceEvidencias.has(chave)) indiceEvidencias.set(chave,[]);
        indiceEvidencias.get(chave).push(evidencia);
      });
      const entity = {
        key, orgao, cidade, label: [orgao, cidade].filter(Boolean).join(' · ') || 'Órgão não identificado',
        status: text(row.status) || 'Não informado', setor: text(row.setor_atual) || 'Não informado',
        nota: score(row.porcentagem ?? row.porcetagem), coletado_em: date ? new Date(date).toISOString() : null,
        erro: text(row.erro), erro_detalhes: text(row.erro_evidencias),
        cobertura: row.coleta_detalhada || (source.length ? 'legado_parcial' : 'nao_solicitada'),
        fonte: text(row.fonte_coleta), etapa: text(row.etapa_resultado) || 'validacao', grupo:grupoOrgao(orgao),
        pdf_arquivo:text(row.pdf_arquivo), pdf_url:text(row.pdf_url), fonte_extracao:text(row.fonte_extracao), limitacoes_pdf:array(row.limitacoes_pdf).map(text),
        criterios: [], falhas: 0, essenciais: 0, divergencias: 0, avaliados: 0, desconhecidos: 0
      };
      const local = new Map();
      source.forEach(entry => {
        const label = text(entry.criterio);
        if (!label) return; // A local response ID cannot identify a criterion across entities.
        const chapter = text(entry.titulo) || 'Sem dimensão';
        if (filtros.dimensao && chapter !== filtros.dimensao) return;
        const id = `${norm(chapter)}|${chaveEnunciado(label)}`;
        if (!local.has(id)) local.set(id, { key: id, criterio: label, dimensao: chapter, importancia: text(entry.grau_importancia), itens: new Map(), auto: new Map(), evidencias:[], paginas:[], etapa:text(entry.etapa_resultado) || entity.etapa });
        const criterion = local.get(id);
        criterion.paginas = [...new Set([...criterion.paginas, ...array(entry.paginas_pdf).filter(p => Number.isInteger(p) && p > 0)])];
        criterion.evidencias = [...new Map([...criterion.evidencias,...extrairEvidencias(indiceEvidencias,entry)].map(e => [JSON.stringify(e),e])).values()];
        const merge = (map, name, value, notApplicable = false) => {
          const key = itemName(name);
          if (!key) return;
          if (!map.has(key)) map.set(key, { item: text(name), valores: new Set(), nao_aplicavel: true });
          map.get(key).valores.add(value);
          map.get(key).nao_aplicavel = map.get(key).nao_aplicavel && notApplicable;
        };
        const resultItems = Array.isArray(entry.validacoes_resultado) ? entry.validacoes_resultado : array(entry.validacoes_validacao);
        resultItems.forEach(item => merge(criterion.itens, item.item, status(item.status), /aplic/.test(norm(item.status))));
        array(entry.validacoes_avaliacao).forEach(item => merge(criterion.auto, item.item, status(item.status)));
        // Legacy evidence JSON can contain only the failed items; never invent passing items.
        const failures = array(entry.validacoes_nao_atendidas).length ? entry.validacoes_nao_atendidas : text(entry.validacoes_nao_atendidas_texto).split(',').filter(Boolean);
        failures.forEach(name => {
          if (!criterion.itens.has(itemName(name))) merge(criterion.itens, name, false);
        });
      });
      for (const criterion of local.values()) {
        const comRevisor = criterion.evidencias.some(m => m.etapa === 'revisao' && /comentario/.test(norm(m.tipo)));
        if (filtros.revisor === 'com' && !comRevisor || filtros.revisor === 'sem' && comRevisor) continue;
        if (filtros.criterio && !norm(`${criterion.criterio} ${criterion.dimensao} ${criterion.evidencias.map(m => m.texto).join(' ')}`).includes(norm(filtros.criterio))) continue;
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
          avaliados: 0, afetados: [], falhas: 0, essenciais: 0, divergencias: 0, registros:[], importancia_informada:true
        });
        const global = criteria.get(criterion.key);
        global.importancia_informada = global.importancia_informada && Boolean(criterion.importancia);
        global.registros.push({orgao:entity.label,grupo:entity.grupo,resultado:result.resultado,etapa:criterion.etapa,itens:items.filter(i => i.validacao === false).map(i => i.item),evidencias:criterion.evidencias,paginas:criterion.paginas,pdf_arquivo:entity.pdf_arquivo,pdf_url:entity.pdf_url,fonte:entity.fonte});
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
    const criteriosNaoAtendidos = entities.reduce((s,e) => s+e.criterios.filter(c => c.resultado === false).length,0);
    const criteriosAvaliados = entities.reduce((s,e) => s+e.criterios.filter(c => c.resultado !== null).length,0);
    const scores = entities.map(e => e.nota).filter(n => n !== null).sort((a, b) => a - b);
    const dates = entities.map(e => e.coletado_em).filter(Boolean).sort();
    const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return {
      gerado_em: now.toISOString(), periodo_coleta: { inicio: dates[0] || null, fim: dates.at(-1) || null, sem_data: entities.length - dates.length },
      resumo: { total: entities.length, duplicados_descartados: array(input).length - unique.length,
        com_detalhes: covered.length, sem_detalhes: entities.length - covered.length,
        completas: entities.filter(e => e.cobertura === 'concluida').length,
        com_falhas: covered.filter(e => e.falhas > 0).length, falhas: entities.reduce((n, e) => n + e.falhas, 0),
        criterios_nao_atendidos:criteriosNaoAtendidos, criterios_avaliados:criteriosAvaliados,
        essenciais: entities.reduce((n, e) => n + e.essenciais, 0), divergencias: entities.reduce((n, e) => n + e.divergencias, 0),
        erros_coleta: entities.filter(e => e.erro || e.erro_detalhes).length,
        pdfs: entities.filter(e => e.fonte === 'pdf').length,
        sem_importancia: entities.reduce((n, e) => n + e.criterios.filter(c => !c.importancia).length, 0),
        nota_media: average, notas_disponiveis: scores.length,
        nota_mediana: scores.length ? (scores[Math.floor((scores.length - 1) / 2)] + scores[Math.floor(scores.length / 2)]) / 2 : null },
      criterios: rankedCriteria, tipos: typeRows, dimensoes: finish(dimensions.values()), pares: pairs,
      por_orgao: groupBy('orgao'), por_cidade: groupBy('cidade'), por_status: groupBy('status'), por_setor: groupBy('setor'),
      orgaos: entities.sort((a, b) => b.essenciais - a.essenciais || b.falhas - a.falhas || (a.nota ?? 101) - (b.nota ?? 101) || a.label.localeCompare(b.label))
    };
  }

  const details = labels => labels.length ? `<details><summary>${labels.length} órgão(s) afetado(s)</summary><ul>${labels.map(label => `<li>${esc(label)}</li>`).join('')}</ul></details>` : 'Nenhuma falha observada';
  const table = (headers, rows) => `<div class="analysis-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${typeof h === 'object' ? `<a href="${esc(h.href)}" title="${esc(h.titulo)}" aria-label="Consultar critério ${esc(h.titulo)}">${esc(h.rotulo)}</a>` : esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Sem dados suficientes neste recorte.</td></tr>`}</tbody></table></div>`;
  const section = (title, body) => `<section class="analysis-card"><h3>${esc(title)}</h3>${body}</section>`;
  const ratio = row => `${row.afetados.length}/${row.avaliados} · ${fmt(row.taxa)}${row.maioria ? ' <strong class="analysis-bad">Maioria</strong>' : ''}`;
  const bar = row => `<div class="analysis-bar"><span style="width:${row.taxa || 0}%"></span></div>${ratio(row)}`;

  /** Gera a referência ao PDF e à página de origem no visualizador local. */
  const urlPdf = (registro, pagina) => {
    const arquivo = text(registro.pdf_arquivo).replace(/\\/g,'/');
    let destino = '';
    if (/^[a-z]:\//i.test(arquivo)) {
      const indice = arquivo.toLowerCase().lastIndexOf('/atricon/');
      const local = root.location;
      if (indice >= 0 && /^https?:$/.test(local?.protocol || '')) {
        const prefixo = local.pathname.includes('/atricon/') ? '/atricon/' : '/';
        destino = local.origin + prefixo + encodeURI(arquivo.slice(indice+9));
      } else destino = 'file:///'+encodeURI(arquivo);
    } else if (/^https?:\/\//i.test(arquivo)) destino = arquivo;
    else if (arquivo && !/^[a-z]+:|^\/\//i.test(arquivo)) destino = encodeURI(arquivo);
    if (!destino && /^https?:\/\//i.test(registro.pdf_url || '')) destino = registro.pdf_url;
    return destino ? destino.split('#')[0]+(pagina ? '#page='+pagina : '') : '';
  };

  /** Ordena comentários por data brasileira, preservando a ordem de origem quando não há data. */
  const dataComentario = mensagem => {
    const m = text(mensagem.data).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    return m ? Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4] || 0),Number(m[5] || 0)) : 0;
  };

  /** Mantém o último comentário do revisor em destaque e as demais etapas no histórico. */
  const evidenciasRegistro = registro => {
    const comentarios = array(registro.evidencias);
    const revisores = comentarios.filter(m => m.etapa === 'revisao' && /comentario/.test(norm(m.tipo))).sort((a,b) => dataComentario(a)-dataComentario(b));
    const ultimo = revisores.at(-1);
    const historico = comentarios.filter(m => m !== ultimo);
    const paginas = array(registro.paginas);
    const link = urlPdf(registro,paginas[0]);
    const mensagemHtml = m => {
      const pdf = urlPdf(registro,array(m.paginas)[0] || paginas[0]);
      const urls = [...new Set([m.url_evidencia,...((m.texto || '').match(/https?:\/\/[^\s<>"']+/g) || [])].filter(Boolean))];
      return `<blockquote class="analysis-comment"><div><strong>${esc(m.tipo || 'Comentário registrado')}</strong>${m.data ? `<time>${esc(m.data)}</time>` : ''}${array(m.paginas).length ? `<span>Página(s) ${m.paginas.join(', ')}</span>` : ''}</div><p>${m.texto ? escaparComentario(m.texto) : 'Evidência em imagem: consulte o PDF original.'}</p>${m.imagem_no_pdf ? '<small>Imagens da evidência permanecem no PDF original.</small>' : ''}${urls.length ? `<p class="analysis-links">${urls.map((url,i) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Evidência ${i+1}</a>`).join(' ')}</p>` : ''}${pdf ? `<a href="${esc(pdf)}" target="_blank" rel="noopener noreferrer">Abrir página no PDF</a>` : ''}</blockquote>`;
    };
    const resultado = registro.resultado === false ? 'Não atendido' : registro.resultado === true ? 'Atendido' : 'Sem resultado conhecido';
    return `<article class="analysis-evidence" data-evidence-entity="${esc(registro.orgao)}"><h4>${esc(registro.orgao)}</h4><p class="analysis-note"><strong>${resultado}</strong> na etapa ${esc({revisao:'Revisão',validacao:'Validação',avaliacao:'Avaliação'}[registro.etapa] || registro.etapa)}.${registro.itens.length ? ` Subitens reprovados: ${esc(registro.itens.join(', '))}.` : ''}</p><h5>Comentário do Revisor</h5>${ultimo ? mensagemHtml(ultimo) : '<p class="analysis-missing">Comentário do Revisor não registrado nos dados extraídos. Não foi inventada uma justificativa a partir dos subitens.</p>'}${historico.length ? `<details class="analysis-history"><summary>Histórico de comentários e outras etapas (${historico.length})</summary>${historico.map(mensagemHtml).join('')}</details>` : ''}${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Consultar PDF original${paginas.length ? ' · página(s) '+paginas.join(', ') : ''}</a></p>` : '<small>PDF original não informado neste registro.</small>'}</article>`;
  };

  /** Lista as evidências por órgão e não por número de mensagens. */
  const evidenciasCriterio = criterio => {
    const reprovados = array(criterio.registros).filter(r => r.resultado === false);
    const demais = array(criterio.registros).filter(r => r.resultado !== false);
    return `<details class="analysis-evidence-list"><summary>Evidências e revisor · ${reprovados.length} órgão(s) com falha</summary>${reprovados.length ? reprovados.map(evidenciasRegistro).join('') : '<p>Nenhuma reprovação observada neste critério.</p>'}${demais.length ? `<details><summary>Consultar demais resultados (${demais.length})</summary>${demais.map(evidenciasRegistro).join('')}</details>` : ''}</details>`;
  };

  /** Resume os critérios extraídos de um grupo sem presumir sucesso quando faltam dados. */
  const resumoGrupo = (report, grupo) => {
    const orgaos = report.orgaos.filter(e => e.grupo === grupo);
    const criterios = orgaos.flatMap(e => e.criterios);
    return { orgaos:orgaos.length, com_pdf:orgaos.filter(e => e.fonte === 'pdf').length,
      falhas:criterios.filter(c => c.resultado === false).length, atendidos:criterios.filter(c => c.resultado === true).length,
      desconhecidos:criterios.filter(c => c.resultado === null).length, subitens:orgaos.reduce((n,e) => n+e.falhas,0) };
  };

  /** Desenha pizza com fatias matemáticas e legenda textual acessível. */
  const pizza = (titulo, segmentos, descricao) => {
    const total = segmentos.reduce((n,s) => n+s.valor,0);
    if (!total) return `<section class="analysis-chart"><h3>${esc(titulo)}</h3><p class="analysis-missing">Nenhum critério extraído neste recorte.</p><p class="analysis-note">${esc(descricao)}</p></section>`;
    let angulo = -Math.PI/2;
    const formas = segmentos.filter(s => s.valor > 0).map(s => {
      const tamanho = s.valor/total*2*Math.PI;
      const proximo = angulo+tamanho;
      const x1 = 110+90*Math.cos(angulo), y1 = 110+90*Math.sin(angulo);
      const x2 = 110+90*Math.cos(proximo), y2 = 110+90*Math.sin(proximo);
      const forma = s.valor === total ? `<circle cx="110" cy="110" r="90" fill="${s.cor}"/>` : `<path d="M110 110 L${x1} ${y1} A90 90 0 ${tamanho > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z" fill="${s.cor}"/>`;
      angulo = proximo;
      return `<g><title>${esc(s.nome)}: ${s.valor} (${fmt(percent(s.valor,total))})</title>${forma}</g>`;
    }).join('');
    return `<section class="analysis-chart"><h3>${esc(titulo)}</h3><div class="analysis-pie-body"><svg class="analysis-pie" viewBox="0 0 220 220" role="img" aria-label="${esc(titulo)}: ${segmentos.map(s => esc(s.nome)+': '+s.valor).join('; ')}"><title>${esc(titulo)}</title>${formas}</svg><ul class="analysis-legend">${segmentos.map(s => `<li><span class="analysis-swatch" style="background:${s.cor}" aria-hidden="true"></span><span>${esc(s.nome)}</span><strong>${s.valor}</strong><small>${fmt(percent(s.valor,total))}</small></li>`).join('')}</ul></div><p class="analysis-note">${esc(descricao)}</p></section>`;
  };

  /** Desenha barras com contagem explícita e escala proporcional ao maior valor. */
  const graficoBarras = (titulo, linhas, unidade) => {
    const maximo = Math.max(0,...linhas.map(l => l.valor));
    return `<section class="analysis-chart"><h3>${esc(titulo)}</h3>${maximo ? `<ol class="analysis-bars">${linhas.map(l => `<li><span>${esc(l.nome)}</span><div><i style="width:${100*l.valor/maximo}%"></i></div><strong>${l.valor}</strong></li>`).join('')}</ol>` : '<p class="analysis-missing">Nenhuma falha observada neste recorte.</p>'}<p class="analysis-note">${esc(unidade)}</p></section>`;
  };

  /** Recalcula os gráficos com a mesma base filtrada das tabelas e exportações. */
  const graficosRelatorio = report => {
    const grupos = [['prefeituras','Prefeituras'],['camaras','Câmaras'],['outros','Outros órgãos']];
    const pizzas = grupos.filter(([grupo]) => resumoGrupo(report,grupo).orgaos > 0).map(([grupo,nome]) => {
      const r = resumoGrupo(report,grupo);
      return pizza(nome,[{nome:'Não atendidos',valor:r.falhas,cor:'var(--analysis-failure)'},{nome:'Atendidos',valor:r.atendidos,cor:'var(--analysis-success)'},{nome:'Sem resultado',valor:r.desconhecidos,cor:'var(--analysis-unknown)'}],`${r.orgaos} órgão(s) no recorte; ${r.com_pdf} com fonte PDF. Fatias contam pares órgão/critério extraídos, não clientes distintos. Órgãos sem critérios não são considerados atendidos.`);
    });
    const dimensoes = report.dimensoes.map(d => ({nome:d.nome,valor:report.criterios.filter(c => c.dimensao === d.nome).reduce((n,c) => n+c.afetados.length,0)})).sort((a,b) => b.valor-a.valor).slice(0,8);
    return `<div class="analysis-chart-grid" data-analysis-charts>${pizzas.join('')}${graficoBarras('Dimensões com mais critérios reprovados',dimensoes,'Pares órgão/critério não atendidos. Até oito dimensões, ordenadas pelo volume.')}${graficoBarras('Subitens mais reprovados',report.tipos.filter(t => t.falhas).map(t => ({nome:t.item,valor:t.falhas})).sort((a,b) => b.valor-a.valor),'Subitens explicitamente Não. Um critério pode ter vários subitens reprovados.')}</div>`;
  };

  /** Mantém o denominador observável de cada grupo no critério. */
  const contagemGrupo = (criterio,grupo) => {
    const conhecidos = array(criterio.registros).filter(r => r.grupo === grupo && r.resultado !== null);
    const falhas = conhecidos.filter(r => r.resultado === false).length;
    return conhecidos.length ? `<strong>${falhas}</strong> de ${conhecidos.length}<small>${fmt(percent(falhas,conhecidos.length))}</small>` : '<span class="analysis-muted">Sem resultado</span>';
  };

  function reportHtml(report) {
    const r = report.resumo;
    const cards = [ ['Órgãos no recorte', r.total], ['Com validação observável', `${r.com_detalhes}/${r.total}`],
      ['Com falhas observadas', `${r.com_falhas}/${r.com_detalhes}`], ['Critérios não atendidos', r.criterios_nao_atendidos],
      ['Falhas em essenciais', r.sem_importancia ? 'Dados incompletos' : r.essenciais], ['Divergências avaliação × resultado', r.divergencias],
      ['Nota média informada', fmt(r.nota_media)], ['Erros de coleta', r.erros_coleta] ];
    const top = report.criterios.find(c => c.afetados.length);
    const dates = report.periodo_coleta;
    const formatDate = value => value ? new Date(value).toLocaleString('pt-BR') : 'Não informada';
    const overview = `<div class="analysis-metrics" data-analysis-totals data-failed-criteria="${r.criterios_nao_atendidos}" data-failed-items="${r.falhas}" data-known-criteria="${r.criterios_avaliados}">${cards.map(([name, value]) => `<div><span>${esc(name)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      <p class="analysis-note"><strong>${r.criterios_nao_atendidos} falha(s) em critérios</strong> entre ${r.criterios_avaliados} pares órgão/critério com resultado conhecido; <strong>${r.falhas} subitem(ns) não atendido(s)</strong>. As evidências destacam o último <strong>Comentário do Revisor</strong>; comentários anteriores ficam no histórico.</p>
      <p class="analysis-note">Coletas: ${esc(formatDate(dates.inicio))} a ${esc(formatDate(dates.fim))}. ${dates.sem_data} órgão(s) sem data de coleta. Esta análise descreve o arquivo carregado.</p>
      <p class="analysis-note">${r.completas} coleta(s) detalhada(s) concluída(s); ${r.sem_detalhes} órgão(s) sem validação observável. ${r.duplicados_descartados} duplicata(s) descartada(s). Nota média/mediana calculadas sobre ${r.notas_disponiveis} nota(s); mediana: ${fmt(r.nota_mediana)}.</p>
      ${r.com_detalhes < r.total ? '<p class="analysis-alert">Cobertura incompleta: registros sem detalhes, pendentes ou com erro não representam órgãos sem falhas. Use “Coletar e analisar todos” para ampliar a base.</p>' : ''}
      ${r.completas < r.com_detalhes ? '<p class="analysis-alert">Parte dos detalhes vem de coletas parciais ou arquivos antigos. As taxas representam somente os resultados observados; evidências isoladas podem conter apenas falhas e superestimar sua frequência. Recolha todos os critérios antes de generalizar.</p>' : ''}
      ${r.pdfs ? `<p class="analysis-note">${r.pdfs} órgão(s) coletado(s) pelo relatório PDF. A análise usa a Revisão quando essa coluna existe; caso contrário, a Validação ou Avaliação. As etapas originais ficam preservadas no JSON.</p>` : ''}
      ${r.sem_importancia ? `<p class="analysis-alert">O grau de importância não foi informado em ${r.sem_importancia} critério(s). As falhas nesses itens foram contadas, mas não é possível concluir quantas são essenciais. O PDF original preserva as imagens das evidências.</p>` : ''}
      <p>${top ? `Maior alcance observado: <strong>${esc(top.criterio)}</strong>, com falha em ${top.afetados.length} de ${top.avaliados} órgão(s) com resultado conhecido nesse critério (${fmt(top.taxa)}). ${top.maioria ? 'A maioria dessa base apresenta falha.' : 'Esse problema não atinge a maioria dessa base.'}` : 'Nenhuma falha estruturada observada. Isso não comprova conformidade dos registros sem detalhes.'}</p>`;
    const criteriaTable = table(['Critério / dimensão', 'Prefeituras com falha', 'Câmaras com falha', 'Total de falhas no critério', 'Subitens reprovados', 'Evidências e justificativas por órgão'], report.criterios.map((c,indice) => [
      `<span id="analysis-criterion-${indice}">${esc(c.criterio)}</span><small>${esc(c.dimensao)}</small>`,contagemGrupo(c,'prefeituras'),contagemGrupo(c,'camaras'),`${c.afetados.length}<small>${c.avaliados} órgão(s) com resultado conhecido</small>`,c.falhas,evidenciasCriterio(c)
    ]));
    const types = table(['Tipo de falha', 'Órgãos com falha / avaliados', 'Itens não atendidos / verificados', 'Afetados'], report.tipos.map(t => [esc(t.item), bar(t), `${t.falhas}/${t.verificacoes}`, details(t.afetados)]));
    const ranking = table(['Órgão / cidade', 'Nota', 'Itens não atendidos / verificados', 'Essenciais', 'Divergências', 'Detalhes das falhas', 'Cobertura / coleta'], report.orgaos.map(e => [
      esc(e.label), fmt(e.nota), `${e.falhas}/${e.avaliados}`, !e.criterios.length || e.criterios.some(c => !c.importancia) ? 'Não informado' : e.essenciais, e.divergencias,
      e.falhas ? `<details><summary>Ver critérios e itens</summary><ul>${e.criterios.filter(c => c.resultado === false).map(c => `<li><strong>${esc(c.criterio)}</strong><small>${esc(c.dimensao)} · ${esc(c.importancia || 'Importância não informada')}</small>${esc(c.itens.filter(i => i.validacao === false).map(i => i.item).join(', '))}</li>`).join('')}</ul></details>` : e.avaliados ? 'Nenhuma falha observada' : 'Sem resultados observáveis',
      `${esc(e.cobertura)}${e.fonte ? `<small>${esc(e.fonte)} · ${esc(e.etapa)}</small>` : ''}${e.desconhecidos ? `<small>${e.desconhecidos} item(ns) sem resultado aplicável conhecido</small>` : ''}${e.erro || e.erro_detalhes ? `<small class="analysis-bad">${esc([e.erro, e.erro_detalhes].filter(Boolean).join(' · '))}</small>` : ''}`
    ]));
    const groupTable = rows => table(['Grupo', 'Órgãos', 'Com detalhes', 'Com falha / com detalhes', 'Itens não atendidos', 'Nota média'], rows.map(g => [esc(g.nome), g.total, g.cobertura, `${g.com_falhas}/${g.cobertura} · ${fmt(g.taxa)}`, g.falhas, fmt(g.nota_media)]));
    const matrixCriteria = report.criterios.filter(c => c.afetados.length);
    const matrix = table(['Órgão', ...matrixCriteria.map(c => ({rotulo:c.criterio.match(/^\d+\.\d+/)?.[0] || c.criterio.slice(0,35),titulo:`${c.dimensao} · ${c.criterio}`,href:`#analysis-criterion-${report.criterios.indexOf(c)}`}))], report.orgaos.map(e => [esc(e.label), ...matrixCriteria.map(c => {
      const found = e.criterios.find(item => item.key === c.key);
      return found?.resultado === false ? '<span class="analysis-bad">Falha</span>' : found?.resultado === true ? 'Atendido' : '<span class="analysis-muted">Sem resultado</span>';
    })]));
    const divergenceRows = report.orgaos.flatMap(e => e.criterios.flatMap(c => c.itens.filter(i => i.divergencia).map(i => [esc(e.label), esc(c.criterio), esc(i.item), 'Sim → Não'])));
    const priorities = report.criterios.filter(c => c.afetados.length).slice().sort((a, b) => b.essenciais - a.essenciais || b.afetados.length - a.afetados.length || b.falhas - a.falhas);
    return overview + graficosRelatorio(report) + section('Prioridades de correção', `<p>Ordem: falhas essenciais quando informadas, alcance entre órgãos e quantidade de itens não atendidos. A prioridade é operacional; não estima pontos da nota oficial.</p>${table(['Prioridade', 'Critério', 'Essenciais afetados', 'Alcance', 'Ação sugerida'], priorities.map((c, i) => [i + 1, esc(c.criterio), c.importancia_informada ? c.essenciais : 'Não informado', ratio(c), 'Conferir os itens não atendidos e as evidências dos órgãos listados no ranking de critérios.']))}`)
      + section('O que mais estão errando', criteriaTable)
      + section('Tipos de falha', types)
      + section('Falhas por dimensão', table(['Dimensão', 'Órgãos com falha / avaliados', 'Itens não atendidos', 'Afetados'], report.dimensoes.map(d => [esc(d.nome), bar(d), d.falhas, details(d.afetados)])))
      + section('Quais órgãos precisam de atenção', ranking)
      + section('Matriz órgão × critério com falha', '<p>Os cabeçalhos mostram o código do critério. Selecione um código para consultar o enunciado completo e suas evidências na lista de critérios.</p>'+matrix)
      + section('Problemas que aparecem juntos', `<p>Coocorrências em pelo menos dois órgãos. Suporte usa os ${r.com_detalhes} órgãos com validação observável; similaridade usa a união dos órgãos com uma das duas falhas. Associação não comprova causa.</p>${table(['Primeiro critério', 'Segundo critério', 'Suporte', 'Similaridade', 'Afetados'], report.pares.map(p => [esc(p.primeiro), esc(p.segundo), fmt(p.suporte), fmt(p.similaridade), details(p.afetados)]))}`)
      + section('Avaliação marcou Sim e o resultado marcou Não', table(['Órgão', 'Critério', 'Item', 'Divergência'], divergenceRows))
      + section('Cruzamento por tipo de órgão', groupTable(report.por_orgao))
      + section('Cruzamento por cidade', groupTable(report.por_cidade))
      + section('Cruzamento por status', groupTable(report.por_status))
      + section('Cruzamento por setor atual', groupTable(report.por_setor))
      + (report.orgaos.some(e => e.fonte_extracao || e.limitacoes_pdf.length) ? section('Fontes e conferência dos PDFs', table(['Órgão', 'Extração e limitações'], report.orgaos.filter(e => e.fonte_extracao || e.limitacoes_pdf.length).map(e => [esc(e.label), `${esc(e.fonte_extracao)}${e.limitacoes_pdf.length ? `<ul>${e.limitacoes_pdf.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`]))) : '')
      + section('Como os indicadores são calculados', `<p>Cada órgão/cidade conta uma vez. Se houver duplicatas, vale a coleta mais recente; sem data, vale a última ocorrência. Critérios são cruzados pelo nome e dimensão, nunca pelo ID local da resposta. Mensagens repetidas da mesma evidência não aumentam os contadores.</p><p>“Maioria” significa mais de 50% dos órgãos com resultado conhecido naquele critério ou tipo de item. Itens sem status reconhecido ou não aplicáveis ficam fora dos denominadores. Uma falha explícita já caracteriza falha no critério; “Atendido” exige Sim em todos os itens aplicáveis observados, com ao menos um Sim. Arquivos antigos com apenas evidências fornecem cobertura parcial. Falhas são itens explicitamente Não; texto livre de manifestações não é convertido em diagnóstico.</p><p>Essenciais seguem o grau de importância coletado. Notas são as porcentagens informadas pelo sistema, sem recalcular pesos oficiais. Status diferentes podem representar etapas distintas; use os filtros para comparar a mesma etapa. Os dados descrevem a coleta e não demonstram evolução histórica.</p>`);
  }

  function csv(report) {
    const rows = [['orgao', 'cidade', 'status', 'setor', 'nota', 'coletado_em', 'cobertura', 'fonte', 'etapa_resultado', 'dimensao', 'criterio', 'importancia', 'item', 'avaliacao', 'resultado', 'divergencia', 'erro_coleta','comentario_do_revisor','data_comentario_revisor','paginas_pdf','pdf_arquivo']];
    report.orgaos.forEach(e => {
      const base = [e.orgao, e.cidade, e.status, e.setor, e.nota ?? '', e.coletado_em || '', e.cobertura, e.fonte, e.etapa];
      if (!e.criterios.length) rows.push([...base, '', '', '', '', '', '', '', [e.erro, e.erro_detalhes].filter(Boolean).join(' · ')]);
      e.criterios.forEach(c => (c.itens.length ? c.itens : [{}]).forEach(i => rows.push([...base, c.dimensao, c.criterio, c.importancia, i.item || '',
        i.avaliacao === true ? 'Sim' : i.avaliacao === false ? 'Não' : 'Sem resultado',
        i.validacao === true ? 'Sim' : i.validacao === false ? 'Não' : 'Sem resultado', i.divergencia ? 'Sim' : '', [e.erro, e.erro_detalhes].filter(Boolean).join(' · '),
        c.evidencias.filter(m => m.etapa === 'revisao' && /comentario/.test(norm(m.tipo))).sort((a,b) => dataComentario(a)-dataComentario(b)).at(-1)?.texto || '',
        c.evidencias.filter(m => m.etapa === 'revisao' && /comentario/.test(norm(m.tipo))).sort((a,b) => dataComentario(a)-dataComentario(b)).at(-1)?.data || '',c.paginas.join(', '),e.pdf_arquivo])));
    });
    return '\uFEFF' + rows.map(row => row.map(value => {
      const safe = /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(';')).join('\r\n');
  }

  /** Monta o painel integrado e mantém gráficos, tabela e exportação no mesmo recorte. */
  function mount(container, getRows) {
    container.innerHTML = `<div class="analysis-head"><div><h2>Análise dos órgãos e comentários do revisor</h2><p>Compare critérios, identifique as falhas e consulte a justificativa registrada no PDF de cada órgão.</p></div><div class="analysis-actions"><button type="button" data-action="json">Baixar análise JSON</button><button type="button" data-action="csv">Exportar dados CSV</button></div></div>
      <nav class="analysis-groups" aria-label="Comparar tipos de órgão"><button type="button" data-analysis-group="" aria-pressed="true">Todos os órgãos</button><button type="button" data-analysis-group="prefeituras" aria-pressed="false">Prefeituras</button><button type="button" data-analysis-group="camaras" aria-pressed="false">Câmaras</button></nav>
      <div class="analysis-filters"><label>Tipo de órgão<select data-filter="orgao"><option value="">Todos</option></select></label><label>Status<select data-filter="status"><option value="">Todos</option></select></label><label>Buscar órgão ou cidade<input type="search" data-filter="query" placeholder="Nome do órgão ou cidade"></label><label>Dimensão<select data-filter="dimensao"><option value="">Todas</option></select></label><label>Buscar critério ou comentário<input type="search" data-filter="criterio" placeholder="Ex.: RREO, 2022, série histórica"></label><label>Comentário do Revisor<select data-filter="revisor"><option value="">Todos</option><option value="com">Com comentário</option><option value="sem">Sem comentário</option></select></label><button type="button" data-action="clear">Limpar filtros</button></div><p class="analysis-note">Todos os gráficos e totais abaixo acompanham os filtros. “Falhas em critérios” e “subitens reprovados” são contagens diferentes. Falta de PDF ou comentário é indicada, sem presumir atendimento.</p><div data-output aria-live="polite"></div>`;
    let report;
    let lastSignature;
    let grupoAtivo = '';
    const controls = [...container.querySelectorAll('[data-filter]')];
    /** Recalcula a análise sobre os registros únicos e critérios selecionados. */
    function refresh(reset = false) {
      const rows = latestRows(getRows()).map(entry => entry.row);
      const signature = JSON.stringify(rows.map(r => [r.orgao ?? r['orgão'] ?? r['órgão'],r.cidade,r.status,r.coletado_em,array(r.criterios_validacao).map(c => c.titulo)]));
      if (reset || signature !== lastSignature) {
        for (const campo of ['orgao','status','dimensao']) {
          const control = controls.find(c => c.dataset.filter === campo);
          const anterior = reset ? '' : control.value;
          const values = [...new Set(rows.flatMap(r => campo === 'orgao' ? [text(r.orgao ?? r['orgão'] ?? r['órgão'])] : campo === 'status' ? [text(r.status)] : (array(r.criterios_validacao).length ? r.criterios_validacao : array(r.evidencias_validacao)).map(c => text(c.titulo))))].filter(Boolean).sort((a,b) => a.localeCompare(b,'pt-BR'));
          control.innerHTML = `<option value="">${campo === 'dimensao' ? 'Todas' : 'Todos'}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
          if (values.includes(anterior)) control.value = anterior;
        }
        if (reset) controls.forEach(c => { c.value = ''; });
        lastSignature = signature;
      }
      const filters = {...Object.fromEntries(controls.map(c => [c.dataset.filter,c.value])),grupo:grupoAtivo};
      const selected = rows.filter(r => (!filters.grupo || grupoOrgao(r.orgao ?? r['orgão'] ?? r['órgão']) === filters.grupo)
        && (!filters.orgao || text(r.orgao ?? r['orgão'] ?? r['órgão']) === filters.orgao)
        && (!filters.status || text(r.status) === filters.status)
        && (!filters.query || norm(`${r.orgao ?? r['orgão'] ?? r['órgão'] ?? ''} ${r.cidade || ''}`).includes(norm(filters.query))));
      report = build(selected,new Date(),filters);
      if (Object.values(filters).every(v => !v)) report.resumo.duplicados_descartados = array(getRows()).length-rows.length;
      report.filtros = filters;
      container.querySelector('[data-output]').innerHTML = !rows.length ? '<p class="analysis-alert">Carregue um resultado JSON ou execute “Coletar e analisar todos”.</p>' : !selected.length ? '<p class="analysis-alert">Nenhum órgão corresponde aos filtros. Use “Limpar filtros” para ampliar a consulta.</p>' : reportHtml(report);
      container.querySelectorAll('.analysis-actions button').forEach(button => { button.disabled = !selected.length; });
      container.querySelectorAll('[data-analysis-group]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.analysisGroup === grupoAtivo)));
    }
    controls.forEach(c => c.addEventListener(c.tagName === 'SELECT' ? 'change' : 'input',() => refresh()));
    container.addEventListener('click',event => {
      const grupo = event.target.closest('[data-analysis-group]');
      if (grupo) { grupoAtivo = grupo.dataset.analysisGroup; controls.find(c => c.dataset.filter === 'orgao').value = ''; refresh(); return; }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'clear') { grupoAtivo = ''; controls.forEach(c => { c.value = ''; }); refresh(); }
      if (action !== 'csv' && action !== 'json') return;
      const content = action === 'csv' ? csv(report) : JSON.stringify(report,null,2);
      const blob = new Blob([content],{type:action === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `analise_atricon_${new Date().toISOString().slice(0,10)}.${action}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    refresh();
    return {refresh};
  }

  const api = { build, status, score, csv, reportHtml, mount };
  root.AtriconAnalysis = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
