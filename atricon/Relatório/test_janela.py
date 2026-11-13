"""Teste de construção da interface, sem clicar em aplicativos ou consultar sites."""
import os
import unittest


@unittest.skipUnless(os.environ.get('BARCO_TESTAR_JANELA') == '1', 'Teste opcional de Tkinter instalado no Windows.')
class TesteJanela(unittest.TestCase):
    """Confere seleção, rodapé fixo e transição para a tela de progresso."""

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
            self.assertEqual(janela.modo.get(), 'pacote')
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
            raiz.destroy()


if __name__ == '__main__':
    unittest.main()
