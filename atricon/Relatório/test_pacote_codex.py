"""Confere limpeza dos auxiliares e importação usando somente PDF e prompt."""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from ambiente import salvar_json
from motor import Cancelado, Opcoes, Processo
from pacote_codex import gerar_prompt, identificar_pdf, ler_dados_prompt, restaurar_capturas


class TestePacoteCodex(unittest.TestCase):
    def test_prompt_recupera_imagem_do_pdf_sem_arquivos_auxiliares(self):
        import pymupdf
        from PIL import Image
        with tempfile.TemporaryDirectory() as diretorio:
            raiz = Path(diretorio)
            saida = raiz / 'saida'
            saida.mkdir()
            original = raiz / "PDF d'Exemplo.pdf"
            with pymupdf.open() as doc:
                doc.new_page().insert_text((40, 40), 'Documento original de teste')
                doc.save(original)
            sha = identificar_pdf(original)[0]
            pdf = saida / 'relatorio.pdf'
            captura = {'id': '8.6-atual-001', 'arquivo': 'foto.png', 'recorte': [0, 0, 60, 40],
                       'url': 'https://portal.gov.br', 'titulo': 'Portal', 'observacao': 'Captura de teste.',
                       'capturado_em': '13/11/2026 12:00', 'texto_arquivo': 'foto.json'}
            with tempfile.TemporaryDirectory(dir=raiz) as trabalho:
                pasta = Path(trabalho)
                Image.new('RGB', (60, 40), '#2563eb').save(pasta / 'foto.png')
                salvar_json(pasta / 'foto.json', {'texto': 'Texto integral observado.'})
                with pymupdf.open() as doc:
                    pagina = doc.new_page()
                    pagina.insert_image(pymupdf.Rect(40, 50, 340, 250), filename=str(pasta / 'foto.png'))
                    doc.save(pdf)
                contexto = {'entidade': 'Órgão de teste', 'sha256_origem': sha,
                            'criterios': [{'criterio_id': '8.6', 'historico_imagens': []}], 'pendencias_coleta': []}
                modelo = {'sha256_origem': sha, 'explicacoes': {'8.6': ''}, 'pendencias': ['Revisar']}
                gerado = gerar_prompt(pasta, contexto, original, saida, raiz / 'execucoes', pdf=pdf,
                                     pdf_publicado=pdf, capturas={'8.6': [captura]}, modelo=modelo,
                                     posicoes=[{'criterio': '8.6', 'arquivo': 'foto.png', 'pagina_destino': 1,
                                                'destino': [40, 50, 340, 250]}])
                prompt = saida / 'relatorio_PROMPT_CODEX.md'
                shutil.copy2(gerado, prompt)
            self.assertEqual({p.name for p in saida.iterdir()}, {'relatorio.pdf', 'relatorio_PROMPT_CODEX.md'})
            dados = ler_dados_prompt(prompt, sha)
            self.assertEqual(dados['textos_capturas'][captura['id']]['texto'], 'Texto integral observado.')
            self.assertIn("PDF d''Exemplo.pdf", prompt.read_text(encoding='utf-8'))
            with self.assertRaises(ValueError):
                ler_dados_prompt(prompt, 'outro-pdf')
            with tempfile.TemporaryDirectory(dir=raiz) as restauracao:
                pasta = Path(restauracao)
                capturas = restaurar_capturas(dados, pasta)
                item = capturas['8.6'][0]
                with Image.open(pasta / item['arquivo']) as imagem:
                    self.assertEqual(imagem.convert('RGB').getpixel((10, 10)), (37, 99, 235))
                self.assertEqual(item['capturado_em'], captura['capturado_em'])
            pdf.write_bytes(pdf.read_bytes() + b'\nmodificado')
            with self.assertRaisesRegex(ValueError, 'alterado'):
                ler_dados_prompt(prompt, sha)

    def test_limpeza_em_sucesso_erro_e_cancelamento_preserva_entradas(self):
        for erro in (None, RuntimeError('Falha de teste'), Cancelado('Cancelado')):
            with self.subTest(erro=erro), tempfile.TemporaryDirectory() as diretorio:
                raiz = Path(diretorio)
                original = raiz / 'original.pdf'
                original.write_bytes(b'%PDF-1.4 teste')
                execucoes = raiz / 'execucoes'
                execucoes.mkdir()
                sentinela = execucoes / 'arquivo_preexistente.txt'
                sentinela.write_text('Preservar', encoding='utf-8')
                processo = Processo(Opcoes(arquivo=original, execucoes=execucoes), lambda *args: None)

                def processar(arquivo, sha, pasta, gerador):
                    self.assertTrue(pasta.resolve().is_relative_to(execucoes.resolve()))
                    (pasta / 'imagens').mkdir()
                    (pasta / 'imagens/tela.png').write_bytes(b'imagem')
                    salvar_json(pasta / 'contexto.json', {'teste': True})
                    if erro:
                        raise erro
                    return {'arquivo': 'resultado.pdf'}

                with patch.dict(sys.modules, {'gerar_pdfs_barco': SimpleNamespace()}), patch.object(processo, 'processar', side_effect=processar):
                    if erro:
                        with self.assertRaises(type(erro)):
                            processo.executar()
                    else:
                        processo.executar()
                self.assertEqual(list(execucoes.iterdir()), [sentinela])
                self.assertTrue(original.is_file())
                self.assertIsNone(processo.pasta)

    def test_modo_api_nao_pode_iniciar_processamento(self):
        with patch('revisao_ia.requisitar') as requisitar:
            with self.assertRaisesRegex(ValueError, 'modo codex'):
                Processo(Opcoes(modo='ia'), lambda *args: None).executar()
            requisitar.assert_not_called()


if __name__ == '__main__':
    unittest.main()
