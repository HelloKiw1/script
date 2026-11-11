"""Leitura local do relatorio PDF do Avalia, sem depender do prazo do formulario.

Preserva Avaliacao, Validacao e Revisao separadamente. O resultado para a analise
usa a ultima etapa presente no relatorio, sem preencher lacunas com etapas antigas.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


def normalize(value: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if not unicodedata.combining(c))


def clean(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


STAGES = {'avaliacao': 'avaliacao', 'validacao': 'validacao', 'revisao': 'revisao'}
ITEM_PATTERN = re.compile(
    r'^\s*(Disponibilidade|Atualidade|S[eé]rie Hist[oó]rica|Grava[cç][aã]o de Relat[oó]rios|Filtros? de Pesquisa)\s{2,}(.*?)\s*$',
    re.IGNORECASE,
)
CANONICAL_ITEMS = {
    'disponibilidade': 'Disponibilidade', 'atualidade': 'Atualidade',
    'serie historica': 'Série Histórica', 'gravacao de relatorios': 'Gravação de Relatórios',
    'filtros de pesquisa': 'Filtros de Pesquisa', 'filtro de pesquisa': 'Filtros de Pesquisa',
}


def parse_report_text(pages: list[str]) -> dict[str, Any]:
    if not pages:
        raise ValueError('PDF sem paginas ou texto extraivel.')
    first = pages[0]
    metadata: dict[str, Any] = {}
    fields = {
        'questionario_id': r'Question[aá]rio\s*:\s*(\d+)',
        'ano_pdf': r'(?:^|\n)\s*(20\d{2})\s*(?:\n|$)',
        'status_pdf': r'Status\s*:\s*([^\r\n]+)',
        'entidade_pdf': r'Entidade Avaliada\s*:\s*([^\r\n]+)',
        'porcentagem': r'[ÍI]ndice de Transpar[eê]ncia\s*:\s*(\d{1,3}(?:[,.]\d+)?)\s*%',
        'classificacao_pdf': r'Classifica[cç][aã]o\s*:\s*([^\r\n]+)',
        'essenciais_pdf': r'(?:Crit[eé]rios\s+)?Essenciais\s*:\s*(\d{1,3}(?:[,.]\d+)?)\s*%',
    }
    for name, pattern in fields.items():
        match = re.search(pattern, first, re.IGNORECASE)
        if match:
            metadata[name] = clean(match.group(1)) + ('%' if name in ['porcentagem', 'essenciais_pdf'] else '')
    if not metadata.get('questionario_id') or not metadata.get('entidade_pdf'):
        raise ValueError('Nao foi possivel confirmar o questionario e a entidade no cabecalho do PDF.')

    summaries = []
    stages = []
    in_summary = False
    for line in '\n'.join(pages).splitlines():
        if in_summary and re.match(r'^\s*\d+\.\d+\.?\s+', line):
            break
        if 'Dimensão' in line and 'Itens' in line:
            stages = [STAGES[normalize(s)] for s in re.findall(r'Avalia[cç][aã]o|Valida[cç][aã]o|Revis[aã]o', line)]
            in_summary = True
            continue
        if not in_summary:
            continue
        columns = re.split(r'\s{2,}', line.strip())
        if len(columns) >= 3 and columns[1].isdigit() and all(re.match(r'^\d+\s*/\s*\d+\s*\(', c) for c in columns[2:]):
            summaries.append({'titulo': clean(columns[0]), 'itens': int(columns[1])})
    if not stages:
        # A PDF without the summary may still have verification table headers.
        for text in pages:
            header = next((line for line in text.splitlines() if 'Item de Verificação' in line), '')
            if header:
                stages = [STAGES[normalize(s)] for s in re.findall(r'Avalia[cç][aã]o|Valida[cç][aã]o|Revis[aã]o', header)]
                break
    if not stages:
        raise ValueError('As colunas de Avaliacao/Validacao/Revisao nao foram identificadas no PDF.')
    result_stage = next(s for s in ['revisao', 'validacao', 'avaliacao'] if s in stages)
    dimension_names = {normalize(s['titulo']): s['titulo'] for s in summaries}
    current_dimension = ''
    prefix_dimensions: dict[str, str] = {}
    criteria: list[dict[str, Any]] = []
    evidence_groups = []
    current = None
    pending_title = None
    title_lines: list[str] = []
    in_table = False
    table_stages: list[str] = []
    last_cells: list[tuple[float, dict[str, str]]] = []
    messages = []
    message = None
    warnings = []

    def finish_message():
        nonlocal message
        if message is not None:
            message['conteudo_texto'] = '\n'.join(message.pop('_lines')).strip()
            if message['etapa'] in ['validacao', 'revisao']:
                messages.append(message)
        message = None

    def finish_criterion():
        nonlocal current, messages
        finish_message()
        if current is None:
            return
        for stage in ['avaliacao', 'validacao', 'revisao']:
            current.setdefault(f'validacoes_{stage}', [])
        current['etapa_resultado'] = result_stage
        current['validacoes_resultado'] = list(current[f'validacoes_{result_stage}'])
        failures = [i['item'] for i in current['validacoes_resultado'] if normalize(i['status']) in ['nao', 'nao atende', 'nao atendido', 'nao atendida']]
        current['validacoes_nao_atendidas'] = failures
        current['validacoes_nao_atendidas_texto'] = ', '.join(failures)
        criteria.append(current)
        if messages:
            evidence_groups.append({
                **current,
                'tipo': 'Relatório PDF', 'titulo_evidencia': current['criterio'],
                'numero_evidencia': f"{metadata['questionario_id']}-{current['criterio_id']}",
                'ordem': len(evidence_groups) + 1,
                'data_evidencia': messages[-1].get('data_evidencia', ''),
                'conteudo_texto': '\n\n'.join(m['conteudo_texto'] for m in messages if m['conteudo_texto']),
                'imagens': [], 'mensagens_evidencia': messages,
                'total_mensagens_evidencia': len(messages),
            })
        current = None
        messages = []

    for page_number, text in enumerate(pages, 1):
        lines = text.splitlines()
        for line_index, raw in enumerate(lines):
            stripped = raw.strip()
            if not stripped:
                continue
            key = normalize(clean(stripped))
            if key in dimension_names:
                current_dimension = dimension_names[key]
            title_match = re.match(r'^(\d+\.\d+)\.?\s+(.+)', stripped)
            # Only a numbered heading immediately followed by a verification
            # table starts a criterion. Numbers inside comments are not headings.
            nearby = lines[line_index + 1:line_index + 12]
            if title_match and any('Item de Verificação' in following for following in nearby):
                finish_criterion()
                pending_title = title_match.group(1)
                title_lines = [f'{title_match.group(1)} {title_match.group(2)}']
                in_table = False
                continue
            if pending_title and 'Item de Verificação' not in raw:
                title_lines.append(stripped)
                continue
            if 'Item de Verificação' in raw:
                last_cells = []
                table_stages = [STAGES[normalize(s)] for s in re.findall(r'Avalia[cç][aã]o|Valida[cç][aã]o|Revis[aã]o', raw)]
                if pending_title:
                    prefix = pending_title.split('.')[0]
                    prefix_dimensions.setdefault(prefix, current_dimension or 'Sem dimensão')
                    current = {
                        'titulo': prefix_dimensions[prefix], 'criterio': clean(' '.join(title_lines)),
                        'criterio_id': pending_title, 'grau_importancia': '',
                        'fonte': 'pdf', 'paginas_pdf': [page_number],
                        'validacoes_avaliacao': [], 'validacoes_validacao': [], 'validacoes_revisao': [],
                    }
                    pending_title = None
                in_table = current is not None
                continue
            if 'Evidências do Critério' in stripped:
                in_table = False
                continue
            if in_table and current is not None:
                match = ITEM_PATTERN.match(raw)
                if match:
                    name = CANONICAL_ITEMS[normalize(match.group(1))]
                    values = re.split(r'\s{2,}', match.group(2).strip())
                    blocks = list(re.finditer(r'\S(?:.*?\S)?(?=\s{2,}|$)', match.group(2)))
                    if len(values) != len(table_stages):
                        warnings.append(f"{current['criterio_id']}: colunas incompletas em {name} (pagina {page_number}).")
                        # Leave unknown rather than shifting one stage into another.
                        values = [''] * len(table_stages)
                    last_cells = []
                    for column_index, (stage, value) in enumerate(zip(table_stages, values)):
                        target = current[f'validacoes_{stage}']
                        if not any(i['item'] == name for i in target):
                            target.append({'item': name, 'status': clean(value)})
                        if len(blocks) == len(table_stages):
                            block = blocks[column_index]
                            center = match.start(2) + (block.start() + block.end()) / 2
                            last_cells.append((center, next(i for i in target if i['item'] == name)))
                    if page_number not in current['paginas_pdf']:
                        current['paginas_pdf'].append(page_number)
                    continue
                if last_cells:
                    # Narrow PDF columns wrap "Não atende" / "Não se aplica".
                    # Join a continuation to the matching physical column; a
                    # truncated "Não se aplica" must never become a failure.
                    for block in re.finditer(r'\S(?:.*?\S)?(?=\s{2,}|$)', raw):
                        suffix = clean(block.group())
                        if normalize(suffix) not in {'atende', 'se', 'se aplica', 'aplica', 'aplicavel', 'avaliado', 'validado', 'atendido', 'atendida'}:
                            continue
                        center = (block.start() + block.end()) / 2
                        old_center, cell = min(last_cells, key=lambda entry: abs(entry[0] - center))
                        if abs(old_center - center) < 12 and normalize(cell['status']) in {'nao', 'nao se'}:
                            cell['status'] = clean(cell['status'] + ' ' + suffix)
            if current is not None and not in_table:
                evidence = re.match(r'^\s*(.+?\b(?:Avaliador|Validador|Revisor))\s{2,}(\d{1,2}/\d{1,2}/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$', raw)
                if evidence:
                    finish_message()
                    label = clean(evidence.group(1))
                    role = normalize(label)
                    message = {'ordem': len(messages) + 1, 'tipo': label,
                               'etapa': 'revisao' if 'revisor' in role else 'validacao' if 'validador' in role else 'avaliacao',
                               'data_evidencia': clean(evidence.group(2)), 'paginas_pdf': [page_number],
                               'imagem_no_pdf': 'foto' in role or 'imagem' in role,
                               'imagens': [], '_lines': []}
                elif message is not None and key not in dimension_names:
                    message['_lines'].append(stripped)
                    if page_number not in message['paginas_pdf']:
                        message['paginas_pdf'].append(page_number)
    finish_criterion()
    if not criteria:
        raise ValueError('Nenhum criterio foi identificado nas tabelas do PDF; nao considerar a coleta concluida.')
    expected_items = sum(d['itens'] for d in summaries)
    observed_items = sum(len(c['validacoes_resultado']) for c in criteria)
    known = {'atende', 'sim', 'nao', 'nao atende', 'nao atendido', 'nao atendida', 'nao se aplica', 'nao aplicavel'}
    unknown = sum(normalize(item['status']) not in known for c in criteria for item in c['validacoes_resultado'])
    if not expected_items or observed_items != expected_items:
        warnings.append(f'Cobertura de itens: {observed_items} extraidos; {expected_items or "nao informado"} no resumo do PDF.')
    if unknown:
        warnings.append(f'{unknown} item(ns) sem resultado reconhecido na etapa {result_stage}.')
    observed_dimensions = Counter(c['titulo'] for c in criteria)
    if any(c['titulo'] == 'Sem dimensão' for c in criteria):
        warnings.append('Ha criterios sem dimensao identificada no PDF.')
    return {
        **metadata, 'fonte_coleta': 'pdf', 'etapa_resultado': result_stage,
        'pdf_paginas': len(pages), 'resumo_dimensoes_pdf': summaries,
        'criterios_validacao': criteria, 'evidencias_validacao': evidence_groups,
        'total_evidencias_validacao': len(evidence_groups),
        'coleta_detalhada': 'parcial' if warnings else 'concluida',
        'avisos_pdf': warnings,
        'limitacoes_pdf': ['O PDF nao informa o grau de importancia de cada criterio; esse campo nao foi inferido.'],
        'cobertura_pdf': {'criterios': len(criteria), 'itens': observed_items, 'itens_esperados': expected_items,
                         'dimensoes': len(observed_dimensions), 'itens_desconhecidos': unknown,
                         'itens_nao_atendidos': sum(len(c['validacoes_nao_atendidas']) for c in criteria)},
    }


def extract_pdf_report(path: Path) -> dict[str, Any]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError('Dependencia de PDF ausente. Execute: python atricon/coletor_atricon.py install') from exc
    reader = PdfReader(str(path))
    pages = [page.extract_text(extraction_mode='layout') or '' for page in reader.pages]
    return parse_report_text(pages)
