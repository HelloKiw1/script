"""Teste de construção da interface, sem clicar em aplicativos ou consultar sites."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


@unittest.skipUnless(os.environ.get('BARCO_TESTAR_JANELA') == '1', 'Teste opcional de Tkinter instalado no Windows.')
class TesteJanela(unittest.TestCase):
    """Confere seleção, rodapé fixo e transição para a tela de progresso."""

    def atualizar_layout(self, raiz) -> None:
        """Processa geometria e pintura por um intervalo delimitado no Windows."""
        raiz.after(60, raiz.quit)
        raiz.mainloop()
        raiz.update_idletasks()

    def test_construcao_e_transicao(self) -> None:
        """Constrói widgets ocultos e exercita a fila sem iniciar trabalho real."""
        import tkinter as tk
        from relatorio import Janela
        raiz = tk.Tk()
        raiz.withdraw()
        try:
            janela = Janela(raiz)
            raiz.update_idletasks()
            self.assertTrue(janela.orgaos)
            self.assertEqual(janela.rodape.pack_info()['side'], 'bottom')
            self.assertTrue(janela.rolagem.find_all())
            self.assertEqual(janela.modo.get(), 'codex')
            self.assertFalse(hasattr(janela, 'modelo'))
            janela.fila.put(('progresso', 42, 'Capturando documentos'))
            janela.atualizar()
            self.assertEqual(janela.percentual.get(), '42%')
            self.assertEqual(janela.etapa.get(), 'Capturando documentos')
            janela.selecao.pack_forget()
            janela.progresso.pack(fill='both', expand=True)
            self.assertEqual(janela.selecao.winfo_manager(), '')
            self.assertEqual(janela.progresso.winfo_manager(), 'pack')
            janela.voltar()
            self.assertEqual(janela.selecao.winfo_manager(), 'pack')
        finally:
            for chamada in raiz.tk.call('after', 'info'):
                raiz.after_cancel(chamada)
            raiz.destroy()

    def test_layout_e_estados(self) -> None:
        """Confere dimensões reais, campos condicionais e ações em telas pequenas e grandes."""
        import tkinter as tk
        from relatorio import Janela

        raiz = tk.Tk()
        raiz.withdraw()
        orgaos = [{'rotulo': 'Câmara de teste', 'indice': 0}]
        try:
            with patch('relatorio.listar_orgaos', return_value=orgaos):
                janela = Janela(raiz)
            raiz.deiconify()
            for largura, altura in ((760, 580), (900, 700), (1180, 860), (1880, 960)):
                with self.subTest(largura=largura):
                    raiz.geometry(f'{largura}x{altura}+0+0')
                    self.atualizar_layout(raiz)
                    self.assertLessEqual(janela.corpo.winfo_width(), janela.u(1140))
                    self.assertTrue(janela.entrada_pdf.winfo_ismapped())
                    self.assertFalse(janela.entrada_orgao.winfo_ismapped())
                    self.assertEqual(janela.modo.get(), 'codex')
                    self.assertLessEqual(janela.rodape.winfo_rooty() + janela.rodape.winfo_height(),
                                         raiz.winfo_rooty() + raiz.winfo_height())
                    for botao in janela.rodape.winfo_children():
                        if botao.winfo_class() != 'TButton':
                            continue
                        self.assertGreaterEqual(botao.winfo_height(), janela.u(32))
                        self.assertGreaterEqual(botao.winfo_x(), 0)
                        self.assertLessEqual(botao.winfo_x() + botao.winfo_width(), janela.rodape.winfo_width())
                    self.assertEqual(janela.cartao_revisao.winfo_y(), 0)
                    self.assertEqual(janela.cartao_coleta.winfo_y() == 0, janela._duas_colunas)

                    janela.origem.set('orgao')
                    self.atualizar_layout(raiz)
                    self.assertTrue(janela.entrada_orgao.winfo_ismapped())
                    self.assertFalse(janela.entrada_pdf.winfo_ismapped())
                    self.assertFalse(hasattr(janela, 'opcoes_modelo'))
                    self.assertLessEqual(abs(janela.combo.winfo_height() - janela.campo_pdf.winfo_reqheight()), janela.u(8))

                    janela.preparar_progresso('Gerando relatório', 'Órgão de teste')
                    self.atualizar_layout(raiz)
                    self.assertGreaterEqual(janela.barra.winfo_height(), janela.u(10))
                    for grupo in (janela.acoes_navegacao, janela.acoes_resultado):
                        self.assertGreaterEqual(grupo.winfo_x(), 0)
                        self.assertLessEqual(grupo.winfo_x() + grupo.winfo_width(), grupo.master.winfo_width())
                    janela.fila.put(('concluido', {'arquivo': 'teste.pdf', 'pacote': 'pacote', 'paginas': 4, 'pendencias': ['Conferir']}))
                    janela.atualizar()
                    self.assertEqual(janela.percentual.get(), '100%')
                    self.assertEqual(janela.estado_progresso['text'], 'Revisão pendente')
                    self.assertEqual(str(janela.botao_pdf['state']), 'normal')
                    janela.preparar_progresso('Instalando dependências')
                    self.assertEqual(str(janela.botao_pdf['state']), 'disabled')
                    self.assertEqual(janela.etapa.get(), 'Preparando a execução…')
                    janela.fila.put(('erro', 'Falha de teste', ''))
                    janela.atualizar()
                    self.assertEqual(janela.estado_progresso['text'], 'Interrompido')
                    janela.voltar()
                    janela.origem.set('pdf')
        finally:
            for chamada in raiz.tk.call('after', 'info'):
                raiz.after_cancel(chamada)
            raiz.destroy()

    def test_preparacao_sem_chave_e_copia_do_prompt(self) -> None:
        """Entrega o prompt gerado e não exige modelo ou chave para preparar o pacote."""
        import tkinter as tk
        from relatorio import Janela
        raiz = tk.Tk()
        raiz.withdraw()
        try:
            with tempfile.TemporaryDirectory() as diretorio, patch('relatorio.listar_orgaos', return_value=[]), \
                    patch('relatorio.dependencias_ausentes', return_value=[]), \
                    patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
                pasta = Path(diretorio)
                pdf = pasta / 'original.pdf'
                pdf.write_bytes(b'%PDF-1.4 teste')
                prompt = pasta / 'PROMPT_CODEX.md'
                prompt.write_text('Leia os arquivos locais e preencha resposta_ia.json.', encoding='utf-8')
                janela = Janela(raiz)
                janela.arquivo.set(str(pdf))
                self.assertEqual(janela.obter_opcoes().modo, 'codex')
                janela.fila.put(('concluido', {'arquivo': str(pdf), 'pacote': str(pasta),
                                              'prompt': str(prompt), 'paginas': 1, 'pendencias': ['Revisar']}))
                janela.atualizar()
                self.assertEqual(str(janela.botao_prompt['state']), 'normal')
                self.assertEqual(janela.titulo_progresso['text'], 'Pré-PDF e prompt prontos')
                janela.copiar_prompt()
                self.assertEqual(raiz.clipboard_get(), prompt.read_text(encoding='utf-8'))
                janela.preparar_progresso('Nova execução')
                self.assertEqual(str(janela.botao_prompt['state']), 'disabled')
        finally:
            for chamada in raiz.tk.call('after', 'info'):
                raiz.after_cancel(chamada)
            raiz.destroy()


if __name__ == '__main__':
    unittest.main()
