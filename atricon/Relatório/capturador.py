"""Captura evidências públicas com Playwright e preserva o que foi observado."""
from __future__ import annotations

import hashlib
import ipaddress
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

from ambiente import agora, salvar_json


def url_publica(url: str) -> bool:
    """Aceita somente HTTP público; rejeita arquivos locais e endereços privados."""
    try:
        partes = urlsplit(url)
        host = (partes.hostname or '').lower()
        if partes.scheme not in {'http', 'https'} or not host or partes.username or partes.password:
            return False
        if host in {'localhost', 'metadata.google.internal'} or host.endswith(('.local', '.internal')):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return '.' in host
    except ValueError:
        return False


def aguardar_componentes(pagina: Any, segundos: int) -> dict[str, Any]:
    """Espera rede, fontes, imagens e indicadores de carregamento com prazo finito."""
    from playwright.sync_api import TimeoutError as Prazo
    avisos = []
    avisos_rede = []
    try:
        pagina.wait_for_load_state('domcontentloaded', timeout=segundos * 1000)
        pagina.wait_for_load_state('networkidle', timeout=min(segundos * 1000, 12000))
    except Prazo:
        avisos_rede.append('A rede não ficou ociosa; isso pode decorrer de conexões contínuas do portal.')
    try:
        pagina.wait_for_function("""() => document.readyState === 'complete' &&
          [...document.images].every(i => i.complete) &&
          ![...document.querySelectorAll('[aria-busy="true"],.p-skeleton,.p-datatable-loading-overlay,.p-progressspinner')]
          .some(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')""",
          timeout=segundos * 1000)
        pagina.evaluate('document.fonts.ready.then(() => true)')
    except Prazo:
        avisos.append('Ainda havia componente/imagem em carregamento no prazo configurado.')
    pagina.wait_for_timeout(700)
    texto = pagina.locator('body').inner_text(timeout=10000)
    erros = re.findall(r'.{0,60}(?:erro ao processar[^\n]*|não foi possível carregar[^\n]*|acesso negado[^\n]*).{0,80}', texto, re.I)
    return {'avisos': avisos, 'avisos_rede': avisos_rede, 'erros_visiveis': erros, 'texto': texto}


def selecionar_documentos(pagina: Any, criterio: dict, limite: int) -> list[dict]:
    """Prioriza linhas relevantes, declarações e anos, sem escolher pelo título apenas."""
    candidatos = pagina.locator('a,button,[role="button"]').evaluate_all("""els => els.map((e,i) => ({
      indice:i, texto:(e.innerText || e.getAttribute('aria-label') || e.title || '').trim(),
      linha:(e.closest('tr')?.innerText || e.parentElement?.innerText || '').slice(0,1500),
      href:e.tagName === 'A' ? e.href : '', visivel:!!e.getClientRects().length
    })).filter(e => e.visivel)""")
    palavras = set(re.findall(r'[a-zá-ú]{5,}', criterio['criterio'].lower()))
    resultado = []
    for item in candidatos:
        if not re.fullmatch(r'(visualizar|detalhes?|abrir(?: documento)?|ver(?: detalhes)?|baixar(?: arquivo)?|download)', item['texto'], re.I):
            continue
        if item['href'] and not url_publica(item['href']):
            continue
        texto = (item['linha'] + ' ' + item['texto']).lower()
        if re.search(r'excluir|remover|editar|enviar|assinar|publicar|login', texto):
            continue
        item['pontos'] = sum(p in texto for p in palavras) * 3 + 5 * bool(re.search('declaração|inexistência', texto))
        resultado.append(item)
    if not resultado:
        # Nos portais Barco, a própria linha PrimeVue abre o detalhamento público.
        linhas = pagina.locator('.p-datatable-tbody > tr').evaluate_all("""els => els.map((e,i) => ({
          indice:i, texto:'Detalhes da linha', linha:e.innerText.trim(),
          consultavel:getComputedStyle(e).cursor === 'pointer' || e.tabIndex === 0,
          visivel:!!e.getClientRects().length
        })).filter(e => e.visivel && e.consultavel && e.linha.length > 20)""")
        for linha in linhas:
            linha['seletor'] = '.p-datatable-tbody > tr'
            linha['pontos'] = sum(p in linha['linha'].lower() for p in palavras) * 3
            resultado.append(linha)
    return sorted(resultado, key=lambda i: -i['pontos'])[:limite]


def descobrir_caminho_atual(pagina: Any, criterio: dict) -> str:
    """Sugere um caminho do próprio menu quando número ou enunciado o identificam."""
    original = urlsplit(pagina.url)
    palavras = set(re.findall(r'[a-zá-ú]{5,}', criterio['criterio'].lower())) - {'divulga', 'informações', 'respectivo', 'exercício', 'órgão'}
    candidatos = pagina.locator('a[href]').evaluate_all("els => els.map(e => ({url:e.href,texto:(e.innerText || e.title || '').trim()}))")
    resultado = []
    identificador = criterio['criterio_id']
    for item in candidatos:
        if item['url'] == pagina.url or not url_publica(item['url']) or urlsplit(item['url']).netloc != original.netloc:
            continue
        if '/transparencia/' not in item['url'].lower():
            continue
        texto = item['texto'].lower()
        pontos = sum(p in texto for p in palavras)
        if re.search(r'(?<!\d)' + re.escape(identificador) + r'(?!\d)', texto):
            pontos += 5
        if pontos >= 3:
            resultado.append((pontos, item['url']))
    return max(resultado, default=(0, ''), key=lambda i: i[0])[1]


class Capturador:
    """Mantém navegador separado e grava capturas, textos, PDFs e limitações reais."""

    def __init__(self, pasta: Path, opcoes: Any, informar: Callable, verificar_cancelamento: Callable) -> None:
        """Configura o destino; não inicia navegador ou consulta externa nesta etapa."""
        self.pasta = pasta
        self.opcoes = opcoes
        self.informar = informar
        self.verificar = verificar_cancelamento
        self.itens: dict[str, list[dict]] = {}
        self.pendencias: list[str] = []
        self.sequencia = 0
        self.cache: dict[str, list[dict]] = {}
        self.documentos_registrados: set[tuple[str, str]] = set()

    def registrar_tela(self, pagina: Any, criterio: str, titulo: str, observacao: str = '') -> dict:
        """Fotografa o estado real e salva o texto da mesma tela, com data e URL."""
        self.verificar()
        from PIL import Image
        self.sequencia += 1
        nome = f'{criterio}-atual-{self.sequencia:03d}'
        arquivo = self.pasta / 'capturas' / f'{nome}.png'
        arquivo.parent.mkdir(parents=True, exist_ok=True)
        consulta = aguardar_componentes(pagina, self.opcoes.espera)
        data = agora()
        # Telas muito longas são registradas por viewport; o texto integral fica no pacote.
        pagina.screenshot(path=str(arquivo), full_page=False, animations='disabled')
        salvar_json(arquivo.with_suffix('.json'), {'url': pagina.url, 'capturado_em_iso': data, **consulta})
        with Image.open(arquivo) as imagem:
            recorte = [0, 0, imagem.width, imagem.height]
        item = {'id': nome, 'arquivo': arquivo.relative_to(self.pasta).as_posix(), 'recorte': recorte,
                'url': pagina.url, 'titulo': titulo, 'capturado_em': datetime.fromisoformat(data).strftime('%d/%m/%Y %H:%M'),
                'capturado_em_iso': data, 'observacao': observacao or 'Estado da página no momento da captura.',
                'texto_arquivo': arquivo.with_suffix('.json').relative_to(self.pasta).as_posix(),
                'avisos': consulta['avisos'], 'erros_visiveis': consulta['erros_visiveis']}
        self.itens.setdefault(criterio, []).append(item)
        for aviso in consulta['avisos']:
            self.pendencias.append(f'{criterio}: {aviso}')
        return item

    def registrar_pdf(self, conteudo: bytes, url: str, criterio: str, titulo: str) -> None:
        """Renderiza o PDF baixado e guarda todo o texto; não simula uma tela do site."""
        import pymupdf
        if not conteudo.startswith(b'%PDF-'):
            return
        self.verificar()
        chave = hashlib.sha256(conteudo).hexdigest()[:12]
        if (criterio, chave) in self.documentos_registrados:
            return
        self.documentos_registrados.add((criterio, chave))
        pasta = self.pasta / 'capturas'
        pasta.mkdir(parents=True, exist_ok=True)
        arquivo = pasta / f'{criterio}-documento-{chave}.pdf'
        arquivo.write_bytes(conteudo)
        data = agora()
        with pymupdf.open(stream=conteudo, filetype='pdf') as documento:
            textos = [p.get_text() for p in documento]
            salvar_json(arquivo.with_suffix('.json'), {'url': url, 'capturado_em_iso': data, 'paginas': len(documento), 'textos': textos})
            paginas = list(range(min(len(documento), self.opcoes.paginas_documento)))
            if len(documento) > self.opcoes.paginas_documento:
                paginas[-1] = len(documento) - 1
                self.pendencias.append(f'{criterio}: PDF com {len(documento)} páginas: imagens de {len(paginas)} páginas; texto integral no pacote.')
            for numero in paginas:
                self.sequencia += 1
                nome = f'{criterio}-documento-{self.sequencia:03d}'
                imagem = pasta / f'{nome}.png'
                mapa = documento[numero].get_pixmap(matrix=pymupdf.Matrix(1.7, 1.7), alpha=False)
                mapa.save(imagem)
                self.itens.setdefault(criterio, []).append({
                    'id': nome, 'arquivo': imagem.relative_to(self.pasta).as_posix(), 'recorte': [0, 0, mapa.width, mapa.height],
                    'titulo': f'{titulo} - página {numero + 1} de {len(documento)}', 'url': url,
                    'capturado_em': datetime.fromisoformat(data).strftime('%d/%m/%Y %H:%M'), 'capturado_em_iso': data,
                    'observacao': 'Página renderizada do documento público efetivamente aberto nesta consulta.',
                    'texto_arquivo': arquivo.with_suffix('.json').relative_to(self.pasta).as_posix(),
                    'documento_arquivo': arquivo.relative_to(self.pasta).as_posix(), 'avisos': [], 'erros_visiveis': []})

    def abrir_documento(self, contexto: Any, pagina: Any, candidato: dict, criterio: str) -> None:
        """Abre somente controles de consulta; acompanha modal, nova aba ou download."""
        self.verificar()
        respostas: list[Any] = []
        downloads: list[Any] = []
        abas_antes = set(contexto.pages)
        url_antes = pagina.url

        def receber(resposta: Any) -> None:
            """Retém somente respostas PDF desta ação de leitura."""
            if 'application/pdf' in resposta.headers.get('content-type', ''):
                respostas.append(resposta)

        def baixar(download: Any) -> None:
            """Registra downloads gerados pelo botão consultado."""
            downloads.append(download)

        contexto.on('response', receber)
        pagina.on('download', baixar)
        titulo = candidato['linha'].replace('\n', ' ')[:180] or candidato['texto']
        try:
            pagina.locator(candidato.get('seletor', 'a,button,[role="button"]')).nth(candidato['indice']).click(timeout=10000)
            pagina.wait_for_timeout(1500)
            novas = [p for p in contexto.pages if p not in abas_antes]
            alvo = novas[-1] if novas else pagina
            if not alvo.is_closed() and url_publica(alvo.url):
                try:
                    self.registrar_tela(alvo, criterio, 'Documento/detalhe consultado', titulo)
                    abas = alvo.get_by_role('tab').all_text_contents()
                    nomes = [n.strip() for n in abas if re.search(r'document|anexo|gerais|detalh', n, re.I)][:3]
                    for nome in nomes:
                        self.verificar()
                        alvo.get_by_role('tab', name=nome, exact=True).click(timeout=8000)
                        self.registrar_tela(alvo, criterio, f'Detalhe: {nome}', titulo)
                except Exception:
                    self.verificar()
            for download in downloads[:2]:
                temporario = self.pasta / 'capturas' / 'download-temporario.bin'
                download.save_as(str(temporario))
                conteudo = temporario.read_bytes()
                origem = download.url if url_publica(download.url) else pagina.url
                if conteudo.startswith(b'%PDF-'):
                    self.registrar_pdf(conteudo, origem, criterio, titulo)
                    temporario.unlink(missing_ok=True)
                else:
                    sufixo = Path(download.suggested_filename).suffix.lower()
                    if sufixo not in {'.xlsx', '.xls', '.csv', '.docx', '.doc', '.txt', '.zip'}:
                        sufixo = '.bin'
                    arquivo = temporario.with_name(f'{criterio}-anexo-{hashlib.sha256(conteudo).hexdigest()[:12]}{sufixo}')
                    temporario.replace(arquivo)
                    self.pendencias.append(f'{criterio}: anexo {arquivo.name} foi baixado e preservado, mas o formato {sufixo} exige análise manual do conteúdo.')
            for resposta in respostas[:2]:
                try:
                    conteudo = resposta.body()
                except Exception:
                    # Chromium pode consumir o corpo no visualizador; consultar a mesma URL recupera o arquivo.
                    if not url_publica(resposta.url):
                        continue
                    nova_resposta = contexto.request.get(resposta.url, timeout=45000)
                    if not nova_resposta.ok:
                        if not downloads:
                            self.pendencias.append(f'{criterio}: documento retornou HTTP {nova_resposta.status}.')
                        continue
                    conteudo = nova_resposta.body()
                self.registrar_pdf(conteudo, resposta.url, criterio, titulo)
            if not respostas and not downloads and novas:
                # O visualizador pode apontar diretamente para um PDF sem expor o corpo.
                if re.search(r'\.pdf(?:[?#]|$)', alvo.url, re.I):
                    resposta = contexto.request.get(alvo.url, timeout=45000)
                    if resposta.ok:
                        self.registrar_pdf(resposta.body(), alvo.url, criterio, titulo)
        except Exception as erro:
            self.verificar()
            self.pendencias.append(f'{criterio}: não foi possível concluir a abertura de {titulo[:90]} ({type(erro).__name__}).')
        finally:
            contexto.remove_listener('response', receber)
            pagina.remove_listener('download', baixar)
            for aba in list(contexto.pages):
                if aba not in abas_antes:
                    aba.close()
            if not pagina.is_closed():
                if pagina.url != url_antes:
                    pagina.goto(url_antes, wait_until='domcontentloaded', timeout=45000)
                    aguardar_componentes(pagina, self.opcoes.espera)
                else:
                    pagina.keyboard.press('Escape')
                    fechar = pagina.locator('[aria-label="Close"], [aria-label="Fechar"],button.p-dialog-header-close')
                    if fechar.count() and fechar.first.is_visible():
                        fechar.first.click(timeout=3000)

    def executar_acoes(self, pagina: Any, acoes: list[dict], criterio: str) -> None:
        """Executa testes opcionais de filtro descritos no plano; proíbe ações de escrita."""
        for acao in acoes:
            self.verificar()
            papel = acao.get('papel', '')
            nome = acao.get('nome', '')
            if re.search(r'excluir|remover|editar|enviar|salvar|assinar|publicar|login', nome, re.I):
                raise ValueError('O plano contém um comando de alteração, não de consulta.')
            tipo = acao.get('tipo')
            if tipo == 'selecionar_ano':
                campo = pagina.get_by_label(nome, exact=True)
                campo.select_option(label=str(acao['valor']), timeout=10000)
            elif tipo == 'clicar' and papel in {'button', 'link', 'option', 'combobox'}:
                pagina.get_by_role(papel, name=nome, exact=True).click(timeout=10000)
            else:
                raise ValueError(f'Ação de consulta não reconhecida: {tipo}')
            aguardar_componentes(pagina, self.opcoes.espera)
            self.registrar_tela(pagina, criterio, acao.get('titulo') or f'Consulta: {nome}', 'Resultado da ação de consulta registrada no plano.')

    def testar_anos(self, pagina: Any, criterio: dict) -> None:
        """Testa até quatro exercícios quando o ano e o botão de filtro são reconhecíveis."""
        falhas = ' '.join(criterio.get('falhas', []))
        if not re.search('histórica|históric|atualidade|filtros', falhas, re.I):
            return
        identificador = criterio['criterio_id']
        campos = pagina.get_by_role('combobox')
        campo = None
        for indice in range(campos.count()):
            candidato = campos.nth(indice)
            nome = ' '.join(filter(None, [candidato.get_attribute('aria-label'), candidato.get_attribute('id'), candidato.get_attribute('name')]))
            if re.search('ano|exerc[ií]cio', nome, re.I) and candidato.is_visible():
                campo = candidato
                break
        if campo is None:
            return
        filtrar = pagina.get_by_role('button', name=re.compile(r'^(Filtrar|Pesquisar|Consultar)$', re.I))
        if not filtrar.count():
            return
        nativo = campo.evaluate('e => e.tagName === "SELECT"')
        if nativo:
            anos = campo.locator('option').all_text_contents()
        else:
            campo.click(timeout=5000)
            anos = pagina.get_by_role('option').all_text_contents()
            pagina.keyboard.press('Escape')
        anos = sorted({a.strip() for a in anos if re.fullmatch(r'20\d{2}', a.strip())}, reverse=True)[:4]
        for ano in anos:
            self.verificar()
            if nativo:
                campo.select_option(label=ano, timeout=5000)
            else:
                campo.click(timeout=5000)
                pagina.get_by_role('option', name=ano, exact=True).click(timeout=5000)
            filtrar.first.click(timeout=5000)
            self.registrar_tela(pagina, identificador, f'Consulta por exercício: {ano}', f'Resultado observado após selecionar {ano} e aplicar o filtro. A imagem não comprova disponibilidade na época da revisão.')

    def executar(self, plano: dict, criterios: list[dict]) -> tuple[dict, list[str]]:
        """Percorre critérios sequencialmente e persiste cada captura antes da próxima."""
        from playwright.sync_api import sync_playwright
        self.pasta.mkdir(parents=True, exist_ok=True)
        with sync_playwright() as navegador:
            browser = navegador.chromium.launch(headless=not self.opcoes.navegador_visivel)
            contexto = browser.new_context(viewport={'width': 1600, 'height': 1050}, locale='pt-BR', timezone_id='America/Sao_Paulo', accept_downloads=True)
            contexto.on('dialog', lambda dialogo: dialogo.dismiss())
            try:
                for indice, criterio in enumerate(criterios):
                    self.verificar()
                    identificador = criterio['criterio_id']
                    self.informar(20 + 40 * indice / max(1, len(criterios)), f'Capturando páginas e documentos - critério {identificador}')
                    urls = plano.get(identificador, {}).get('urls', [])[:self.opcoes.links_criterio]
                    if not urls:
                        self.pendencias.append(f'{identificador}: nenhum endereço público encontrado no PDF. Informe a URL no plano de capturas.')
                    for url in urls:
                        if not url_publica(url):
                            self.pendencias.append(f'{identificador}: endereço não público ignorado.')
                            continue
                        # Deduplica consultas iguais neste mesmo processamento, mantendo o horário real.
                        if url in self.cache and not plano.get(identificador, {}).get('acoes'):
                            self.itens.setdefault(identificador, []).extend([dict(item, id=f'{identificador}-reuso-{i}') for i, item in enumerate(self.cache[url])])
                            continue
                        pagina = contexto.new_page()
                        inicio = len(self.itens.get(identificador, []))
                        try:
                            if re.search(r'\.pdf(?:[?#]|$)', url, re.I):
                                resposta_pdf = contexto.request.get(url, timeout=60000)
                                if resposta_pdf.ok and resposta_pdf.body().startswith(b'%PDF-'):
                                    self.registrar_pdf(resposta_pdf.body(), url, identificador, 'Documento indicado na evidência')
                                    self.cache[url] = self.itens.get(identificador, [])[inicio:]
                                    continue
                            resposta = pagina.goto(url, wait_until='domcontentloaded', timeout=60000)
                            if resposta and 'application/pdf' in resposta.headers.get('content-type', ''):
                                self.registrar_pdf(resposta.body(), resposta.url, identificador, 'Documento indicado na evidência')
                            else:
                                self.registrar_tela(pagina, identificador, 'Página atual do portal')
                                if resposta and resposta.status >= 400:
                                    self.pendencias.append(f'{identificador}: página retornou HTTP {resposta.status}: {url}')
                                candidato_atual = descobrir_caminho_atual(pagina, criterio)
                                if candidato_atual and not pagina.get_by_role('button', name=re.compile('visualizar|detalhes', re.I)).count():
                                    pagina.goto(candidato_atual, wait_until='domcontentloaded', timeout=60000)
                                    self.registrar_tela(pagina, identificador, 'Caminho atual identificado no menu', 'Consulta adicional por um link real do menu relacionado ao critério; não comprova qual caminho foi acessado na revisão.')
                                self.executar_acoes(pagina, plano.get(identificador, {}).get('acoes', []), identificador)
                                candidatos = selecionar_documentos(pagina, criterio, self.opcoes.documentos_pagina)
                                for candidato in candidatos:
                                    self.abrir_documento(contexto, pagina, candidato, identificador)
                                if not plano.get(identificador, {}).get('acoes'):
                                    try:
                                        self.testar_anos(pagina, criterio)
                                    except Exception as erro:
                                        self.verificar()
                                        self.pendencias.append(f'{identificador}: não foi possível concluir o teste automático dos anos ({type(erro).__name__}).')
                            self.cache[url] = self.itens.get(identificador, [])[inicio:]
                        except Exception as erro:
                            self.verificar()
                            # Um erro de navegação nunca vira prova de inexistência de arquivo.
                            self.pendencias.append(f'{identificador}: falha de consulta ({type(erro).__name__}): {url}')
                            if not pagina.is_closed() and pagina.url.startswith('http'):
                                try:
                                    self.registrar_tela(pagina, identificador, 'Consulta com limitação de acesso')
                                except Exception:
                                    pass
                        finally:
                            pagina.close()
                            salvar_json(self.pasta / 'capturas.json', {'itens': self.itens, 'pendencias': self.pendencias})
            finally:
                browser.close()
        return self.itens, self.pendencias
