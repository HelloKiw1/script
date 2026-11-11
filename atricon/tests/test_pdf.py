import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import coletor_atricon as collector
from pdf_atricon import parse_report_text

HEADER = '''RELATÓRIO DE AVALIAÇÃO DA TRANSPARÊNCIA PÚBLICA
2026
Questionário: 42
Status: Revisado
Entidade Avaliada: Prefeitura de Demo (TO)
Índice de Transparência: 94,92%     Classificação: Elevado
RESUMO
Dimensão        Itens    Avaliação       Validação       Revisão
Licitações      2        2 / 2 (100,0%)  2 / 2 (100,0%)  1 / 2 (50,0%)
Licitações
'''
BODY = '''8.1 Divulga as licitações?
Item de Verificação                Avaliação    Validação    Revisão
Disponibilidade                    Atende       Atende       Atende
Série Histórica                    Atende       Atende       Não
Evidências do Critério
Comentário do Validador                         12/06/2026 10:00
Confere com a avaliação.
Comentário do Revisor                           10/07/2026 14:20
Não foi possível consultar anos anteriores.
'''


class PDFParsingTests(unittest.TestCase):
    def test_revision_is_preserved_separately_and_used_as_final_result(self):
        result = parse_report_text([HEADER, BODY])
        self.assertEqual(result['coleta_detalhada'], 'concluida')
        self.assertEqual(result['porcentagem'], '94,92%')
        self.assertEqual(result['classificacao_pdf'], 'Elevado')
        self.assertEqual(result['cobertura_pdf']['itens'], 2)
        criterion = result['criterios_validacao'][0]
        self.assertEqual(criterion['validacoes_validacao'][1]['status'], 'Atende')
        self.assertEqual(criterion['validacoes_revisao'][1]['status'], 'Não')
        self.assertEqual(criterion['validacoes_resultado'][1]['status'], 'Não')
        self.assertEqual(criterion['validacoes_nao_atendidas'], ['Série Histórica'])
        self.assertEqual(criterion['grau_importancia'], '')
        self.assertTrue(result['limitacoes_pdf'])
        messages = result['evidencias_validacao'][0]['mensagens_evidencia']
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[1]['etapa'], 'revisao')

    def test_table_without_revision_uses_validation_without_inferring_failed_comments(self):
        header = HEADER.replace('       Revisão', '').replace('  1 / 2 (50,0%)', '')
        body = BODY.replace('    Revisão', '').replace('       Atende\n', '\n').replace('       Não\n', '\n')
        result = parse_report_text([header, body])
        self.assertEqual(result['etapa_resultado'], 'validacao')
        self.assertEqual(result['cobertura_pdf']['itens_nao_atendidos'], 0)

    def test_missing_columns_are_partial_and_never_fall_back_to_earlier_passing_values(self):
        result = parse_report_text([HEADER, BODY.replace('Atende       Atende       Não', 'Atende       Atende')])
        self.assertEqual(result['coleta_detalhada'], 'parcial')
        self.assertTrue(result['avisos_pdf'])
        self.assertEqual(result['criterios_validacao'][0]['validacoes_resultado'][1]['status'], '')

    def test_summary_mismatch_is_partial_and_trailing_dot_in_criterion_is_accepted(self):
        result = parse_report_text([HEADER.replace('Licitações      2', 'Licitações      3'), BODY.replace('8.1 ', '8.1. ')])
        self.assertEqual(result['criterios_validacao'][0]['criterio_id'], '8.1')
        self.assertEqual(result['criterios_validacao'][0]['criterio'], '8.1 Divulga as licitações?')
        self.assertEqual(result['coleta_detalhada'], 'parcial')

    def test_wrapped_not_applicable_status_is_not_a_failure(self):
        wrapped = BODY.replace('Série Histórica                    Atende       Atende       Não',
                               'Série Histórica                    Atende       Atende       Não\n'
                               '                                                           se aplica')
        result = parse_report_text([HEADER, wrapped])
        criterion = result['criterios_validacao'][0]
        self.assertEqual(criterion['validacoes_revisao'][1]['status'], 'Não se aplica')
        self.assertEqual(criterion['validacoes_nao_atendidas'], [])

    def test_invalid_or_nonextractable_pdf_is_not_claimed_complete(self):
        for pages in [[], ['Login'], [HEADER]]:
            with self.assertRaises(ValueError):
                parse_report_text(pages)


class PDFCollectorTests(unittest.TestCase):
    account = {'orgao':'Prefeitura', 'cidade':'Demo', 'user':'dummy', 'senha':'dummy'}

    def test_new_table_keeps_status_score_and_essentials_in_their_correct_columns(self):
        rows = collector.parse_assessment_rows([{
            'headers':['#','Entidade','Setor Atual','Data','Índice','Essencias','Ação'],
            'cells':['42','Prefeitura de Demo (TO)\nPNTP 2026 | Revisado\nAvaliação prorrogada para 07/06/2026',
                     'Atricon','20/05/2026 09:13','100,0','96,2',''],
            'link':'/questionarios/42/view/',
        }])
        self.assertEqual(rows[0]['questionario_id'], '42')
        self.assertEqual(rows[0]['status'], 'Revisado')
        self.assertEqual(rows[0]['setor_atual'], 'Atricon')
        self.assertEqual(rows[0]['indice'], '100,0%')
        self.assertEqual(rows[0]['essenciais_tabela'], '96,2%')

    def test_old_table_and_cycle_selection_still_work(self):
        rows = collector.parse_assessment_rows([{
            'headers':['Número','Entidade','Status','Setor Atual','Data','Índice'],
            'cells':['42/2026','Prefeitura de Demo','Validado','Tribunal','01/06/2026','80%'],
            'link':'',
        }])
        self.assertEqual(rows[0]['indice'], '80%')
        self.assertEqual(rows[0]['status'], 'Validado')
        self.assertEqual(rows[0]['questionario_id'], '42')
        self.assertEqual(collector.select_assessment(rows + [{**rows[0], 'ano':'2025','questionario_id':'999'}], self.account)['questionario_id'], '42')

    def test_print_html_is_rendered_with_auth_in_a_headless_browser(self):
        page = MagicMock()
        response = page.context.request.get.return_value
        response.ok = True
        response.body.return_value = b'<html>Relatorio</html>'
        response.headers = {'content-type':'text/html'}
        browser = page.context.browser.browser_type.launch.return_value
        report_page = browser.new_context.return_value.new_page.return_value
        report_page.pdf.return_value = b'%PDF-1.7\nsynthetic test'
        report_page.evaluate.return_value = 0
        with tempfile.TemporaryDirectory() as tmp:
            result = collector.download_questionnaire_pdf(page, {'questionario_id':'42'}, self.account, Path(tmp)/'result.json')
            self.assertEqual(Path(result['pdf_arquivo']).read_bytes(), b'%PDF-1.7\nsynthetic test')
            self.assertEqual(result['pdf_metodo'], 'impressao_html')
        page.context.browser.browser_type.launch.assert_called_once_with(headless=True)
        browser.new_context.assert_called_once_with(locale='pt-BR', storage_state=page.context.storage_state.return_value)
        browser.close.assert_called_once()

    def test_direct_pdf_download_does_not_launch_another_browser(self):
        page = MagicMock()
        response = page.context.request.get.return_value
        response.ok = True
        response.body.return_value = b'%PDF-1.7\nsynthetic test'
        with tempfile.TemporaryDirectory() as tmp:
            result = collector.download_questionnaire_pdf(page, {'questionario_id':'42'}, self.account, Path(tmp)/'result.json')
            self.assertEqual(result['pdf_metodo'], 'download')
        page.context.browser.browser_type.launch.assert_not_called()

    def test_other_entity_pdf_is_rejected_and_expired_form_is_never_opened(self):
        row = {'entidade':'Prefeitura de Demo','status':'Revisado','data':'','questionario_id':'42','link':'https://example.invalid/view/','indice':'100%','setor_atual':'Atricon'}
        with patch.object(collector, 'login', return_value=MagicMock()), \
             patch.object(collector, 'get_my_assessment_rows', return_value=[row]), \
             patch.object(collector, 'download_questionnaire_pdf', return_value={'pdf_arquivo':'dummy.pdf'}), \
             patch.object(collector, 'extract_pdf_report', return_value={'questionario_id':'42','entidade_pdf':'Prefeitura de Outra Cidade','porcentagem':'30%'}), \
             patch.object(collector, 'collect_validation_evidences_from_form') as expired:
            result = collector.process_account(MagicMock(), self.account, Path('dummy.json'), True)
        self.assertEqual(result['coleta_detalhada'], 'erro')
        self.assertEqual(result['criterios_validacao'], [])
        self.assertEqual(result['porcentagem'], '100%')
        self.assertIn('nao corresponde', result['erro_evidencias'])
        expired.assert_not_called()


if __name__ == '__main__':
    unittest.main()
