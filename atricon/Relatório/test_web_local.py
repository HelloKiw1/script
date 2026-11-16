"""Testa a página local, sessão, envio e processamento sem acessar portais."""
import json
import tempfile
import threading
import sys
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest.mock import patch

from web_local import Aplicacao, Servidor, principal


class TestePaginaLocal(unittest.TestCase):
    def setUp(self):
        self.app = Aplicacao()
        self.servidor = Servidor(('127.0.0.1', 0), self.app)
        self.thread = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.servidor.server_port}'

    def tearDown(self):
        if self.app.thread:
            self.app.thread.join(timeout=5)
        self.servidor.shutdown()
        self.servidor.server_close()
        self.thread.join(timeout=5)

    def requisitar(self, caminho, corpo=None, headers=None, token=True):
        cabecalhos = {'X-Barco-Token': self.app.token} if token else {}
        cabecalhos.update(headers or {})
        if isinstance(corpo, dict):
            corpo = json.dumps(corpo).encode()
            cabecalhos['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.url + caminho, data=corpo, headers=cabecalhos)
        return urllib.request.urlopen(req, timeout=5)

    def test_html_e_ativos_locais(self):
        with self.requisitar('/', token=False) as r:
            html = r.read().decode()
            self.assertIn(self.app.token, html)
            self.assertNotIn('__LOCAL_TOKEN__', html)
            self.assertIn('Gerar PDF e prompt', html)
        for caminho in ('/app.css', '/app.js', '/logo.png'):
            with self.requisitar(caminho, token=False) as r:
                self.assertEqual(r.status, 200)
        with self.requisitar('/api/ping', token=False) as r:
            self.assertEqual(json.load(r)['aplicacao'], 'barco-relatorio-local')

    def test_api_rejeita_outra_origem_e_sessao_invalida(self):
        for kwargs in ({'token': False}, {'headers': {'Origin': 'https://outro-site.test'}},
                       {'headers': {'Host': 'outro-site.test'}}):
            with self.subTest(kwargs=kwargs), self.assertRaises(urllib.error.HTTPError) as erro:
                self.requisitar('/api/config', **kwargs)
            self.assertEqual(erro.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as erro:
            self.requisitar('/api/resultado/qualquer-arquivo')
        self.assertEqual(erro.exception.code, 404)

    def test_envio_e_execucao_na_pagina(self):
        with tempfile.TemporaryDirectory() as diretorio:
            raiz = Path(diretorio)
            saida, entrada = raiz / 'saida', raiz / 'entrada'
            saida.mkdir()

            class ProcessoLocal:
                def __init__(self, opcoes, registrar, cancelar):
                    self.opcoes, self.registrar = opcoes, registrar

                def executar(self):
                    assert self.opcoes.arquivo.is_file()
                    self.registrar(50, 'Gerando PDF de teste')
                    pdf, prompt = saida / 'teste.pdf', saida / 'teste_PROMPT_CODEX.md'
                    pdf.write_bytes(b'%PDF-1.4 teste')
                    prompt.write_text('Prompt de teste.', encoding='utf-8')
                    return {'arquivo': str(pdf), 'prompt': str(prompt), 'origem': str(self.opcoes.arquivo),
                            'pacote': str(saida), 'paginas': 1, 'pendencias': [], 'revisao_importada': False}

            with patch('web_local.ENTRADA', entrada), patch('web_local.dependencias_ausentes', return_value=[]), \
                    patch('web_local.Processo', ProcessoLocal):
                with self.requisitar('/api/arquivo?tipo=pdf&nome=original.pdf', b'%PDF-1.4 original') as r:
                    envio = json.load(r)
                with self.requisitar('/api/iniciar', {'tipo': 'gerar', 'origem': 'pdf', 'pdf_id': envio['id'], 'destino': str(saida)}) as r:
                    self.assertEqual(r.status, 202)
                self.app.thread.join(timeout=5)
                with self.requisitar('/api/status') as r:
                    estado = json.load(r)
                self.assertEqual(estado['situacao'], 'concluido')
                self.assertTrue(any('Gerando PDF' in linha for linha in estado['logs']))
                self.assertFalse(self.app.envios)
                self.assertEqual({p.suffix for p in saida.iterdir()}, {'.pdf', '.md'})
                with self.requisitar('/api/resultado/pdf') as r:
                    self.assertEqual(r.headers['Content-Type'], 'application/pdf')
                    self.assertTrue(r.read().startswith(b'%PDF-'))
                with self.requisitar('/api/prompt') as r:
                    self.assertEqual(json.load(r)['texto'], 'Prompt de teste.')
                # Enviar novamente o mesmo original não acumula cópias PDF.
                self.app.guardar_original({'nome': 'original.pdf', 'conteudo': b'%PDF-1.4 original'})
                self.assertEqual(len(list(entrada.iterdir())), 1)

    def test_validacao_e_cancelamento(self):
        with patch('web_local.dependencias_ausentes', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'Selecione o PDF'):
                self.app.iniciar({'tipo': 'gerar'})
        with self.assertRaisesRegex(ValueError, 'PDF válido'):
            self.app.enviar('pdf', 'arquivo.pdf', b'nao e pdf')
        self.app.estado.update(situacao='executando', tipo='gerar')
        self.app.pedir_cancelamento()
        self.assertTrue(self.app.cancelar.is_set())
        self.assertEqual(self.app.snapshot()['situacao'], 'cancelando')
        self.app.estado['situacao'] = 'cancelado'

    def test_reabrir_reutiliza_pagina_local_existente(self):
        with patch('web_local.webbrowser.open') as abrir, \
                patch('web_local.Servidor.serve_forever', side_effect=AssertionError('Não deve iniciar outro servidor.')):
            self.assertEqual(principal(['--porta', str(self.servidor.server_port)]), 0)
            abrir.assert_called_once_with(self.url + '/')

    def test_entrada_padrao_abre_html_em_vez_de_tkinter(self):
        from relatorio import principal as entrada
        with patch.object(sys, 'argv', ['relatorio.py']), patch('web_local.principal', return_value=0) as pagina:
            self.assertEqual(entrada(), 0)
            pagina.assert_called_once_with([])


if __name__ == '__main__':
    unittest.main()
