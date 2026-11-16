"""Página HTML local para gerar relatórios, com servidor restrito a este computador."""
from __future__ import annotations

import argparse
import hmac
import json
import os
import secrets
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from ambiente import ATRICON, ENTRADA, PASTA
from motor import Cancelado, Opcoes, Processo, listar_orgaos
from pacote_codex import identificar_pdf
from relatorio import dependencias_ausentes, instalar

MAX_ARQUIVO = 150 * 1024 * 1024
MAX_MEMORIA = 300 * 1024 * 1024
ESTATICOS = PASTA / 'web'


class Aplicacao:
    """Mantém a sessão em memória e executa somente um processamento por vez."""

    def __init__(self) -> None:
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.cancelar = threading.Event()
        self.thread: threading.Thread | None = None
        self.envios: dict[str, dict] = {}
        self.ultimo_resultado: dict = {}
        self.estado: dict = {'id': '', 'situacao': 'inativo', 'tipo': '', 'percentual': 0,
                             'etapa': '', 'logs': [], 'resultado': None}

    def ocupado(self) -> bool:
        return self.estado['situacao'] in {'executando', 'cancelando'}

    def registrar(self, percentual: float | None, mensagem: str) -> None:
        with self.lock:
            if percentual is not None:
                self.estado['percentual'] = max(0, min(100, percentual))
            if self.estado['situacao'] != 'cancelando':
                self.estado['etapa'] = mensagem
            self.estado['logs'].append(str(mensagem))
            self.estado['logs'] = self.estado['logs'][-800:]

    def snapshot(self) -> dict:
        with self.lock:
            return json.loads(json.dumps(self.estado))

    def enviar(self, tipo: str, nome: str, conteudo: bytes) -> dict:
        extensoes = {'pdf': '.pdf', 'prompt': '.md', 'resposta': '.json', 'cadastro': '.json'}
        nome = Path(nome.replace('\\', '/')).name
        if tipo not in extensoes or Path(nome).suffix.lower() != extensoes[tipo]:
            raise ValueError('Selecione um arquivo do tipo indicado.')
        if not conteudo or len(conteudo) > MAX_ARQUIVO:
            raise ValueError('O arquivo deve ter até 150 MB e não pode estar vazio.')
        if tipo == 'pdf' and not conteudo.startswith(b'%PDF-'):
            raise ValueError('O arquivo selecionado não é um PDF válido.')
        if tipo in {'cadastro', 'resposta'}:
            json.loads(conteudo.decode('utf-8-sig'))
        with self.lock:
            if self.ocupado():
                raise ValueError('Aguarde a execução atual antes de selecionar novos arquivos.')
            # Uma seleção substitui a anterior do mesmo tipo, sem acumular cópias.
            self.envios = {k: v for k, v in self.envios.items() if v['tipo'] != tipo}
            if sum(len(v['conteudo']) for v in self.envios.values()) + len(conteudo) > MAX_MEMORIA:
                raise ValueError('Os arquivos selecionados excedem o limite de memória da sessão.')
            identificador = secrets.token_urlsafe(18)
            self.envios[identificador] = {'tipo': tipo, 'nome': nome, 'conteudo': conteudo}
        return {'id': identificador, 'nome': nome, 'tamanho': len(conteudo)}

    def orgaos(self, cadastro_id: str = '') -> list[dict]:
        if not cadastro_id:
            try:
                return listar_orgaos(ATRICON / 'entrada/orgaos_avalia.json')
            except (OSError, ValueError):
                return []
        with self.lock:
            envio = self.envios.get(cadastro_id)
            if not envio or envio['tipo'] != 'cadastro':
                raise ValueError('Selecione novamente o cadastro.')
            dados = json.loads(envio['conteudo'].decode('utf-8-sig'))
        if isinstance(dados, dict):
            dados = [dados]
        if not isinstance(dados, list):
            raise ValueError('O cadastro deve conter uma lista de órgãos.')
        return [{'indice': i, 'rotulo': '{} - {}'.format(
            next((str(d[k]) for k in ('orgao', 'orgão', 'órgão') if d.get(k)), 'Órgão'), d.get('cidade') or '')}
            for i, d in enumerate(dados) if isinstance(d, dict)]

    def configuracao(self) -> dict:
        return {'ausentes': dependencias_ausentes(), 'destino': str(ENTRADA / 'barco'),
                'orgaos': self.orgaos(), 'pdfs': [p.name for p in sorted(ENTRADA.glob('*.pdf'))]}

    def iniciar(self, dados: dict) -> dict:
        tipo = dados.get('tipo', 'gerar')
        if tipo not in {'gerar', 'importar', 'instalar'}:
            raise ValueError('Operação inválida.')
        with self.lock:
            if self.ocupado():
                raise ValueError('Já há uma execução em andamento.')
            if tipo != 'instalar' and dependencias_ausentes():
                raise ValueError('Prepare o ambiente pelo botão Instalar dependências antes de gerar o relatório.')
            envios = dict(self.envios)
            if tipo != 'instalar':
                self.validar_entrada(dados, envios)
            self.cancelar.clear()
            self.estado = {'id': secrets.token_hex(8), 'situacao': 'executando', 'tipo': tipo,
                           'percentual': 0, 'etapa': 'Preparando a execução…', 'logs': [], 'resultado': None}
            self.thread = threading.Thread(target=self.executar, args=(tipo, dict(dados), envios), daemon=True)
            self.thread.start()
            return self.snapshot()

    def validar_entrada(self, dados: dict, envios: dict) -> None:
        if dados.get('tipo') == 'importar' and dados.get('usar_ultimo'):
            if not self.ultimo_resultado.get('origem') or not self.ultimo_resultado.get('prompt'):
                raise ValueError('Primeiro gere um relatório ou selecione o PDF original e o prompt.')
        elif dados.get('origem', 'pdf') == 'pdf' or dados.get('tipo') == 'importar':
            envio = envios.get(dados.get('pdf_id'))
            existente = dados.get('pdf_existente', '')
            if not envio and not existente:
                raise ValueError('Selecione o PDF original do Avalia.')
            if envio and envio['tipo'] != 'pdf':
                raise ValueError('PDF de entrada inválido.')
            if existente and (Path(existente).name != existente or not (ENTRADA / existente).is_file() or not existente.lower().endswith('.pdf')):
                raise ValueError('Selecione um PDF da lista de entrada.')
        else:
            orgaos = self.orgaos(dados.get('cadastro_id', ''))
            if not any(o['indice'] == dados.get('orgao_indice') for o in orgaos):
                raise ValueError('Selecione um órgão do cadastro.')
        if dados.get('tipo') == 'importar':
            for chave, tipo in (('resposta_id', 'resposta'), ('prompt_id', 'prompt')):
                if chave == 'prompt_id' and dados.get('usar_ultimo'):
                    continue
                if envios.get(dados.get(chave), {}).get('tipo') != tipo:
                    raise ValueError('Selecione o prompt e a resposta JSON preenchida pelo Codex.')
        espera, documentos = int(dados.get('espera', 25)), int(dados.get('documentos', 3))
        if not 5 <= espera <= 90 or not 0 <= documentos <= 10:
            raise ValueError('Use espera entre 5 e 90 segundos e de 0 a 10 documentos por página.')
        destino = str(dados.get('destino', '')).strip()
        if destino and not Path(destino).is_absolute():
            raise ValueError('Informe o caminho completo da pasta de saída.')

    @staticmethod
    def guardar_original(envio: dict) -> Path:
        """Conserva a entrada PDF para a revisão posterior, sem duplicar um original idêntico."""
        import hashlib
        ENTRADA.mkdir(parents=True, exist_ok=True)
        arquivo = ENTRADA / envio['nome']
        sha = hashlib.sha256(envio['conteudo']).hexdigest()
        if arquivo.exists() and identificar_pdf(arquivo)[0] != sha:
            arquivo = arquivo.with_name(arquivo.stem + '-' + sha[:12] + '.pdf')
        if not arquivo.exists():
            with arquivo.open('xb') as destino:
                destino.write(envio['conteudo'])
        return arquivo

    def executar(self, tipo: str, dados: dict, envios: dict) -> None:
        try:
            if tipo == 'instalar':
                instalar(lambda mensagem: self.registrar(None, mensagem))
                import importlib
                from ambiente import preparar_importacoes
                preparar_importacoes()
                importlib.invalidate_caches()
                resultado = None
                mensagem = 'Ambiente preparado. Você já pode gerar o relatório.'
            else:
                # Prompt, resposta e cadastro enviados não persistem no disco.
                with tempfile.TemporaryDirectory(prefix='barco-entrada-') as temporarios:
                    pasta = Path(temporarios)
                    def materializar(chave: str) -> Path:
                        envio = envios[dados[chave]]
                        caminho = pasta / (chave + Path(envio['nome']).suffix.lower())
                        caminho.write_bytes(envio['conteudo'])
                        return caminho
                    opcoes = Opcoes(destino=Path(dados.get('destino') or ENTRADA / 'barco'),
                                    navegador_visivel=bool(dados.get('visivel', False)),
                                    espera=int(dados.get('espera', 25)), documentos_pagina=int(dados.get('documentos', 3)),
                                    capturar=bool(dados.get('capturar', True)))
                    if tipo == 'importar' and dados.get('usar_ultimo'):
                        opcoes.arquivo = Path(self.ultimo_resultado['origem'])
                        opcoes.prompt = Path(self.ultimo_resultado['prompt'])
                    elif dados.get('origem', 'pdf') == 'pdf' or tipo == 'importar':
                        opcoes.arquivo = (self.guardar_original(envios[dados['pdf_id']]) if dados.get('pdf_id')
                                          else ENTRADA / dados['pdf_existente'])
                    else:
                        opcoes.conta_indice = dados['orgao_indice']
                        if dados.get('cadastro_id'):
                            opcoes.cadastro = materializar('cadastro_id')
                    if tipo == 'importar':
                        opcoes.modo = 'importar'
                        opcoes.resposta = materializar('resposta_id')
                        if not opcoes.prompt:
                            opcoes.prompt = materializar('prompt_id')
                    resultado = Processo(opcoes, self.registrar, self.cancelar).executar()
                mensagem = 'PDF e prompt prontos. Arquivos auxiliares removidos.'
            with self.lock:
                if resultado:
                    self.ultimo_resultado = resultado
                self.estado.update(situacao='concluido', percentual=100, etapa=mensagem, resultado=resultado)
        except Cancelado as erro:
            with self.lock:
                self.estado.update(situacao='cancelado', etapa=str(erro))
        except Exception as erro:
            mensagem = str(erro)
            if dados.get('origem') == 'orgao':
                mensagem = 'Não foi possível concluir a coleta deste órgão. Confira o cadastro, o acesso ao Avalia e a conexão.'
            self.registrar(None, mensagem)
            with self.lock:
                self.estado.update(situacao='erro', etapa=mensagem)
        finally:
            with self.lock:
                self.envios.clear()

    def pedir_cancelamento(self) -> None:
        with self.lock:
            if self.ocupado():
                if self.estado['tipo'] == 'instalar':
                    raise ValueError('Aguarde a instalação terminar antes de encerrar.')
                self.cancelar.set()
                self.estado.update(situacao='cancelando', etapa='Cancelando após a operação em andamento…')

    def caminho_resultado(self, tipo: str) -> Path:
        if tipo not in {'pdf', 'prompt', 'pasta'} or not self.ultimo_resultado:
            raise ValueError('Nenhum resultado disponível.')
        chave = {'pdf': 'arquivo', 'prompt': 'prompt', 'pasta': 'pacote'}[tipo]
        caminho = Path(self.ultimo_resultado[chave]).resolve()
        if not caminho.exists():
            raise ValueError('O arquivo foi movido ou removido da pasta de saída.')
        return caminho


class Servidor(ThreadingHTTPServer):
    daemon_threads = True
    # No Windows, SO_REUSEADDR pode permitir dois ouvintes na mesma porta.
    allow_reuse_address = os.name != 'nt'

    def __init__(self, endereco: tuple, app: Aplicacao | None = None) -> None:
        self.app = app or Aplicacao()
        super().__init__(endereco, Requisicao)


class Requisicao(BaseHTTPRequestHandler):
    server: Servidor

    def log_message(self, formato: str, *args: Any) -> None:
        pass

    def resposta(self, conteudo: bytes, tipo: str, status: int = 200, **cabecalhos: str) -> None:
        self.send_response(status)
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(len(conteudo)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for chave, valor in cabecalhos.items():
            self.send_header(chave.replace('_', '-'), valor)
        self.end_headers()
        self.wfile.write(conteudo)

    def json(self, dados: Any, status: int = 200) -> None:
        self.resposta(json.dumps(dados, ensure_ascii=False).encode(), 'application/json; charset=utf-8', status)

    def verificar(self, privado: bool = True) -> None:
        porta = self.server.server_port
        hosts = {f'127.0.0.1:{porta}', f'localhost:{porta}'}
        if self.headers.get('Host') not in hosts:
            raise PermissionError('Acesso restrito ao computador local.')
        origem = self.headers.get('Origin')
        if origem and origem not in {f'http://{h}' for h in hosts}:
            raise PermissionError('Origem da solicitação inválida.')
        consulta = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        token = self.headers.get('X-Barco-Token', '') or consulta.get('token', [''])[0]
        if privado and not hmac.compare_digest(token, self.server.app.token):
            raise PermissionError('Esta sessão expirou. Reabra a página pelo iniciar.bat.')

    def do_GET(self) -> None:
        try:
            url = urllib.parse.urlsplit(self.path)
            self.verificar(privado=url.path.startswith('/api/') and url.path != '/api/ping')
            app = self.server.app
            if url.path == '/api/ping':
                return self.json({'aplicacao': 'barco-relatorio-local', 'versao': 1})
            if url.path == '/api/config':
                return self.json(app.configuracao())
            if url.path == '/api/status':
                return self.json(app.snapshot())
            if url.path == '/api/orgaos':
                cadastro = urllib.parse.parse_qs(url.query).get('cadastro', [''])[0]
                return self.json({'orgaos': app.orgaos(cadastro)})
            if url.path == '/api/prompt':
                return self.json({'texto': app.caminho_resultado('prompt').read_text(encoding='utf-8')})
            if url.path in {'/api/resultado/pdf', '/api/resultado/prompt'}:
                tipo = url.path.rsplit('/', 1)[1]
                arquivo = app.caminho_resultado(tipo)
                mime = 'application/pdf' if tipo == 'pdf' else 'text/markdown; charset=utf-8'
                nome = urllib.parse.quote(arquivo.name)
                return self.resposta(arquivo.read_bytes(), mime,
                                     Content_Disposition=f"inline; filename*=UTF-8''{nome}")
            arquivos = {'/': ('index.html', 'text/html; charset=utf-8'),
                        '/app.css': ('app.css', 'text/css; charset=utf-8'),
                        '/app.js': ('app.js', 'application/javascript; charset=utf-8')}
            if url.path == '/logo.png':
                return self.resposta((ATRICON / 'assets/logo-da-empresa.png').read_bytes(), 'image/png')
            if url.path in arquivos:
                nome, mime = arquivos[url.path]
                conteudo = (ESTATICOS / nome).read_bytes()
                if url.path == '/':
                    conteudo = conteudo.replace(b'__LOCAL_TOKEN__', app.token.encode())
                return self.resposta(conteudo, mime)
            self.json({'erro': 'Página não encontrada.'}, 404)
        except PermissionError as erro:
            self.json({'erro': str(erro)}, 403)
        except (ValueError, OSError, KeyError) as erro:
            self.json({'erro': str(erro)}, 400)

    def do_POST(self) -> None:
        try:
            self.verificar()
            url = urllib.parse.urlsplit(self.path)
            limite = MAX_ARQUIVO if url.path == '/api/arquivo' else 64 * 1024
            tamanho = int(self.headers.get('Content-Length', '0'))
            if tamanho < 0 or tamanho > limite:
                return self.json({'erro': 'Arquivo ou solicitação acima do limite permitido.'}, 413)
            conteudo = self.rfile.read(tamanho)
            app = self.server.app
            if url.path == '/api/arquivo':
                params = urllib.parse.parse_qs(url.query)
                return self.json(app.enviar(params.get('tipo', [''])[0], params.get('nome', [''])[0], conteudo))
            dados = json.loads(conteudo or b'{}')
            if not isinstance(dados, dict):
                raise ValueError('Solicitação inválida.')
            if url.path == '/api/iniciar':
                return self.json(app.iniciar(dados), 202)
            if url.path == '/api/cancelar':
                app.pedir_cancelamento()
                return self.json(app.snapshot())
            if url.path == '/api/abrir-pasta':
                caminho = app.caminho_resultado('pasta')
                if os.name == 'nt':
                    os.startfile(str(caminho))
                return self.json({'ok': True})
            if url.path == '/api/encerrar':
                app.pedir_cancelamento()
                def encerrar() -> None:
                    if app.thread:
                        app.thread.join()
                    app.envios.clear()
                    self.server.shutdown()
                self.json({'ok': True})
                threading.Thread(target=encerrar, daemon=True).start()
                return
            self.json({'erro': 'Operação não encontrada.'}, 404)
        except PermissionError as erro:
            self.json({'erro': str(erro)}, 403)
        except (ValueError, OSError, KeyError, TypeError) as erro:
            self.json({'erro': str(erro)}, 400)


def principal(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--porta', type=int, default=8765)
    parser.add_argument('--nao-abrir', action='store_true')
    args = parser.parse_args(argv)
    try:
        servidor = Servidor(('127.0.0.1', args.porta))
    except OSError:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{args.porta}/api/ping', timeout=2) as resposta:
                existente = json.load(resposta)
            if existente.get('aplicacao') == 'barco-relatorio-local':
                if not args.nao_abrir:
                    webbrowser.open(f'http://127.0.0.1:{args.porta}/')
                return 0
        except (OSError, ValueError, urllib.error.URLError):
            pass
        servidor = Servidor(('127.0.0.1', 0))
    endereco = f'http://127.0.0.1:{servidor.server_port}/'
    if sys.stdout is not None:
        print('Relatórios Barco Digital: ' + endereco, flush=True)
    if not args.nao_abrir:
        webbrowser.open(endereco)
    try:
        servidor.serve_forever(poll_interval=.3)
    except KeyboardInterrupt:
        if servidor.app.ocupado() and servidor.app.estado['tipo'] != 'instalar':
            servidor.app.pedir_cancelamento()
        if servidor.app.thread:
            servidor.app.thread.join()
    finally:
        servidor.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(principal())
