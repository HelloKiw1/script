"""Localiza o projeto e os ambientes Python sem depender do diretório aberto."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

PASTA = Path(__file__).resolve().parent
ATRICON = PASTA.parent
RAIZ = ATRICON.parent
ENTRADA = RAIZ / 'resultado/coleta_2026/pdfs/analise_2026'
EXECUCOES = PASTA / 'execucoes'
BRASILIA = timezone(timedelta(hours=-3))


def preparar_importacoes() -> None:
    """Reaproveita dependências locais, sem instalar pacotes na abertura da janela."""
    for pasta in (ATRICON, PASTA / '.dependencias', RAIZ / 'tmp/pdf-barco-runtime', RAIZ / 'tmp/atricon-runtime'):
        if pasta.exists() and str(pasta) not in sys.path:
            sys.path.append(str(pasta))


def agora() -> str:
    """Retorna a data real da captura no horário de Brasília."""
    return datetime.now(BRASILIA).isoformat(timespec='seconds')


def ler_json(caminho: Path) -> Any:
    """Lê um arquivo local em UTF-8, inclusive com BOM."""
    return json.loads(caminho.read_text(encoding='utf-8-sig'))


def salvar_json(caminho: Path, dados: Any) -> None:
    """Grava atomicamente para permitir retomada após interrupções."""
    caminho.parent.mkdir(parents=True, exist_ok=True)
    temporario = caminho.with_suffix(caminho.suffix + '.tmp')
    temporario.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding='utf-8')
    temporario.replace(caminho)


preparar_importacoes()
