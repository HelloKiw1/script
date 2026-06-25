#!/usr/bin/env python3
"""
Automatiza a consulta de avaliacoes no Avalia Atricon.

Entrada JSON esperada:
[
  {
    "orgao": "Prefeitura Municipal",
    "cidade": "Santa Fe do Araguaia",
    "user": "usuario",
    "senha": "senha"
  }
]

Tambem aceita as chaves "orgão" e "órgão" para orgao.

Dependencia:
    pip install playwright
    python -m playwright install chromium
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, Iterable, List
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except ImportError as exc:
    raise SystemExit(
        "Dependencia ausente: playwright.\n"
        "Instale com:\n"
        "  pip install playwright\n"
        "  python -m playwright install chromium"
    ) from exc


BASE_URL = "https://avalia.atricon.org.br"
LOGIN_URL = f"{BASE_URL}/login/"
OAUTH_START_URL = f"{BASE_URL}/oauth/authenticate/"
HOME_URL = f"{BASE_URL}/"
MINHAS_AVALIACOES_URL = f"{BASE_URL}/avaliacoes/minhas-avaliacoes/"
LOGOUT_URL = f"{BASE_URL}/logout/"
ORGAO_KEYS = ("orgao", "orgão", "órgão")


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def first_value(data: Dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def has_value(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def expected_entity(account: Dict[str, Any]) -> str:
    orgao = first_value(account, ORGAO_KEYS)
    cidade = first_value(account, ("cidade",))
    return f"{orgao} de {cidade}".strip()


def empty_result(account: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "orgão": first_value(account, ORGAO_KEYS),
        "cidade": first_value(account, ("cidade",)),
        "status": "",
        "setor_atual": "",
        "data": "",
        "porcentagem": "",
    }


def account_validation_error(account: Any, index: int) -> str:
    if not isinstance(account, dict):
        return f"Item {index} do JSON nao e um objeto."

    missing = [
        name
        for name in ("cidade", "user", "senha")
        if not has_value(account.get(name))
    ]
    if not first_value(account, ORGAO_KEYS):
        missing.append("orgao/orgão/órgão")
    if missing:
        return f"Item {index} sem campos obrigatorios: {', '.join(missing)}."
    return ""


def entity_matches(actual: str, account: Dict[str, Any]) -> bool:
    orgao = first_value(account, ORGAO_KEYS)
    cidade = first_value(account, ("cidade",))
    actual_norm = normalize_text(actual)
    expected_norm = normalize_text(f"{orgao} de {cidade}")
    alternate_norm = normalize_text(f"{orgao} {cidade}")

    if expected_norm and expected_norm in actual_norm:
        return True
    if alternate_norm and alternate_norm in actual_norm:
        return True

    orgao_tokens = normalize_text(orgao).split()
    cidade_tokens = normalize_text(cidade).split()
    tokens = set(actual_norm.split())
    return all(token in tokens for token in orgao_tokens + cidade_tokens)


def wait_page_ready(page: Page, timeout_ms: int = 45_000) -> None:
    page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_function("document.readyState === 'complete'", timeout=timeout_ms)


def choose_json_file() -> Path:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # pragma: no cover
        raise SystemExit("Informe o caminho do JSON com --entrada.") from exc

    root = tk.Tk()
    root.withdraw()
    selected = filedialog.askopenfilename(
        title="Selecione o JSON de contas",
        filetypes=(("Arquivos JSON", "*.json"), ("Todos os arquivos", "*.*")),
    )
    root.destroy()
    if not selected:
        raise SystemExit("Nenhum arquivo selecionado.")
    return Path(selected)


def load_accounts(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"Arquivo de entrada nao encontrado: {path}")
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON invalido em {path}: {exc}") from exc

    if isinstance(data, dict):
        data = [data]
    elif not isinstance(data, list):
        return [{"_erro_validacao": "O JSON de entrada precisa ser uma lista de contas ou um objeto de conta."}]
    if not data:
        return [{"_erro_validacao": "O JSON de entrada esta vazio."}]

    accounts: List[Dict[str, Any]] = []
    for index, account in enumerate(data, start=1):
        if not isinstance(account, dict):
            accounts.append({"_erro_validacao": f"Item {index} do JSON nao e um objeto."})
            continue
        error = account_validation_error(account, index)
        if error:
            account = dict(account)
            account["_erro_validacao"] = error
        accounts.append(account)
    return accounts


def write_results(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(results, file, ensure_ascii=False, indent=2)


def safe_filename(value: str) -> str:
    value = normalize_text(value)
    value = re.sub(r"[^a-z0-9_-]+", "_", value).strip("_")
    return value or "sem_identificacao"


def save_debug_html(page: Page, output_path: Path, account: Dict[str, Any]) -> str:
    if page.is_closed():
        return ""

    debug_dir = output_path.parent / "debug_atricon"
    debug_dir.mkdir(parents=True, exist_ok=True)

    user = str(account.get("user", "") or "")
    senha = str(account.get("senha", "") or "")
    filename = f"{time.strftime('%Y%m%d_%H%M%S')}_{safe_filename(user)}.html"
    debug_path = debug_dir / filename

    try:
        html_content = page.content()
    except PlaywrightError:
        return ""

    if user:
        html_content = html_content.replace(user, "***USER***")
    if senha:
        html_content = html_content.replace(senha, "***SENHA***")

    debug_path.write_text(html_content, encoding="utf-8")
    return str(debug_path)


def save_debug_screenshot(page: Page, output_path: Path, account: Dict[str, Any]) -> str:
    if page.is_closed():
        return ""

    debug_dir = output_path.parent / "debug_atricon"
    debug_dir.mkdir(parents=True, exist_ok=True)

    user = str(account.get("user", "") or "")
    filename = f"{time.strftime('%Y%m%d_%H%M%S')}_{safe_filename(user)}.png"
    debug_path = debug_dir / filename

    try:
        page.screenshot(path=str(debug_path), full_page=True)
    except PlaywrightError:
        return ""

    return str(debug_path)


def start_login_flow(page: Page) -> None:
    try:
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45_000)
        wait_page_ready(page)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(f"nao foi possivel carregar a pagina inicial de login: {LOGIN_URL}") from exc

    button = page.locator("#submitBtn, button:has-text('Entrar')").first
    try:
        button.wait_for(state="visible", timeout=10_000)
        page.wait_for_function(
            """
            () => {
              const btn = document.querySelector('#submitBtn, button');
              return btn && !btn.disabled;
            }
            """,
            timeout=10_000,
        )
        button.click()
    except PlaywrightTimeoutError:
        page.goto(OAUTH_START_URL, wait_until="domcontentloaded")

    wait_page_ready(page)


def submit_credentials(page: Page, username: str, password: str) -> Page:
    username_field = page.locator("input[name='username'], #username").first
    password_field = page.locator("input[name='password'], #password").first
    submit_button = page.locator("form button[type='submit'], #submitBtn, button:has-text('Entrar')").first

    try:
        username_field.wait_for(state="visible", timeout=20_000)
        password_field.wait_for(state="visible", timeout=20_000)
        username_field.fill(username)
        password_field.fill(password)
        page = submit_login_form(page, submit_button, password_field)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError("formulario de login da Conta Atricon nao apareceu completo.") from exc

    page = wait_for_avalia_redirect(page)

    wait_page_ready(page)
    return page


def submit_login_form(page: Page, submit_button: Any, password_field: Any) -> Page:
    initial_url = page.url
    submit_button.click()
    wait_after_submit(page, initial_url)

    page = current_live_page(page)

    if page.url == initial_url and "conta.atricon.org.br/usuarios/login" in page.url:
        try:
            if page.locator("input[name='password'], #password").first.is_visible(timeout=1_000):
                password_field.press("Enter")
                wait_after_submit(page, initial_url)
        except PlaywrightError:
            pass

    return current_live_page(page)


def wait_after_submit(page: Page, initial_url: str) -> None:
    try:
        page.wait_for_load_state("networkidle", timeout=8_000)
    except PlaywrightTimeoutError:
        pass

    if not page.is_closed() and page.url == initial_url:
        time.sleep(1)


def current_live_page(page: Page) -> Page:
    if not page.is_closed():
        return page

    live_pages = [candidate for candidate in page.context.pages if not candidate.is_closed()]
    if live_pages:
        return live_pages[-1]
    raise RuntimeError("a pagina do navegador foi fechada durante o login e nenhuma nova aba ficou aberta.")


def wait_for_avalia_redirect(page: Page, timeout_ms: int = 45_000) -> Page:
    deadline = time.monotonic() + (timeout_ms / 1000)
    last_url = ""
    tried_authorize_next = False

    while time.monotonic() < deadline:
        try:
            page = current_live_page(page)
            last_url = page.url
            if re.match(r"https://avalia\.atricon\.org\.br/.*", last_url):
                return page
            if "conta.atricon.org.br/usuarios/login" in last_url:
                login_message = get_explicit_login_error(page)
                if login_message:
                    raise RuntimeError(login_message)
                if not tried_authorize_next:
                    next_url = get_oauth_next_url(page)
                    if next_url:
                        tried_authorize_next = True
                        page.goto(next_url, wait_until="domcontentloaded", timeout=30_000)
                        wait_page_ready(page, timeout_ms=30_000)
                        continue
            time.sleep(0.5)
        except PlaywrightError as exc:
            raise RuntimeError(
                "a pagina do navegador foi fechada ou perdeu a sessao durante o login."
            ) from exc

    visible_text = ""
    try:
        if not page.is_closed() and page.locator("body").count():
            visible_text = page.locator("body").inner_text(timeout=5_000)
    except PlaywrightError:
        visible_text = ""

    raise RuntimeError(
        "login nao redirecionou para o Avalia dentro do tempo esperado; "
        "a Conta Atricon permaneceu na tela de login. "
        f"URL atual: {last_url}. Texto atual: {visible_text[:300]}"
    )


def get_oauth_next_url(page: Page) -> str:
    next_value = ""
    try:
        next_value = page.locator("input[name='next']").first.get_attribute("value", timeout=1_000) or ""
    except PlaywrightError:
        next_value = ""

    if not next_value:
        parsed_page_url = urlparse(page.url)
        next_values = parse_qs(parsed_page_url.query).get("next", [])
        next_value = next_values[0] if next_values else ""

    if not next_value:
        return ""

    absolute_url = urljoin("https://conta.atricon.org.br", next_value)
    parsed = urlparse(absolute_url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query.pop("prompt", None)
    clean_query = urlencode(query, doseq=True)
    return urlunparse(parsed._replace(query=clean_query))


def get_explicit_login_error(page: Page) -> str:
    try:
        selectors = (
            ".alert-danger, .alert-error, .invalid-feedback, "
            ".error, .text-danger, [role='alert']"
        )
        page.locator(selectors).first.wait_for(state="attached", timeout=1_500)
        error_texts = [
            text.strip()
            for text in page.locator(selectors).all_inner_texts()
            if text.strip()
        ]
    except (PlaywrightError, PlaywrightTimeoutError):
        return ""

    if error_texts:
        compact_text = re.sub(r"\s+", " ", " ".join(error_texts)).strip()
        return (
            "login nao foi aceito pela Conta Atricon. "
            f"Texto da pagina: {compact_text[:300]}"
        )
    return ""


def login(page: Page, account: Dict[str, Any]) -> Page:
    start_login_flow(page)
    if "avalia.atricon.org.br" in page.url and "/login" not in page.url:
        return page

    if "conta.atricon.org.br" not in page.url:
        try:
            page.wait_for_url(re.compile(r"https://conta\.atricon\.org\.br/.*"), timeout=45_000)
        except PlaywrightTimeoutError as exc:
            raise RuntimeError(f"nao houve redirecionamento para a Conta Atricon. URL atual: {page.url}") from exc

    page = submit_credentials(page, str(account["user"]), str(account["senha"]))
    page.goto(HOME_URL, wait_until="domcontentloaded")
    wait_page_ready(page)
    if "/login" in page.url or "conta.atricon.org.br" in page.url:
        raise RuntimeError(f"login aparentemente nao foi concluido. URL atual: {page.url}")
    return page


def get_my_assessment_rows(page: Page) -> List[Dict[str, str]]:
    try:
        page.goto(MINHAS_AVALIACOES_URL, wait_until="domcontentloaded", timeout=45_000)
        wait_page_ready(page)
        page.locator("table tbody tr").first.wait_for(state="attached", timeout=30_000)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError("tabela de Minhas Avaliacoes nao carregou ou nao foi encontrada.") from exc

    rows: List[Dict[str, str]] = []
    for row in page.locator("table tbody tr").all():
        cells = [cell.inner_text().strip() for cell in row.locator("td").all()]
        if len(cells) < 6:
            continue
        link = ""
        href = row.locator("a[href*='/questionarios/'][href*='/view/']").first
        if href.count() > 0:
            link = href.get_attribute("href") or ""
            if link:
                link = urljoin(BASE_URL, link)
        match = re.search(r"(\d+)\s*/\s*2026", cells[0])
        questionnaire_id = match.group(1) if match else ""
        if not link and questionnaire_id:
            link = f"{BASE_URL}/questionarios/{questionnaire_id}/view/"
        rows.append(
            {
                "numero": cells[0],
                "questionario_id": questionnaire_id,
                "entidade": re.sub(r"\s+", " ", cells[1]).strip(),
                "status": re.sub(r"\s+", " ", cells[2]).strip(),
                "setor_atual": re.sub(r"\s+", " ", cells[3]).strip(),
                "data": cells[4],
                "indice": cells[5],
                "link": link,
            }
        )
    if not rows:
        raise RuntimeError("nenhuma avaliacao com colunas esperadas foi encontrada na tabela.")
    return rows


def extract_percentage_from_questionnaire(page: Page, url: str, fallback: str = "") -> str:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        wait_page_ready(page)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(f"questionario nao carregou: {url}") from exc

    candidates: List[str] = []
    for attr_value in page.locator("[aria-valuenow]").evaluate_all(
        "els => els.map(el => el.getAttribute('aria-valuenow')).filter(Boolean)"
    ):
        candidates.append(f"{str(attr_value).strip()} %")

    body_text = page.locator("body").inner_text(timeout=10_000)
    candidates.extend(re.findall(r"\b\d{1,3}(?:[,.]\d+)?\s*%", body_text))

    normalized_fallback = normalize_text(fallback.replace("%", " porcento"))
    for candidate in candidates:
        if normalize_text(candidate.replace("%", " porcento")) == normalized_fallback:
            return candidate.strip()
    return candidates[0].strip() if candidates else fallback.strip()


def logout(page: Page) -> None:
    try:
        page.goto(LOGOUT_URL, wait_until="domcontentloaded", timeout=30_000)
        wait_page_ready(page, timeout_ms=30_000)
    except Exception:
        pass


def process_account(page: Page, account: Dict[str, Any]) -> Dict[str, Any]:
    result = empty_result(account)

    page = login(page, account)
    rows = get_my_assessment_rows(page)
    row = next((item for item in rows if entity_matches(item["entidade"], account)), None)
    if row is None:
        expected = expected_entity(account)
        found = [item["entidade"] for item in rows]
        raise RuntimeError(
            f"entidade esperada nao encontrada para login {account['user']}. "
            f"Esperado: {expected}. Encontrado: {found}"
        )

    result["status"] = row["status"]
    result["setor_atual"] = row["setor_atual"]
    status_norm = normalize_text(row["status"])
    if status_norm != "validado":
        result["erro"] = f"login ainda nao validado. Status atual: {row['status']}"
        return result

    result["data"] = row["data"]
    if not row["link"]:
        raise RuntimeError(f"nao foi possivel localizar o link do questionario para {account['user']}.")
    result["porcentagem"] = extract_percentage_from_questionnaire(page, row["link"], row["indice"])
    if not result["porcentagem"]:
        result["erro"] = "porcentagem nao encontrada no questionario."
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Coleta status e porcentagem no Avalia Atricon.")
    parser.add_argument("--entrada", type=Path, help="Caminho do JSON com as contas.")
    parser.add_argument(
        "--saida",
        type=Path,
        help="Caminho do JSON de saida. Padrao: resultado_atricon_<data>.json",
    )
    parser.add_argument("--headless", action="store_true", help="Executa o navegador sem abrir janela.")
    parser.add_argument("--slow-mo", type=int, default=0, help="Atraso em ms entre acoes do navegador.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.entrada or choose_json_file()
    output_path = args.saida or input_path.with_name(f"resultado_atricon_{time.strftime('%Y%m%d_%H%M%S')}.json")
    try:
        accounts = load_accounts(input_path)
    except SystemExit as exc:
        result = empty_result({})
        result["erro"] = str(exc)
        write_results(output_path, [result])
        print(f"ERRO: {exc}", file=sys.stderr)
        print(f"Saida salva em: {output_path}")
        return 1

    results: List[Dict[str, Any]] = []
    fatal_error = False

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=args.headless, slow_mo=args.slow_mo)

        for index, account in enumerate(accounts, start=1):
            user = str(account.get("user", "")).strip()
            validation_error = str(account.get("_erro_validacao", "")).strip()
            if validation_error:
                result = empty_result(account)
                result["erro"] = validation_error
                results.append(result)
                write_results(output_path, results)
                print(f"[{index}/{len(accounts)}] ERRO: {validation_error}", file=sys.stderr)
                continue

            context = browser.new_context(locale="pt-BR")
            page = context.new_page()
            login_responses: List[Dict[str, Any]] = []

            def record_login_response(response: Any) -> None:
                try:
                    request = response.request
                    if "conta.atricon.org.br/usuarios/login" not in response.url:
                        return
                    login_responses.append(
                        {
                            "url": response.url,
                            "status": response.status,
                            "method": request.method,
                            "location": response.header_value("location") or "",
                            "redirected_from": request.redirected_from.url if request.redirected_from else "",
                        }
                    )
                except PlaywrightError:
                    return

            page.on("response", record_login_response)
            try:
                print(f"[{index}/{len(accounts)}] Processando login {user}...")
                result = process_account(page, account)
                results.append(result)
                if result.get("erro"):
                    print(f"  Aviso: {result['erro']}")
                else:
                    print(f"  OK: status={result['status']} porcentagem={result['porcentagem']}")
            except Exception as exc:
                fatal_error = True
                message = f"Erro no login {user}: {exc}"
                result = empty_result(account)
                result["erro"] = message
                try:
                    debug_page = current_live_page(page)
                except RuntimeError:
                    debug_page = page

                debug_html = save_debug_html(debug_page, output_path, account)
                if debug_html:
                    result["debug_html"] = debug_html
                debug_screenshot = save_debug_screenshot(debug_page, output_path, account)
                if debug_screenshot:
                    result["debug_screenshot"] = debug_screenshot
                if login_responses:
                    result["login_responses"] = login_responses[-10:]
                results.append(
                    result
                )
                print(f"  ERRO: {message}", file=sys.stderr)
            finally:
                logout(page)
                context.close()
                write_results(output_path, results)

            if fatal_error:
                break

        browser.close()

    print(f"Saida salva em: {output_path}")
    return 1 if fatal_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
