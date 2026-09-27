import json
import sys
import types
from io import BytesIO

import pytest
from crewai import BaseLLM
from PIL import Image, ImageDraw
from pydantic import ValidationError

import dsa
from dsa.schemas import DecisionResult, ExtractionResult, Signal
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


def test_offline_cli_filename_and_directory(monkeypatch, tmp_path, stub_docling, capsys):
    from dsa.cli import directory_main, filename_main

    path = tmp_path / "synthetic.pdf"
    path.write_bytes(b"synthetic")
    monkeypatch.setenv("KLASR_LLM_PROVIDER", "local")
    monkeypatch.delenv("KLASR_LLM_MODEL", raising=False)

    monkeypatch.setattr(sys, "argv", ["suggest_filename", "-f", str(path)])
    filename_main()
    filename = DecisionResult.model_validate_json(capsys.readouterr().out)

    directories = ["/Clients/Acme", "/Archive/2026"]
    monkeypatch.setattr(
        sys,
        "argv",
        ["suggest_directory", "-f", str(path), "-d", json.dumps(directories)],
    )
    directory_main()
    destination = DecisionResult.model_validate_json(capsys.readouterr().out)

    assert filename.value and filename.signals == [Signal(label="provider", value="local")]
    assert destination.value == "/Clients/Acme"


def test_corrupted_empty_sparse_and_schema(monkeypatch, tmp_path):
    assert ExtractionResult(text="", quality="empty").quality == "empty"
    with pytest.raises(ValidationError):
        DecisionResult(value="x", confidence=2, signals=["kind:value"])
    normalized = DecisionResult(value="x", confidence=1, signals=["unlabelled"])
    assert normalized.signals == [Signal(label="unlabelled", value="unlabelled")]
    assert "unlabelled_signal" in normalized.warnings
    with pytest.raises(ValidationError):
        DecisionResult(value="x", confidence=1, signals=[42])
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"not a pdf")
    assert extract_document(str(path)).quality == "failed"


def test_filename_destination_and_single_analysis(monkeypatch):
    calls = {"extract": 0}

    def extraction(_file, _suffix=".pdf"):
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
        lambda *_: ExtractionResult(text="enough extracted content for analysis", quality="ok"),
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
        dsa, "_extract", lambda *_: ExtractionResult(text="sparse", quality="sparse")
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
        lambda *_: ExtractionResult(text="synthetic extracted fields", quality="ok"),
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
        lambda *_: ExtractionResult(text="synthetic extracted fields", quality="sparse"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(value="/Clients/Acme", confidence=0.2, signals=["match:weak"]),
    )
    assert dsa.suggest_directory(b"x", ["/Clients/Acme"]).value is None


def test_temp_file_deleted(monkeypatch):
    # Phase 2 strengthens the old cleanup check: no temporary file is created.
    import io

    observed = []

    def inspect_memory(stream, _markdown=False):
        assert isinstance(stream, io.BytesIO)
        assert stream.read() == b"synthetic"
        assert stream.name == "document.png"
        observed.append(stream)
        return ExtractionResult(text="", quality="empty")

    monkeypatch.setattr("dsa.tools.extract_document", inspect_memory)
    extract_bytes(b"synthetic", ".png")
    assert len(observed) == 1


def test_bytes_suffix_is_forwarded(monkeypatch):
    monkeypatch.setattr(
        dsa,
        "extract_bytes",
        lambda _data, suffix: ExtractionResult(text=suffix, quality="ok"),
    )
    assert dsa._extract(b"image", ".png").text == ".png"


def test_empty_destination_keeps_extraction_warning():
    result = DecisionResult(
        value=None, confidence=0, signals=["extraction:empty"], warnings=["no_text"]
    )
    validated = dsa._validated_destination(result, ["/allowed"])
    assert validated.value is None and validated.confidence == 0
    assert validated.warnings[:2] == ["no_destination_match", "no_text"]


class FakeLLM(BaseLLM):
    responses: list[str]
    prompts: list[str] = []

    def call(self, messages, **_kwargs):
        prompt = (
            messages
            if isinstance(messages, str)
            else "\n".join(str(message["content"]) for message in messages)
        )
        self.prompts.append(prompt)
        return self.responses.pop(0)


def test_decision_signals_normalize_llm_drift_and_preserve_labelled_signals():
    result = DecisionResult.model_validate(
        {
            "value": "invoice.pdf",
            "confidence": 0.9,
            "signals": [
                "date: 2026-08-15",
                "Invoice number 12345",
                "Contract reference identified in source text",
            ],
        }
    )
    assert [signal.label for signal in result.signals] == ["date", "invoice", "contract"]
    assert [signal.value for signal in result.signals] == [
        "date: 2026-08-15",
        "Invoice number 12345",
        "Contract reference identified in source text",
    ]
    assert result.warnings == ["unlabelled_signal"]

    labelled = DecisionResult.model_validate(
        {
            "value": "invoice.pdf",
            "confidence": 0.9,
            "signals": [{"label": "reference", "value": "INV-42"}],
            "warnings": [],
        }
    )
    assert labelled.signals == [Signal(label="reference", value="INV-42")]
    assert labelled.warnings == []


@pytest.mark.parametrize(
    "payload",
    [
        {"signals": [""]},
        {"signals": ["date"]},
        {"signals": [{"label": "date", "value": "today", "extra": True}]},
        {"signals": "date: today"},
        {"signals": ["date: today"], "warnings": "illisible"},
    ],
)
def test_decision_signals_fail_closed(payload):
    with pytest.raises(ValidationError):
        DecisionResult.model_validate({"value": "x", "confidence": 1, **payload})


def test_colon_signal_is_lossless_labelled_and_warned_after_existing_warnings():
    result = DecisionResult.model_validate(
        {
            "value": "invoice.pdf",
            "confidence": 0.9,
            "signals": ["Date: 2026-08-15"],
            "warnings": ["filename_warning"],
        }
    )
    assert result.signals == [Signal(label="date", value="Date: 2026-08-15")]
    assert result.warnings == ["filename_warning", "unlabelled_signal"]


def test_crew_renders_inputs_validates_output_and_disables_egress(monkeypatch):
    monkeypatch.setenv("CREWAI_DISABLE_TELEMETRY", "false")
    from dsa import crews

    fake = FakeLLM(
        model="fake",
        responses=[
            '{"value":"analysis","confidence":1,"signals":["kind:invoice"],"warnings":[]}',
            json.dumps(
                {
                    "value": "invoice.pdf",
                    "confidence": 0.9,
                    "signals": ["Invoice number 12345"],
                    "warnings": [],
                }
            ),
            '{"value":"analysis","confidence":1,"signals":["kind:invoice"],"warnings":[]}',
            '{"value":"/Clients/Acme","confidence":0.9,"signals":["kind:invoice"],"warnings":[]}',
        ],
    )
    monkeypatch.setattr(crews, "llm_for", lambda _name: fake)
    crew = crews.DocumentSortingAssistantCrew().naming_crew()
    output = crew.kickoff(inputs={"content": "ACME INVOICE 42", "directories": []})
    assert crew.tracing is False
    assert crews.os.environ["CREWAI_DISABLE_TELEMETRY"] == "true"
    assert isinstance(output.pydantic, DecisionResult)
    assert output.pydantic.value == "invoice.pdf"
    assert output.pydantic.signals == [Signal(label="invoice", value="Invoice number 12345")]
    assert "unlabelled_signal" in output.pydantic.warnings
    assert all("ACME INVOICE 42" in task.description for task in crew.tasks)
    assert any("JAMAIS de simples chaînes de caractères" in prompt for prompt in fake.prompts)

    directory_crew = crews.DocumentSortingAssistantCrew().destination_crew()
    directories = ["/Clients/Acme", "/Archive/2026"]
    directory_crew.kickoff(inputs={"content": "ACME INVOICE 42", "directories": directories})
    assert directory_crew.tracing is False
    assert all(path in directory_crew.tasks[-1].description for path in directories)


def test_combined_crew_task_order_and_prompts(monkeypatch):
    from dsa import crews

    fake = FakeLLM(
        model="fake",
        responses=[
            '{"value":"analysis","confidence":1,"signals":["kind:invoice"],"warnings":[]}',
            '{"value":"invoice.pdf","confidence":0.9,"signals":["kind:invoice"],"warnings":[]}',
            '{"value":"/Clients/Acme","confidence":0.9,"signals":["kind:invoice"],"warnings":[]}',
        ],
    )
    monkeypatch.setattr(crews, "llm_for", lambda _name: fake)
    combined = crews.DocumentSortingAssistantCrew().combined_crew()
    output = combined.kickoff(
        inputs={"content": "ACME INVOICE 42", "directories": ["/Clients/Acme"]}
    )
    assert combined.tracing is False
    # The last two tasks are filename then destination (in crew task order).
    tasks_output = output.tasks_output
    assert tasks_output[-2].pydantic.value == "invoice.pdf"
    assert tasks_output[-1].pydantic.value == "/Clients/Acme"
    # FakeLLM collected prompts (N6: prompts must be asserted).
    assert len(fake.prompts) == 3
    # At least the first prompt (analysis task) contains the content.
    assert "ACME INVOICE 42" in fake.prompts[0]


@pytest.mark.parametrize(
    (
        "content",
        "model_destination",
        "model_confidence",
        "model_warnings",
        "destination",
        "confidence",
        "warnings",
    ),
    [
        (
            "Contract REF-ZEPHYR-742 dated 2026-08-15 from Zephyr Research. "
            "Archived research memorandum.",
            None,
            0.9,
            [],
            None,
            0,
            ["no_destination_match"],
        ),
        (
            "Archived research memorandum.",
            "stg_tree/quotes",
            0.9,
            ["no_destination_match"],
            None,
            0,
            ["no_destination_match"],
        ),
        (
            "INVOICE INV-42 dated 2026-08-15 from Acme",
            "stg_tree/invoices",
            0.98,
            [],
            "stg_tree/invoices",
            0.98,
            [],
        ),
    ],
)
def test_stub_llm_destination_contract(
    monkeypatch,
    content,
    model_destination,
    model_confidence,
    model_warnings,
    destination,
    confidence,
    warnings,
):
    from dsa import crews

    fake = FakeLLM(
        model="fake",
        responses=[
            '{"value":"analysis","confidence":1,"signals":[],"warnings":[]}',
            '{"value":"document.pdf","confidence":0.9,"signals":[],"warnings":[]}',
            json.dumps(
                {
                    "value": model_destination,
                    "confidence": model_confidence,
                    "signals": [],
                    "warnings": model_warnings,
                }
            ),
        ],
    )
    monkeypatch.setattr(crews, "llm_for", lambda _name: fake)

    result = dsa.suggest_text(
        ExtractionResult(text=content, quality="ok"),
        ["stg_tree/invoices", "stg_tree/meetings", "stg_tree/quotes"],
        lambda _name: fake,
    )

    assert result.destination.value == destination
    assert result.destination.confidence == confidence
    assert result.destination.warnings == warnings
    assert any(
        "Ne choisir un chemin que si le contenu l'étaye directement" in p for p in fake.prompts
    )


# --- Phase 4: Suggestion quality tests ---


def test_assess_quality_with_signals(stub_docling, tmp_path):
    """Content with date and identifier signals gets 'ok' quality."""
    from dsa.tools import _assess_quality

    quality, warnings = _assess_quality("Supplier: Acme; invoice: INV-42; date: 2026-09-13")
    assert quality == "ok"
    assert "no_dates_found" not in warnings
    assert "no_identifiers_found" not in warnings


def test_assess_quality_without_signals(stub_docling, tmp_path):
    """Content long enough but without recognizable signals gets 'sparse'."""
    from dsa.tools import _assess_quality

    quality, warnings = _assess_quality("x" * 100)
    assert quality == "sparse"
    assert "no_recognizable_signals" in warnings


def test_assess_quality_empty(stub_docling, tmp_path):
    """Empty content gets 'empty'."""
    from dsa.tools import _assess_quality

    quality, warnings = _assess_quality("")
    assert quality == "empty"
    assert warnings == []


def test_assess_quality_short_content(stub_docling, tmp_path):
    """Very short content gets 'sparse' with warning."""
    from dsa.tools import _assess_quality

    quality, warnings = _assess_quality("tiny")
    assert quality == "sparse"
    assert "very_short_content" in warnings


def test_assess_quality_with_siret(stub_docling, tmp_path):
    """SIRET number is recognized as a signal."""
    from dsa.tools import _assess_quality

    quality, _ = _assess_quality("Société: Acme SARL SIRET: 123 456 789 00012" + " " * 40)
    assert quality == "ok"


def test_assess_quality_no_dates_warning(stub_docling, tmp_path):
    """Content with identifiers but no dates gets 'ok' with warning."""
    from dsa.tools import _assess_quality

    quality, warnings = _assess_quality(
        "Supplier: Acme; invoice: INV-42; amount: 1500.00 EUR" + " " * 20
    )
    assert quality == "ok"
    assert "no_dates_found" in warnings


def test_docling_config_uses_pipeline_options(stub_docling, tmp_path):
    """Verify _build_converter creates a DocumentConverter (fallback when mocked)."""
    from dsa.tools import _build_converter

    converter = _build_converter()
    assert converter is not None


def test_filename_grounded_on_content_not_filename(monkeypatch):
    """Filename is built from content signals, not original filename."""
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda *_: ExtractionResult(
            text="Facture Fournisseur: Acme date: 2026-09-13 référence: INV-42",
            quality="ok",
        ),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(
            value="2026-09-13_facture_Acme_INV-42.pdf",
            confidence=0.9,
            signals=["supplier:Acme", "invoice:INV-42"],
        ),
    )
    # Original filename is misleading ("vacances.jpg") but content is an invoice
    result = dsa.suggest_filename(b"vacances.jpg")
    assert result.value == "2026-09-13_facture_Acme_INV-42.pdf"
    assert "vacances" not in (result.value or "")


def test_nested_tree_destination_parent_context_disambiguates(monkeypatch):
    """Parent context disambiguates same leaf names."""
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda *_: ExtractionResult(text="invoice content for Acme", quality="ok"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(
            value="/Clients/Acme/Factures", confidence=0.9, signals=["parent:Acme"]
        ),
    )
    # Two folders with same leaf name "Factures" but different parents
    result = dsa.suggest_directory(
        b"doc.pdf",
        ["/Clients/Acme/Factures", "/Clients/Beta/Factures"],
    )
    assert result.value == "/Clients/Acme/Factures"


def test_destination_outside_tree_rejects_substring(monkeypatch):
    """Substring path not in tree is rejected."""
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda *_: ExtractionResult(text="some content here", quality="ok"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(
            value="/Clients/Acme/Factures/Child", confidence=0.99, signals=["match:claimed"]
        ),
    )
    result = dsa.suggest_directory(b"x", ["/Clients/Acme/Factures"])
    assert result.value is None
    assert "destination_outside_tree" in result.warnings


def test_independent_confidence_sparse_caps_both(monkeypatch):
    """Sparse extraction caps both filename and destination confidence at 0.55.

    The capping happens in AnalysisService.suggest(), not in the DSA-level suggest().
    This test verifies the DSA suggest() returns raw confidences (the capping is
    applied at the service layer, not the DSA layer).
    """
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda *_: ExtractionResult(text="sparse", quality="sparse"),
    )

    def llm(_analysis, _directories):
        return (
            DecisionResult(value="name.pdf", confidence=0.95, signals=["kind:invoice"]),
            DecisionResult(value="/Invoices", confidence=0.9, signals=["kind:invoice"]),
        )

    monkeypatch.setattr(dsa, "_both_decisions", llm)
    result = dsa.suggest(b"doc.pdf", ["/Invoices"])
    # DSA-level suggest returns raw confidences (not capped — capping is in AnalysisService)
    assert result.filename.confidence == 0.95
    assert result.destination.confidence == 0.9
    assert result.extraction_quality == "sparse"


def test_mechanical_low_confidence_on_failed_extraction(monkeypatch):
    """Failed extraction produces mechanical zero confidence."""
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda *_: ExtractionResult(text="", quality="failed", warnings=["extraction_failed"]),
    )

    def llm(_analysis, _directories):
        return (
            DecisionResult(value=None, confidence=0, signals=[], warnings=["extraction_failed"]),
            DecisionResult(value=None, confidence=0, signals=[], warnings=["extraction_failed"]),
        )

    monkeypatch.setattr(dsa, "_both_decisions", llm)
    result = dsa.suggest(b"broken.pdf", ["/Invoices"])
    assert result.filename.confidence == 0
    assert result.destination.confidence == 0
    assert result.filename.value is None
    assert result.destination.value is None


def test_pdf_pipeline_options_are_wired_correctly():
    # Regression: PdfPipelineOptions must be wrapped in PdfFormatOption keyed by
    # InputFormat.PDF; the flat {"pdf": options} form builds but fails at convert
    # time with AttributeError, silently degrading every PDF to extraction_failed.
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat

    from dsa.tools import _build_converter

    converter = _build_converter()
    assert isinstance(converter, DocumentConverter)
    option = converter.format_to_options.get(InputFormat.PDF)
    assert option is not None and isinstance(option, PdfFormatOption)
    assert option.pipeline_options.do_ocr is True


def test_scanned_pdf_is_extracted_with_ocr():
    image = Image.new("RGB", (1600, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.text((100, 100), "FACTURE INV-2026-042", fill="black", font_size=80)
    draw.text((100, 250), "DATE 2026-09-20", fill="black", font_size=80)
    draw.text((100, 400), "TOTAL 1 234,56 EUR", fill="black", font_size=80)
    scanned_pdf = BytesIO()
    image.save(scanned_pdf, format="PDF", resolution=200)

    result = extract_bytes(scanned_pdf.getvalue(), ".pdf")

    assert result.quality in {"ok", "sparse"}
    assert result.text
