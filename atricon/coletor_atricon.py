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
    python coletor_atricon.py install
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, List
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlparse, urlunparse

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except ImportError as exc:
    PLAYWRIGHT_IMPORT_ERROR = exc
    PlaywrightError = Exception
    PlaywrightTimeoutError = TimeoutError
    Page = Any
    sync_playwright = None
else:
    PLAYWRIGHT_IMPORT_ERROR = None


BASE_URL = "https://avalia.atricon.org.br"
LOGIN_URL = f"{BASE_URL}/login/"
OAUTH_START_URL = f"{BASE_URL}/oauth/authenticate/"
HOME_URL = f"{BASE_URL}/"
MINHAS_AVALIACOES_URL = f"{BASE_URL}/avaliacoes/minhas-avaliacoes/"
VALIDATION_ITEM_LABELS = {
    "disponibilidade": "Disponibilidade",
    "atualidade": "Atualidade",
    "serie historica": "Série Histórica",
    "gravacao de relatorios": "Gravação de Relatórios",
    "filtros de pesquisa": "Filtros de Pesquisa",
    "filtro de pesquisa": "Filtros de Pesquisa",
}
LOGOUT_URL = f"{BASE_URL}/logout/"
ORGAO_KEYS = ("orgao", "orgão", "órgão")
LOGIN_ATTEMPTS = 5
ACCEPTED_ANALYSIS_STATUSES = {"validado", "em validacao"}


def install_runtime_dependencies() -> int:
    commands = [
        [sys.executable, "-m", "pip", "install", "--upgrade", "playwright"],
        [sys.executable, "-m", "playwright", "install", "chromium"],
    ]

    for command in commands:
        print(f"Executando: {' '.join(command)}")
        completed = subprocess.run(command)
        if completed.returncode != 0:
            print("Instalacao interrompida por erro no comando acima.", file=sys.stderr)
            return completed.returncode

    print("Instalacao concluida. Agora rode:")
    print("  python atricon\\coletor_atricon.py")
    return 0


def require_playwright() -> None:
    if PLAYWRIGHT_IMPORT_ERROR is None and sync_playwright is not None:
        return

    raise SystemExit(
        "Dependencia ausente: playwright.\n"
        "Instale tudo que e necessario com:\n"
        "  python atricon\\coletor_atricon.py install"
    ) from PLAYWRIGHT_IMPORT_ERROR


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"\([^)]*\)", " ", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_percentage_text(value: str) -> str:
    match = re.search(r"\b(\d{1,3}(?:[,.]\d+)?)\s*%", value or "")
    return f"{match.group(1).strip()}%" if match else ""


def first_value(data: Dict[str, Any], keys: Iterable[str]) -> str:
    for key in keys:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def has_value(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def canonical_validation_item(value: str) -> str:
    normalized = normalize_text(value)
    return VALIDATION_ITEM_LABELS.get(normalized, clean_text(value))


def parse_brazilian_datetime(value: str) -> tuple[str, datetime | None]:
    text = clean_text(value)
    match = re.search(
        r"\b(\d{1,2}/\d{1,2}/\d{2,4})(?:\s*(?:as|às)?\s*(\d{1,2}:\d{2}(?::\d{2})?))?",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return "", None

    date_part = match.group(1)
    time_part = match.group(2) or "00:00"
    raw_value = f"{date_part} {time_part}"

    formats = (
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%y %H:%M:%S",
        "%d/%m/%y %H:%M",
    )
    for date_format in formats:
        try:
            return raw_value, datetime.strptime(raw_value, date_format)
        except ValueError:
            continue
    return raw_value, None


def expected_entity(account: Dict[str, Any]) -> str:
    orgao = first_value(account, ORGAO_KEYS)
    cidade = first_value(account, ("cidade",))
    return f"{orgao} de {cidade}".strip()


def empty_result(account: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "orgão": first_value(account, ORGAO_KEYS),
        "cidade": first_value(account, ("cidade",)),
        "user": first_value(account, ("user",)),
        "status": "",
        "setor_atual": "",
        "data": "",
        "porcentagem": "",
        "manifestacao_data": "",
        "manifestacao_historico": [],
        "manifestacao_historico_texto": "",
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


def default_input_file() -> Path:
    script_dir = Path(__file__).resolve().parent
    candidates = [
        Path.cwd() / "atricon" / "entrada" / "orgaos_avalia.json",
        script_dir / "entrada" / "orgaos_avalia.json",
        script_dir.parent / "atricon" / "entrada" / "orgaos_avalia.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit("Arquivo padrao nao encontrado: atricon/entrada/orgaos_avalia.json")


def center_tk_window(window: Any) -> None:
    window.update_idletasks()
    width = window.winfo_width()
    height = window.winfo_height()
    screen_width = window.winfo_screenwidth()
    screen_height = window.winfo_screenheight()
    x = max((screen_width - width) // 2, 0)
    y = max((screen_height - height) // 2, 0)
    window.geometry(f"{width}x{height}+{x}+{y}")


def configure_tk_style(root: Any, ttk: Any) -> None:
    root.configure(bg="#0f172a")
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("App.TFrame", background="#0f172a")
    style.configure("Panel.TFrame", background="#111827")
    style.configure("Header.TLabel", background="#0f172a", foreground="#f8fafc", font=("Segoe UI", 16, "bold"))
    style.configure("Subtle.TLabel", background="#0f172a", foreground="#cbd5e1", font=("Segoe UI", 9))
    style.configure("PanelTitle.TLabel", background="#111827", foreground="#f8fafc", font=("Segoe UI", 11, "bold"))
    style.configure("PanelText.TLabel", background="#111827", foreground="#cbd5e1", font=("Segoe UI", 9))
    style.configure("Metric.TLabel", background="#111827", foreground="#38bdf8", font=("Segoe UI", 15, "bold"))
    style.configure(
        "Action.TButton",
        padding=(12, 10),
        font=("Segoe UI", 10, "bold"),
        foreground="#ffffff",
        background="#2563eb",
        bordercolor="#1d4ed8",
        lightcolor="#2563eb",
        darkcolor="#1d4ed8",
    )
    style.map(
        "Action.TButton",
        foreground=[("disabled", "#94a3b8"), ("active", "#ffffff"), ("pressed", "#ffffff")],
        background=[("disabled", "#334155"), ("active", "#1d4ed8"), ("pressed", "#1e40af")],
        bordercolor=[("disabled", "#475569"), ("active", "#1d4ed8"), ("pressed", "#1e40af")],
    )
    style.configure(
        "Cancel.TButton",
        padding=(12, 8),
        foreground="#e2e8f0",
        background="#334155",
        bordercolor="#475569",
        lightcolor="#334155",
        darkcolor="#1f2937",
    )
    style.map(
        "Cancel.TButton",
        foreground=[("disabled", "#94a3b8"), ("active", "#ffffff"), ("pressed", "#ffffff")],
        background=[("disabled", "#1f2937"), ("active", "#475569"), ("pressed", "#1f2937")],
        bordercolor=[("disabled", "#334155"), ("active", "#64748b"), ("pressed", "#334155")],
    )
    style.configure("TCombobox", fieldbackground="#f8fafc", background="#f8fafc")
    style.configure("Treeview", rowheight=24, font=("Segoe UI", 9))
    style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"))


def company_logo_path() -> Path:
    return Path(__file__).resolve().parent / "assets" / "logo-da-empresa.png"


def load_company_logo(tk: Any, max_size: int = 44) -> Any:
    logo_path = company_logo_path()
    if not logo_path.exists():
        return None
    try:
        image = tk.PhotoImage(file=str(logo_path))
        factor = max(1, int(max(image.width() / max_size, image.height() / max_size)))
        if factor > 1:
            image = image.subsample(factor, factor)
        return image
    except Exception:
        return None


def apply_window_logo(window: Any, tk: Any) -> Any:
    image = load_company_logo(tk, max_size=64)
    if image is None:
        return None
    try:
        window.iconphoto(False, image)
        window._company_icon = image
    except Exception:
        pass
    return image


def add_window_header(parent: Any, tk: Any, ttk: Any, title: str, subtitle: str = "") -> None:
    header = ttk.Frame(parent, style="App.TFrame")
    header.pack(fill="x", pady=(0, 14))

    image = load_company_logo(tk, max_size=46)
    if image is not None:
        logo_label = tk.Label(header, image=image, bg="#0f172a", borderwidth=0, highlightthickness=0)
        logo_label.image = image
        logo_label.pack(side="left", padx=(0, 12))

    text_frame = ttk.Frame(header, style="App.TFrame")
    text_frame.pack(side="left", fill="x", expand=True)
    ttk.Label(text_frame, text=title, style="Header.TLabel").pack(anchor="w")
    if subtitle:
        ttk.Label(text_frame, text=subtitle, style="Subtle.TLabel").pack(anchor="w", pady=(4, 0))


def choose_run_in_window(default_input_path: Path, default_accounts: List[Dict[str, Any]]) -> tuple[Path, List[Dict[str, Any]]]:
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk
    except Exception as exc:  # pragma: no cover
        raise SystemExit("Interface grafica indisponivel. Use --entrada, --todos, --cidade ou --usuario.") from exc

    selected: Dict[str, Any] = {"input_path": None, "accounts": None}
    total_accounts = len(default_accounts)
    valid_accounts = [account for account in default_accounts if not account.get("_erro_validacao")]
    missing_access = total_accounts - len(valid_accounts)

    def finish(input_path: Path, accounts: List[Dict[str, Any]]) -> None:
        selected["input_path"] = input_path
        selected["accounts"] = accounts
        root.destroy()

    def select_all() -> None:
        finish(default_input_path, default_accounts)

    def select_external_json() -> None:
        path = filedialog.askopenfilename(
            title="Selecione um JSON externo",
            filetypes=(("Arquivos JSON", "*.json"), ("Todos os arquivos", "*.*")),
        )
        if not path:
            return
        try:
            accounts = load_accounts(Path(path))
        except SystemExit as exc:
            messagebox.showerror("JSON invalido", str(exc))
            return
        finish(Path(path), accounts)

    def select_specific() -> None:
        account = choose_specific_account_window(root, default_accounts)
        if account:
            finish(default_input_path, [account])

    root = tk.Tk()
    root.title("Coletor Atricon")
    root.geometry("720x520")
    root.resizable(False, False)
    configure_tk_style(root, ttk)
    apply_window_logo(root, tk)

    frame = ttk.Frame(root, padding=18, style="App.TFrame")
    frame.pack(fill="both", expand=True)

    add_window_header(
        frame,
        tk,
        ttk,
        "Coletor Atricon",
        f"Base padrao: {default_input_path}",
    )

    metrics = ttk.Frame(frame, style="App.TFrame")
    metrics.pack(fill="x", pady=(0, 14))
    for title, value in (
        ("Registros", str(total_accounts)),
        ("Com acesso", str(len(valid_accounts))),
        ("Sem acesso", str(missing_access)),
    ):
        box = ttk.Frame(metrics, padding=14, style="Panel.TFrame")
        box.pack(side="left", fill="x", expand=True, padx=(0, 10))
        ttk.Label(box, text=title.upper(), style="PanelText.TLabel").pack(anchor="w")
        ttk.Label(box, text=value, style="Metric.TLabel").pack(anchor="w", pady=(3, 0))

    ttk.Label(frame, text="Escolha como deseja iniciar a verificacao", style="PanelTitle.TLabel").pack(anchor="w", pady=(0, 8))

    actions = ttk.Frame(frame, style="App.TFrame")
    actions.pack(fill="x")
    ttk.Button(actions, text="Verificar todas as cidades", style="Action.TButton", command=select_all).pack(fill="x", pady=4)
    ttk.Label(actions, text="Usa o orgaos_avalia.json e coleta apenas status/porcentagem, sem manifestacoes.", style="Subtle.TLabel").pack(anchor="w", padx=4, pady=(0, 6))
    ttk.Button(actions, text="Verificar uma cidade ou usuario especifico", style="Action.TButton", command=select_specific).pack(fill="x", pady=4)
    ttk.Label(actions, text="Permite escolher orgao e cidade; nesse modo tambem coleta as manifestacoes/evidencias.", style="Subtle.TLabel").pack(anchor="w", padx=4, pady=(0, 6))
    ttk.Button(actions, text="Verificar um JSON externo", style="Action.TButton", command=select_external_json).pack(fill="x", pady=4)

    footer = ttk.Frame(frame, style="App.TFrame")
    footer.pack(fill="x", pady=(12, 0))
    ttk.Button(footer, text="Cancelar", style="Cancel.TButton", command=root.destroy).pack(side="right")

    center_tk_window(root)
    root.mainloop()

    if not selected["input_path"] or selected["accounts"] is None:
        raise SystemExit("Nenhuma opcao selecionada.")
    return selected["input_path"], selected["accounts"]


def choose_specific_account_window(parent: Any, accounts: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    import tkinter as tk
    from tkinter import messagebox, ttk

    available = [account for account in accounts if isinstance(account, dict)]
    if not available:
        messagebox.showerror("Sem dados", "Nenhum usuario encontrado no JSON.")
        return None

    selected: Dict[str, Any] = {"account": None}
    window = tk.Toplevel(parent)
    window.title("Escolher cidade ou usuario")
    window.geometry("900x640")
    window.resizable(False, False)
    configure_tk_style(window, ttk)
    apply_window_logo(window, tk)
    window.transient(parent)
    window.grab_set()

    frame = ttk.Frame(window, padding=18, style="App.TFrame")
    frame.pack(fill="both", expand=True)

    add_window_header(
        frame,
        tk,
        ttk,
        "Selecionar verificacao especifica",
        "Filtre pelo orgao, cidade ou usuario e confirme o registro desejado.",
    )

    orgaos = sorted(
        {first_value(account, ORGAO_KEYS) for account in available if first_value(account, ORGAO_KEYS)},
        key=lambda value: normalize_text(value),
    )
    orgao_var = tk.StringVar(value="Todos")
    search_var = tk.StringVar(value="")
    current_accounts: List[Dict[str, Any]] = []

    filters = ttk.Frame(frame, style="App.TFrame")
    filters.pack(fill="x", pady=(0, 12))

    orgao_box = ttk.Frame(filters, style="App.TFrame")
    orgao_box.pack(side="left", fill="x", expand=True, padx=(0, 10))
    ttk.Label(orgao_box, text="Orgao", style="Subtle.TLabel").pack(anchor="w")
    orgao_combo = ttk.Combobox(orgao_box, textvariable=orgao_var, values=["Todos"] + orgaos, state="readonly")
    orgao_combo.pack(fill="x", pady=(4, 0))

    search_box = ttk.Frame(filters, style="App.TFrame")
    search_box.pack(side="left", fill="x", expand=True)
    ttk.Label(search_box, text="Busca", style="Subtle.TLabel").pack(anchor="w")
    search_entry = ttk.Entry(search_box, textvariable=search_var)
    search_entry.pack(fill="x", pady=(4, 0))

    table_frame = ttk.Frame(frame, style="Panel.TFrame")
    table_frame.pack(fill="both", expand=True)

    columns = ("orgao", "cidade", "usuario", "situacao")
    table = ttk.Treeview(table_frame, columns=columns, show="headings", height=18)
    table.heading("orgao", text="Orgao")
    table.heading("cidade", text="Cidade")
    table.heading("usuario", text="Usuario")
    table.heading("situacao", text="Situacao")
    table.column("orgao", width=230, anchor="w")
    table.column("cidade", width=230, anchor="w")
    table.column("usuario", width=180, anchor="w")
    table.column("situacao", width=120, anchor="w")
    scrollbar = ttk.Scrollbar(table_frame, orient="vertical", command=table.yview)
    table.configure(yscrollcommand=scrollbar.set)
    table.pack(side="left", fill="both", expand=True, padx=1, pady=1)
    scrollbar.pack(side="right", fill="y")

    info_var = tk.StringVar(value="")
    ttk.Label(frame, textvariable=info_var, style="Subtle.TLabel").pack(anchor="w", pady=(8, 0))

    def account_row_values(account: Dict[str, Any]) -> tuple[str, str, str, str]:
        orgao = first_value(account, ORGAO_KEYS) or "sem orgao"
        cidade = first_value(account, ("cidade",)) or "sem cidade"
        user = str(account.get("user", "") or "").strip() or "sem usuario"
        situacao = "Sem acesso" if account.get("_erro_validacao") else "Pronto"
        return orgao, cidade, user, situacao

    def refresh_accounts(*_: Any) -> None:
        nonlocal current_accounts
        selected_orgao = orgao_var.get()
        search = normalize_text(search_var.get())
        filtered = []
        for account in available:
            orgao, cidade, user, situacao = account_row_values(account)
            if selected_orgao != "Todos" and orgao != selected_orgao:
                continue
            haystack = normalize_text(f"{orgao} {cidade} {user} {situacao}")
            if search and search not in haystack:
                continue
            filtered.append(account)

        filtered.sort(key=lambda account: normalize_text(" ".join(account_row_values(account)[:2])))
        current_accounts = filtered
        table.delete(*table.get_children())
        for index, account in enumerate(current_accounts):
            table.insert("", "end", iid=str(index), values=account_row_values(account))
        if current_accounts:
            table.selection_set("0")
            table.focus("0")
        info_var.set(f"{len(current_accounts)} registro(s) encontrado(s).")

    def confirm() -> None:
        selection = table.selection()
        if not selection:
            messagebox.showwarning("Selecione um registro", "Escolha uma cidade para continuar.")
            return
        account = current_accounts[int(selection[0])]
        if account.get("_erro_validacao"):
            proceed = messagebox.askyesno(
                "Registro sem acesso",
                "Este registro esta sem usuario/senha completos. Deseja continuar mesmo assim?",
            )
            if not proceed:
                return
        selected["account"] = account
        window.destroy()

    orgao_combo.bind("<<ComboboxSelected>>", refresh_accounts)
    search_var.trace_add("write", refresh_accounts)
    table.bind("<Double-1>", lambda _event: confirm())
    refresh_accounts()
    search_entry.focus_set()

    buttons = ttk.Frame(frame, style="App.TFrame")
    buttons.pack(fill="x", pady=(12, 0))
    confirm_button = ttk.Button(buttons, text="Confirmar selecao", style="Action.TButton", command=confirm, width=22)
    cancel_button = ttk.Button(buttons, text="Cancelar", style="Cancel.TButton", command=window.destroy, width=14)
    confirm_button.pack(side="right", ipadx=10, ipady=2)
    cancel_button.pack(side="right", padx=(0, 10), ipadx=10, ipady=2)

    center_tk_window(window)
    parent.wait_window(window)
    return selected["account"]


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

    data = complete_accounts_from_access_file(path, data)

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


def account_access_key(account: Dict[str, Any]) -> str:
    orgao = first_value(account, ORGAO_KEYS)
    cidade = first_value(account, ("cidade",))
    return f"{normalize_text(orgao)}|{normalize_text(cidade)}"


def access_file_candidates(input_path: Path) -> List[Path]:
    script_dir = Path(__file__).resolve().parent
    candidates = [
        input_path.with_name("orgaos_avalia.json"),
        input_path.parent / "orgaos_avalia.json",
        script_dir / "entrada" / "orgaos_avalia.json",
        script_dir.parent / "atricon" / "entrada" / "orgaos_avalia.json",
        Path.cwd() / "atricon" / "entrada" / "orgaos_avalia.json",
    ]

    unique_candidates: List[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        try:
            key = str(candidate.resolve())
        except OSError:
            key = str(candidate)
        if key not in seen:
            unique_candidates.append(candidate)
            seen.add(key)
    return unique_candidates


def load_access_map(input_path: Path) -> tuple[Dict[str, Dict[str, Any]], str]:
    for candidate in access_file_candidates(input_path):
        if not candidate.exists() or candidate.resolve() == input_path.resolve():
            continue
        try:
            with candidate.open("r", encoding="utf-8") as file:
                data = json.load(file)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict):
            data = [data]
        if not isinstance(data, list):
            continue

        access_map: Dict[str, Dict[str, Any]] = {}
        for item in data:
            if not isinstance(item, dict):
                continue
            key = account_access_key(item)
            if key and has_value(item.get("user")) and has_value(item.get("senha")):
                access_map[key] = item
        if access_map:
            return access_map, str(candidate)
    return {}, ""


def complete_accounts_from_access_file(input_path: Path, data: List[Any]) -> List[Any]:
    needs_access = any(
        isinstance(item, dict)
        and (not has_value(item.get("user")) or not has_value(item.get("senha")))
        for item in data
    )
    if not needs_access:
        return data

    access_map, access_path = load_access_map(input_path)
    if not access_map:
        return data

    completed: List[Any] = []
    filled = 0
    for item in data:
        if not isinstance(item, dict):
            completed.append(item)
            continue

        account = dict(item)
        access = access_map.get(account_access_key(account))
        if access:
            if not has_value(account.get("user")) and has_value(access.get("user")):
                account["user"] = access["user"]
                filled += 1
            if not has_value(account.get("senha")) and has_value(access.get("senha")):
                account["senha"] = access["senha"]
        completed.append(account)

    if filled:
        print(f"Acessos preenchidos a partir de: {access_path}")
    return completed


def write_results(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(results, file, ensure_ascii=False, indent=2)


def safe_filename(value: str) -> str:
    value = normalize_text(value)
    value = re.sub(r"[^a-z0-9_-]+", "_", value).strip("_")
    return value or "sem_identificacao"


def account_label(account: Dict[str, Any], index: int) -> str:
    orgao = first_value(account, ORGAO_KEYS) or "sem orgao"
    cidade = first_value(account, ("cidade",)) or "sem cidade"
    user = str(account.get("user", "") or "").strip() or "sem usuario"
    status = " invalido" if account.get("_erro_validacao") else ""
    return f"{index}. {orgao} de {cidade} - {user}{status}"


def account_matches_filter(account: Dict[str, Any], cidade: str = "", usuario: str = "") -> bool:
    if cidade and normalize_text(cidade) not in normalize_text(first_value(account, ("cidade",))):
        return False
    if usuario and normalize_text(usuario) not in normalize_text(str(account.get("user", "") or "")):
        return False
    return True


def choose_accounts(accounts: List[Dict[str, Any]], args: argparse.Namespace) -> List[Dict[str, Any]]:
    if args.todos:
        return accounts

    if args.cidade or args.usuario:
        selected = [
            account
            for account in accounts
            if account_matches_filter(account, args.cidade or "", args.usuario or "")
        ]
        if not selected:
            raise SystemExit("Nenhum usuario encontrado com os filtros informados.")
        return selected

    valid_accounts = [account for account in accounts if not account.get("_erro_validacao")]
    if not valid_accounts:
        return accounts

    if not sys.stdin.isatty():
        print("Entrada nao interativa detectada; analisando todas as cidades.")
        return accounts

    print("\nO que deseja fazer?")
    print("1 - Verificar todas as cidades")
    print("2 - Verificar uma cidade/usuario especifico")
    choice = input("Opcao [1/2]: ").strip()

    if choice != "2":
        return accounts

    print("\nUsuarios disponiveis:")
    for index, account in enumerate(valid_accounts, start=1):
        print(account_label(account, index))

    while True:
        selected = input("Digite o numero, cidade ou usuario: ").strip()
        if not selected:
            print("Informe uma opcao valida.")
            continue

        if selected.isdigit():
            selected_index = int(selected)
            if 1 <= selected_index <= len(valid_accounts):
                return [valid_accounts[selected_index - 1]]

        matches = [
            account
            for account in valid_accounts
            if account_matches_filter(account, cidade=selected)
            or account_matches_filter(account, usuario=selected)
        ]
        if len(matches) == 1:
            return matches
        if len(matches) > 1:
            print("Mais de um usuario encontrado. Escolha pelo numero:")
            for index, account in enumerate(matches, start=1):
                print(account_label(account, index))
            selected_match = input("Numero: ").strip()
            if selected_match.isdigit() and 1 <= int(selected_match) <= len(matches):
                return [matches[int(selected_match) - 1]]

        print("Usuario/cidade nao encontrado. Tente novamente.")


def default_output_path(input_path: Path, accounts: List[Dict[str, Any]]) -> Path:
    result_root = input_path.parent / ".resultado"
    valid_accounts = [account for account in accounts if not account.get("_erro_validacao")]
    if len(valid_accounts) == 1:
        account = valid_accounts[0]
        orgao = safe_filename(first_value(account, ORGAO_KEYS))
        cidade = first_value(account, ("cidade",))
        primeiro_nome_cidade = safe_filename(cidade.split()[0] if cidade.split() else cidade)
        return result_root / "particular" / f"resultado_atricon_{orgao}_{primeiro_nome_cidade}.json"
    return result_root / "geral" / f"resultado_geral_atricon_{time.strftime('%H')}hrs.json"


def report_image_dir(output_path: Path) -> Path:
    return output_path.parent / "imagens" / output_path.stem


def image_extension_from_type(content_type: str, source_url: str = "") -> str:
    content_type = (content_type or "").split(";")[0].strip().lower()
    by_type = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/bmp": ".bmp",
    }
    if content_type in by_type:
        return by_type[content_type]

    suffix = Path(urlparse(source_url).path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".png"


def image_source_groups_from_element(locator: Any) -> List[List[str]]:
    try:
        return locator.evaluate(
            """
            element => Array.from(element.querySelectorAll('img')).map(img => {
              const sources = [];
              const push = (value) => {
                if (!value) return;
                try {
                  const absolute = new URL(value, document.baseURI).href;
                  if (!sources.includes(absolute)) sources.push(absolute);
                } catch (error) {}
              };

              const anchor = img.closest('a[href]');
              if (anchor) push(anchor.getAttribute('href'));

              [
                'data-full',
                'data-original',
                'data-src',
                'data-large',
                'data-url',
                'data-image',
                'data-zoom-image',
                'data-download-url'
              ].forEach(attr => push(img.getAttribute(attr)));

              const srcset = img.getAttribute('srcset') || '';
              srcset.split(',').forEach(part => {
                const candidate = part.trim().split(/\\s+/)[0];
                push(candidate);
              });

              push(img.currentSrc);
              push(img.src);
              push(img.getAttribute('src'));
              return sources;
            }).filter(group => group.length)
            """
        )
    except PlaywrightError:
        return []


def fetch_image_candidate(page: Page, source: str) -> tuple[bytes, str]:
    if source.startswith("data:image/"):
        header, encoded = source.split(",", 1)
        content_type = header.split(";", 1)[0].removeprefix("data:")
        return base64.b64decode(encoded), content_type

    response = page.context.request.get(source, timeout=30_000)
    if not response.ok:
        return b"", ""
    return response.body(), response.headers.get("content-type", "")


def download_evidence_images(
    page: Page,
    locator: Any,
    output_path: Path,
    questionario_id: str,
    criterio_id: str,
    message_order: int,
) -> List[str]:
    source_groups = image_source_groups_from_element(locator)
    if not source_groups:
        return []

    image_dir = report_image_dir(output_path)
    image_dir.mkdir(parents=True, exist_ok=True)

    saved_paths: List[str] = []
    for image_index, sources in enumerate(source_groups, start=1):
        try:
            best_content = b""
            best_content_type = ""
            best_source = ""
            for source in sources:
                content, content_type = fetch_image_candidate(page, source)
                if len(content) > len(best_content):
                    best_content = content
                    best_content_type = content_type
                    best_source = source

            if not best_content:
                continue

            extension = image_extension_from_type(best_content_type, best_source)
            image_name = (
                f"{questionario_id or 'questionario'}_"
                f"{criterio_id or 'criterio'}_"
                f"{message_order:02d}_{image_index:02d}{extension}"
            )
            image_path = image_dir / image_name
            image_path.write_bytes(best_content)
            saved_paths.append(str(image_path))
        except Exception:
            continue

    return saved_paths


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


def is_authenticated_avalia_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.netloc == "avalia.atricon.org.br" and not parsed.path.startswith("/login")


def wait_for_avalia_redirect(page: Page, timeout_ms: int = 45_000) -> Page:
    deadline = time.monotonic() + (timeout_ms / 1000)
    last_url = ""
    tried_authorize_next = False

    while time.monotonic() < deadline:
        try:
            page = current_live_page(page)
            last_url = page.url
            if is_authenticated_avalia_url(last_url):
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
        "a autenticacao parece ter voltado para a tela publica de login do Avalia sem concluir a sessao. "
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
    last_error = ""

    for attempt in range(1, LOGIN_ATTEMPTS + 1):
        try:
            start_login_flow(page)
            if is_authenticated_avalia_url(page.url):
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
                raise RuntimeError(
                    "login aparentemente nao foi concluido: o fluxo voltou para a tela de login em vez de abrir uma pagina autenticada. "
                    f"URL atual: {page.url}"
                )
            return page
        except RuntimeError as exc:
            last_error = str(exc)
            retryable_error = (
                "login aparentemente nao foi concluido" in last_error
                or "nao houve redirecionamento para a Conta Atricon" in last_error
                or "login nao foi aceito pela Conta Atricon" in last_error
            )
            if not retryable_error or attempt >= LOGIN_ATTEMPTS:
                raise

            try:
                page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=20_000)
                wait_page_ready(page)
            except PlaywrightError:
                pass
            time.sleep(min(5, attempt))

    raise RuntimeError(last_error or "login nao foi concluido.")


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


def extract_history_from_questionnaire_view(page: Page, url: str) -> Dict[str, Any]:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        wait_page_ready(page)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(f"questionario nao carregou: {url}") from exc

    history_entries: List[Dict[str, str]] = []
    history_pattern = re.compile(
        r"^(?P<setor>.*?)\s+Envio para Manifesta\S*\s+at\S*\s+(?P<data>\d{1,2}/\d{1,2}/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$",
        flags=re.IGNORECASE,
    )
    action_pattern = re.compile(
        r"\bEnvio\s+para\s+Manifesta\S*\s+at\S*\s+(?P<data>\d{1,2}/\d{1,2}/\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)",
        flags=re.IGNORECASE,
    )

    try:
        timeline_cards = page.locator(".timeline-card").evaluate_all(
            """
            cards => cards.map(card => {
              const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const movementDate = clean(card.querySelector('.text-muted.small')?.innerText || '');
              const sector = clean(card.querySelector('.fw-semibold')?.innerText || '');
              const actions = Array.from(card.querySelectorAll('.text-muted.small.mb-1'))
                .map(node => clean(node.innerText || node.textContent || ''))
                .filter(Boolean);
              return {
                data_tramitacao: movementDate,
                setor: sector,
                acoes: actions,
                texto: clean(card.innerText || card.textContent || '')
              };
            })
            """
        )
    except PlaywrightError:
        timeline_cards = []

    if isinstance(timeline_cards, list):
        for card in timeline_cards:
            if not isinstance(card, dict):
                continue
            setor = clean_text(str(card.get("setor") or ""))
            movement_date, movement_value = parse_brazilian_datetime(str(card.get("data_tramitacao") or ""))
            for action in card.get("acoes") or []:
                action_text = clean_text(str(action or ""))
                action_match = action_pattern.search(action_text)
                if not action_match:
                    continue
                data_text, data_value = parse_brazilian_datetime(action_match.group("data"))
                history_entries.append(
                    {
                        "setor": setor,
                        "data": data_text,
                        "data_tramitacao": movement_date,
                        "texto": clean_text(str(card.get("texto") or action_text)),
                        "timestamp": data_value.isoformat(sep=" ") if data_value else "",
                        "timestamp_tramitacao": movement_value.isoformat(sep=" ") if movement_value else "",
                    }
                )

    body_text = ""
    try:
        body_text = page.locator("body").inner_text(timeout=10_000)
    except PlaywrightError:
        body_text = ""

    if not history_entries:
        last_movement_date = ""
        last_movement_value: datetime | None = None
        last_setor = ""
        for raw_line in re.split(r"[\r\n]+", body_text):
            line = clean_text(raw_line)
            if not line:
                continue

            parsed_date, parsed_value = parse_brazilian_datetime(line)
            if parsed_date and parsed_date == line:
                last_movement_date = parsed_date
                last_movement_value = parsed_value
                last_setor = ""
                continue

            action_match = action_pattern.search(line)
            match = history_pattern.match(line)
            if action_match:
                setor = clean_text(match.group("setor")) if match else last_setor
                data_text, data_value = parse_brazilian_datetime(action_match.group("data"))
                history_entries.append(
                    {
                        "setor": setor,
                        "data": data_text,
                        "data_tramitacao": last_movement_date,
                        "texto": line if not setor else f"{setor} {line}",
                        "timestamp": data_value.isoformat(sep=" ") if data_value else "",
                        "timestamp_tramitacao": last_movement_value.isoformat(sep=" ") if last_movement_value else "",
                    }
                )
                continue

            if last_movement_date and not last_setor:
                last_setor = line

    latest_history = history_entries[0] if history_entries else {}
    return {
        "manifestacao_data": str(latest_history.get("data", "") or ""),
        "manifestacao_historico": history_entries,
        "manifestacao_historico_texto": "; ".join(
            f"{item['setor']} -> {item['data']}" for item in history_entries
        ),
    }


def extract_percentage_from_loaded_questionnaire(page: Page, fallback: str = "") -> str:
    percentage_boxes = page.locator("div.display-6.fw-bold")
    try:
        for index in range(percentage_boxes.count()):
            percentage = normalize_percentage_text(percentage_boxes.nth(index).inner_text(timeout=10_000))
            if percentage:
                return percentage
    except PlaywrightError:
        pass

    return fallback.strip()


def extract_percentage_from_questionnaire(page: Page, url: str, fallback: str = "") -> str:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45_000)
        wait_page_ready(page)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(f"questionario nao carregou: {url}") from exc

    # Fallback seguro: coluna "Indice" da tabela Minhas Avaliacoes. Nao varre outros
    # componentes com porcentagem dentro do questionario.
    return extract_percentage_from_loaded_questionnaire(page, fallback)


def questionnaire_form_url(row: Dict[str, str]) -> str:
    if row.get("questionario_id"):
        return f"{BASE_URL}/questionarios/{row['questionario_id']}/questionario-form/"
    if row.get("link"):
        return row["link"].replace("/view/", "/questionario-form/")
    return ""


def get_active_chapter_title(page: Page) -> str:
    try:
        return clean_text(page.locator("#dimensoes .nav-link.active").first.inner_text(timeout=5_000))
    except PlaywrightError:
        return ""


def get_active_pane_id(page: Page) -> str:
    try:
        active_pane = page.locator(".tab-pane.active.show, .tab-pane.active").first
        if active_pane.count() > 0:
            return active_pane.get_attribute("id", timeout=5_000) or ""
    except PlaywrightError:
        pass

    try:
        href = page.locator("#dimensoes .nav-link.active").first.get_attribute("href", timeout=5_000) or ""
    except PlaywrightError:
        return ""

    match = re.search(r"#([^#]+)$", href)
    return match.group(1) if match else ""


def get_active_pane(page: Page) -> Any:
    pane_id = get_active_pane_id(page)
    if pane_id:
        return page.locator(f"#{pane_id}").first
    return page.locator(".tab-pane.active.show, .tab-pane.active").first


def absolute_inner_html(locator: Any) -> str:
    try:
        return locator.evaluate(
            """
            element => {
              const clone = element.cloneNode(true);
              clone.querySelectorAll('img[src]').forEach(img => {
                img.setAttribute('src', new URL(img.getAttribute('src'), document.baseURI).href);
              });
              clone.querySelectorAll('a[href]').forEach(link => {
                link.setAttribute('href', new URL(link.getAttribute('href'), document.baseURI).href);
              });
              return clone.innerHTML.trim();
            }
            """
        )
    except PlaywrightError:
        return ""


def evidence_content_text(locator: Any) -> str:
    try:
        return clean_text(
            locator.evaluate(
                """
                element => {
                  const clone = element.cloneNode(true);
                  Array.from(clone.childNodes).forEach(node => {
                    if (node.nodeType === Node.COMMENT_NODE) node.remove();
                  });
                  clone.querySelectorAll('script, style, .note-toolbar, .note-statusbar, .note-popover, .note-modal').forEach(node => {
                    node.remove();
                  });

                  const read = (node) => (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
                  const preferred = clone.querySelector('.mb-0, .card-text, .note-editable, [data-evidence-content]');
                  const preferredText = preferred ? read(preferred) : '';
                  if (preferredText) return preferredText;

                  clone.querySelectorAll('.d-flex.justify-content-between.align-items-center.mb-2, .badge, button, script, style').forEach(node => {
                    node.remove();
                  });
                  return read(clone);
                }
                """
            )
        )
    except PlaywrightError:
        return ""


def extract_criterion_context(button: Any) -> Dict[str, Any]:
    empty = {
        "criterio": "",
        "grau_importancia": "",
        "validacoes_avaliacao": [],
        "validacoes_validacao": [],
        "validacoes_nao_atendidas": [],
        "validacoes_nao_atendidas_texto": "",
    }

    try:
        data = button.evaluate(
            """
            (button) => {
              const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
              const normalize = (value) => clean(value)
                .normalize('NFD')
                .replace(/[\\u0300-\\u036f]/g, '')
                .toLowerCase();
              const card = button.closest('.card');
              if (!card) return {};

              const titleNode = card.querySelector('[data-bs-target^="#Criterio"], [data-bs-target*="Criterio"]');
              const titleClone = titleNode ? titleNode.cloneNode(true) : null;
              const titleBadge = titleClone ? titleClone.querySelector('.badge') : null;
              const grau = titleBadge ? clean(titleBadge.textContent) : '';
              if (titleBadge) titleBadge.remove();
              const criterio = clean(titleClone ? titleClone.textContent : '');

              const readColumn = (needle) => {
                const headers = Array.from(card.querySelectorAll('h6'));
                const header = headers.find((item) => normalize(item.textContent).includes(needle));
                const column = header ? header.closest('[class*="col-"]') : null;
                if (!column) return [];
                return Array.from(column.querySelectorAll('.mb-2')).map((item) => {
                  const badge = item.querySelector('.badge');
                  const clone = item.cloneNode(true);
                  const cloneBadge = clone.querySelector('.badge');
                  if (cloneBadge) cloneBadge.remove();
                  return {
                    item: clean(clone.textContent),
                    status: clean(badge ? badge.textContent : '')
                  };
                }).filter((item) => item.item);
              };

              const validacao = readColumn('validacao');
              return {
                criterio,
                grau_importancia: grau,
                validacoes_avaliacao: readColumn('avaliacao'),
                validacoes_validacao: validacao,
                validacoes_nao_atendidas: validacao
                  .filter((item) => normalize(item.status).startsWith('nao'))
                  .map((item) => item.item)
              };
            }
            """
        )
    except PlaywrightError:
        return empty

    context = dict(empty)
    context["criterio"] = clean_text(str(data.get("criterio") or ""))
    context["grau_importancia"] = clean_text(str(data.get("grau_importancia") or ""))
    context["validacoes_avaliacao"] = [
        {
            "item": canonical_validation_item(str(item.get("item") or "")),
            "status": clean_text(str(item.get("status") or "")),
        }
        for item in data.get("validacoes_avaliacao") or []
        if isinstance(item, dict) and clean_text(str(item.get("item") or ""))
    ]
    context["validacoes_validacao"] = [
        {
            "item": canonical_validation_item(str(item.get("item") or "")),
            "status": clean_text(str(item.get("status") or "")),
        }
        for item in data.get("validacoes_validacao") or []
        if isinstance(item, dict) and clean_text(str(item.get("item") or ""))
    ]
    failures: List[str] = []
    for item in data.get("validacoes_nao_atendidas") or []:
        label = canonical_validation_item(str(item or ""))
        if label and label not in failures:
            failures.append(label)
    context["validacoes_nao_atendidas"] = failures
    context["validacoes_nao_atendidas_texto"] = ", ".join(failures)
    return context


def extract_modal_validation_evidences(
    page: Page,
    modal_selector: str,
    chapter_title: str,
    questionario_id: str,
    criterio_id: str,
    start_order: int,
    output_path: Path,
    criterio_context: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    modal = page.locator(modal_selector).first
    desc = modal.locator("p.card-title-desc").first

    tipo = ""
    titulo = ""
    try:
        tipo = clean_text(desc.locator(".badge").first.inner_text(timeout=3_000))
        desc_text = clean_text(desc.inner_text(timeout=3_000))
        titulo = clean_text(desc_text.replace(tipo, "", 1))
    except PlaywrightError:
        pass

    raw_evidencias: List[Dict[str, Any]] = []
    items = modal.locator("ul[id^='timeline'] > li")
    for item_index in range(items.count()):
        item = items.nth(item_index)
        try:
            badge_text = clean_text(item.locator(".badge").first.inner_text(timeout=1_500))
        except PlaywrightError:
            continue

        if not normalize_text(badge_text).startswith("valida"):
            continue

        card_body = item.locator(".flex-grow-1 .card .card-body").first
        conteudo_texto = evidence_content_text(card_body)
        imagens = download_evidence_images(
            page,
            item,
            output_path,
            questionario_id,
            criterio_id,
            len(raw_evidencias) + 1,
        )
        item_text = ""
        try:
            item_text = clean_text(item.inner_text(timeout=3_000))
        except PlaywrightError:
            item_text = conteudo_texto
        data_evidencia, data_ordenacao = parse_brazilian_datetime(item_text)

        raw_evidencias.append(
            {
                "titulo": chapter_title,
                "criterio_id": criterio_id,
                "tipo": tipo,
                "titulo_evidencia": titulo,
                "conteudo_texto": conteudo_texto,
                "imagens": imagens,
                "data_evidencia": data_evidencia,
                "_data_ordenacao": data_ordenacao,
                "_ordem_dom": item_index,
            }
        )

    raw_evidencias.sort(
        key=lambda evidence: (
            evidence["_data_ordenacao"] is None,
            evidence["_data_ordenacao"] or datetime.max,
            -evidence["_ordem_dom"],
        )
    )
    raw_evidencias.reverse()

    if not raw_evidencias:
        return []

    mensagens: List[Dict[str, Any]] = []
    for evidence in raw_evidencias:
        evidence.pop("_data_ordenacao", None)
        evidence.pop("_ordem_dom", None)
        evidence["ordem_na_evidencia"] = len(mensagens) + 1
        evidence["total_mensagens_evidencia"] = len(raw_evidencias)
        mensagens.append(evidence)

    base = mensagens[0]
    evidence_group: Dict[str, Any] = {
        "titulo": base["titulo"],
        "criterio_id": base["criterio_id"],
        "tipo": base["tipo"],
        "titulo_evidencia": base["titulo_evidencia"],
        "data_evidencia": base["data_evidencia"],
        "conteudo_texto": "\n\n".join(
            message["conteudo_texto"] for message in mensagens if message["conteudo_texto"]
        ),
        "imagens": [
            image
            for message in mensagens
            for image in message.get("imagens", [])
        ],
        "total_mensagens_evidencia": len(mensagens),
        "numero_evidencia": f"{questionario_id or 'questionario'}-{criterio_id or 'criterio'}-{start_order:04d}",
        "ordem": start_order,
        "mensagens_evidencia": [],
    }

    if criterio_context:
        evidence_group.update(
            {
                "criterio": criterio_context.get("criterio", ""),
                "grau_importancia": criterio_context.get("grau_importancia", ""),
                "validacoes_avaliacao": criterio_context.get("validacoes_avaliacao", []),
                "validacoes_validacao": criterio_context.get("validacoes_validacao", []),
                "validacoes_nao_atendidas": criterio_context.get("validacoes_nao_atendidas", []),
                "validacoes_nao_atendidas_texto": criterio_context.get("validacoes_nao_atendidas_texto", ""),
            }
        )

    for message in mensagens:
        ordem_mensagem = message["ordem_na_evidencia"]
        evidence_group[f"data_evidencia_{ordem_mensagem}"] = message["data_evidencia"]
        evidence_group[f"conteudo_texto_{ordem_mensagem}"] = message["conteudo_texto"]
        evidence_group[f"imagens_{ordem_mensagem}"] = message.get("imagens", [])
        evidence_group["mensagens_evidencia"].append(
            {
                "ordem": ordem_mensagem,
                "data_evidencia": message["data_evidencia"],
                "conteudo_texto": message["conteudo_texto"],
                "imagens": message.get("imagens", []),
            }
        )

    return [evidence_group]


def click_next_chapter_link(page: Page, current_pane_id: str) -> bool:
    links = page.locator("#dimensoes .nav-link")
    total = links.count()
    current_index = -1

    for index in range(total):
        href = links.nth(index).get_attribute("href") or ""
        if href.endswith(f"#{current_pane_id}"):
            current_index = index
            break

    if current_index < 0 or current_index + 1 >= total:
        return False

    try:
        links.nth(current_index + 1).click(force=True)
        return True
    except PlaywrightError:
        return False


def wait_for_chapter_change(page: Page, previous_pane_id: str, timeout_ms: int = 10_000) -> bool:
    try:
        page.wait_for_function(
            """
            (previousId) => {
              const activePane = document.querySelector('.tab-pane.active.show, .tab-pane.active');
              if (activePane && activePane.id !== previousId) return true;
              const activeLink = document.querySelector('#dimensoes .nav-link.active');
              const href = activeLink ? activeLink.getAttribute('href') || '' : '';
              return href && !href.endsWith('#' + previousId);
            }
            """,
            arg=previous_pane_id,
            timeout=timeout_ms,
        )
        return True
    except PlaywrightTimeoutError:
        return False


def click_next_chapter(page: Page, active_pane: Any, current_pane_id: str) -> bool:
    try:
        called_function = page.evaluate(
            """
            () => {
              if (typeof mostrarProximaAba !== 'function') return false;
              mostrarProximaAba();
              return true;
            }
            """
        )
        if called_function and wait_for_chapter_change(page, current_pane_id):
            return True
    except PlaywrightError:
        pass

    next_selectors = [
        "button[onclick*='mostrarProximaAba']",
        "button:has-text('Próximo')",
        "button:has-text('Proximo')",
    ]

    for selector in next_selectors:
        next_button = active_pane.locator(selector).first
        if next_button.count() == 0:
            continue

        try:
            next_button.scroll_into_view_if_needed(timeout=5_000)
        except PlaywrightTimeoutError:
            pass

        try:
            next_button.click(force=True)
        except PlaywrightError:
            continue

        if wait_for_chapter_change(page, current_pane_id):
            return True

    if click_next_chapter_link(page, current_pane_id):
        return wait_for_chapter_change(page, current_pane_id)

    try:
        target_id = page.evaluate(
            """
            (currentPaneId) => {
              const links = Array.from(document.querySelectorAll('#dimensoes .nav-link'));
              const currentIndex = links.findIndex((link) => {
                const href = link.getAttribute('href') || '';
                return href.endsWith('#' + currentPaneId) || link.classList.contains('active');
              });
              if (currentIndex < 0 || currentIndex + 1 >= links.length) return '';

              const nextLink = links[currentIndex + 1];
              const href = nextLink.getAttribute('href') || '';
              const targetId = href.includes('#') ? href.split('#').pop() : nextLink.getAttribute('aria-controls');
              if (!targetId) return '';

              nextLink.click();
              const pane = document.getElementById(targetId);
              if (!pane || !pane.classList.contains('active')) {
                links.forEach((link) => link.classList.remove('active'));
                nextLink.classList.add('active');
                document.querySelectorAll('.tab-pane').forEach((item) => {
                  item.classList.remove('active', 'show');
                });
                if (pane) pane.classList.add('active', 'show');
              }

              const dimensoes = document.getElementById('dimensoes');
              if (dimensoes && nextLink.parentElement) {
                dimensoes.scrollLeft = nextLink.parentElement.offsetLeft;
              }
              window.scrollTo(0, 0);
              return targetId;
            }
            """,
            current_pane_id,
        )
        if target_id and wait_for_chapter_change(page, current_pane_id, timeout_ms=2_000):
            return True
    except PlaywrightError:
        pass

    return False


def wait_modal_evidences_loaded(page: Page, modal_selector: str, timeout_ms: int = 20_000) -> bool:
    match = re.search(r"modalEvidencias(\d+)", modal_selector)
    timeline_selector = f"#timeline{match.group(1)}" if match else "ul[id^='timeline']"

    try:
        page.wait_for_function(
            """
            ({ modalSelector, timelineSelector }) => {
              const modal = document.querySelector(modalSelector);
              if (!modal) return false;
              const body = modal.querySelector('.modal-body');
              if (!body) return false;
              const timeline = modal.querySelector(timelineSelector);
              if (timeline && timeline.querySelectorAll('li').length > 0) return true;
              const hasSpinner = Boolean(body.querySelector('.spinner-border'));
              const hasContent = body.textContent.trim().length > 0;
              return hasContent && !hasSpinner;
            }
            """,
            arg={"modalSelector": modal_selector, "timelineSelector": timeline_selector},
            timeout=timeout_ms,
        )
        return True
    except PlaywrightTimeoutError:
        return False


def open_evidence_modal(page: Page, button: Any, modal_selector: str) -> bool:
    criterio_match = re.search(r"modalEvidencias(\d+)", modal_selector)
    resposta_id = criterio_match.group(1) if criterio_match else ""
    tipo = ""

    try:
        onclick = button.get_attribute("onclick") or ""
        onclick_match = re.search(r"carregarEvidencias\(\s*(\d+)\s*,\s*['\"]([^'\"]+)['\"]", onclick)
        if onclick_match:
            resposta_id = onclick_match.group(1)
            tipo = onclick_match.group(2)
    except PlaywrightError:
        pass

    if not tipo:
        try:
            tipo = button.locator("xpath=ancestor::*[@data-tipo][1]").first.get_attribute("data-tipo") or ""
        except PlaywrightError:
            tipo = ""

    tipo = tipo or "questionario_form"

    try:
        opened = page.evaluate(
            """
            ({ modalSelector, respostaId, tipo }) => {
              const modal = document.querySelector(modalSelector);
              if (!modal) return false;

              if (window.bootstrap && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modal).show();
              } else {
                modal.classList.add('show');
                modal.style.display = 'block';
                modal.removeAttribute('aria-hidden');
                modal.setAttribute('aria-modal', 'true');
                document.body.classList.add('modal-open');
              }

              if (respostaId && typeof carregarEvidencias === 'function') {
                carregarEvidencias(respostaId, tipo);
              }

              return true;
            }
            """,
            {"modalSelector": modal_selector, "respostaId": resposta_id, "tipo": tipo},
        )
        if opened:
            return True
    except PlaywrightError:
        pass

    return False


def get_questionnaire_panes(page: Page) -> List[Dict[str, str]]:
    try:
        panes = page.evaluate(
            """
            () => {
              const links = Array.from(document.querySelectorAll('#dimensoes .nav-link'));
              const linkedPanes = links.map((link) => {
                const href = link.getAttribute('href') || '';
                const id = href.includes('#') ? href.split('#').pop() : link.getAttribute('aria-controls') || '';
                return {
                  id,
                  title: (link.textContent || '').replace(/\\s+/g, ' ').trim()
                };
              }).filter((item) => item.id && document.getElementById(item.id));

              if (linkedPanes.length) return linkedPanes;

              return Array.from(document.querySelectorAll('.tab-pane[id]')).map((pane, index) => ({
                id: pane.id,
                title: `Aba ${index + 1}`
              }));
            }
            """
        )
        return [
            {"id": str(item.get("id") or ""), "title": str(item.get("title") or "")}
            for item in panes
        ]
    except PlaywrightError:
        return []


def evidence_button_data(button: Any, modal_selector: str) -> Dict[str, str]:
    criterio_match = re.search(r"modalEvidencias(\d+)", modal_selector)
    resposta_id = criterio_match.group(1) if criterio_match else ""
    tipo = ""

    try:
        onclick = button.get_attribute("onclick") or ""
        onclick_match = re.search(r"carregarEvidencias\(\s*(\d+)\s*,\s*['\"]([^'\"]+)['\"]", onclick)
        if onclick_match:
            resposta_id = onclick_match.group(1)
            tipo = onclick_match.group(2)
    except PlaywrightError:
        pass

    if not tipo:
        try:
            tipo = button.locator("xpath=ancestor::*[@data-tipo][1]").first.get_attribute("data-tipo") or ""
        except PlaywrightError:
            tipo = ""

    return {
        "resposta_id": resposta_id,
        "tipo": tipo or "questionario_form",
    }


def load_evidence_modal_content(page: Page, modal_selector: str, resposta_id: str, tipo: str) -> bool:
    if not resposta_id:
        return False

    try:
        return bool(
            page.evaluate(
                """
                async ({ modalSelector, respostaId, tipo }) => {
                  const modal = document.querySelector(modalSelector);
                  const body = document.getElementById(`modalEvidenciasBody${respostaId}`)
                    || (modal ? modal.querySelector('.modal-body') : null);
                  if (!body) return false;

                  body.innerHTML = '<div class="text-center py-5"><div class="spinner-border"></div></div>';
                  const response = await fetch(`/questionarios/${respostaId}/evidencias/${tipo}/`, {
                    credentials: 'same-origin'
                  });
                  if (!response.ok) return false;

                  body.innerHTML = await response.text();
                  if (window.htmx && typeof htmx.process === 'function') htmx.process(body);
                  return true;
                }
                """,
                {"modalSelector": modal_selector, "respostaId": resposta_id, "tipo": tipo},
            )
        )
    except PlaywrightError:
        return False


def close_modal(page: Page, modal: Any) -> None:
    try:
        page.keyboard.press("Escape")
        modal.wait_for(state="hidden", timeout=5_000)
        return
    except PlaywrightTimeoutError:
        pass

    close_button = modal.locator(".btn-close, [data-bs-dismiss='modal']").first
    if close_button.count() > 0:
        try:
            close_button.click(force=True)
            modal.wait_for(state="hidden", timeout=5_000)
            return
        except PlaywrightError:
            pass

    try:
        page.evaluate(
            """
            () => {
              document.querySelectorAll('.modal.show').forEach((modal) => {
                modal.classList.remove('show');
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
              });
              document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.remove());
              document.body.classList.remove('modal-open');
              document.body.style.removeProperty('overflow');
              document.body.style.removeProperty('padding-right');
            }
            """
        )
    except PlaywrightError:
        pass


def collect_validation_evidences_from_form(
    page: Page,
    form_url: str,
    questionario_id: str,
    output_path: Path,
) -> List[Dict[str, Any]]:
    if not form_url:
        return []

    try:
        page.goto(form_url, wait_until="domcontentloaded", timeout=45_000)
        wait_page_ready(page)
        page.locator("#dimensoes .nav-link.active").first.wait_for(state="visible", timeout=30_000)
        get_active_pane(page).wait_for(state="attached", timeout=30_000)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(f"formulario do questionario nao carregou: {form_url}") from exc

    evidencias: List[Dict[str, Any]] = []
    botoes_evidencias = 0
    visited_buttons: set[str] = set()
    panes = get_questionnaire_panes(page)
    if not panes:
        panes = [{"id": get_active_pane_id(page), "title": get_active_chapter_title(page)}]

    for pane in panes:
        pane_id = pane.get("id", "")
        if not pane_id:
            continue

        chapter_title = pane.get("title", "") or pane_id
        active_pane = page.locator(f"#{pane_id}").first
        buttons = active_pane.locator("button").filter(has_text=re.compile("Evid", re.IGNORECASE))

        for button_index in range(buttons.count()):
            button = buttons.nth(button_index)
            try:
                button_text = clean_text(button.text_content(timeout=3_000) or "")
            except PlaywrightError:
                button_text = ""

            if not re.search(r"\d+\s+Evid", button_text, flags=re.IGNORECASE):
                continue

            modal_selector = button.get_attribute("data-bs-target") or ""
            if not modal_selector:
                continue

            data = evidence_button_data(button, modal_selector)
            criterio_id = data["resposta_id"] or (re.search(r"modalEvidencias(\d+)", modal_selector).group(1) if re.search(r"modalEvidencias(\d+)", modal_selector) else "")
            button_key = criterio_id or modal_selector
            if button_key in visited_buttons:
                continue
            visited_buttons.add(button_key)
            botoes_evidencias += 1
            criterio_context = extract_criterion_context(button)

            evidencias_pre_load = extract_modal_validation_evidences(
                page,
                modal_selector,
                chapter_title,
                questionario_id,
                criterio_id,
                len(evidencias) + 1,
                output_path,
                criterio_context,
            )

            if load_evidence_modal_content(page, modal_selector, data["resposta_id"], data["tipo"]):
                wait_modal_evidences_loaded(page, modal_selector)

            evidencias_loaded = extract_modal_validation_evidences(
                page,
                modal_selector,
                chapter_title,
                questionario_id,
                criterio_id,
                len(evidencias) + 1,
                output_path,
                criterio_context,
            )
            evidencias.extend(evidencias_loaded or evidencias_pre_load)

    if botoes_evidencias and not evidencias:
        raise RuntimeError(
            f"{botoes_evidencias} botao(oes) de evidencias encontrado(s), "
            "mas nenhuma evidencia de validacao foi coletada."
        )

    return evidencias

    evidencias: List[Dict[str, Any]] = []
    botoes_evidencias = 0
    visited_panes: set[str] = set()

    while True:
        active_pane_id = get_active_pane_id(page)
        if not active_pane_id or active_pane_id in visited_panes:
            break
        visited_panes.add(active_pane_id)

        chapter_title = get_active_chapter_title(page)
        active_pane = get_active_pane(page)
        buttons = active_pane.locator("button").filter(has_text=re.compile("Evid", re.IGNORECASE))

        for button_index in range(buttons.count()):
            button = buttons.nth(button_index)
            button_text = clean_text(button.inner_text(timeout=3_000))
            if not re.search(r"\d+\s+Evid", button_text, flags=re.IGNORECASE):
                continue
            botoes_evidencias += 1

            modal_selector = button.get_attribute("data-bs-target") or ""
            if not modal_selector:
                continue

            criterio_match = re.search(r"modalEvidencias(\d+)", modal_selector)
            criterio_id = criterio_match.group(1) if criterio_match else ""
            evidencias_pre_click = extract_modal_validation_evidences(
                page,
                modal_selector,
                chapter_title,
                questionario_id,
                criterio_id,
                len(evidencias) + 1,
                output_path,
            )

            try:
                button.scroll_into_view_if_needed(timeout=5_000)
            except PlaywrightTimeoutError:
                pass

            opened_modal = open_evidence_modal(page, button, modal_selector)
            clicked_button = False
            if not opened_modal:
                try:
                    button.click(force=True)
                    clicked_button = True
                except PlaywrightError:
                    clicked_button = False

            modal = page.locator(modal_selector).first
            if opened_modal or clicked_button:
                try:
                    modal.wait_for(state="visible", timeout=8_000)
                except PlaywrightTimeoutError:
                    modal.wait_for(state="attached", timeout=8_000)
            else:
                modal.wait_for(state="attached", timeout=8_000)
            modal.locator(".modal-body").first.wait_for(state="attached", timeout=15_000)
            wait_modal_evidences_loaded(page, modal_selector)

            evidencias_pos_click = extract_modal_validation_evidences(
                page,
                modal_selector,
                chapter_title,
                questionario_id,
                criterio_id,
                len(evidencias) + 1,
                output_path,
            )
            evidencias.extend(evidencias_pos_click or evidencias_pre_click)

            if opened_modal or clicked_button:
                close_modal(page, modal)

        if click_next_chapter(page, active_pane, active_pane_id):
            continue
        break

        next_button = active_pane.locator("button:has-text('Próximo'), button:has-text('Proximo')").first
        if next_button.count() == 0:
            break

    if botoes_evidencias and not evidencias:
        raise RuntimeError(
            f"{botoes_evidencias} botao(oes) de evidencias encontrado(s), "
            "mas nenhuma evidencia de validacao foi coletada."
        )

    return evidencias


def logout(page: Page) -> None:
    try:
        page.goto(LOGOUT_URL, wait_until="domcontentloaded", timeout=30_000)
        wait_page_ready(page, timeout_ms=30_000)
    except Exception:
        pass


def process_account(
    page: Page,
    account: Dict[str, Any],
    output_path: Path,
    collect_manifestations: bool,
) -> Dict[str, Any]:
    result = empty_result(account)
    result["user"] = str(account.get("user", "") or "").strip()

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

    result["data"] = row["data"]
    result["questionario_id"] = row["questionario_id"]
    if not row["link"]:
        raise RuntimeError(f"nao foi possivel localizar o link do questionario para {account['user']}.")
    history_result = extract_history_from_questionnaire_view(page, row["link"])
    result.update(history_result)
    result["porcentagem"] = extract_percentage_from_loaded_questionnaire(page, row["indice"])
    if not result["porcentagem"]:
        result["erro"] = "porcentagem nao encontrada no questionario."

    if not collect_manifestations:
        result["total_evidencias_validacao"] = 0
        result["evidencias_validacao"] = []
        return result

    evidencias_validacao = collect_validation_evidences_from_form(
        page,
        questionnaire_form_url(row),
        row["questionario_id"],
        output_path,
    )
    result["total_evidencias_validacao"] = len(evidencias_validacao)
    result["evidencias_validacao"] = evidencias_validacao
    return result


def find_free_local_port(start: int = 8765, attempts: int = 30) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("nao foi possivel encontrar uma porta local livre para abrir o visualizador.")


def account_public_data(account: Dict[str, Any]) -> Dict[str, Any]:
    user = str(account.get("user", "") or "").strip()
    return {
        "orgao": first_value(account, ORGAO_KEYS),
        "cidade": first_value(account, ("cidade",)),
        "user": user,
        "has_access": not bool(account.get("_erro_validacao")),
        "erro": str(account.get("_erro_validacao", "") or ""),
    }


def load_default_public_accounts() -> List[Dict[str, Any]]:
    return [account_public_data(account) for account in load_accounts(default_input_file())]


def response_json(handler: SimpleHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def output_json_url(output_path: Path, viewer_dir: Path) -> str:
    relative_path = result_path_for_viewer(output_path, viewer_dir)
    return quote(relative_path.as_posix(), safe="/")


def run_collector_from_viewer(payload: Dict[str, Any], viewer_dir: Path) -> Dict[str, Any]:
    mode = str(payload.get("mode", "") or "").strip()
    input_path = default_input_file()
    accounts = load_accounts(input_path)
    command = [sys.executable, str(Path(__file__).resolve()), "--no-abrir-visualizador"]

    if mode == "all":
        output_path = default_output_path(input_path, accounts)
        command.extend(["--todos", "--saida", str(output_path)])
    elif mode == "specific":
        orgao = str(payload.get("orgao", "") or "").strip()
        cidade = str(payload.get("cidade", "") or "").strip()
        user = str(payload.get("user", "") or "").strip()
        selected = [
            account
            for account in accounts
            if (not orgao or first_value(account, ORGAO_KEYS) == orgao)
            and (not cidade or first_value(account, ("cidade",)) == cidade)
            and (not user or str(account.get("user", "") or "").strip() == user)
        ]
        if len(selected) != 1:
            raise RuntimeError(f"selecao especifica precisa apontar para 1 registro; encontrados: {len(selected)}.")
        output_path = default_output_path(input_path, selected)
        command.extend(["--cidade", cidade, "--saida", str(output_path)])
        if user:
            command.extend(["--usuario", user])
    elif mode == "external":
        filename = safe_filename(str(payload.get("filename", "") or "json_externo"))
        content = str(payload.get("content", "") or "").strip()
        if not content:
            raise RuntimeError("JSON externo vazio.")
        try:
            json.loads(content)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"JSON externo invalido: {exc}") from exc
        input_path = viewer_dir / "entrada" / f"{filename}_{time.strftime('%Y%m%d_%H%M%S')}.json"
        input_path.parent.mkdir(parents=True, exist_ok=True)
        input_path.write_text(content, encoding="utf-8")
        external_accounts = load_accounts(input_path)
        output_path = default_output_path(input_path, external_accounts)
        command.extend(["--entrada", str(input_path), "--todos", "--saida", str(output_path)])
    else:
        raise RuntimeError("modo de execucao invalido.")

    completed = subprocess.run(
        command,
        cwd=str(viewer_dir.parent),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "output_path": str(output_path),
        "json_url": output_json_url(output_path, viewer_dir),
        "stdout": completed.stdout[-4000:],
        "stderr": completed.stderr[-4000:],
    }


def serve_viewer(port: int) -> None:
    viewer_dir = Path(__file__).resolve().parent

    class CollectorViewerHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(viewer_dir), **kwargs)

        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:
            if urlparse(self.path).path == "/api/coletor/contas":
                try:
                    response_json(self, 200, {"ok": True, "accounts": load_default_public_accounts()})
                except Exception as exc:
                    response_json(self, 500, {"ok": False, "error": str(exc)})
                return
            super().do_GET()

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/api/coletor/executar":
                response_json(self, 404, {"ok": False, "error": "rota nao encontrada"})
                return

            try:
                length = int(self.headers.get("Content-Length", "0") or "0")
                raw_body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(raw_body or "{}")
                result = run_collector_from_viewer(payload, viewer_dir)
                status = 200 if result["ok"] else 500
                response_json(self, status, result)
            except Exception as exc:
                response_json(self, 500, {"ok": False, "error": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", port), CollectorViewerHandler)
    print(f"Servidor do visualizador iniciado em http://127.0.0.1:{port}/")
    server.serve_forever()


def start_viewer_server(viewer_dir: Path) -> int:
    port = find_free_local_port()
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--viewer-server",
        "--viewer-port",
        str(port),
    ]
    kwargs: Dict[str, Any] = {
        "cwd": str(viewer_dir),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    subprocess.Popen(command, **kwargs)
    time.sleep(0.8)
    return port


def result_path_for_viewer(output_path: Path, viewer_dir: Path) -> Path:
    output_resolved = output_path.resolve()
    viewer_resolved = viewer_dir.resolve()
    try:
        return output_resolved.relative_to(viewer_resolved)
    except ValueError:
        target = viewer_resolved / "entrada" / output_resolved.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output_resolved, target)
        return target.relative_to(viewer_resolved)


def open_result_viewer(output_path: Path) -> None:
    viewer_dir = Path(__file__).resolve().parent
    viewer_file = viewer_dir / "visualizador_atricon.html"
    if not viewer_file.exists() or not output_path.exists():
        return

    try:
        result_relative_path = result_path_for_viewer(output_path, viewer_dir)
        port = start_viewer_server(viewer_dir)
        json_url = quote(result_relative_path.as_posix(), safe="/")
        viewer_url = f"http://127.0.0.1:{port}/visualizador_atricon.html?json={json_url}"
        webbrowser.open(viewer_url)
        print(f"Visualizador aberto em: {viewer_url}")
    except Exception as exc:
        print(f"Aviso: nao foi possivel abrir o visualizador automaticamente: {exc}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Coleta status e porcentagem no Avalia Atricon.")
    parser.add_argument(
        "command",
        nargs="?",
        choices=("install",),
        help="Instala as dependencias necessarias para rodar o coletor.",
    )
    parser.add_argument(
        "--entrada",
        type=Path,
        help="Caminho do JSON com as contas. Sem este argumento, usa atricon/entrada/orgaos_avalia.json e abre a janela de escolha.",
    )
    parser.add_argument(
        "--saida",
        type=Path,
        help="Caminho do JSON de saida. Padrao: .resultado/particular/resultado_atricon_<orgao>_<cidade>.json ou .resultado/geral/resultado_geral_atricon_<hora>hrs.json",
    )
    parser.add_argument("--todos", action="store_true", help="Analisa todos os usuarios do JSON sem perguntar.")
    parser.add_argument("--cidade", help="Analisa apenas a cidade informada, sem perguntar.")
    parser.add_argument("--usuario", help="Analisa apenas o usuario informado, sem perguntar.")
    parser.add_argument("--headless", action="store_true", help="Executa o navegador sem abrir janela.")
    parser.add_argument("--slow-mo", type=int, default=0, help="Atraso em ms entre acoes do navegador.")
    parser.add_argument("--no-abrir-visualizador", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--viewer-server", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--viewer-port", type=int, default=8765, help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "install":
        return install_runtime_dependencies()

    if args.viewer_server:
        serve_viewer(args.viewer_port)
        return 0

    input_path = args.entrada or default_input_file()
    output_path = args.saida or default_output_path(input_path, [])
    try:
        accounts = load_accounts(input_path)
        if args.entrada or args.todos or args.cidade or args.usuario:
            accounts = choose_accounts(accounts, args)
        else:
            input_path, accounts = choose_run_in_window(input_path, accounts)
        output_path = args.saida or default_output_path(input_path, accounts)
    except SystemExit as exc:
        result = empty_result({})
        result["erro"] = str(exc)
        write_results(output_path, [result])
        print(f"ERRO: {exc}", file=sys.stderr)
        print(f"Saida salva em: {output_path}")
        if not args.no_abrir_visualizador:
            open_result_viewer(output_path)
        return 1

    results: List[Dict[str, Any]] = []
    valid_accounts_count = sum(1 for account in accounts if not account.get("_erro_validacao"))
    collect_manifestations = valid_accounts_count == 1
    if collect_manifestations:
        print("Modo especifico: manifestacoes/evidencias serao coletadas.")
    else:
        print("Modo geral: manifestacoes/evidencias nao serao coletadas.")

    require_playwright()
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
                result = process_account(page, account, output_path, collect_manifestations)
                results.append(result)
                if result.get("erro"):
                    print(f"  Aviso: {result['erro']}")
                else:
                    print(f"  OK: status={result['status']} porcentagem={result['porcentagem']}")
            except Exception as exc:
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
                print("  Continuando para o proximo usuario...", file=sys.stderr)
            finally:
                logout(page)
                context.close()
                write_results(output_path, results)

        browser.close()

    print(f"Saida salva em: {output_path}")
    if not args.no_abrir_visualizador:
        open_result_viewer(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
