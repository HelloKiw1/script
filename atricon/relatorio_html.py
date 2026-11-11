"""Gera uma análise HTML independente, com dados locais e sem credenciais."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def preparar_dados_publicos(registros: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Seleciona somente campos necessários à análise e remove identificadores de login dos erros."""
    campos = ['orgao', 'orgão', 'órgão', 'cidade', 'status', 'setor_atual', 'porcentagem', 'porcetagem',
              'coletado_em', 'coleta_detalhada', 'fonte_coleta', 'fonte_extracao', 'etapa_resultado',
              'pdf_arquivo', 'pdf_url', 'pdf_paginas', 'ano_pdf', 'questionario_id', 'entidade_pdf',
              'classificacao_pdf', 'essenciais_pdf', 'modo_coleta', 'erro', 'erro_evidencias',
              'avisos_pdf', 'limitacoes_pdf', 'cobertura_pdf']
    campos_criterio = ['titulo', 'criterio', 'criterio_id', 'grau_importancia', 'fonte', 'paginas_pdf',
                       'etapa_resultado', 'validacoes_nao_atendidas', 'validacoes_nao_atendidas_texto',
                       'tipo', 'pdf_arquivo', 'pdf_url', 'conteudo_texto', 'data_evidencia', 'etapa']
    campos_mensagem = ['tipo', 'etapa', 'data_evidencia', 'conteudo_texto', 'paginas_pdf',
                       'imagem_no_pdf', 'url_evidencia', 'transcricao_conferida']
    resultado = []
    for registro in registros:
        publico = {campo: registro[campo] for campo in campos if campo in registro}
        for campo_erro in ['erro', 'erro_evidencias']:
            if campo_erro in publico:
                for privado in ['user', 'usuario', 'senha', 'password', 'token']:
                    valor = str(registro.get(privado) or '')
                    if valor:
                        publico[campo_erro] = str(publico[campo_erro]).replace(valor, '[dado de acesso removido]')
        for lista in ['criterios_validacao', 'evidencias_validacao']:
            publico[lista] = []
            for criterio in registro.get(lista) or []:
                if not isinstance(criterio, dict):
                    continue
                item = {campo: criterio[campo] for campo in campos_criterio if campo in criterio}
                for etapa in ['avaliacao', 'validacao', 'revisao', 'resultado']:
                    chave = 'validacoes_' + etapa
                    if chave in criterio:
                        item[chave] = [{k: v for k, v in subitem.items() if k in ['item', 'status']} for subitem in criterio[chave] if isinstance(subitem, dict)]
                item['mensagens_evidencia'] = [{k: v for k, v in mensagem.items() if k in campos_mensagem} for mensagem in criterio.get('mensagens_evidencia') or [] if isinstance(mensagem, dict)]
                publico[lista].append(item)
        resultado.append(publico)
    return resultado


def gerar_relatorio_html(caminho_json: Path, registros: list[dict[str, Any]], destino: Path | None = None) -> Path:
    """Salva um HTML com gráficos, filtros e justificativas do revisor a partir da mesma coleta."""
    raiz = Path(__file__).resolve().parent
    destino = destino or caminho_json.with_suffix('.html')
    dados = json.dumps(preparar_dados_publicos(registros), ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    javascript = (raiz/'extension/analise.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
    css = (raiz/'extension/analise.css').read_text(encoding='utf-8')
    documento = '''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'">
<title>Análise Atricon 2026 - comentários do revisor</title><style>
:root {color-scheme:light;--bg:#f3f6f9;--panel:#fff;--panel-soft:#f7f9fb;--line:#d8e0ea;--line-strong:#aeb9c7;--text:#162231;--muted:#536477;--accent:#0c7c8c;--accent-dark:#075e6b;--accent-soft:#e9f7f9;--input-bg:#fff;--error:#b42318;--ok:#067647;--warn:#9a6700}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:var(--bg);color:var(--text)}main{max-width:1440px;padding:28px 32px 50px;margin:auto}header.report-header{padding:16px 32px;background:var(--panel);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:16px}header.report-header span{color:var(--muted)}button,input,select{font:inherit}button{cursor:pointer;min-height:44px;padding:9px 13px;border:1px solid var(--line-strong);border-radius:6px;background:var(--panel);color:var(--text)}button:hover{background:var(--accent-soft)}button:disabled{cursor:default;opacity:.6}a{color:var(--accent-dark)}h2{font-size:24px}h3{font-size:17px}input,select{caret-color:var(--accent)}summary{cursor:pointer}table{font-variant-numeric:tabular-nums}.analysis-scroll table{background:var(--panel)}.analysis-head>div{max-width:80ch}.analysis-head p{margin-bottom:0}.analysis-alert{border-left:0;border:1px solid var(--line);border-radius:6px}.analysis-chart{break-inside:avoid}@media(max-width:700px){main{padding:22px 15px}header.report-header{padding:14px 16px;flex-wrap:wrap}h2{font-size:21px}.analysis-filters{display:grid;grid-template-columns:1fr}.analysis-actions{width:100%}}@media print{body{background:white}main{padding:0}.analysis-actions,.analysis-filters,.analysis-groups{display:none}.analysis-scroll{max-height:none;overflow:visible}.analysis-chart-grid{grid-template-columns:1fr 1fr}}
__CSS__
</style></head><body data-theme="light"><header class="report-header"><strong>BARCO</strong><span>Atricon 2026 · análise dos dados carregados</span></header><main><div id="analysisContent"></div></main>
<script id="analysis-data" type="application/json">__DADOS__</script><script>__JAVASCRIPT__</script>
<script>'use strict'; const registros = JSON.parse(document.getElementById('analysis-data').textContent); AtriconAnalysis.mount(document.getElementById('analysisContent'), () => registros);</script></body></html>'''
    documento = documento.replace('__CSS__', css).replace('__DADOS__', dados).replace('__JAVASCRIPT__', javascript)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(documento, encoding='utf-8')
    return destino
