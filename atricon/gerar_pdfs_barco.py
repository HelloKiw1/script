"""Gera relatórios Barco exclusivamente a partir dos PDFs originais da revisão.

As categorias são conferidas na cartilha PNTP local; nenhum JSON de coleta,
credencial ou consulta ao Avalia é necessário.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any
from collections import Counter
from html import escape

RAIZ = Path(__file__).resolve().parents[1]
DEPENDENCIAS = RAIZ / 'tmp/pdf-barco-runtime'
if DEPENDENCIAS.exists():
    sys.path.insert(0, str(DEPENDENCIAS))

import pymupdf
from pypdf import PdfReader
from pdf_atricon import parse_report_text
from PIL import Image as ImagemPIL
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, Flowable, Frame, Image, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle

ORIGEM = RAIZ / 'resultado/coleta_2026/pdfs/analise_2026'
TEMPORARIOS = RAIZ / 'tmp/pdfs/barco'
CARTILHA = RAIZ / 'atricon/doc/Cartilha-PNTP-2026.pdf'
AZUL = '#0b62c4'
AZUL_ESCURO = '#082f63'
TEXTO = '#172033'
CINZA = '#5c6f85'
CORES_DOS_RESPONSAVEIS = {
    'Avaliador': ('#6d28d9', '#f3edff'),
    'Validador': ('#087f5b', '#eaf8f1'),
    'Revisor': ('#be185d', '#fff0f6'),
}
PALETAS = {
    'Essenciais': ('#b42318', '#fef3f2', '#fecdca'),
    'Obrigatórios': ('#93370d', '#fffaeb', '#fedf89'),
    'Recomendados': ('#067647', '#ecfdf3', '#abefc6')
}


def normalizar(valor: str) -> str:
    """Normaliza somente acentos, pontuação e espaços para conferir enunciados."""
    sem_acentos = ''.join(c for c in unicodedata.normalize('NFKD', valor.casefold()) if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', sem_acentos)


def ler_classificacoes() -> dict[str, dict[str, Any]]:
    """Extrai enunciado, categoria e página diretamente da cartilha PNTP 2026."""
    with pymupdf.open(CARTILHA) as documento:
        paginas = [pagina.get_text() for pagina in documento]
    texto = '\n'.join(paginas)
    inicios = list(re.finditer(r'(?m)^\s*(\d{1,2}\.\d{1,2})\.?\s+([^\n]+)', texto))
    resultado = {}
    for indice, inicio in enumerate(inicios):
        fim = inicios[indice + 1].start() if indice + 1 < len(inicios) else len(texto)
        trecho = texto[inicio.start():fim]
        classificacao = re.search(r'Classifica[çc][ãa]o\s*:\s*(Essencial|Obrigat[óo]ri[ao]|Recomendad[ao])', trecho, re.I)
        if not classificacao:
            continue
        enunciado = re.split(r'➢\s*Fundamenta|Fundamenta[çc][ãa]o:', trecho, maxsplit=1)[0]
        enunciado = re.sub(r'\s+', ' ', enunciado).strip()
        pagina = 0
        # A contagem de caracteres mantém o número físico da página da cartilha.
        acumulado = 0
        for numero, conteudo in enumerate(paginas, 1):
            acumulado += len(conteudo) + 1
            if inicio.start() < acumulado:
                pagina = numero
                break
        categoria = classificacao.group(1)
        categoria = 'Essenciais' if normalizar(categoria) == 'essencial' else 'Obrigatórios' if normalizar(categoria).startswith('obrigat') else 'Recomendados'
        resultado[inicio.group(1)] = {'categoria': categoria, 'enunciado': enunciado, 'pagina_cartilha': pagina}
    if len(resultado) < 170:
        raise ValueError(f'Cartilha incompleta: {len(resultado)} classificações identificadas')
    return resultado


def extrair_documento(arquivo: Path) -> dict[str, Any]:
    """Lê o PDF e confere a cobertura usando o mesmo parser do coletor."""
    resumo = hashlib.sha256(arquivo.read_bytes()).hexdigest()
    cache = TEMPORARIOS / 'extraidos' / (arquivo.stem + '.json')
    if cache.exists():
        dados = json.loads(cache.read_text(encoding='utf-8'))
        if dados.get('sha256_origem') == resumo:
            return dados
    leitor = PdfReader(arquivo)
    paginas = [pagina.extract_text(extraction_mode='layout') or '' for pagina in leitor.pages]
    dados = parse_report_text(paginas)
    dados['sha256_origem'] = resumo
    dados['arquivo_origem'] = str(arquivo)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding='utf-8')
    return dados


def preparar_documento(arquivo: Path, classificacoes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Filtra apenas os subitens explicitamente reprovados na coluna Revisão."""
    dados = extrair_documento(arquivo)
    if dados['avisos_pdf']:
        raise ValueError(f'{arquivo.name}: {dados["avisos_pdf"]}')
    if dados['etapa_resultado'] != 'revisao':
        return {**dados, 'reprovados': [], 'divergencias_enunciado': [], 'sem_revisao': True}
    evidencias = {item['criterio_id']: item for item in dados['evidencias_validacao']}
    reprovados = []
    divergencias = []
    for criterio in dados['criterios_validacao']:
        falhas = [item['item'] for item in criterio['validacoes_revisao'] if normalizar(item['status']) in {'nao', 'naoatende', 'naoatendido', 'naoatendida'}]
        if not falhas:
            continue
        classificacao = classificacoes.get(criterio['criterio_id'])
        if not classificacao:
            raise ValueError(f'{arquivo.name}: categoria ausente para {criterio["criterio"]}')
        if normalizar(criterio['criterio']) != normalizar(classificacao['enunciado']):
            divergencias.append({'pdf': criterio['criterio'], 'cartilha': classificacao['enunciado']})
        reprovados.append({**criterio, **classificacao, 'falhas': falhas, 'mensagens_evidencia': evidencias.get(criterio['criterio_id'], {}).get('mensagens_evidencia', [])})
    dados['reprovados'] = reprovados
    dados['divergencias_enunciado'] = divergencias
    return dados


def criar_estilos() -> dict[str, ParagraphStyle]:
    """Prepara a tipografia legível e as cores da identidade visual Barco."""
    fontes = Path('C:/Windows/Fonts')
    for nome, arquivo in [('Barco', 'arial.ttf'), ('Barco-Bold', 'arialbd.ttf'), ('Barco-Italic', 'ariali.ttf')]:
        pdfmetrics.registerFont(TTFont(nome, str(fontes / arquivo)))
    pdfmetrics.registerFontFamily('Barco', normal='Barco', bold='Barco-Bold', italic='Barco-Italic', boldItalic='Barco-Bold')
    base = ParagraphStyle('base', fontName='Barco', fontSize=10, leading=14.5, textColor=colors.HexColor(TEXTO), spaceAfter=7, splitLongWords=True)
    return {
        'texto': base,
        'pequeno': ParagraphStyle('pequeno', parent=base, fontSize=8.5, leading=12, textColor=colors.HexColor(CINZA)),
        'rotulo': ParagraphStyle('rotulo', parent=base, fontName='Barco-Bold', fontSize=8, leading=12, textColor=colors.HexColor(CINZA), spaceAfter=4),
        'chamada': ParagraphStyle('chamada', parent=base, fontName='Barco-Bold', fontSize=10, leading=14, textColor=colors.HexColor(AZUL), spaceAfter=14),
        'titulo': ParagraphStyle('titulo', parent=base, fontName='Barco-Bold', fontSize=29, leading=34, textColor=colors.HexColor(AZUL_ESCURO), spaceAfter=20),
        'entidade': ParagraphStyle('entidade', parent=base, fontName='Barco-Bold', fontSize=19, leading=25, textColor=colors.HexColor(AZUL_ESCURO), spaceAfter=17),
        'secao': ParagraphStyle('secao', parent=base, fontName='Barco-Bold', fontSize=17, leading=23, textColor=colors.HexColor(AZUL_ESCURO), spaceAfter=12, keepWithNext=True),
        'dimensao': ParagraphStyle('dimensao', parent=base, fontName='Barco-Bold', fontSize=9, leading=13, textColor=colors.HexColor(AZUL), spaceBefore=10, spaceAfter=6, keepWithNext=True),
        'mensagem': ParagraphStyle('mensagem', parent=base, fontName='Barco-Bold', fontSize=9, leading=13, spaceBefore=8, spaceAfter=6, keepWithNext=True),
        'link': ParagraphStyle('link', parent=base, fontSize=8.5, leading=12, textColor=colors.HexColor(AZUL), wordWrap='CJK', spaceAfter=6),
        'tag': ParagraphStyle('tag', parent=base, fontName='Barco-Bold', fontSize=8, leading=11, spaceAfter=0),
    }


def formatar_texto(valor: str) -> str:
    """Escapa o conteúdo da fonte e transforma URLs em links azuis clicáveis."""
    texto = str(valor or '').replace('\r\n', '\n')
    texto = texto.replace('\U0001f517', '').replace('\u00ad', '').replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')
    partes = re.split(r'(https?://[^\s<>]+)', texto)
    resultado = []
    for parte in partes:
        if re.match(r'^https?://', parte):
            endereco = parte.rstrip('.,;)')
            sobra = parte[len(endereco):]
            resultado.append(f'<link href="{escape(endereco, quote=True)}" color="{AZUL}"><u>{escape(endereco)}</u></link>{escape(sobra)}')
        else:
            resultado.append(escape(parte).replace('\n', '<br/>'))
    return ''.join(resultado)


def criar_link(rotulo: str, endereco: str, estilos: dict[str, ParagraphStyle]) -> Paragraph:
    """Cria um link azul no PDF sem acessar a rede."""
    return Paragraph(f'<link href="{escape(endereco, quote=True)}" color="{AZUL}"><u>{escape(rotulo)}</u></link>', estilos['link'])


def preparar_logos() -> dict[str, Path]:
    """Ajusta as margens transparentes dos próprios ativos oficiais da Barco."""
    resultado = {}
    for nome, arquivo in [('capa', 'logo-da-empresa-capa.png'), ('simbolo', 'logo-da-empresa.png')]:
        imagem = ImagemPIL.open(RAIZ / 'atricon/assets' / arquivo).convert('RGBA')
        limites = imagem.getchannel('A').getbbox()
        if limites:
            imagem = imagem.crop(limites)
        caminho = TEMPORARIOS / f'logo-{nome}.png'
        imagem.save(caminho)
        resultado[nome] = caminho
    return resultado


def desenhar_pagina(tela: Any, documento: Any) -> None:
    """Desenha símbolo, cabeçalho e número de página sem invadir o conteúdo."""
    largura, altura = A4
    tela.saveState()
    if documento.page > 1:
        tela.drawImage(str(documento.logos['simbolo']), 16 * mm, altura - 20 * mm, width=11 * mm, height=11 * mm, preserveAspectRatio=True, mask='auto')
        tela.setFillColor(colors.HexColor(AZUL_ESCURO))
        tela.setFont('Barco-Bold', 9)
        tela.drawString(31 * mm, altura - 14 * mm, 'BARCO DIGITAL | PNTP 2026')
        tela.setStrokeColor(colors.HexColor('#bed5f2'))
        tela.line(16 * mm, altura - 23 * mm, largura - 16 * mm, altura - 23 * mm)
    tela.setStrokeColor(colors.HexColor('#bed5f2'))
    tela.line(16 * mm, 15 * mm, largura - 16 * mm, 15 * mm)
    tela.setFont('Barco', 7.5)
    tela.setFillColor(colors.HexColor(CINZA))
    fonte = 'Fontes: PDF Avalia e portal público' if documento.dados.get('_capturas_atuais') else 'Fonte: PDF Avalia'
    tela.drawString(16 * mm, 10 * mm, f'{fonte} | Questionário {documento.dados["questionario_id"]} | PNTP 2026')
    tela.drawRightString(largura - 16 * mm, 10 * mm, f'Página {documento.page}')
    tela.restoreState()


def montar_capa(dados: dict[str, Any], estilos: dict[str, ParagraphStyle], logos: dict[str, Path], largura: float) -> list[Any]:
    """Apresenta órgão, escopo e totais sem listar itens aprovados."""
    imagem = ImagemPIL.open(logos['capa'])
    logo = Image(str(logos['capa']), width=64 * mm, height=64 * mm * imagem.height / imagem.width, hAlign='LEFT')
    chamada = dados.get('_aviso_editorial') or 'PNTP 2026 | RESULTADO DA REVISÃO'
    conteudo = [Spacer(1, 8 * mm), logo, Spacer(1, 12 * mm), Paragraph(escape(chamada), estilos['chamada']), Paragraph('Relatório de itens<br/>não atendidos', estilos['titulo']), Paragraph(escape(dados['entidade_pdf']), estilos['entidade'])]
    meta = f'Questionário {dados["questionario_id"]} | Status da fonte: {dados.get("status_pdf", "Não informado")}'
    conteudo.append(Paragraph(escape(meta), estilos['pequeno']))
    if dados.get('porcentagem'):
        conteudo.append(Paragraph(f'Índice de transparência informado no PDF: <b>{escape(dados["porcentagem"])}</b> | {escape(dados.get("classificacao_pdf", ""))}', estilos['pequeno']))
    conteudo.append(Spacer(1, 8 * mm))
    if dados.get('sem_revisao'):
        aviso = '<b>Revisão não informada no PDF original.</b><br/><br/>O documento apresenta somente ' + ('Avaliação e Validação' if dados['etapa_resultado'] == 'validacao' else 'Avaliação') + '. Não é possível identificar itens reprovados na Revisão a partir desta fonte. Este relatório não substitui a Revisão pelo resultado de outra etapa.'
        caixa = Table([[Paragraph(aviso, estilos['texto'])]], colWidths=[largura])
        caixa.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fffaeb')), ('BOX', (0, 0), (-1, -1), .7, colors.HexColor('#fedf89')), ('LEFTPADDING', (0, 0), (-1, -1), 13), ('RIGHTPADDING', (0, 0), (-1, -1), 13), ('TOPPADDING', (0, 0), (-1, -1), 12), ('BOTTOMPADDING', (0, 0), (-1, -1), 9)]))
        conteudo.extend([caixa, Spacer(1, 9 * mm)])
    else:
        reprovados = dados['reprovados']
        essenciais = sum(criterio['categoria'] == 'Essenciais' for criterio in reprovados)
        estatisticas = [[Paragraph(f'<font size="22" color="{AZUL_ESCURO}"><b>{valor}</b></font><br/><br/>{rotulo}', estilos['pequeno']) for valor, rotulo in [(len(reprovados), 'critérios com falhas'), (essenciais, 'critérios essenciais')]]]
        quadro = Table(estatisticas, colWidths=[largura / 2] * 2)
        quadro.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#eaf3ff')), ('BOX', (0, 0), (-1, -1), .6, colors.HexColor('#bed5f2')), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, -1), 16), ('BOTTOMPADDING', (0, 0), (-1, -1), 14)]))
        conteudo.extend([quadro, Spacer(1, 6 * mm)])
        escopo_atual = ' Inclui também capturas atuais do portal, com data e link de consulta.' if dados.get('_capturas_atuais') else ' As capturas atuais do portal ainda estão pendentes.' if dados.get('_aviso_editorial') else ''
        conteudo.append(Paragraph('Inclui somente subitens marcados como “Não atende” na coluna Revisão(Ultima Etapa da Avaliação). Os enunciados, comentários, links e imagens da revisão foram extraídos do PDF original, encontrado no site da Atricon.' + escopo_atual, estilos['pequeno']))
        conteudo.append(Spacer(1, 5))
        categorias = [
            Paragraph('<font color="#b42318"><b>Essenciais:</b></font> precisam ter <b>100% de atendimento</b>. Se qualquer essencial falhar, o órgão <b>não recebe selo</b>, mesmo com nota geral alta.', estilos['pequeno']),
            Paragraph('<font color="#93370d"><b>Obrigatórios:</b></font> são exigências de divulgação previstas em leis e normas. As falhas reduzem a nota e influenciam a classificação do portal.', estilos['pequeno']),
            Paragraph('<font color="#067647"><b>Recomendados:</b></font> são boas práticas de transparência. Também contam na pontuação e ajudam a melhorar a classificação.', estilos['pequeno']),
        ]
        responsaveis = [
            Paragraph(f'<font color="{CORES_DOS_RESPONSAVEIS["Avaliador"][0]}"><b>Avaliador:</b></font> responsável do órgão pela avaliação do site. Faz a avaliação inicial, envia links e imagens e responde aos apontamentos.', ParagraphStyle('papelAvaliador', parent=estilos['pequeno'], backColor=colors.HexColor(CORES_DOS_RESPONSAVEIS['Avaliador'][1]), borderPadding=2)),
            Paragraph(f'<font color="{CORES_DOS_RESPONSAVEIS["Validador"][0]}"><b>Validador:</b></font> equipe do <b>TCE do Tocantins (TCE-TO)</b>. Confere as informações e evidências enviadas e valida ou contesta o atendimento dos critérios.', ParagraphStyle('papelValidador', parent=estilos['pequeno'], backColor=colors.HexColor(CORES_DOS_RESPONSAVEIS['Validador'][1]), borderPadding=2)),
            Paragraph(f'<font color="{CORES_DOS_RESPONSAVEIS["Revisor"][0]}"><b>Revisor:</b></font> equipe de Tribunal de Contas designada pela Atricon, que pode ser de <b>outro estado</b>. Reconfere as evidências e o resultado da validação na revisão nacional.', ParagraphStyle('papelRevisor', parent=estilos['pequeno'], backColor=colors.HexColor(CORES_DOS_RESPONSAVEIS['Revisor'][1]), borderPadding=2)),
        ]
        explicacoes = Table([
            [Paragraph(f'<font color="{AZUL_ESCURO}"><b>Como funcionam as categorias</b></font>', estilos['pequeno']), '', Paragraph(f'<font color="{AZUL_ESCURO}"><b>Quem faz cada etapa</b></font>', estilos['pequeno'])],
            [categorias, '', responsaveis],
        ], colWidths=[(largura - 18) / 2, 18, (largura - 18) / 2])
        explicacoes.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        conteudo.append(explicacoes)
        conteudo.append(Paragraph('O selo também depende da nota geral e das etapas de validação e controle de qualidade. Fontes: <link href="https://radardatransparencia.atricon.org.br/pdf/Cartilha-PNTP-2026.pdf" color="' + AZUL + '"><u>Cartilha PNTP 2026</u></link> (categorias, páginas 40 a 43) e <link href="https://atricon.org.br/blog/pntp-2026-entra-na-etapa-de-garantia-da-qualidade-confira-os-proximos-passos/" color="' + AZUL + '"><u>orientações da Atricon sobre a revisão</u></link>.', estilos['pequeno']))
    conteudo.extend([criar_link('Abrir relatório no Avalia (pode exigir acesso)', f'https://avalia.atricon.org.br/questionarios/{dados["questionario_id"]}/pdf/', estilos), Paragraph('Gerado em ' + datetime.now().strftime('%d/%m/%Y') + ' | Barco Digital Sistemas', estilos['pequeno'])])
    return conteudo


def localizar_titulo(pagina: Any, identificador: str) -> float:
    """Localiza a altura do enunciado, inclusive em páginas com vários critérios."""
    palavras = pagina.get_text('words')
    ocorrencias = [palavra[1] for palavra in palavras if palavra[4].rstrip('.') == identificador and palavra[0] < 140]
    return min(ocorrencias) if ocorrencias else 0


def delimitar_criterio(documento: Any, dados: dict[str, Any], criterio: dict[str, Any]) -> dict[int, tuple[float, float]]:
    """Delimita fisicamente o critério para não importar evidências de outro item."""
    criterios = dados['criterios_validacao']
    indice = next(i for i, item in enumerate(criterios) if item['criterio_id'] == criterio['criterio_id'])
    inicio = min(criterio['paginas_pdf'])
    proximo = criterios[indice + 1] if indice + 1 < len(criterios) else None
    fim = min(proximo['paginas_pdf']) if proximo else len(documento)
    limites = {}
    for numero in range(inicio, fim + 1):
        pagina = documento[numero - 1]
        superior = localizar_titulo(pagina, criterio['criterio_id']) if numero == inicio else 0
        inferior = localizar_titulo(pagina, proximo['criterio_id']) if proximo and numero == fim else pagina.rect.height
        if inferior > superior:
            limites[numero] = (superior, inferior)
    return limites


class EvidenciaOriginal(Flowable):
    """Reserva espaço para incorporar um bloco original com texto e imagens vetoriais."""

    def __init__(self, pagina: int, recorte: Any, largura: float, registros: list[dict[str, Any]], criterio: str) -> None:
        """Dimensiona o bloco sem alterar a proporção do conteúdo original."""
        super().__init__()
        self.pagina = pagina
        self.recorte = pymupdf.Rect(recorte)
        escala = min(largura / self.recorte.width, 680 / self.recorte.height)
        self.width = self.recorte.width * escala
        self.height = self.recorte.height * escala
        self.registros = registros
        self.criterio = criterio

    def draw(self) -> None:
        """Registra a posição final para inserir a evidência após a paginação."""
        x, y = self.canv.absolutePosition(0, 0)
        altura = self.canv._pagesize[1]
        self.registros.append({'pagina_destino': self.canv.getPageNumber(), 'pagina_origem': self.pagina, 'criterio': self.criterio, 'recorte': list(self.recorte), 'destino': [x, altura - y - self.height, x + self.width, altura - y]})


class DestinoDoCriterio(Flowable):
    """Registra o início real do critério para os links e a numeração do sumário."""

    def __init__(self, identificador: str, destinos: dict[str, Any]) -> None:
        """Associa o marcador ao identificador do critério."""
        super().__init__()
        self.identificador = identificador
        self.destinos = destinos
        self.width = 0
        self.height = 0

    def draw(self) -> None:
        """Guarda a página e a altura após a paginação definitiva."""
        _, y = self.canv.absolutePosition(0, 0)
        self.destinos[self.identificador] = {'pagina': self.canv.getPageNumber(), 'altura': self.canv._pagesize[1] - y}


class LinhaDoSumario(Flowable):
    """Exibe o número do critério, a categoria e as cores correspondentes."""

    def __init__(self, criterio: dict[str, Any], largura: float, linhas: list[dict[str, Any]]) -> None:
        """Dimensiona a linha compacta do sumário."""
        super().__init__()
        self.criterio = criterio
        self.width = largura
        self.linhas = linhas
        cor, _, _ = PALETAS[criterio['categoria']]
        estilo = ParagraphStyle('criterioSumario', fontName='Barco-Bold', fontSize=8.5, leading=11.5, textColor=colors.HexColor(cor))
        self.titulo = Paragraph(escape(criterio['criterio_id']), estilo)
        _, self.altura_titulo = self.titulo.wrap(largura - 129, 1000)
        self.height = max(31, self.altura_titulo + 15)

    def draw(self) -> None:
        """Desenha a categoria ao lado do número e registra a área clicável."""
        cor, fundo, borda = PALETAS[self.criterio['categoria']]
        tela = self.canv
        tela.saveState()
        tela.setFillColor(colors.HexColor(fundo))
        tela.setStrokeColor(colors.HexColor(borda))
        tela.setLineWidth(.5)
        tela.roundRect(0, 2, self.width, self.height - 4, 3, fill=1, stroke=1)
        self.titulo.drawOn(tela, 9, (self.height - self.altura_titulo) / 2)
        categoria = {'Essenciais': 'Essencial', 'Obrigatórios': 'Obrigatório', 'Recomendados': 'Recomendado'}[self.criterio['categoria']]
        tela.setFillColor(colors.HexColor(cor))
        tela.setFont('Barco-Bold', 8)
        tela.drawCentredString(self.width - 77, self.height / 2 - 3, categoria)
        x, y = tela.absolutePosition(0, 0)
        altura_pagina = tela._pagesize[1]
        self.linhas.append({'criterio': self.criterio['criterio_id'], 'pagina': tela.getPageNumber(), 'caixa': [x, altura_pagina - y - self.height, x + self.width, altura_pagina - y]})
        tela.restoreState()


def montar_sumario(dados: dict[str, Any], estilos: dict[str, ParagraphStyle], largura: float) -> list[Any]:
    """Monta o sumário da segunda página com números, categorias e páginas."""
    cabecalho = Table([[Paragraph('<b>Critério</b>', estilos['pequeno']), Paragraph('<b>Categoria</b>', estilos['pequeno']), Paragraph('<b>Página</b>', estilos['pequeno'])]], colWidths=[largura - 129, 91, 38])
    cabecalho.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
    return [Paragraph('Sumário', estilos['secao']), Paragraph('Clique em um critério para ir diretamente à sua página.', estilos['pequeno']), Spacer(1, 6), cabecalho, *[LinhaDoSumario(criterio, largura, dados['_linhas_sumario']) for criterio in dados['reprovados']]]


def vincular_sumario(caminho: Path, dados: dict[str, Any]) -> None:
    """Preenche páginas, links internos e marcadores usando os destinos definitivos."""
    temporario = caminho.with_suffix('.sumario.pdf')
    with pymupdf.open(caminho) as documento:
        for linha in dados['_linhas_sumario']:
            destino = dados['_destinos_criterios'][linha['criterio']]
            pagina = documento[linha['pagina'] - 1]
            caixa = pymupdf.Rect(linha['caixa'])
            numero = str(destino['pagina'])
            fonte = pymupdf.Font(fontfile='C:/Windows/Fonts/arialbd.ttf')
            largura_numero = fonte.text_length(numero, fontsize=9)
            pagina.insert_font(fontname='BarcoSumario', fontfile='C:/Windows/Fonts/arialbd.ttf')
            pagina.insert_text((caixa.x1 - 12 - largura_numero, (caixa.y0 + caixa.y1) / 2 + 3), numero, fontname='BarcoSumario', fontsize=9, color=pymupdf.sRGB_to_pdf(int(AZUL_ESCURO[1:], 16)))
            pagina.insert_link({'kind': pymupdf.LINK_GOTO, 'from': caixa, 'page': destino['pagina'] - 1, 'to': pymupdf.Point(0, max(0, destino['altura'] - 5)), 'zoom': 0})
        documento.set_toc([[1, 'Sumário', 2], *[[1, criterio['criterio'], dados['_destinos_criterios'][criterio['criterio_id']]['pagina']] for criterio in dados['reprovados']]])
        documento.save(temporario, garbage=4, deflate=True)
    temporario.replace(caminho)


def extrair_blocos_evidencias(documento: Any, limites: dict[int, tuple[float, float]]) -> list[tuple[int, Any]]:
    """Recupera as caixas de evidência na ordem original, incluindo todas as etapas."""
    resultado = []
    for numero, (superior, inferior) in limites.items():
        pagina = documento[numero - 1]
        caixas = []
        for desenho in pagina.get_drawings():
            caixa = desenho['rect']
            if desenho['type'] != 's' or abs(caixa.x0 - 49.125) > 2 or caixa.width < pagina.rect.width * .75:
                continue
            recorte = caixa + (-1, -1, 1, 1)
            recorte &= pymupdf.Rect(0, superior, pagina.rect.width, inferior)
            recorte &= pagina.rect
            if recorte.width > 0 and recorte.height > 8:
                caixas.append(recorte)
        # Alguns comentários que ocupam uma página inteira têm bordas feitas
        # por linhas preenchidas, sem o retângulo de contorno dos demais.
        blocos = pagina.get_text('blocks')
        cabecalhos = [pymupdf.Rect(bloco[:4]) for bloco in blocos
                      if re.match(r'^(Comentário|Foto|Link) do (Avaliador|Validador|Revisor)\b', re.sub(r'\s+', ' ', bloco[4]).strip())
                      and superior <= bloco[1] < inferior]
        imagens = [pymupdf.Rect(imagem['bbox']) for imagem in pagina.get_image_info()]
        for cabecalho in cabecalhos:
            centro = pymupdf.Point(cabecalho.x0 + 2, (cabecalho.y0 + cabecalho.y1) / 2)
            if any(caixa.contains(centro) for caixa in caixas):
                continue
            fim = min([inferior, *[caixa.y0 for caixa in caixas if caixa.y0 > cabecalho.y1],
                       *[outro.y0 - 10 for outro in cabecalhos if outro.y0 > cabecalho.y1]])
            areas = [pymupdf.Rect(bloco[:4]) for bloco in blocos
                     if cabecalho.y0 <= bloco[1] and bloco[3] < fim]
            areas.extend(imagem for imagem in imagens if cabecalho.y0 <= imagem.y0 and imagem.y1 < fim)
            if areas:
                caixas.append(pymupdf.Rect(48.125, max(superior, cabecalho.y0 - 11), 548.875,
                                          min(fim, max(area.y1 for area in areas) + 11)))
        # A imagem de um comentário pode continuar na página seguinte sem
        # repetir o cabeçalho ou formar outro retângulo fechado.
        for imagem in imagens:
            visivel = imagem & pymupdf.Rect(0, superior, pagina.rect.width, inferior)
            if visivel.is_empty:
                continue
            centro = pymupdf.Point((visivel.x0 + visivel.x1) / 2, (visivel.y0 + visivel.y1) / 2)
            if not any(caixa.contains(centro) for caixa in caixas):
                recorte = (visivel + (-10, -1, 10, 11)) & pagina.rect
                recorte &= pymupdf.Rect(0, superior, pagina.rect.width, inferior)
                caixas.append(recorte)
        caixas.sort(key=lambda caixa: (caixa.y0, caixa.x0))
        resultado.extend((numero, caixa) for caixa in caixas)
    return resultado


def colorir_responsaveis(fonte: Any, registros: list[dict[str, Any]]) -> None:
    """Colore os cabeçalhos em uma cópia em memória, preservando textos e imagens."""
    alteracoes = {}
    anteriores = {}
    encontrados = set()
    for registro in registros:
        numero = registro['pagina_origem'] - 1
        pagina = fonte[numero]
        recorte = pymupdf.Rect(registro['recorte'])
        responsavel = None
        for bloco in pagina.get_text('dict', clip=recorte)['blocks']:
            for linha in bloco.get('lines', []):
                for trecho in linha['spans']:
                    if trecho['bbox'][1] > recorte.y0 + 30:
                        continue
                    papel = next((nome for nome in CORES_DOS_RESPONSAVEIS if re.search(r'\b' + nome + r'\b', trecho['text'])), None)
                    if not papel:
                        continue
                    responsavel = papel
                    chave = (numero, tuple(trecho['bbox']))
                    if chave not in encontrados:
                        encontrados.add(chave)
                        alteracoes.setdefault(numero, []).append((trecho, papel))
        registro['responsavel'] = responsavel or anteriores.get(registro['criterio'])
        if registro['responsavel']:
            anteriores[registro['criterio']] = registro['responsavel']
    for numero, trechos in alteracoes.items():
        pagina = fonte[numero]
        for trecho, papel in trechos:
            fundo = pymupdf.sRGB_to_pdf(int(CORES_DOS_RESPONSAVEIS[papel][1][1:], 16))
            pagina.add_redact_annot(pymupdf.Rect(trecho['bbox']), fill=fundo, cross_out=False)
        pagina.apply_redactions(images=0, graphics=0, text=0)
        pagina.insert_font(fontname='BarcoResponsavel', fontfile='C:/Windows/Fonts/arialbd.ttf')
        for trecho, papel in trechos:
            cor = pymupdf.sRGB_to_pdf(int(CORES_DOS_RESPONSAVEIS[papel][0][1:], 16))
            pagina.insert_text(trecho['origin'], trecho['text'], fontsize=trecho['size'], fontname='BarcoResponsavel', color=cor)


def incorporar_evidencias(caminho: Path, origem: str, registros: list[dict[str, Any]]) -> None:
    """Insere o histórico com cores por responsável e restaura seus links clicáveis."""
    temporario = caminho.with_suffix('.atualizando.pdf')
    with pymupdf.open(caminho) as destino, pymupdf.open(origem) as fonte:
        colorir_responsaveis(fonte, registros)
        for registro in registros:
            pagina = destino[registro['pagina_destino'] - 1]
            recorte = pymupdf.Rect(registro['recorte'])
            area_destino = pymupdf.Rect(registro['destino'])
            indice_origem = registro['pagina_origem'] - 1
            if registro.get('responsavel'):
                cor, fundo = CORES_DOS_RESPONSAVEIS[registro['responsavel']]
                pagina.draw_rect(area_destino, color=pymupdf.sRGB_to_pdf(int(cor[1:], 16)), fill=pymupdf.sRGB_to_pdf(int(fundo[1:], 16)), width=.5)
            pagina.show_pdf_page(area_destino, fonte, indice_origem, clip=recorte, keep_proportion=False)
            escala_x = area_destino.width / recorte.width
            escala_y = area_destino.height / recorte.height
            for link in fonte[indice_origem].get_links():
                if not re.match(r'^https?://', link.get('uri', '')):
                    continue
                area_link = link['from'] & recorte
                if area_link.is_empty:
                    continue
                area_link_destino = pymupdf.Rect(area_destino.x0 + (area_link.x0 - recorte.x0) * escala_x, area_destino.y0 + (area_link.y0 - recorte.y0) * escala_y, area_destino.x0 + (area_link.x1 - recorte.x0) * escala_x, area_destino.y0 + (area_link.y1 - recorte.y0) * escala_y)
                pagina.insert_link({'kind': pymupdf.LINK_URI, 'from': area_link_destino, 'uri': link['uri']})
        destino.save(temporario, garbage=4, deflate=True)
    temporario.replace(caminho)


def carregar_explicacoes(dados: dict[str, Any]) -> dict[str, str]:
    """Carrega sínteses conferidas e exige correspondência com o PDF de origem."""
    if not dados['reprovados']:
        return {}
    caminho = Path(dados.get('_arquivo_resumos') or RAIZ / 'atricon/resumos_barco' / (Path(dados['arquivo_origem']).stem + '.json'))
    resumos = json.loads(caminho.read_text(encoding='utf-8'))
    if resumos['sha256_origem'] != dados['sha256_origem']:
        raise ValueError('O PDF original mudou. Confira as explicações antes de gerar novamente.')
    explicacoes = resumos['explicacoes']
    for criterio in dados['reprovados']:
        if not explicacoes.get(criterio['criterio_id'], '').strip():
            raise ValueError(f'Explicação ausente para o critério {criterio["criterio_id"]}')
    return explicacoes


def carregar_capturas_atuais(dados: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Carrega somente as capturas reais organizadas para o relatório selecionado."""
    pasta = Path(dados.get('_pasta_capturas') or RAIZ / 'atricon/evidencias_atuais')
    manifesto = Path(dados.get('_arquivo_capturas') or pasta / (Path(dados['arquivo_origem']).stem + '.json'))
    if not manifesto.is_file():
        return {}
    itens = json.loads(manifesto.read_text(encoding='utf-8'))['itens']
    for criterio in dados['reprovados']:
        identificador = criterio['criterio_id']
        if not itens.get(identificador):
            if dados.get('_permitir_capturas_ausentes'):
                continue
            raise ValueError(f'Captura atual ausente: {identificador}')
        for captura in itens[identificador]:
            caminho = (pasta / captura['arquivo']).resolve()
            if not caminho.is_relative_to(pasta.resolve()) or not caminho.is_file():
                raise ValueError(f'Captura atual inválida: {caminho}')
    return itens


class CapturaAtual(Image):
    """Insere uma captura real e registra a sua posição para conferir o PDF."""

    def __init__(self, caminho: Path, largura: float, altura: float, criterio: str, arquivo: str, registros: list[dict[str, Any]]) -> None:
        """Mantém a proporção da imagem e a identificação da consulta realizada."""
        super().__init__(str(caminho), width=largura, height=altura, hAlign='CENTER')
        self.criterio = criterio
        self.arquivo_original = arquivo
        self.registros = registros

    def draw(self) -> None:
        """Registra página e limites da imagem efetivamente desenhada."""
        x, y = self.canv.absolutePosition(0, 0)
        altura = self.canv._pagesize[1]
        self.registros.append({'criterio': self.criterio, 'arquivo': self.arquivo_original, 'pagina_destino': self.canv.getPageNumber(), 'destino': [x, altura - y - self.drawHeight, x + self.drawWidth, altura - y]})
        super().draw()


def montar_situacao_atual(dados: dict[str, Any], criterio: dict[str, Any], estilos: dict[str, ParagraphStyle], largura: float) -> list[Any]:
    """Apresenta as telas atuais em caixas azuis após o comentário do Barco."""
    identificador = criterio['criterio_id']
    capturas = dados['_capturas_atuais'].get(identificador, [])
    if not capturas:
        return []
    titulo = ParagraphStyle('tituloAtual', parent=estilos['texto'], fontName='Barco-Bold', fontSize=10, leading=14, textColor=colors.white, spaceBefore=0, spaceAfter=7)
    pequeno = ParagraphStyle('legendaAtual', parent=estilos['pequeno'], textColor=colors.white, spaceAfter=7)
    estilo_caixa = TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(AZUL)), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, -1), 11), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)])
    cabecalho = Table([[Paragraph(f'Situação atual do portal - Critério {identificador}', titulo)]], colWidths=[largura])
    cabecalho.setStyle(estilo_caixa)
    conteudo = [PageBreak(), cabecalho, Spacer(1, 8)]
    temporarios = TEMPORARIOS / 'capturas_atuais'
    temporarios.mkdir(exist_ok=True)
    for captura in capturas:
        original = Path(dados.get('_pasta_capturas') or RAIZ / 'atricon/evidencias_atuais') / captura['arquivo']
        imagem = ImagemPIL.open(original).convert('RGB').crop(captura['recorte'])
        caminho = temporarios / original.name
        imagem.save(caminho)
        escala = min((largura - 24) / imagem.width, 430 / imagem.height)
        quadro = CapturaAtual(caminho, imagem.width * escala, imagem.height * escala, identificador, captura['arquivo'], dados['_posicoes_capturas_atuais'])
        link = Paragraph('<link href="' + escape(captura['url'], quote=True) + '" color="#ffffff"><u>Abrir página ou documento consultado</u></link>', pequeno)
        bloco = [Paragraph(escape(captura['titulo']), titulo), Paragraph('Capturado em ' + escape(captura['capturado_em']) + ' (Brasília) | Barco Digital', pequeno), link, quadro, Spacer(1, 7), Paragraph(escape(captura['observacao']), pequeno)]
        caixa = Table([[bloco]], colWidths=[largura])
        caixa.setStyle(estilo_caixa)
        conteudo.extend([KeepTogether([caixa]), Spacer(1, 8)])
    return conteudo


def montar_explicacao(criterio: dict[str, Any], explicacao: str, estilos: dict[str, ParagraphStyle], largura: float) -> Table:
    """Destaca o comentário do Barco em azul antes da situação atual do portal."""
    estilo_titulo = ParagraphStyle('tituloExplicacao', parent=estilos['texto'], fontName='Barco-Bold', fontSize=10, leading=14, textColor=colors.white, spaceAfter=0)
    estilo_texto = ParagraphStyle('textoExplicacao', parent=estilos['texto'], fontSize=9.5, leading=14, textColor=colors.white, spaceAfter=0)
    titulo = f'Por que não foi atendido? - Critério {criterio["criterio_id"]}'
    cabecalho = escape(titulo) + '<br/><font size="8.5">Comentário do Barco Digital</font>'
    caixa = Table([[Paragraph(cabecalho, estilo_titulo)], [Paragraph(escape(explicacao), estilo_texto)]], colWidths=[largura])
    caixa.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(AZUL)), ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12), ('TOPPADDING', (0, 0), (-1, 0), 10), ('BOTTOMPADDING', (0, 0), (-1, 0), 5), ('TOPPADDING', (0, 1), (-1, 1), 0), ('BOTTOMPADDING', (0, 1), (-1, 1), 11)]))
    return caixa


def montar_criterio(dados: dict[str, Any], criterio: dict[str, Any], documento: Any, estilos: dict[str, ParagraphStyle], largura: float) -> list[Any]:
    """Monta a ficha de um critério sem expor subitens aprovados."""
    cor, fundo, borda = PALETAS[criterio['categoria']]
    limites = delimitar_criterio(documento, dados, criterio)
    categoria = Paragraph(f'<font color="{cor}">{escape(criterio["categoria"])}</font>', estilos['tag'])
    titulo = Paragraph(f'<font color="{cor}"><b>{escape(criterio["criterio"])}</b></font>', estilos['texto'])
    cabecalho = Table([[categoria], [titulo]], colWidths=[largura])
    cabecalho.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor(fundo)), ('BOX', (0, 0), (-1, -1), .7, colors.HexColor(borda)), ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (-1, 0), 8), ('BOTTOMPADDING', (0, 0), (-1, 0), 3), ('TOPPADDING', (0, 1), (-1, 1), 2), ('BOTTOMPADDING', (0, 1), (-1, 1), 4)]))
    blocos = extrair_blocos_evidencias(documento, limites)
    if not blocos:
        raise ValueError(f'Nenhuma evidência original encontrada para o critério {criterio["criterio_id"]}')
    numero, recorte = blocos[0]
    primeira_evidencia = EvidenciaOriginal(numero, recorte, largura, dados['_posicoes_evidencias'], criterio['criterio_id'])
    conteudo = [KeepTogether([DestinoDoCriterio(criterio['criterio_id'], dados['_destinos_criterios']), Paragraph(escape(criterio['titulo']).upper(), estilos['dimensao']), cabecalho, Spacer(1, 6), Paragraph('Evidências do Critério', estilos['mensagem']), primeira_evidencia]), Spacer(1, 8)]
    for numero, recorte in blocos[1:-1]:
        conteudo.append(EvidenciaOriginal(numero, recorte, largura, dados['_posicoes_evidencias'], criterio['criterio_id']))
        conteudo.append(Spacer(1, 8))
    explicacao = montar_explicacao(criterio, dados['_explicacoes'][criterio['criterio_id']], estilos, largura)
    if len(blocos) > 1:
        numero, recorte = blocos[-1]
        ultima_evidencia = EvidenciaOriginal(numero, recorte, largura, dados['_posicoes_evidencias'], criterio['criterio_id'])
        conteudo.append(KeepTogether([ultima_evidencia, Spacer(1, 8), explicacao]))
    else:
        conteudo.append(explicacao)
    conteudo.extend(montar_situacao_atual(dados, criterio, estilos, largura))
    # O próximo critério começa em outra página; um espaçador final pode
    # transbordar sozinho e criar uma página contendo apenas o cabeçalho.
    while conteudo and isinstance(conteudo[-1], Spacer):
        conteudo.pop()
    return conteudo


def gerar_documentos(resultados: list[dict[str, Any]], destino: Path | None = None) -> None:
    """Gera os PDFs na pasta solicitada e mantém um manifesto de conferência."""
    destino = destino or ORIGEM / 'barco'
    destino.mkdir(parents=True, exist_ok=True)
    estilos = criar_estilos()
    logos = preparar_logos()
    largura = A4[0] - 32 * mm
    manifesto = []
    for indice, dados in enumerate(resultados, 1):
        if dados['divergencias_enunciado']:
            raise ValueError(f'Confira os enunciados antes de gerar: {dados["arquivo_origem"]}')
        dados['_explicacoes'] = carregar_explicacoes(dados)
        dados['_capturas_atuais'] = carregar_capturas_atuais(dados)
        caminho = destino / Path(dados['arquivo_origem']).name
        relatorio = BaseDocTemplate(str(caminho), pagesize=A4, title='PNTP 2026 - ' + dados['entidade_pdf'] + ' - Itens não atendidos na revisão', author='Barco Digital Sistemas', subject='Reprovados na Revisão; categorias da Cartilha PNTP 2026', leftMargin=16 * mm, rightMargin=16 * mm, topMargin=28 * mm, bottomMargin=19 * mm, pageCompression=1)
        relatorio.logos = logos
        relatorio.dados = dados
        quadro = Frame(16 * mm, 19 * mm, largura, A4[1] - 47 * mm, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        relatorio.addPageTemplates(PageTemplate(id='relatorio', frames=quadro, onPage=desenhar_pagina))
        dados['_posicoes_evidencias'] = []
        dados['_posicoes_capturas_atuais'] = []
        dados['_destinos_criterios'] = {}
        dados['_linhas_sumario'] = []
        conteudo = montar_capa(dados, estilos, logos, largura)
        if not dados.get('sem_revisao'):
            conteudo.extend([PageBreak(), *montar_sumario(dados, estilos, largura)])
            conteudo.extend([PageBreak(), Paragraph('Itens não atendidos na Revisão', estilos['secao'])])
            if not dados['reprovados']:
                conteudo.append(Paragraph('Nenhum subitem marcado como “Não atende” na coluna Revisão do PDF original.', estilos['texto']))
            with pymupdf.open(dados['arquivo_origem']) as documento:
                for indice_criterio, criterio in enumerate(dados['reprovados']):
                    if indice_criterio:
                        conteudo.append(PageBreak())
                    conteudo.extend(montar_criterio(dados, criterio, documento, estilos, largura))
        while conteudo and isinstance(conteudo[-1], Spacer):
            conteudo.pop()
        relatorio.build(conteudo)
        incorporar_evidencias(caminho, dados['arquivo_origem'], dados['_posicoes_evidencias'])
        if dados['_linhas_sumario']:
            vincular_sumario(caminho, dados)
            (TEMPORARIOS / (caminho.stem + '-sumario.json')).write_text(json.dumps({'linhas': dados['_linhas_sumario'], 'destinos': dados['_destinos_criterios']}, ensure_ascii=False, indent=2), encoding='utf-8')
        (TEMPORARIOS / (caminho.stem + '-evidencias.json')).write_text(json.dumps(dados['_posicoes_evidencias'], ensure_ascii=False, indent=2), encoding='utf-8')
        (TEMPORARIOS / (caminho.stem + '-capturas-atuais.json')).write_text(json.dumps(dados['_posicoes_capturas_atuais'], ensure_ascii=False, indent=2), encoding='utf-8')
        with pymupdf.open(caminho) as conferido:
            texto = '\n'.join(pagina.get_text() for pagina in conferido)
            for criterio in dados['reprovados']:
                assert criterio['criterio_id'] in texto, f'Critério ausente: {criterio["criterio_id"]}'
            paginas = len(conferido)
            links = sum(len(pagina.get_links()) for pagina in conferido)
        manifesto.append({'arquivo': str(caminho), 'origem': dados['arquivo_origem'], 'sha256_origem': dados['sha256_origem'], 'entidade': dados['entidade_pdf'], 'etapa_fonte': dados['etapa_resultado'], 'sem_revisao': bool(dados.get('sem_revisao')), 'paginas': paginas, 'links': links, 'criterios_reprovados': len(dados['reprovados']), 'subitens_reprovados': sum(len(criterio['falhas']) for criterio in dados['reprovados']), 'categorias': dict(Counter(criterio['categoria'] for criterio in dados['reprovados']))})
        print(f'PDF {indice}/{len(resultados)}: {caminho.name} | {paginas} páginas | {links} links', flush=True)
    (TEMPORARIOS / 'manifesto.json').write_text(json.dumps(manifesto, ensure_ascii=False, indent=2), encoding='utf-8')


def principal() -> None:
    """Analisa as fontes locais e gera um PDF por documento original."""
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument('--analisar', action='store_true', help='Somente extrair e conferir as fontes')
    argumentos.add_argument('--arquivo', help='Nome do PDF original para gerar uma amostra')
    opcoes = argumentos.parse_args()
    TEMPORARIOS.mkdir(parents=True, exist_ok=True)
    classificacoes = ler_classificacoes()
    (TEMPORARIOS / 'classificacoes.json').write_text(json.dumps(classificacoes, ensure_ascii=False, indent=2), encoding='utf-8')
    arquivos = sorted(ORIGEM.glob(opcoes.arquivo or '*.pdf'))
    if not arquivos:
        raise ValueError('Nenhum PDF encontrado')
    resultados = []
    erros = []
    for indice, arquivo in enumerate(arquivos, 1):
        try:
            dados = preparar_documento(arquivo, classificacoes)
            resultados.append(dados)
            print(f'{indice}/{len(arquivos)} {arquivo.name}: {len(dados["reprovados"])} critérios, {sum(len(c["falhas"]) for c in dados["reprovados"])} subitens; {len(dados["divergencias_enunciado"])} diferenças de enunciado', flush=True)
        except Exception as erro:
            erros.append({'arquivo': arquivo.name, 'erro': str(erro)})
            print(f'ERRO {arquivo.name}: {erro}', flush=True)
    (TEMPORARIOS / 'conferencia_fontes.json').write_text(json.dumps({'documentos': resultados, 'erros': erros}, ensure_ascii=False, indent=2), encoding='utf-8')
    if erros:
        raise ValueError(f'{len(erros)} documento(s) exigem conferência; veja conferencia_fontes.json')
    if not opcoes.analisar:
        gerar_documentos(resultados)


if __name__ == '__main__':
    principal()
