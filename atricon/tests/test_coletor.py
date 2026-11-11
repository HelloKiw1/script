"""Offline regression checks for detailed collection and viewer integration."""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import coletor_atricon as collector


class DetailedCollectionTests(unittest.TestCase):
    def test_detailed_error_preserves_assessment_and_criteria(self):
        account = {"orgao": "Prefeitura", "cidade": "Demo", "user": "demo", "senha": "dummy"}
        row = {"entidade": "Prefeitura de Demo", "status": "Validado", "setor_atual": "Tribunal", "data": "", "questionario_id": "1", "link": "https://example.invalid/view/", "indice": "80%"}

        def fail_after_criteria(page, url, question_id, output, criteria):
            criteria.append({"criterio": "1.1 Receitas", "validacoes_validacao": [{"item": "Atualidade", "status": "Não"}]})
            raise RuntimeError("modal indisponivel")

        with patch.object(collector, "login", return_value=MagicMock()), \
             patch.object(collector, "get_my_assessment_rows", return_value=[row]), \
             patch.object(collector, "extract_history_from_questionnaire_view", return_value={}), \
             patch.object(collector, "extract_percentage_from_loaded_questionnaire", return_value="80%"), \
             patch.object(collector, "collect_validation_evidences_from_form", side_effect=fail_after_criteria) as detailed:
            result = collector.process_account(MagicMock(), account, Path("result.json"), True)
        self.assertEqual(result["porcentagem"], "80%")
        self.assertEqual(result["status"], "Validado")
        self.assertEqual(result["coleta_detalhada"], "parcial")
        self.assertEqual(len(result["criterios_validacao"]), 1)
        self.assertEqual(result["erro_evidencias"], "modal indisponivel")
        self.assertNotIn("senha", result)
        detailed.assert_called_once()

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
