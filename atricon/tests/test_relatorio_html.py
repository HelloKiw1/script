import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from relatorio_html import gerar_relatorio_html, preparar_dados_publicos


class RelatorioHTMLTests(unittest.TestCase):
    def test_gera_html_independente_sem_dados_de_acesso(self):
        registros = [{'orgao':'Prefeitura','cidade':'Alfa','user':'LOGIN_PRIVADO','senha':'SENHA_PRIVADA','erro':'Erro no login LOGIN_PRIVADO',
                      'criterios_validacao':[{'titulo':'Dimensão','criterio':'1.1 </script><script>invadir()</script>',
                        'validacoes_resultado':[{'item':'Atualidade','status':'Não','token':'TOKEN_PRIVADO'}]}]}]
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = gerar_relatorio_html(Path(pasta)/'coleta.json',registros)
            texto = arquivo.read_text(encoding='utf-8')
            self.assertNotIn('LOGIN_PRIVADO',texto)
            self.assertNotIn('SENHA_PRIVADA',texto)
            self.assertNotIn('TOKEN_PRIVADO',texto)
            self.assertNotIn('</script><script>invadir()',texto)
            self.assertIn('application/json',texto)
            self.assertIn('data-analysis-charts',texto)
            self.assertNotIn('<script src=',texto)
            self.assertNotIn('<link rel="stylesheet"',texto)

    def test_preserva_revisor_e_paginas_sem_promover_validador(self):
        origem = [{'orgao':'Câmara','evidencias_validacao':[{'criterio':'1.1 Exemplo','mensagens_evidencia':[
            {'tipo':'Comentário do Revisor','etapa':'revisao','conteudo_texto':'Falta o ano de 2022.','paginas_pdf':[74],'senha':'segredo'}]}]}]
        dados = preparar_dados_publicos(origem)
        mensagem = dados[0]['evidencias_validacao'][0]['mensagens_evidencia'][0]
        self.assertEqual(mensagem['etapa'],'revisao')
        self.assertEqual(mensagem['paginas_pdf'],[74])
        self.assertNotIn('senha',mensagem)


if __name__ == '__main__':
    unittest.main()
