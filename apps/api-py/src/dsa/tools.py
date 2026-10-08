import io
import logging
import re
from functools import lru_cache
from pathlib import Path

from .schemas import ExtractionResult

SUPPORTED_SUFFIXES = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".tiff",
    ".gif",
    ".bmp",
    ".docx",
    ".pptx",
    ".xlsx",
}

# Signal patterns for quality assessment — content-aware verdicts.
_DATE_RE = re.compile(r"\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b")
_IDENTIFIER_RE = re.compile(
    r"(?:facture|invoice|contrat|contract|r[ée]f(?:érence)?|n[°o]|SIRET|SIREN)"
    r"[ \t:#n°-]*([A-Z0-9][A-Z0-9-]{2,})",
    re.I,
)
_PARTY_RE = re.compile(
    r"(?:de|from|[ée]metteur|issuer|fournisseur|supplier)\s*[:-]?\s*([A-ZÀ-Ÿ][\w &.'-]{2,40})",
    re.I,
)
_AMOUNT_RE = re.compile(r"\b\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})\s*(?:€|EUR|euro)", re.I)
_SIRET_RE = re.compile(r"\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b")
_SIREN_RE = re.compile(r"\b\d{3}\s?\d{3}\s?\d{3}\b")

# Minimum content length for "ok" quality verdict.
_MIN_OK_LENGTH = 40
_MIN_SPARSE_LENGTH = 10
# Docling conversion timeout (seconds).
_DOCLING_TIMEOUT = 120.0

logger = logging.getLogger(__name__)


def _assess_quality(content: str) -> tuple[str, list[str]]:
    """Return (quality, warnings) based on content length and signal presence."""
    if not content:
        return "empty", []
    warnings: list[str] = []
    has_signals = bool(
        _DATE_RE.search(content)
        or _IDENTIFIER_RE.search(content)
        or _PARTY_RE.search(content)
        or _AMOUNT_RE.search(content)
        or _SIRET_RE.search(content)
        or _SIREN_RE.search(content)
    )
    if len(content) < _MIN_SPARSE_LENGTH:
        return "sparse", ["very_short_content"]
    if len(content) < _MIN_OK_LENGTH:
        return "sparse", ["short_content"]
    if not has_signals:
        return "sparse", ["no_recognizable_signals"]
    if not _DATE_RE.search(content):
        warnings.append("no_dates_found")
    if not (
        _IDENTIFIER_RE.search(content) or _SIRET_RE.search(content) or _SIREN_RE.search(content)
    ):
        warnings.append("no_identifiers_found")
    return "ok", warnings


@lru_cache(maxsize=2)
def _build_converter(do_ocr: bool = False):
    """Create a DocumentConverter with tuned PDF pipeline options."""
    # ponytail: two cached converters hold two model sets; revisit the module-level
    # cache if model memory becomes a constraint.
    from docling.document_converter import DocumentConverter

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import PdfFormatOption

    def options():
        pipeline_options = PdfPipelineOptions(
            do_ocr=do_ocr,
            document_timeout=_DOCLING_TIMEOUT,
            force_backend_text=False,
        )
        return pipeline_options

    format_options = {
        InputFormat.PDF: PdfFormatOption(pipeline_options=options()),
    }
    from docling.document_converter import ImageFormatOption

    format_options[InputFormat.IMAGE] = ImageFormatOption(pipeline_options=options())
    return DocumentConverter(format_options=format_options)


def _export(document) -> tuple[str, str]:
    return document.export_to_text().strip(), document.export_to_markdown().strip()


def extract_document(file_path: str) -> ExtractionResult:
    memory = isinstance(file_path, io.BytesIO)
    path = file_path if memory else Path(file_path)
    if not memory and path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    name = getattr(path, "name", "document.pdf") if memory else path.name
    suffix = Path(name).suffix.lower()
    image = suffix in {".png", ".jpg", ".jpeg", ".tiff", ".gif", ".bmp"}
    try:
        if memory:
            from docling.datamodel.base_models import DocumentStream

            data = path.getvalue()
            path = DocumentStream(name=name, stream=io.BytesIO(data))
        document = _build_converter(do_ocr=image).convert(path).document
        text, markdown_content = _export(document)
    except Exception:
        return ExtractionResult(text="", quality="failed", warnings=["extraction_failed"])
    if not re.sub(r"<!--.*?-->", "", markdown_content, flags=re.DOTALL).strip():
        markdown_content = ""
    quality, warnings = _assess_quality(text)
    first_pass = ExtractionResult(
        text=text,
        markdown=markdown_content,
        quality=quality,
        warnings=warnings,
        first_pass_quality=quality,
        first_pass_text_chars=len(text),
        first_pass_md_chars=len(markdown_content),
    )
    if image or quality == "ok" or suffix != ".pdf":
        return first_pass

    try:
        if memory:
            path = DocumentStream(name=name, stream=io.BytesIO(data))
        document = _build_converter(do_ocr=True).convert(path).document
        text, markdown_content = _export(document)
    except Exception as exc:
        logger.warning("%s", type(exc).__name__)
        return first_pass.model_copy(update={"ocr_pass": True})
    if not re.sub(r"<!--.*?-->", "", markdown_content, flags=re.DOTALL).strip():
        markdown_content = ""
    quality, warnings = _assess_quality(text)
    second_pass = ExtractionResult(
        text=text,
        markdown=markdown_content,
        quality=quality,
        warnings=warnings,
        first_pass_quality=first_pass.quality,
        first_pass_text_chars=len(first_pass.text),
        first_pass_md_chars=len(first_pass.markdown),
        ocr_pass=True,
    )
    quality_rank = {"failed": 0, "empty": 1, "sparse": 2, "ok": 3}
    if quality_rank[second_pass.quality] < quality_rank[first_pass.quality] or (
        second_pass.quality == first_pass.quality
        and len(second_pass.text.strip()) < len(first_pass.text.strip())
    ):
        logger.warning("OCR fallback was lower quality; using text-layer extraction")
        return first_pass.model_copy(update={"ocr_pass": True})
    return second_pass


def extract_bytes(data: bytes, suffix: str) -> ExtractionResult:
    if suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    stream = io.BytesIO(data)
    stream.name = "document" + suffix.lower()
    return extract_document(stream)
