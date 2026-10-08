import io
import json
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


def _build_converter(enriched: bool = False):
    """Each pass owns its pipeline and converter."""
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions(
        do_ocr=enriched,
        document_timeout=_DOCLING_TIMEOUT,
        generate_picture_images=enriched,
        do_picture_description=enriched,
        do_picture_classification=enriched,
    )
    options.ocr_options.lang = ["fra", "eng"]
    options.ocr_options.force_full_page_ocr = enriched
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )


def _document_context(document_json: dict) -> str:
    """Keep content and runtime metadata fields, never embedded image payloads."""

    def clean(value):
        if isinstance(value, dict):
            return {key: clean(item) for key, item in value.items() if key not in {"image", "uri"}}
        if isinstance(value, list):
            return [clean(item) for item in value]
        if isinstance(value, str) and value.startswith("data:"):
            return ""
        return value

    content = {
        key: clean(document_json.get(key, []))
        for key in ("texts", "tables", "key_value_items", "pictures")
    }
    for picture in content["pictures"]:
        classification = (picture.get("meta") or {}).get("classification") or {}
        predictions = classification.get("predictions", [])
        if predictions:
            classification["predictions"] = [
                max(predictions, key=lambda prediction: prediction.get("confidence", 0))
            ]
    return json.dumps(content, ensure_ascii=False)


class DoclingArgs(BaseModel):
    file_path: str = Field(description="Local temporary document path")


def extract_document(file_path: str, markdown: bool = False) -> ExtractionResult:
    memory = isinstance(file_path, io.BytesIO)
    path = file_path if memory else Path(file_path)
    if not memory and path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    try:
        data = path.getvalue() if memory else path.read_bytes()
    except OSError:
        return ExtractionResult(text="", quality="failed", warnings=["extraction_failed"])
    name = getattr(path, "name", "document.pdf")
    is_pdf = Path(name).suffix.lower() == ".pdf"
    content, context = "", ""
    failed = False
    for enriched in ([False, True] if is_pdf else [False]):
        try:
            from docling.datamodel.base_models import DocumentStream

            source = DocumentStream(name=Path(name).name, stream=io.BytesIO(data))
            document = _build_converter(enriched).convert(source).document
            text = document.export_to_text().strip()
            context = _document_context(document.export_to_dict())
            content = document.export_to_markdown().strip() if markdown else text
            failed = False
            if not is_pdf or len(text) >= _MIN_OK_LENGTH:
                break
        except Exception:
            failed = True
    if failed and not content:
        return ExtractionResult(text="", quality="failed", warnings=["extraction_failed"])
    quality, warnings = _assess_quality(content)
    return ExtractionResult(text=content, context=context, quality=quality, warnings=warnings)


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
