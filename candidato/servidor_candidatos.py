"""Servidor local do Candidatron, sem dependências externas.

Execute na raiz do projeto:
    python candidato/servidor_candidatos.py
Depois acesse:
    http://localhost:8877
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = 8877
APP_DIR = Path(__file__).resolve().parent.parent
TSE_ENDPOINT = (
    "https://divulgacandcontas.tse.jus.br/divulga/rest/v1/candidatura/"
    "listar/{ano}/{uf}/{eleicao}/{cargo}/candidatos"
)
VALID_ROLES = {"1", "3", "5", "6", "7"}
VALID_UFS = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT",
    "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO",
    "RR", "SC", "SP", "SE", "TO", "BR",
}
CACHE_TTL_SECONDS = 300
CACHE: dict[str, tuple[float, bytes]] = {}


class CandidatoHandler(SimpleHTTPRequestHandler):
    """Serve a interface e encaminha somente consultas validadas ao TSE."""

    def do_GET(self) -> None:  # noqa: N802 - API da biblioteca padrão
        parsed = urlparse(self.path)
        if parsed.path == "/api/candidatos":
            self._proxy_candidates(parsed.query)
            return
        if parsed.path == "/api/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "service": "candidatron"})
            return
        if parsed.path in {"", "/"}:
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/candidato/candidato.html")
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _proxy_candidates(self, query_string: str) -> None:
        query = parse_qs(query_string)
        ano = self._single(query, "ano")
        uf = self._single(query, "uf").upper()
        eleicao = self._single(query, "eleicao")
        cargo = self._single(query, "cargo")

        if not re.fullmatch(r"\d{4}", ano) or not (2004 <= int(ano) <= 2100):
            self._send_error("Ano inválido.")
            return
        if uf not in VALID_UFS:
            self._send_error("UF inválida.")
            return
        if not re.fullmatch(r"\d{5,20}", eleicao):
            self._send_error("ID da eleição inválido.")
            return
        if cargo not in VALID_ROLES:
            self._send_error("Cargo inválido.")
            return
        if cargo == "1":
            uf = "BR"

        url = TSE_ENDPOINT.format(ano=ano, uf=uf, eleicao=eleicao, cargo=cargo)
        cached = CACHE.get(url)
        if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
            self._send_bytes(HTTPStatus.OK, cached[1])
            return

        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Candidatron/1.0 (consulta local de dados publicos)",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
            json.loads(payload)
            CACHE[url] = (time.monotonic(), payload)
            self._send_bytes(HTTPStatus.OK, payload)
        except urllib.error.HTTPError as exc:
            self._send_json(exc.code, {"erro": f"O TSE respondeu com status {exc.code}."})
        except (urllib.error.URLError, TimeoutError) as exc:
            self._send_json(
                HTTPStatus.BAD_GATEWAY,
                {"erro": "Não foi possível conectar ao TSE.", "detalhe": str(exc.reason)},
            )
        except (ValueError, json.JSONDecodeError):
            self._send_json(
                HTTPStatus.BAD_GATEWAY,
                {"erro": "O TSE retornou uma resposta inesperada."},
            )

    @staticmethod
    def _single(query: dict[str, list[str]], key: str) -> str:
        values = query.get(key, [""])
        return values[0].strip() if values else ""

    def _send_error(self, message: str) -> None:
        self._send_json(HTTPStatus.BAD_REQUEST, {"erro": message})

    def _send_json(self, status: int, data: object) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send_bytes(status, payload)

    def _send_bytes(self, status: int, payload: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), CandidatoHandler)
    print(f"Candidatron disponível em http://localhost:{PORT}")
    print("Pressione Ctrl+C para encerrar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    import os

    os.chdir(APP_DIR)
    main()
