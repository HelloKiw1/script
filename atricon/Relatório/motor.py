"""Orquestra coleta, pacote de evidências, revisão e geração transacional do PDF."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ambiente import ATRICON, ENTRADA, EXECUCOES, PASTA, agora, ler_json, salvar_json
from capturador import Capturador, url_publica
from revisao_ia import revisar, validar_resposta


class Cancelado(Exception):
    """Interrupção cooperativa, preservando o material já acumulado."""


@dataclass
class Opcoes:
    """Parâmetros públicos; credenciais nunca integram arquivos do processamento."""
    arquivo: Path | None = None
    conta_indice: int | None = None
    cadastro: Path = ATRICON / 'entrada/orgaos_avalia.json'
    modo: str = 'pacote'
    modelo: str = ''
    resposta: Path | None = None
    reutilizar: bool = False
    capturar: bool = True
    navegador_visivel: bool = False
    espera: int = 25
    links_criterio: int = 3
    documentos_pagina: int = 3
    paginas_documento: int = 3
    destino: Path = ENTRADA / 'barco'
    execucoes: Path = EXECUCOES


def listar_orgaos(cadastro: Path) -> list[dict]:
    """Retorna só rótulos públicos e índices, sem expor contas ou senhas na janela."""
    dados = ler_json(cadastro)
    if isinstance(dados, dict):
        dados = [dados]
    if not isinstance(dados, list):
        raise ValueError('O cadastro precisa ser uma lista de órgãos.')
    resultado = []
    for indice, item in enumerate(dados):
        if not isinstance(item, dict):
            continue
        orgao = next((str(item[k]) for k in ('orgao', 'orgão', 'órgão') if item.get(k)), 'Órgão')
        cidade = str(item.get('cidade') or '')
        resultado.append({'indice': indice, 'rotulo': f'{orgao} - {cidade}'})
    return resultado


def baixar_relatorio(opcoes: Opcoes, informar: Callable, verificar: Callable) -> Path:
    """Reutiliza login, identificação e download autenticado do coletor existente."""
    import coletor_atricon as coletor
    from playwright.sync_api import sync_playwright
    try:
        contas = coletor.load_accounts(opcoes.cadastro)
    except SystemExit:
        raise ValueError('Não foi possível ler o cadastro do coletor. Selecione um JSON válido com os órgãos e acessos locais.') from None
    if opcoes.conta_indice is None or not 0 <= opcoes.conta_indice < len(contas):
        raise ValueError('Selecione um órgão válido do cadastro.')
    conta = contas[opcoes.conta_indice]
    if conta.get('_erro_validacao'):
        raise ValueError('O cadastro selecionado não possui os dados de acesso necessários ao Avalia. Confira o cadastro usado pelo coletor.')
    verificar()
    informar(3, 'Entrando no Avalia com o cadastro local do órgão')
    with sync_playwright() as navegador:
        browser = navegador.chromium.launch(headless=not opcoes.navegador_visivel)
        try:
            contexto = browser.new_context(locale='pt-BR')
            pagina = coletor.login(contexto.new_page(), conta)
            verificar()
            informar(6, 'Localizando a avaliação PNTP 2026 do órgão')
            linha = coletor.select_assessment(coletor.get_my_assessment_rows(pagina), conta)
            if not linha:
                raise ValueError('Avaliação PNTP 2026 não encontrada para o órgão selecionado.')
            verificar()
            informar(9, 'Baixando o PDF original no Avalia')
            temporarios = opcoes.execucoes / '_downloads'
            temporarios.mkdir(parents=True, exist_ok=True)
            retorno = coletor.download_questionnaire_pdf(pagina, linha, conta, temporarios / 'coleta.json')
            arquivo = Path(retorno['pdf_arquivo'])
            dados = coletor.extract_pdf_report(arquivo)
            if str(dados.get('questionario_id')) != str(linha['questionario_id']) or not coletor.entity_matches(dados.get('entidade_pdf', ''), conta):
                raise ValueError('O PDF baixado não corresponde ao órgão/questionário selecionado.')
            if retorno.get('pdf_imagens_indisponiveis'):
                raise ValueError('O PDF do Avalia contém imagens não carregadas. Tente novamente antes de analisar.')
            ENTRADA.mkdir(parents=True, exist_ok=True)
            destino = ENTRADA / arquivo.name
            if destino.exists() and destino.read_bytes() != arquivo.read_bytes():
                copia = temporarios / ('anterior-' + agora().replace(':', '-') + '-' + destino.name)
                shutil.copy2(destino, copia)
            shutil.copy2(arquivo, destino)
            return destino
        finally:
            browser.close()


def montar_plano(dados: dict, documento: Any, gerador: Any) -> dict:
    """Extrai URLs das evidências e anotações, sem inventar caminhos de páginas."""
    plano = {}
    for criterio in dados['reprovados']:
        identificador = criterio['criterio_id']
        urls = []
        mensagens = criterio.get('mensagens_evidencia', [])
        # Links explicitamente enviados pelo Avaliador vêm primeiro.
        ordenadas = sorted(mensagens, key=lambda m: ('link' not in m.get('tipo', '').lower(), 'avaliador' not in m.get('tipo', '').lower()))
        for mensagem in ordenadas:
            texto = json.dumps(mensagem, ensure_ascii=False)
            urls.extend(re.findall(r'https?://[^\s<>"\\]+', texto))
        for numero, limites in gerador.delimitar_criterio(documento, dados, criterio).items():
            pagina = documento[numero - 1]
            for link in pagina.get_links():
                if link.get('uri') and limites[0] <= link['from'].y0 < limites[1]:
                    urls.append(link['uri'])
        vistos = set()
        enderecos = []
        for url in urls:
            url = url.rstrip('.,;)')
            if not url_publica(url) or re.search(r'(^https?://[^/]*atricon\.org\.br|Cartilha-PNTP)', url, re.I) or url in vistos:
                continue
            vistos.add(url)
            enderecos.append(url)
        plano[identificador] = {'urls': enderecos, 'acoes': [], 'criterio': criterio['criterio']}
    return plano


def preparar_historico(dados: dict, documento: Any, gerador: Any, pasta: Path, verificar: Callable) -> tuple[list[dict], list[str]]:
    """Renderiza blocos completos e audita cobertura de texto e imagens na fonte."""
    criterios = []
    pendencias = []
    dimensoes = {gerador.normalizar(c['titulo']) for c in dados['criterios_validacao']}
    cartilha = gerador.pymupdf.open(gerador.CARTILHA)
    try:
        for criterio in dados['reprovados']:
            verificar()
            identificador = criterio['criterio_id']
            limites = gerador.delimitar_criterio(documento, dados, criterio)
            caixas = gerador.extrair_blocos_evidencias(documento, limites)
            imagens = []
            for indice, (numero, recorte) in enumerate(caixas, 1):
                verificar()
                pagina = documento[numero - 1]
                caminho = pasta / 'historico' / f'{identificador}-{indice:03d}.png'
                caminho.parent.mkdir(parents=True, exist_ok=True)
                pagina.get_pixmap(matrix=gerador.pymupdf.Matrix(1.8, 1.8), clip=recorte, alpha=False).save(caminho)
                contem = any(recorte.intersects(gerador.pymupdf.Rect(i['bbox'])) for i in pagina.get_image_info())
                imagens.append({'id': f'{identificador}-historico-{indice:03d}', 'arquivo': caminho.relative_to(pasta).as_posix(),
                                'pagina_original': numero, 'recorte': list(recorte), 'contem_imagem': contem,
                                'texto': pagina.get_text(clip=recorte)})
            iniciou = False
            for numero, (superior, inferior) in limites.items():
                pagina = documento[numero - 1]
                if not iniciou:
                    titulos = [r for r in pagina.search_for('Evidências do Critério') if superior <= r.y0 < inferior]
                    if not titulos:
                        continue
                    superior = titulos[0].y1
                    iniciou = True
                recortes = [r for n, r in caixas if n == numero]
                faltantes = []
                for palavra in pagina.get_text('words', clip=gerador.pymupdf.Rect(0, superior, pagina.rect.width, inferior)):
                    centro = gerador.pymupdf.Point((palavra[0] + palavra[2]) / 2, (palavra[1] + palavra[3]) / 2)
                    if not any(r.contains(centro) for r in recortes):
                        faltantes.append(palavra[4])
                if faltantes and gerador.normalizar(' '.join(faltantes)) not in dimensoes:
                    pendencias.append(f'{identificador}: texto do histórico fora dos blocos reconhecidos, página {numero}: {" ".join(faltantes)[:120]}')
                for imagem in pagina.get_image_info():
                    area = gerador.pymupdf.Rect(imagem['bbox'])
                    if superior <= area.y0 < inferior and not any(r.contains((area.tl + area.br) / 2) for r in recortes):
                        pendencias.append(f'{identificador}: imagem histórica fora dos blocos reconhecidos, página {numero}.')
            if not caixas:
                pendencias.append(f'{identificador}: não foram reconhecidos blocos de evidências do histórico.')
            pagina_cartilha = criterio['pagina_cartilha']
            regra = '\n'.join(cartilha[n].get_text() for n in range(max(0, pagina_cartilha - 1), min(len(cartilha), pagina_cartilha + 2)))
            criterios.append({'criterio_id': identificador, 'criterio': criterio['criterio'], 'categoria': criterio['categoria'],
                              'falhas_revisao': criterio['falhas'], 'mensagens': criterio.get('mensagens_evidencia', []),
                              'paginas_pdf': criterio['paginas_pdf'], 'historico_imagens': imagens,
                              'pagina_cartilha': pagina_cartilha, 'trecho_cartilha': regra})
    finally:
        cartilha.close()
    return criterios, pendencias


def minutas(contexto: dict) -> dict:
    """Fornece texto explicitamente pendente; não simula revisão inteligente sem IA."""
    return {'sha256_origem': contexto['sha256_origem'], 'explicacoes': {
        c['criterio_id']: 'O resultado final registra não atendimento neste critério. O histórico e as capturas disponíveis estão apresentados para análise. Este comentário ainda depende de revisão editorial do Barco Digital para explicar a recusa e os fundamentos de eventual recurso.'
        for c in contexto['criterios']}, 'observacoes_capturas': {}, 'pendencias': ['Comentários ainda não revisados pela IA ou pelo responsável.']}


def validar_capturas(pasta: Path, capturas: dict, criterios: list[dict]) -> None:
    """Impede leitura/envio de arquivos externos ao pacote durante a revisão."""
    if not isinstance(capturas, dict) or not set(capturas) <= {c['criterio_id'] for c in criterios}:
        raise ValueError('O manifesto contém capturas de critérios que não pertencem ao documento.')
    ids = set()
    for itens in capturas.values():
        for item in itens:
            identificador = item.get('id')
            if not identificador or identificador in ids:
                raise ValueError('Identificação de captura ausente ou repetida.')
            ids.add(identificador)
            if not url_publica(item.get('url', '')):
                raise ValueError('Captura atual sem endereço público de origem.')
            for chave in ('arquivo', 'texto_arquivo', 'documento_arquivo'):
                if not item.get(chave):
                    continue
                caminho = (pasta / item[chave]).resolve()
                if not caminho.is_relative_to(pasta.resolve()) or not caminho.is_file():
                    raise ValueError('Arquivo de captura inválido ou fora do pacote de evidências.')


def conferir_pdf(caminho: Path, dados: dict, gerador: Any, pasta: Path) -> dict:
    """Confere estrutura, destinos, textos e gera contato visual de todas as páginas."""
    from PIL import Image, ImageDraw
    erros = []
    miniaturas = []
    with gerador.pymupdf.open(caminho) as documento:
        texto = '\n'.join(p.get_text() for p in documento)
        for criterio in dados['reprovados']:
            identificador = criterio['criterio_id']
            if texto.count(f'Por que não foi atendido? - Critério {identificador}\n') != 1:
                erros.append(f'Comentário ausente ou duplicado: {identificador}')
            destino = dados['_destinos_criterios'].get(identificador)
            if not destino or not 1 <= destino['pagina'] <= len(documento):
                erros.append(f'Destino ausente no sumário: {identificador}')
        if dados['_linhas_sumario'] and min(l['pagina'] for l in dados['_linhas_sumario']) != 2:
            erros.append('O sumário não começa na segunda página.')
        for linha in dados['_linhas_sumario']:
            alvo = dados['_destinos_criterios'][linha['criterio']]['pagina'] - 1
            centro = gerador.pymupdf.Rect(linha['caixa']).tl + gerador.pymupdf.Point(5, 5)
            links = documento[linha['pagina'] - 1].get_links()
            if not any(link.get('kind') == gerador.pymupdf.LINK_GOTO and link.get('page') == alvo and link['from'].contains(centro) for link in links):
                erros.append(f'Link do sumário aponta para outro critério: {linha["criterio"]}')
        for numero, pagina in enumerate(documento, 1):
            if not pagina.get_text(clip=gerador.pymupdf.Rect(40, 80, pagina.rect.width - 40, pagina.rect.height - 55)).strip() and not pagina.get_images():
                erros.append(f'Página sem conteúdo: {numero}')
            for link in pagina.get_links():
                if link.get('kind') == gerador.pymupdf.LINK_GOTO and not 0 <= link.get('page', -1) < len(documento):
                    erros.append(f'Link interno inválido, página {numero}')
            mapa = pagina.get_pixmap(matrix=gerador.pymupdf.Matrix(.55, .55), alpha=False)
            miniaturas.append(Image.frombytes('RGB', (mapa.width, mapa.height), mapa.samples))
        total = len(documento)
    pasta_visual = pasta / 'conferencia_visual'
    pasta_visual.mkdir(exist_ok=True)
    for inicio in range(0, len(miniaturas), 8):
        largura, altura = miniaturas[0].size
        contato = Image.new('RGB', (4 * (largura + 12), 2 * (altura + 30)), '#dce3ec')
        desenho = ImageDraw.Draw(contato)
        for indice, imagem in enumerate(miniaturas[inicio:inicio + 8]):
            x, y = (indice % 4) * (largura + 12), (indice // 4) * (altura + 30)
            desenho.text((x + 4, y + 4), str(inicio + indice + 1), fill='black')
            contato.paste(imagem, (x + 4, y + 23))
        contato.save(pasta_visual / f'contato-{inicio // 8 + 1:02d}.png')
    resultado = {'paginas': total, 'criterios': len(dados['reprovados']), 'erros': erros, 'conferencia_visual': str(pasta_visual)}
    salvar_json(pasta / 'conferencia.json', resultado)
    if erros:
        raise ValueError('O PDF não passou na conferência automática: ' + '; '.join(erros[:5]))
    return resultado


class Processo:
    """Executa um único órgão, com cancelamento, rastreabilidade e retomada."""

    def __init__(self, opcoes: Opcoes, informar: Callable[[float, str], None], cancelar: threading.Event | None = None) -> None:
        """Recebe opções e uma função que envia progresso à fila da interface."""
        self.opcoes = opcoes
        self.informar = informar
        self.cancelar = cancelar or threading.Event()
        self.pasta: Path | None = None

    def verificar(self) -> None:
        """Interrompe entre operações, sem eliminar arquivos ou publicar PDF incompleto."""
        if self.cancelar.is_set():
            raise Cancelado('Processamento cancelado. As evidências já coletadas foram preservadas.')

    def executar(self) -> dict:
        """Acumula primeiro, revisa depois e só publica após a validação do PDF."""
        import gerar_pdfs_barco as gerador
        self.informar(1, 'Preparando o processamento')
        arquivo = self.opcoes.arquivo or baixar_relatorio(self.opcoes, self.informar, self.verificar)
        arquivo = arquivo.resolve()
        if not arquivo.is_file() or arquivo.suffix.lower() != '.pdf' or not arquivo.read_bytes().startswith(b'%PDF-'):
            raise ValueError('Selecione um PDF original válido.')
        sha = hashlib.sha256(arquivo.read_bytes()).hexdigest()
        pasta = self.opcoes.execucoes / arquivo.stem / sha[:12]
        self.pasta = pasta
        pasta.mkdir(parents=True, exist_ok=True)
        bloqueio = pasta / '.em_execucao'
        try:
            descritor = bloqueio.open('x')
        except FileExistsError:
            raise ValueError('Já existe um processamento deste PDF. Se o programa anterior foi encerrado à força, remova o arquivo .em_execucao dessa execução.') from None
        try:
            with descritor:
                descritor.write(agora())
            return self.processar(arquivo, sha, pasta, gerador)
        finally:
            bloqueio.unlink(missing_ok=True)

    def processar(self, arquivo: Path, sha: str, pasta: Path, gerador: Any) -> dict:
        """Monta o pacote e o relatório, mantendo artefatos manuais existentes separados."""
        self.verificar()
        gerador.TEMPORARIOS = pasta / 'temporarios'
        gerador.TEMPORARIOS.mkdir(exist_ok=True)
        self.informar(12, 'Lendo critérios e conferindo categorias na cartilha')
        dados = gerador.preparar_documento(arquivo, gerador.ler_classificacoes())
        if dados.get('sem_revisao'):
            raise ValueError('Este PDF não apresenta Revisão. O programa não usa outra etapa como substituta.')
        if dados['divergencias_enunciado']:
            salvar_json(pasta / 'divergencias_enunciado.json', dados['divergencias_enunciado'])
            raise ValueError('Há enunciados diferentes da cartilha. Confira divergencias_enunciado.json antes de gerar.')
        shutil.copy2(arquivo, pasta / 'original.pdf')
        shutil.copy2(PASTA / 'PROMPT_REVISAO.md', pasta / 'PROMPT_REVISAO.md')
        self.informar(15, 'Extraindo histórico, imagens e datas das etapas')
        with gerador.pymupdf.open(arquivo) as documento:
            criterios, pendencias_historico = preparar_historico(dados, documento, gerador, pasta, self.verificar)
            plano_novo = montar_plano(dados, documento, gerador)
        plano_arquivo = pasta / 'plano_capturas.json'
        if not plano_arquivo.exists():
            salvar_json(plano_arquivo, plano_novo)
        plano = ler_json(plano_arquivo)
        contexto = {'versao': 1, 'entidade': dados['entidade_pdf'], 'questionario_id': dados['questionario_id'],
                    'sha256_origem': sha, 'arquivo_origem': 'original.pdf', 'criado_em': agora(), 'criterios': criterios}
        salvar_json(pasta / 'contexto.json', contexto)
        estado_arquivo = pasta / 'estado.json'
        estado_anterior = ler_json(estado_arquivo) if estado_arquivo.exists() else {}
        salvo = pasta / 'capturas.json'
        retomar = self.opcoes.modo == 'importar' or self.opcoes.reutilizar
        pode_reusar = salvo.exists() and estado_anterior.get('coleta_concluida') and estado_anterior.get('sha256_origem') == sha
        if self.opcoes.modo == 'importar' and not pode_reusar:
            raise ValueError('Importação exige uma coleta concluída para este PDF. Primeiro gere o pacote de revisão.')
        salvar_json(estado_arquivo, {'sha256_origem': sha, 'coleta_concluida': False, 'etapa': 'coleta', 'iniciado_em': agora()})
        if retomar and pode_reusar:
            manifesto = ler_json(salvo)
            capturas, pendencias_coleta = manifesto['itens'], manifesto.get('pendencias', [])
            self.informar(60, 'Reaproveitando capturas da coleta anterior, com as datas originais')
        elif self.opcoes.capturar and criterios:
            anteriores = pasta / 'capturas'
            if anteriores.exists():
                arquivo_rodada = pasta / 'rodadas_anteriores' / agora().replace(':', '-')
                destino_rodada = arquivo_rodada / 'capturas'
                if not anteriores.resolve().is_relative_to(pasta.resolve()) or not destino_rodada.resolve().is_relative_to(pasta.resolve()):
                    raise ValueError('Pasta de arquivamento de capturas fora da execução.')
                arquivo_rodada.mkdir(parents=True, exist_ok=True)
                if salvo.exists():
                    shutil.copy2(salvo, arquivo_rodada / 'capturas.json')
                shutil.move(str(anteriores), str(destino_rodada))
            capturador = Capturador(pasta, self.opcoes, self.informar, self.verificar)
            capturas, pendencias_coleta = capturador.executar(plano, dados['reprovados'])
        else:
            capturas = {}
            pendencias_coleta = ['Captura do portal não executada nesta rodada.'] if criterios else []
        validar_capturas(pasta, capturas, criterios)
        for criterio in criterios:
            if not capturas.get(criterio['criterio_id']):
                pendencias_coleta.append(f'{criterio["criterio_id"]}: sem captura atual do portal.')
        contexto['pendencias_coleta'] = list(dict.fromkeys(pendencias_historico + pendencias_coleta))
        salvar_json(pasta / 'contexto.json', contexto)
        salvar_json(salvo, {'sha256_origem': sha, 'itens': capturas, 'pendencias': pendencias_coleta})
        salvar_json(estado_arquivo, {'sha256_origem': sha, 'coleta_concluida': True, 'etapa': 'revisao', 'coletado_em': agora()})
        self.verificar()
        self.informar(63, 'Coleta acumulada. Preparando a revisão dos textos')
        if self.opcoes.modo == 'ia':
            resposta = revisar(pasta, contexto, capturas, self.opcoes.modelo, self.informar, self.verificar)
        elif self.opcoes.modo == 'importar':
            if not self.opcoes.resposta:
                raise ValueError('Selecione o JSON da revisão a importar.')
            resposta = validar_resposta(ler_json(self.opcoes.resposta), contexto, capturas)
            salvar_json(pasta / 'resposta_ia.json', resposta)
        else:
            resposta = minutas(contexto)
        resolvidas = resposta.get('pendencias_resolvidas', {})
        pendencias = list(dict.fromkeys([p for p in contexto['pendencias_coleta'] if p not in resolvidas] + resposta.get('pendencias', [])))
        salvar_json(pasta / 'pendencias_resolvidas.json', resolvidas)
        if self.opcoes.modo == 'pacote' and not criterios:
            pendencias = []
        salvar_json(pasta / 'pendencias.json', pendencias)
        for itens in capturas.values():
            for item in itens:
                item['observacao'] = resposta.get('observacoes_capturas', {}).get(item['id'], item['observacao'])
        salvar_json(pasta / 'capturas_pdf.json', {'itens': capturas})
        salvar_json(pasta / 'resumos_pdf.json', resposta)
        modelo_resposta = minutas(contexto)
        modelo_resposta['pendencias'] = ['Preencha os comentários após examinar todas as evidências.']
        salvar_json(pasta / 'modelo_resposta.json', modelo_resposta)
        dados['_arquivo_resumos'] = pasta / 'resumos_pdf.json'
        dados['_arquivo_capturas'] = pasta / 'capturas_pdf.json'
        dados['_pasta_capturas'] = pasta
        dados['_permitir_capturas_ausentes'] = True
        if pendencias:
            dados['_aviso_editorial'] = 'PNTP 2026 | RASCUNHO - REVISÃO PENDENTE'
        self.verificar()
        self.informar(87, 'Gerando o PDF com identidade visual, histórico e sumário')
        gerado = pasta / 'gerado'
        gerador.gerar_documentos([dados], destino=gerado)
        caminho = gerado / arquivo.name
        self.informar(94, 'Conferindo páginas, links e imagens do PDF')
        conferencia = conferir_pdf(caminho, dados, gerador, pasta)
        self.verificar()
        if hashlib.sha256(arquivo.read_bytes()).hexdigest() != sha:
            raise ValueError('O documento de origem mudou durante a execução. A saída não foi publicada.')
        self.opcoes.destino.mkdir(parents=True, exist_ok=True)
        destino = self.opcoes.destino / arquivo.name
        if destino.resolve() == arquivo.resolve():
            raise ValueError('A saída não pode substituir o PDF original.')
        # Um rascunho não substitui silenciosamente um exemplo já concluído.
        if pendencias:
            destino = destino.with_name(destino.stem + '_rascunho.pdf')
        if destino.exists():
            anteriores = pasta / 'versoes_anteriores'
            anteriores.mkdir(exist_ok=True)
            shutil.copy2(destino, anteriores / (agora().replace(':', '-') + '-' + destino.name))
        temporario = destino.with_suffix('.novo.pdf')
        shutil.copy2(caminho, temporario)
        temporario.replace(destino)
        resultado = {'arquivo': str(destino), 'pacote': str(pasta), 'rascunho': bool(pendencias),
                     'pendencias': pendencias, **conferencia}
        salvar_json(pasta / 'resultado.json', resultado)
        salvar_json(estado_arquivo, {'sha256_origem': sha, 'coleta_concluida': True, 'etapa': 'concluido', 'concluido_em': agora(), 'resultado': resultado})
        self.informar(100, 'Rascunho e pacote de revisão prontos' if pendencias else 'Relatório concluído')
        return resultado
