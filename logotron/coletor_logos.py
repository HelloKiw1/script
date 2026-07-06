#!/usr/bin/env python3
"""
Baixa logos/brasoes dos sites listados em um JSON.

Entrada JSON esperada:
[
  {
    "tipo": "CM",
    "orgao": "CM LAJEADO",
    "cidade": "Lajeado",
    "site_oficial": "https://www.lajeado.to.leg.br/"
  }
]

Uso:
    python logotron\\coletor_logos.py
    python logotron\\coletor_logos.py --offline
    python logotron\\coletor_logos.py --todas
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import shutil
import ssl
import sys
import time
import unicodedata
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except ImportError:
    PlaywrightError = Exception
    PlaywrightTimeoutError = TimeoutError
    Page = Any
    sync_playwright = None


TARGET_BASENAMES = ("logo_site", "brasao_site", "brasao")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")
DEFAULT_TIMEOUT = 25
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
)


@dataclass(frozen=True)
class Candidate:
    source: str
    label: str
    priority: int


def script_dir() -> Path:
    return Path(__file__).resolve().parent


def repo_dir() -> Path:
    return script_dir().parent


def default_input_file() -> Path:
    return repo_dir() / ".temp" / "sites.json"


def default_output_dir() -> Path:
    return repo_dir() / ".temp" / "logos_sites"


def default_models_dir() -> Path:
    return repo_dir() / ".temp" / "pagina site"


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def fix_mojibake(value: Any) -> str:
    text = str(value or "").strip()
    if not re.search(r"[ÃÂ]", text):
        return text
    try:
        fixed = text.encode("latin-1").decode("utf-8")
    except UnicodeError:
        return text
    return fixed if fixed else text


def load_sites(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"Arquivo de entrada nao encontrado: {path}")

    data = json.loads(read_text(path))
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise SystemExit("O JSON de entrada precisa ser uma lista de sites ou um objeto.")

    sites: list[dict[str, Any]] = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            print(f"[{index}] Ignorado: item do JSON nao e objeto.", file=sys.stderr)
            continue
        sites.append(item)
    return sites


def slugify(value: str) -> str:
    value = fix_mojibake(value)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return re.sub(r"_+", "_", value).strip("_")


def orgao_prefix(site: dict[str, Any]) -> str:
    tipo = fix_mojibake(site.get("tipo", ""))
    if tipo:
        return slugify(tipo)

    orgao = fix_mojibake(site.get("orgao", "") or site.get("orgão", ""))
    first_token = orgao.split(maxsplit=1)[0] if orgao else "orgao"
    return slugify(first_token)


def output_stem(site: dict[str, Any]) -> str:
    cidade = fix_mojibake(site.get("cidade", ""))
    return f"{orgao_prefix(site)}_{slugify(cidade or 'sem_cidade')}"


def target_match(source: str) -> tuple[str, int] | None:
    parsed_path = unquote(urlparse(source).path)
    filename = Path(parsed_path).name.lower()
    filename = re.sub(r"\(\d+\)(?=\.[^.]+$)", "", filename)
    stem = Path(filename).stem
    ext = Path(filename).suffix

    if ext and ext not in IMAGE_EXTENSIONS:
        return None

    for priority, basename in enumerate(TARGET_BASENAMES):
        if stem == basename or basename in stem:
            return basename, priority
    return None


def extract_attr_candidates(html: str, base_url: str) -> list[Candidate]:
    candidates: list[Candidate] = []
    seen: set[str] = set()
    attr_pattern = re.compile(
        r"""(?:src|href|data-src|data-lazy-src|content)\s*=\s*["']([^"']+)["']""",
        flags=re.IGNORECASE,
    )
    css_pattern = re.compile(r"""url\((['"]?)([^'")]+)\1\)""", flags=re.IGNORECASE)

    for raw_source in [*attr_pattern.findall(html), *[match[1] for match in css_pattern.findall(html)]]:
        source = unescape(str(raw_source)).strip()
        if not source or source.startswith(("data:", "blob:", "mailto:", "tel:")):
            continue

        match = target_match(source)
        if match is None:
            continue

        label, priority = match
        absolute = urljoin(base_url, source)
        if absolute in seen:
            continue
        seen.add(absolute)
        candidates.append(Candidate(absolute, label, priority))

    return sorted(candidates, key=lambda item: item.priority)


def local_file_candidates(models_dir: Path) -> list[Candidate]:
    if not models_dir.exists():
        return []

    candidates: list[Candidate] = []
    for file_path in models_dir.rglob("*"):
        if not file_path.is_file():
            continue
        match = target_match(file_path.name)
        if match is None:
            continue
        label, priority = match
        candidates.append(Candidate(str(file_path), label, priority))
    return sorted(candidates, key=lambda item: item.priority)


def local_candidates_for_site(site: dict[str, Any], models_dir: Path) -> list[Candidate]:
    if not models_dir.exists():
        return []

    cidade_slug = slugify(fix_mojibake(site.get("cidade", "")))
    orgao = fix_mojibake(site.get("orgao", "") or site.get("orgão", ""))
    orgao_slug = slugify(orgao)
    tipo = orgao_prefix(site)
    tipo_aliases = {
        "cm": ("cm", "camara", "camara_municipal", "camara_municipal_de"),
        "pm": ("pm", "prefeitura", "prefeitura_municipal", "prefeitura_municipal_de"),
    }.get(tipo, (tipo,))

    folders = [path for path in models_dir.iterdir() if path.is_dir()]
    scored: list[tuple[int, Path]] = []
    for folder in folders:
        folder_slug = slugify(folder.name)
        score = 0
        if cidade_slug and cidade_slug in folder_slug:
            score += 4
        if orgao_slug and orgao_slug in folder_slug:
            score += 3
        if any(alias and alias in folder_slug for alias in tipo_aliases):
            score += 1
        has_type_match = any(alias and alias in folder_slug for alias in tipo_aliases)
        has_entity_match = bool((cidade_slug and cidade_slug in folder_slug) or (orgao_slug and orgao_slug in folder_slug))
        if score and has_type_match and has_entity_match:
            scored.append((score, folder))

    search_roots = [folder for _score, folder in sorted(scored, key=lambda item: item[0], reverse=True)]
    if not search_roots:
        return []

    candidates: list[Candidate] = []
    for root in search_roots:
        for file_path in root.rglob("*"):
            if not file_path.is_file():
                continue
            match = target_match(file_path.name)
            if match is None:
                continue
            label, priority = match
            candidates.append(Candidate(str(file_path), label, priority))
        if candidates:
            break

    return sorted(candidates, key=lambda item: item.priority)


def request_url(url: str, timeout: int) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    context = ssl.create_default_context()
    with urlopen(request, timeout=timeout, context=context) as response:
        return response.read()


def fetch_html(url: str, timeout: int) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    context = ssl.create_default_context()
    with urlopen(request, timeout=timeout, context=context) as response:
        raw = response.read()
        content_type = response.headers.get_content_charset()

    if content_type:
        try:
            return raw.decode(content_type)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def image_extension(candidate: Candidate, data: bytes) -> str:
    parsed = urlparse(candidate.source)
    suffix = Path(unquote(parsed.path)).suffix.lower()
    suffix = re.sub(r"\(\d+\)$", "", suffix)
    if suffix in IMAGE_EXTENSIONS:
        return ".png" if suffix == ".svg" else suffix

    guessed = mimetypes.guess_extension("image/png")
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        return ".webp"
    return guessed or ".png"


def unique_output_path(output_dir: Path, stem: str, extension: str, label: str, index: int, all_images: bool) -> Path:
    if not all_images and index == 0:
        return output_dir / f"{stem}.png"

    suffix = f"_{label}" if all_images else f"_{index + 1}"
    path = output_dir / f"{stem}{suffix}{extension}"
    counter = 2
    while path.exists():
        path = output_dir / f"{stem}{suffix}_{counter}{extension}"
        counter += 1
    return path


def save_candidate(
    candidate: Candidate,
    output_dir: Path,
    stem: str,
    index: int,
    all_images: bool,
    timeout: int,
) -> dict[str, Any]:
    if re.match(r"^https?://", candidate.source, flags=re.IGNORECASE):
        data = request_url(candidate.source, timeout)
    else:
        data = Path(candidate.source).read_bytes()

    extension = image_extension(candidate, data)
    output_path = unique_output_path(output_dir, stem, extension, candidate.label, index, all_images)
    output_path.write_bytes(data)

    return {
        "arquivo": str(output_path),
        "origem": candidate.source,
        "tipo_imagem": candidate.label,
        "bytes": len(data),
    }


def try_fetch_site_candidates(site: dict[str, Any], timeout: int) -> tuple[list[Candidate], str]:
    url = fix_mojibake(site.get("site_oficial", "") or site.get("url", ""))
    if not url:
        return [], "site_oficial vazio"
    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        url = f"https://{url}"

    try:
        html = fetch_html(url, timeout)
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return [], f"falha ao abrir site: {exc}"

    candidates = extract_attr_candidates(html, url)
    if candidates:
        return candidates, ""
    return [], "nenhuma imagem alvo encontrada no HTML do site"


def try_rendered_site_candidates(site: dict[str, Any], page: Page, timeout: int) -> tuple[list[Candidate], str]:
    url = fix_mojibake(site.get("site_oficial", "") or site.get("url", ""))
    if not url:
        return [], "site_oficial vazio"
    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        url = f"https://{url}"

    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        try:
            page.wait_for_load_state("networkidle", timeout=timeout * 1000)
        except PlaywrightTimeoutError:
            pass
        sources = page.evaluate(
            """() => {
                const values = [];
                for (const img of document.images) values.push(img.currentSrc || img.src || "");
                for (const link of document.querySelectorAll('a[href], link[href]')) values.push(link.href || "");
                for (const el of document.querySelectorAll('[style]')) values.push(el.getAttribute('style') || "");
                return values;
            }"""
        )
        html = page.content()
    except (PlaywrightError, TimeoutError, OSError) as exc:
        return [], f"falha ao renderizar site: {exc}"

    candidates = extract_attr_candidates(html, url)
    seen = {candidate.source for candidate in candidates}
    for source in sources or []:
        text = unescape(str(source)).strip()
        if not text:
            continue
        style_matches = re.findall(r"""url\((['"]?)([^'")]+)\1\)""", text, flags=re.IGNORECASE)
        raw_sources = [match[1] for match in style_matches] if style_matches else [text]
        for raw_source in raw_sources:
            match = target_match(raw_source)
            if match is None:
                continue
            label, priority = match
            absolute = urljoin(url, raw_source)
            if absolute in seen:
                continue
            seen.add(absolute)
            candidates.append(Candidate(absolute, label, priority))

    candidates = sorted(candidates, key=lambda item: item.priority)
    if candidates:
        return candidates, ""
    return [], "nenhuma imagem alvo encontrada apos renderizar o site"


def process_site(
    site: dict[str, Any],
    output_dir: Path,
    models_dir: Path,
    args: argparse.Namespace,
    index: int,
    total: int,
    page: Page | None = None,
) -> dict[str, Any]:
    stem = output_stem(site)
    cidade = fix_mojibake(site.get("cidade", ""))
    orgao = fix_mojibake(site.get("orgao", "") or site.get("orgão", ""))
    print(f"[{index}/{total}] {orgao or stem} - {cidade or 'sem cidade'}")

    result: dict[str, Any] = {
        "orgao": orgao,
        "cidade": cidade,
        "site_oficial": fix_mojibake(site.get("site_oficial", "")),
        "arquivo_base": f"{stem}.png",
        "baixados": [],
        "erro": "",
    }

    candidates: list[Candidate] = []
    warning = ""
    if not args.offline:
        if page is not None:
            candidates, warning = try_rendered_site_candidates(site, page, args.timeout)
        if not candidates:
            candidates, warning = try_fetch_site_candidates(site, args.timeout)

    if not candidates and args.modelos:
        local_candidates = local_candidates_for_site(site, args.modelos)
        if local_candidates:
            candidates = local_candidates
            warning = "usou modelo local"

    if not candidates:
        result["erro"] = warning or "nenhum candidato encontrado"
        print(f"  ERRO: {result['erro']}")
        return result

    selected = candidates if args.todas else candidates[:1]
    for image_index, candidate in enumerate(selected):
        try:
            saved = save_candidate(candidate, output_dir, stem, image_index, args.todas, args.timeout)
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            result.setdefault("avisos", []).append(f"falha em {candidate.source}: {exc}")
            continue
        result["baixados"].append(saved)
        print(f"  OK: {Path(saved['arquivo']).name} ({saved['tipo_imagem']})")

    if warning and result["baixados"]:
        result.setdefault("avisos", []).append(warning)
    if not result["baixados"]:
        result["erro"] = "candidatos encontrados, mas nenhum arquivo foi salvo"
    return result


def write_report(output_dir: Path, results: Iterable[dict[str, Any]]) -> Path:
    report_dir = output_dir / ".resultado"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"resultado_logos_{time.strftime('%Y%m%d_%H%M%S')}.json"
    report_path.write_text(json.dumps(list(results), ensure_ascii=False, indent=2), encoding="utf-8")
    return report_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Baixa logo_site/brasao dos sites listados.")
    parser.add_argument("--entrada", type=Path, default=default_input_file(), help="Caminho do JSON de sites.")
    parser.add_argument("--saida", type=Path, default=default_output_dir(), help="Pasta onde as imagens serao salvas.")
    parser.add_argument("--modelos", type=Path, default=default_models_dir(), help="Pasta com HTMLs salvos para fallback.")
    parser.add_argument("--offline", action="store_true", help="Nao acessa a internet; usa apenas a pasta de modelos.")
    parser.add_argument("--sem-navegador", action="store_true", help="Nao usa Playwright para renderizar sites.")
    parser.add_argument("--todas", action="store_true", help="Baixa todos os candidatos encontrados por site.")
    parser.add_argument("--limite", type=int, default=0, help="Processa apenas os N primeiros sites.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Timeout por requisicao, em segundos.")
    parser.add_argument("--limpar-saida", action="store_true", help="Remove imagens antigas da pasta de saida antes de rodar.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sites = load_sites(args.entrada)
    if args.limite > 0:
        sites = sites[: args.limite]

    args.saida.mkdir(parents=True, exist_ok=True)
    if args.limpar_saida:
        for file_path in args.saida.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in IMAGE_EXTENSIONS:
                file_path.unlink()
            elif file_path.is_dir() and file_path.name != ".resultado":
                shutil.rmtree(file_path)

    results: list[dict[str, Any]] = []
    browser = None
    context = None
    page = None
    playwright_context = None
    try:
        if not args.offline and not args.sem_navegador and sync_playwright is not None:
            playwright_context = sync_playwright().start()
            browser = playwright_context.chromium.launch(headless=True)
            context = browser.new_context(locale="pt-BR")
            page = context.new_page()
        elif not args.offline and not args.sem_navegador:
            print("Aviso: Playwright nao instalado; usando apenas HTML simples.", file=sys.stderr)

        results = [
            process_site(site, args.saida, args.modelos, args, index, len(sites), page)
            for index, site in enumerate(sites, start=1)
        ]
    finally:
        if context is not None:
            context.close()
        if browser is not None:
            browser.close()
        if playwright_context is not None:
            playwright_context.stop()
    report_path = write_report(args.saida, results)

    ok_count = sum(1 for result in results if result.get("baixados"))
    error_count = len(results) - ok_count
    print(f"Concluido: {ok_count} com imagem, {error_count} sem imagem.")
    print(f"Imagens em: {args.saida}")
    print(f"Relatorio em: {report_path}")
    return 1 if error_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
