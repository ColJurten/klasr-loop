import io
import json
import os
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import dsa
from dsa.schemas import DecisionResult, ExtractionResult
from dsa.tools import _document_context, extract_bytes
from services.analysis import AnalysisService

REASON = "Aucun contenu lisible détecté dans le document"
TEXT = "Invoice: INV-42 Supplier: Acme Date: 2026-09-13 Amount: 1500.00 EUR"


def document(text):
    return SimpleNamespace(
        export_to_text=lambda: text,
        export_to_dict=lambda: {"texts": [{"text": text}]},
    )


@pytest.mark.parametrize("first", ["", "tiny"])
def test_two_pass_options_same_bytes_no_disk(monkeypatch, first):
    from docling.datamodel.base_models import InputFormat

    options, streams = [], []

    class Converter:
        def __init__(self, format_options):
            self.options = format_options[InputFormat.PDF].pipeline_options
            options.append(self.options)

        def convert(self, source):
            assert source.name == "document.pdf"
            assert source.stream.read() == b"private scan"
            streams.append(source.stream)
            return SimpleNamespace(document=document(TEXT if self.options.do_ocr else first))

    monkeypatch.setattr("docling.document_converter.DocumentConverter", Converter)
    monkeypatch.setattr("pathlib.Path.write_bytes", Mock(side_effect=AssertionError("disk")))
    monkeypatch.setattr("tempfile.NamedTemporaryFile", Mock(side_effect=AssertionError("disk")))
    result = extract_bytes(b"private scan", ".pdf")
    assert result.text == TEXT and TEXT in result.context
    assert len(streams) == 2 and streams[0] is not streams[1]
    assert options[0].do_ocr is False
    second = options[1]
    assert second.do_ocr and second.ocr_options.force_full_page_ocr
    assert second.generate_picture_images
    assert second.do_picture_description and second.do_picture_classification
    assert all(o.document_timeout == 120 and o.ocr_options.lang == ["fra", "eng"] for o in options)


def test_context_content_and_no_embedded_images():
    context = _document_context(
        {
            "texts": [{"text": "OCR invoice"}],
            "tables": [{"data": {"table_cells": [{"text": "1500 EUR"}]}}],
            "key_value_items": [{"key": "client", "value": "Acme"}],
            "pictures": [
                {
                    "image": {"uri": "data:image/png;base64,SECRET"},
                    "caption": "Invoice scan",
                    "meta": {
                        "description": {"text": "A scanned invoice"},
                        "classification": {
                            "predictions": [
                                {"class_name": "photo", "confidence": 0.1},
                                {"class_name": "document", "confidence": 0.9},
                            ]
                        },
                    },
                }
            ],
        }
    )
    for text in [
        "OCR invoice",
        "1500 EUR",
        "Acme",
        "Invoice scan",
        "A scanned invoice",
        "document",
    ]:
        assert text in context
    assert "photo" not in context
    for forbidden in ["data:image", "base64", "SECRET", '"uri"', '"image"']:
        assert forbidden not in context


@pytest.mark.parametrize("combined", [False, True])
def test_classifier_receives_json_context(monkeypatch, combined):
    result = DecisionResult(value="invoice", confidence=0.9, signals=["kind:invoice"])
    kickoff = Mock(
        return_value=SimpleNamespace(
            pydantic=result,
            tasks_output=[SimpleNamespace(pydantic=result), SimpleNamespace(pydantic=result)],
        )
    )
    crew = SimpleNamespace(kickoff=kickoff)
    monkeypatch.setattr(dsa, "_local_suggestion", lambda *_: None)
    monkeypatch.setattr(
        "dsa.crews.DocumentSortingAssistantCrew",
        lambda: SimpleNamespace(naming_crew=lambda: crew, combined_crew=lambda: crew),
    )
    extraction = ExtractionResult(text="plain OCR", context="sanitized JSON pictures", quality="ok")
    if combined:
        dsa._both_decisions(extraction, ["/Invoices"])
    else:
        dsa._decision("filename", extraction, ["/Invoices"])
    assert kickoff.call_args.kwargs["inputs"]["content"] == extraction.context


@pytest.mark.asyncio
@pytest.mark.parametrize("raises", [False, True])
async def test_total_failure_normal_original_filename_proposal(monkeypatch, raises):
    calls = []

    def converter(enriched=False):
        calls.append(enriched)
        if raises:
            raise ValueError("extraction_failed")
        return SimpleNamespace(convert=lambda _: SimpleNamespace(document=document("")))

    monkeypatch.setattr("dsa.tools._build_converter", converter)
    extraction = extract_bytes(b"scan", ".pdf")
    assert calls == [False, True]
    service = AnalysisService(None, None, None, None, None)
    proposal = await service.suggest(
        "org", SimpleNamespace(name="Mon scan: 2026?.pdf"), extraction, ["/Invoices"]
    )
    assert proposal["proposed_name"] == "Mon_scan_2026_.pdf"
    assert proposal["confidence"] == 0 and proposal["review_required"]
    assert proposal["review_reason"] == REASON
    assert proposal["llm_calls_used"] == 0
    assert "classement_manuel" not in json.dumps(proposal)
    assert "empty_content" not in json.dumps(proposal)
    assert "extraction_failed" not in json.dumps(proposal)


@pytest.mark.docling
@pytest.mark.skipif(os.getenv("SKIP_DOCLING_MODELS") == "1", reason="heavy models disabled by CI")
@pytest.mark.asyncio
async def test_real_scanned_pdf_ocr_pictures_and_proposal(monkeypatch):
    from PIL import Image, ImageDraw, ImageFont
    from dsa import tools

    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("DejaVuSans.ttf", 42)
    for index, line in enumerate(
        ["Invoice: INV-42", "Supplier: Acme", "Date: 2026-09-13", "Amount: 1500.00 EUR"]
    ):
        draw.text((90, 100 + index * 70), line, fill="black", font=font)
    # A large visual gives layout detection an actual picture alongside OCR text.
    draw.rectangle((90, 500, 1100, 1400), fill="#205080")
    draw.ellipse((250, 650, 900, 1250), fill="#e0a040")
    stream = io.BytesIO()
    image.save(stream, format="PDF", resolution=150, title=None, creationDate=None, modDate=None)
    from pypdfium2 import PdfDocument

    with PdfDocument(stream.getvalue()) as pdf:
        assert not any(pdf.get_metadata_dict().values())
        page = pdf[0]
        text_page = page.get_textpage()
        try:
            assert not text_page.get_text_range().strip()
        finally:
            text_page.close()
            page.close()
    serialized = []
    build_context = tools._document_context

    def capture(value):
        serialized.append(value)
        return build_context(value)

    monkeypatch.setattr(tools, "_document_context", capture)
    extraction = extract_bytes(stream.getvalue(), ".pdf")
    assert extraction.text.strip(), extraction.warnings
    assert len(serialized[-1]["pictures"]) >= 1
    assert serialized[-1]["texts"]
    assert "data:image" not in extraction.context
    monkeypatch.setenv("KLASR_LLM_PROVIDER", "local")
    monkeypatch.delenv("KLASR_LLM_MODEL", raising=False)
    monkeypatch.setattr("services.analysis.LlmSettingsService.resolve", lambda *_: None)
    service = AnalysisService(None, None, None, None, None)
    paths = ["/Clients/Acme", "/Archive"]
    proposal = await service.suggest(
        "org", SimpleNamespace(name="scan_original.pdf"), extraction, paths
    )
    assert proposal["proposed_name"].endswith(".pdf")
    assert "classement_manuel" not in proposal["proposed_name"]
    assert proposal["destination_path"] in paths
