import sys
import types
from pathlib import Path

import pytest
from pydantic import ValidationError

import dsa
from dsa.schemas import DecisionResult, ExtractionResult
from dsa.tools import SUPPORTED_SUFFIXES, extract_bytes, extract_document


class StubDocument:
    def export_to_text(self):
        return "Supplier: Acme; invoice: INV-42; date: 2026-09-13"

    def export_to_markdown(self):
        return "# Invoice\nSupplier: Acme"


class StubConverter:
    def convert(self, _path):
        return types.SimpleNamespace(document=StubDocument())


@pytest.fixture
def stub_docling(monkeypatch):
    module = types.ModuleType("docling.document_converter")
    module.DocumentConverter = StubConverter
    monkeypatch.setitem(sys.modules, "docling.document_converter", module)


def test_supported_file_types_and_quality(tmp_path, stub_docling):
    for suffix in SUPPORTED_SUFFIXES:
        path = tmp_path / f"fixture{suffix}"
        path.write_bytes(b"synthetic")
        result = extract_document(str(path))
        assert result.quality == "ok" and "Acme" in result.text
    assert extract_document(str(tmp_path / "bad.docx")).quality == "failed"


def test_corrupted_empty_sparse_and_schema(monkeypatch, tmp_path):
    assert ExtractionResult(text="", quality="empty").quality == "empty"
    with pytest.raises(ValidationError):
        DecisionResult(value="x", confidence=2, signals=["kind:value"])
    with pytest.raises(ValidationError):
        DecisionResult(value="x", confidence=1, signals=["unlabelled"])
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"not a pdf")
    assert extract_document(str(path)).quality == "failed"


def test_filename_destination_and_single_analysis(monkeypatch):
    calls = {"extract": 0}

    def extraction(_file):
        calls["extract"] += 1
        return ExtractionResult(text="redacted in test", quality="ok")

    def llm(_analysis, _directories):
        return (
            DecisionResult(
                value="2026-09-13_Acme_INV-42.pdf",
                confidence=0.9,
                signals=["supplier:Acme", "invoice:INV-42"],
            ),
            DecisionResult(
                value="/Clients/Acme/Factures",
                confidence=0.8,
                signals=["parent:Acme", "type:invoice"],
            ),
        )

    monkeypatch.setattr(dsa, "_extract", extraction)
    monkeypatch.setattr(dsa, "_both_decisions", llm)
    result = dsa.suggest(b"ignored", ["/Clients/Able/Factures", "/Clients/Acme/Factures"])
    assert result.filename.value == "2026-09-13_Acme_INV-42.pdf"
    assert result.destination.value == "/Clients/Acme/Factures"
    assert calls["extract"] == 1


@pytest.mark.parametrize("value", ["/invented", "/Clients/Acme/Factures/Child"])
def test_destination_outside_tree_fails_closed(monkeypatch, value):
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda _: ExtractionResult(text="enough extracted content for analysis", quality="ok"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(value=value, confidence=0.99, signals=["match:claimed"]),
    )
    result = dsa.suggest_directory(b"x", ["/Clients/Acme/Factures"])
    assert result.value is None and "destination_outside_tree" in result.warnings


def test_no_credible_match_and_low_confidence(monkeypatch):
    monkeypatch.setattr(
        dsa, "_extract", lambda _: ExtractionResult(text="sparse", quality="sparse")
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(
            value="original-name.pdf", confidence=0.49, signals=["basis:none"]
        ),
    )
    result = dsa.suggest_filename(b"misleading-name.pdf")
    assert result.value is None and "low_confidence" in result.warnings


@pytest.mark.parametrize(
    ("value", "signals"),
    [
        ("2026-09-13_Acme_INV-42.pdf", ["supplier:Acme", "invoice:INV-42"]),
        ("2026-09-13_Alix-Bob_Contrat.pdf", ["parties:Alix/Bob", "date:2026-09-13"]),
        ("2026-09-13_Acme_INV-42.pdf", ["original:vacances.jpg", "content:invoice"]),
    ],
)
def test_filename_business_cases(monkeypatch, value, signals):
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda _: ExtractionResult(text="synthetic extracted fields", quality="ok"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(value=value, confidence=0.9, signals=signals),
    )
    assert dsa.suggest_filename(b"synthetic").value == value


def test_destination_no_credible_match(monkeypatch):
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda _: ExtractionResult(text="synthetic extracted fields", quality="sparse"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(value="/Clients/Acme", confidence=0.2, signals=["match:weak"]),
    )
    assert dsa.suggest_directory(b"x", ["/Clients/Acme"]).value is None


def test_temp_file_deleted(monkeypatch):
    observed = []

    def inspect_temp(path, _markdown=False):
        observed.append(path)
        assert Path(path).exists()
        return ExtractionResult(text="", quality="empty")

    monkeypatch.setattr("dsa.tools.extract_document", inspect_temp)
    extract_bytes(b"synthetic", ".png")
    assert observed and not Path(observed[0]).exists()
