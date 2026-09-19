import io
import re
from pathlib import Path

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from .schemas import ExtractionResult

SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".gif", ".bmp"}

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


def _build_converter():
    """Create a DocumentConverter with tuned PDF pipeline options."""
    from docling.document_converter import DocumentConverter

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import PdfFormatOption

        pdf_options = PdfPipelineOptions(
            do_ocr=True,
            document_timeout=_DOCLING_TIMEOUT,
            force_backend_text=False,
        )
        pdf_options.ocr_options.lang = ["fra", "eng"]
        return DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options)}
        )
    except AttributeError, ImportError, TypeError, ValueError:
        return DocumentConverter()


class DoclingArgs(BaseModel):
    file_path: str = Field(description="Local temporary document path")


def extract_document(file_path: str, markdown: bool = False) -> ExtractionResult:
    memory = isinstance(file_path, io.BytesIO)
    path = file_path if memory else Path(file_path)
    if not memory and path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    try:
        if memory:
            from docling.datamodel.base_models import DocumentStream

            path = DocumentStream(name=getattr(path, "name", "document.pdf"), stream=path)
        document = _build_converter().convert(path).document
        content = document.export_to_markdown() if markdown else document.export_to_text()
    except Exception:
        return ExtractionResult(text="", quality="failed", warnings=["extraction_failed"])
    content = content.strip()
    quality, warnings = _assess_quality(content)
    return ExtractionResult(text=content, quality=quality, warnings=warnings)


def extract_bytes(data: bytes, suffix: str, markdown: bool = False) -> ExtractionResult:
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
        return extract_document(file_path, markdown=True).model_dump_json()


class DoclingTextTool(BaseTool):
    name: str = "docling_text"
    description: str = "Extract plain text from a supported document"
    args_schema: type[BaseModel] = DoclingArgs

    def _run(self, file_path: str) -> str:
        return extract_document(file_path).model_dump_json()
