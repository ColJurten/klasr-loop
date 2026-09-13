import io
from pathlib import Path

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from .schemas import ExtractionResult

SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".gif", ".bmp"}


class DoclingArgs(BaseModel):
    file_path: str = Field(description="Local temporary document path")


def extract_document(file_path: str, markdown: bool = False) -> ExtractionResult:
    memory = isinstance(file_path, io.BytesIO)
    path = file_path if memory else Path(file_path)
    if not memory and path.suffix.lower() not in SUPPORTED_SUFFIXES:
        return ExtractionResult(text="", quality="failed", warnings=["unsupported_format"])
    try:
        from docling.document_converter import DocumentConverter

        if memory:
            from docling.datamodel.base_models import DocumentStream

            path = DocumentStream(name=getattr(path, "name", "document.pdf"), stream=path)
        document = DocumentConverter().convert(path).document
        content = document.export_to_markdown() if markdown else document.export_to_text()
    except Exception:
        return ExtractionResult(text="", quality="failed", warnings=["extraction_failed"])
    content = content.strip()
    quality = "empty" if not content else "sparse" if len(content) < 40 else "ok"
    return ExtractionResult(text=content, quality=quality)


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
