"""Offline regression checks for detailed collection and viewer integration."""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import coletor_atricon as collector


class DetailedCollectionTests(unittest.TestCase):
    def test_partial_pdf_preserves_assessment_and_criteria_without_opening_expired_form(self):
        account = {"orgao": "Prefeitura", "cidade": "Demo", "user": "demo", "senha": "dummy"}
        row = {"entidade": "Prefeitura de Demo", "status": "Validado", "setor_atual": "Tribunal", "data": "", "questionario_id": "1", "link": "https://example.invalid/view/", "indice": "80%"}

        with patch.object(collector, "login", return_value=MagicMock()), \
             patch.object(collector, "get_my_assessment_rows", return_value=[row]), \
             patch.object(collector, "download_questionnaire_pdf", return_value={"pdf_arquivo":"dummy.pdf"}) as download, \
             patch.object(collector, "extract_pdf_report", return_value={
                 'questionario_id':'1', 'entidade_pdf':'Prefeitura de Demo', 'porcentagem':'80%',
                 'criterios_validacao':[{'criterio':'1.1 Receitas'}], 'evidencias_validacao':[],
                 'coleta_detalhada':'parcial', 'avisos_pdf':['Uma coluna nao foi lida.'],
             }), \
             patch.object(collector, "collect_validation_evidences_from_form") as expired_form:
            result = collector.process_account(MagicMock(), account, Path("result.json"), True)
        self.assertEqual(result["porcentagem"], "80%")
        self.assertEqual(result["status"], "Validado")
        self.assertEqual(result["coleta_detalhada"], "parcial")
        self.assertEqual(len(result["criterios_validacao"]), 1)
        self.assertEqual(result["erro_evidencias"], "Uma coluna nao foi lida.")
        self.assertNotIn("senha", result)
        download.assert_called_once()
        expired_form.assert_not_called()

    def test_viewer_propagates_analysis_only_when_requested(self):
        completed = MagicMock(returncode=0, stdout="", stderr="")
        with patch.object(collector, "load_accounts", return_value=[]), \
             patch.object(collector.subprocess, "run", return_value=completed) as run:
            collector.run_collector_from_viewer({"mode": "all", "analysis": True}, Path(__file__).resolve().parents[1])
            self.assertIn("--analise-completa", run.call_args.args[0])
            self.assertIn("--todos", run.call_args.args[0])
            collector.run_collector_from_viewer({"mode": "all"}, Path(__file__).resolve().parents[1])
            self.assertNotIn("--analise-completa", run.call_args.args[0])

    def test_cli_accepts_complete_analysis(self):
        with patch.object(sys, "argv", ["coletor_atricon.py", "--todos", "--analise-completa"]):
            args = collector.parse_args()
        self.assertTrue(args.todos)
        self.assertTrue(args.analise_completa)


if __name__ == "__main__":
    unittest.main()
