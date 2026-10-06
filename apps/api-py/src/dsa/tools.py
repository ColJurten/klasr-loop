import io
import logging
import re
from functools import lru_cache
from pathlib import Path

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

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
    # ponytail: module-level converter cache — fine for single-worker process;
    # revisit if multiworker.
    from docling.document_converter import DocumentConverter

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import PdfFormatOption, ImageFormatOption

        def options():
            return PdfPipelineOptions(
                do_ocr=do_ocr,
                document_timeout=_DOCLING_TIMEOUT,
                force_backend_text=False,
            )

        pdf_options = options()
        pdf_options.ocr_options.lang = ["fra", "eng"]
        image_options = options()
        image_options.ocr_options.lang = ["fra", "eng"]
        return DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=image_options),
            }
        )
    except (AttributeError, ImportError, TypeError, ValueError):
        if do_ocr:
            raise
        return DocumentConverter()


class DoclingArgs(BaseModel):
    file_path: str = Field(description="Local temporary document path")


def _export(document) -> tuple[str, str]:
    return document.export_to_text().strip(), document.export_to_markdown().strip()


def extract_document(file_path: str, markdown: bool = True) -> ExtractionResult:
    memory = isinstance(file_path, io.BytesIO)
    path = file_path if memory else Path(file_path)
    if not memory and path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    try:
        if memory:
            from docling.datamodel.base_models import DocumentStream

            name = getattr(path, "name", "document.pdf")
            data = path.getvalue()
            path = DocumentStream(name=name, stream=io.BytesIO(data))
        document = _build_converter(do_ocr=False).convert(path).document
        text, markdown_content = _export(document)
    except Exception:
        return ExtractionResult(text="", quality="failed", warnings=["extraction_failed"])
    if not re.sub(r"<!--.*?-->", "", markdown_content, flags=re.DOTALL).strip():
        markdown_content = ""
    quality, warnings = _assess_quality(text)
    first_pass = ExtractionResult(
        text=text, markdown=markdown_content, quality=quality, warnings=warnings
    )
    suffix = Path(name if memory else path).suffix.lower()
    if quality == "ok" or suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".gif", ".bmp"}:
        return first_pass

    try:
        if memory:
            path = DocumentStream(name=name, stream=io.BytesIO(data))
        document = _build_converter(do_ocr=True).convert(path).document
        text, markdown_content = _export(document)
    except Exception as exc:
        logger.warning(
            "OCR fallback unavailable; using text-layer extraction: %s", type(exc).__name__
        )
        return first_pass
    if not re.sub(r"<!--.*?-->", "", markdown_content, flags=re.DOTALL).strip():
        markdown_content = ""
    quality, warnings = _assess_quality(text)
    return ExtractionResult(
        text=text, markdown=markdown_content, quality=quality, warnings=warnings
    )


def extract_bytes(data: bytes, suffix: str, markdown: bool = True) -> ExtractionResult:
    if suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    stream = io.BytesIO(data)
    stream.name = "document" + suffix.lower()
    return extract_document(stream, markdown)


class DoclingMarkdownTool(BaseTool):
    name: str = "docling_markdown"
    description: str = "Extract a supported document as Markdown"
    args_schema: type[BaseModel] = DoclingArgs

    def _run(self, file_path: str) -> str:
        result = extract_document(file_path)
        return result.model_copy(update={"text": result.markdown}).model_dump_json()


class DoclingTextTool(BaseTool):
    name: str = "docling_text"
    description: str = "Extract plain text from a supported document"
    args_schema: type[BaseModel] = DoclingArgs

    def _run(self, file_path: str) -> str:
        return extract_document(file_path, markdown=False).model_dump_json()
