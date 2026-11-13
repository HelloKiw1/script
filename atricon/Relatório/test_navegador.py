"""Integração real com Chromium em um portal local controlado, sem IA paga."""
from __future__ import annotations

import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from ambiente import ler_json
from capturador import Capturador, url_publica
from motor import Opcoes


@unittest.skipUnless(os.environ.get('BARCO_TESTAR_NAVEGADOR') == '1', 'Defina BARCO_TESTAR_NAVEGADOR=1 para o teste local de navegador.')
class TesteNavegador(unittest.TestCase):
    """Verifica carregamento, modal, download, documento e filtro efetivamente capturados."""

    def test_capturas_e_documentos(self) -> None:
        """Abre um portal de teste e inspeciona os arquivos reais produzidos pelo motor."""
        import pymupdf
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((50, 80), 'DECLARACAO DE INEXISTENCIA - exercicio 2026')
            pdf.new_page().insert_text((50, 80), 'Responsavel do orgao - 01/07/2026')
            conteudo_pdf = pdf.tobytes()
        html = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Portal de teste</title>
          <style>body{font-family:Arial;padding:32px}table{margin:24px;border-collapse:collapse}td{padding:20px}dialog{width:70%;height:70%}</style>
          <h1>Portal da transparência - Plano de Contratações Anual</h1>
          <label for="ano">Ano</label><select id="ano" aria-label="Ano"><option>2026</option><option>2025</option></select>
          <button onclick="document.querySelector('#resultado').textContent='Consulta aplicada: '+document.querySelector('#ano').value">Filtrar</button>
          <p id="resultado">Consulta inicial</p><table><tr><td>Declaração PCA 2026</td><td>
          <button onclick="document.querySelector('dialog').showModal();document.querySelector('iframe').src='/documento.pdf'">Visualizar</button>
          <a href="/documento.pdf" download>Baixar</a></td></tr></table>
          <dialog><button onclick="document.querySelector('dialog').close()">Fechar</button><h2>Documento aberto</h2><iframe style="width:100%;height:80%"></iframe></dialog></html>'''

        class Servidor(BaseHTTPRequestHandler):
            """Fornece apenas HTML e o PDF de teste, com GET público local."""

            def do_GET(self) -> None:
                """Responde à consulta sem modificar qualquer serviço externo."""
                dados = conteudo_pdf if self.path.startswith('/documento.pdf') else html.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/pdf' if self.path.startswith('/documento.pdf') else 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)

            def log_message(self, *args: object) -> None:
                """Mantém o teste silencioso, sem registros de acesso desnecessários."""

        servidor = ThreadingHTTPServer(('127.0.0.1', 0), Servidor)
        thread = threading.Thread(target=servidor.serve_forever, daemon=True)
        thread.start()
        endereco = f'http://127.0.0.1:{servidor.server_port}'
        try:
            with tempfile.TemporaryDirectory() as diretorio, patch('capturador.url_publica', side_effect=lambda u: u.startswith(endereco) or url_publica(u)):
                pasta = Path(diretorio)
                capturador = Capturador(pasta, Opcoes(espera=5), lambda *a: None, lambda: None)
                itens, pendencias = capturador.executar({'8.6': {'urls': [endereco], 'acoes': []}}, [
                    {'criterio_id': '8.6', 'criterio': '8.6 Divulga o Plano de Contratações Anual?', 'falhas': ['Série Histórica']}])
                self.assertFalse(pendencias, pendencias)
                self.assertGreaterEqual(len(itens['8.6']), 6)
                self.assertEqual(len([i for i in itens['8.6'] if 'documento_arquivo' in i]), 2)
                self.assertTrue(any('2025' in i['titulo'] for i in itens['8.6']))
                textos = [ler_json(pasta / i['texto_arquivo']) for i in itens['8.6']]
                self.assertTrue(any('Consulta aplicada: 2025' in t.get('texto', '') for t in textos))
                self.assertTrue(any('DECLARACAO DE INEXISTENCIA' in ' '.join(t.get('textos', [])) for t in textos))
                self.assertTrue(all((pasta / i['arquivo']).is_file() and i['capturado_em_iso'] for i in itens['8.6']))
        finally:
            servidor.shutdown()
            servidor.server_close()


if __name__ == '__main__':
    unittest.main()
