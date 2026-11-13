"""Testes de integridade do fluxo; não acessam o Avalia nem chamam API paga."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from ambiente import salvar_json
from capturador import url_publica
from motor import Cancelado, Opcoes, Processo, listar_orgaos, minutas, validar_capturas
from revisao_ia import revisar, validar_resposta


class TesteIntegridade(unittest.TestCase):
    """Protege origem, saída, revisão e privacidade do cadastro."""

    def setUp(self) -> None:
        """Monta um contexto mínimo de um único órgão."""
        self.contexto = {'sha256_origem': 'abc', 'entidade': 'Órgão de teste', 'criterios': [
            {'criterio_id': '8.6', 'criterio': '8.6 Plano anual?', 'historico_imagens': []}]}
        self.resposta = {'sha256_origem': 'abc', 'explicacoes': {'8.6': 'O Validador não aceitou a declaração apresentada pelo Avaliador.'}, 'pendencias': []}

    def test_nao_aceita_revisao_de_outro_documento(self) -> None:
        """Uma resposta com outro hash não pode substituir os comentários."""
        with self.assertRaises(ValueError):
            validar_resposta({**self.resposta, 'sha256_origem': 'outro'}, self.contexto, {})

    def test_nao_aceita_cobertura_incompleta_ou_criterio_extra(self) -> None:
        """Todos os critérios precisam ter texto, sem IDs de outros órgãos."""
        for explicacoes in ({}, {**self.resposta['explicacoes'], '1.1': 'Texto de outro critério.'}):
            with self.assertRaises(ValueError):
                validar_resposta({**self.resposta, 'explicacoes': explicacoes}, self.contexto, {})

    def test_nao_aceita_legenda_inventada(self) -> None:
        """A revisão só altera legendas de capturas realmente existentes."""
        with self.assertRaises(ValueError):
            validar_resposta({**self.resposta, 'observacoes_capturas': {'foto-inventada': 'Documento.'}}, self.contexto, {})

    def test_recusa_urls_locais_e_credenciais(self) -> None:
        """Não permite navegação de evidências para disco, rede privada ou URL com senha."""
        for url in ['file:///C:/segredo', 'http://127.0.0.1', 'http://192.168.0.1', 'http://[::1]', 'http://localhost', 'https://usuario:senha@portal.gov.br']:
            self.assertFalse(url_publica(url), url)
        self.assertTrue(url_publica('https://www.araguaina.to.gov.br/transparencia'))

    def test_lista_de_orgaos_nao_expoe_credenciais(self) -> None:
        """O combo recebe somente índice e rótulo público do cadastro."""
        with tempfile.TemporaryDirectory() as pasta:
            arquivo = Path(pasta) / 'cadastro.json'
            salvar_json(arquivo, [{'orgao': 'Câmara', 'cidade': 'Teste', 'user': 'privado', 'senha': 'segredo'}])
            texto = json.dumps(listar_orgaos(arquivo))
            self.assertNotIn('privado', texto)
            self.assertNotIn('segredo', texto)

    def test_cancelamento_antes_de_consultar(self) -> None:
        """Interrompe cooperativamente sem processar documentos ou consultar sites."""
        cancelar = threading.Event()
        cancelar.set()
        with self.assertRaises(Cancelado):
            Processo(Opcoes(), lambda *args: None, cancelar).verificar()

    def test_minuta_sempre_pendente(self) -> None:
        """O modo sem IA não finge que revisou os comentários."""
        resposta = minutas(self.contexto)
        self.assertTrue(resposta['pendencias'])
        self.assertIn('depende de revisão', resposta['explicacoes']['8.6'])

    def test_resolucao_de_pendencia_exige_justificativa(self) -> None:
        """Uma decisão editorial precisa apontar uma pendência real e documentar sua resolução."""
        contexto = {**self.contexto, 'pendencias_coleta': ['PDF extenso: conferir páginas restantes.']}
        with self.assertRaises(ValueError):
            validar_resposta({**self.resposta, 'pendencias_resolvidas': {'PDF extenso: conferir páginas restantes.': 'ok'}}, contexto, {})
        resposta = validar_resposta({**self.resposta, 'pendencias_resolvidas': {
            'PDF extenso: conferir páginas restantes.': 'Documento integral conferido manualmente; as páginas 4 a 12 tratam do mesmo período e escopo.'}}, contexto, {})
        self.assertTrue(resposta['pendencias_resolvidas'])

    def test_historico_omitido_nao_pode_ser_liberado(self) -> None:
        """Uma anotação não pode substituir a inclusão efetiva da evidência original."""
        pendencia = '8.6: imagem histórica fora dos blocos reconhecidos, página 3.'
        with self.assertRaises(ValueError):
            validar_resposta({**self.resposta, 'pendencias_resolvidas': {pendencia: 'Conferimos visualmente a imagem e queremos encerrar a pendência.'}},
                             {**self.contexto, 'pendencias_coleta': [pendencia]}, {})

    def test_arquivo_externo_nao_pode_entrar_na_revisao(self) -> None:
        """Um manifesto editado não pode fazer a API receber arquivos fora do pacote."""
        with tempfile.TemporaryDirectory() as diretorio:
            pasta = Path(diretorio)
            salvar_json(pasta / 'externo.json', {'segredo': 'nao enviar'})
            (pasta / 'pacote').mkdir()
            with self.assertRaises(ValueError):
                validar_capturas(pasta / 'pacote', {'8.6': [{'id': 'foto', 'url': 'https://portal.gov.br', 'arquivo': '../externo.json'}]}, self.contexto['criterios'])

    def test_api_so_depois_de_acumular(self) -> None:
        """Bloqueia revisão antes de concluir a coleta do órgão inteiro."""
        with tempfile.TemporaryDirectory() as diretorio:
            pasta = Path(diretorio)
            salvar_json(pasta / 'estado.json', {'coleta_concluida': False})
            with self.assertRaisesRegex(ValueError, 'acumular'):
                revisar(pasta, self.contexto, {}, 'modelo-teste', lambda *a: None, lambda: None)

    def test_cache_e_schema_da_api(self) -> None:
        """Uma análise idêntica reutiliza JSON validado sem segunda chamada paga."""
        item = {'criterio_id': '8.6', 'comentario': self.resposta['explicacoes']['8.6'], 'observacoes_capturas': [], 'pendencias': [], 'analise_concluida': True}
        retorno = {'status': 'completed', 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(item)}]}]}
        with tempfile.TemporaryDirectory() as diretorio, patch.dict(os.environ, {'OPENAI_API_KEY': 'chave-teste'}), patch('revisao_ia.requisitar', return_value=retorno) as requisicao:
            pasta = Path(diretorio)
            salvar_json(pasta / 'estado.json', {'coleta_concluida': True})
            primeiro = revisar(pasta, self.contexto, {}, 'modelo-teste', lambda *a: None, lambda: None)
            segundo = revisar(pasta, self.contexto, {}, 'modelo-teste', lambda *a: None, lambda: None)
            self.assertEqual(primeiro, segundo)
            self.assertEqual(requisicao.call_count, 1)
            payload = requisicao.call_args.args[0]
            self.assertEqual(payload['text']['format']['type'], 'json_schema')
            self.assertFalse(payload['store'])
            self.assertNotIn('chave-teste', json.dumps(payload))


if __name__ == '__main__':
    unittest.main()
