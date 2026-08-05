from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / ".codex_image_tools"))

from PIL import Image, ImageOps  # noqa: E402


SOURCE_DIR = Path(__file__).resolve().parent / "logos_sites"
OUTPUT_DIR = Path(__file__).resolve().parent / "logos_sites_padronizadas"
TARGET_SIZE = (500, 162)


def visible_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    """Retorna os limites dos pixels que não são totalmente transparentes."""
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("a imagem é totalmente transparente")
    return bbox


def standardize(source: Path, destination: Path) -> tuple[str, str, str]:
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGBA")

    bbox = visible_bbox(image)
    content = image.crop(bbox)

    target_width, target_height = TARGET_SIZE
    scale = min(target_width / content.width, target_height / content.height)
    resized_size = (
        max(1, round(content.width * scale)),
        max(1, round(content.height * scale)),
    )

    resized = content.resize(resized_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", TARGET_SIZE, (0, 0, 0, 0))
    position = (
        target_width - resized.width,
        target_height - resized.height,
    )
    canvas.alpha_composite(resized, position)

    final_bbox = visible_bbox(canvas)
    if final_bbox[2] != target_width or final_bbox[3] != target_height:
        raise ValueError("o conteúdo visível não alcançou as bordas direita e inferior")

    canvas.save(destination, format="PNG", optimize=True)

    original_size = f"{image.width}x{image.height}"
    content_size = f"{content.width}x{content.height}"
    final_content_size = f"{resized.width}x{resized.height}"
    return original_size, content_size, final_content_size


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = sorted(SOURCE_DIR.glob("*.png"))
    if not sources:
        raise SystemExit(f"Nenhuma imagem encontrada em {SOURCE_DIR}")

    report_lines = [
        "LOGOS PADRONIZADAS EM 500x162 PX",
        "O conteúdo visível foi recortado, redimensionado proporcionalmente e alinhado à direita e abaixo.",
        "",
        "arquivo | original | conteúdo visível original | conteúdo na cópia",
    ]

    for source in sources:
        destination = OUTPUT_DIR / source.name
        original, visible, final = standardize(source, destination)
        report_lines.append(f"{source.name} | {original} | {visible} | {final}")

    report = OUTPUT_DIR / "relatorio_padronizacao.txt"
    report.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    print(f"Processadas: {len(sources)}")
    print(f"Destino: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
