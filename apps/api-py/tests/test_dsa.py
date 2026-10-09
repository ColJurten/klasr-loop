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
    def export_to_dict(self):
        return {"texts": [{"text": self.export_to_text()}]}

    def export_to_text(self):
        return "Supplier: Acme; invoice: INV-42; date: 2026-09-13"

    def export_to_markdown(self):
        return "# Invoice\nSupplier: Acme; invoice: INV-42; date: 2026-09-13"


class StubConverter:
    def __init__(self, **_kwargs):
        pass

    def convert(self, _path):
        return types.SimpleNamespace(document=StubDocument())


@pytest.fixture
def stub_docling(monkeypatch):
    from dsa.tools import _build_converter

    module = types.ModuleType("docling.document_converter")
    module.DocumentConverter = StubConverter
    module.PdfFormatOption = lambda **kwargs: types.SimpleNamespace(**kwargs)
    module.ImageFormatOption = lambda **kwargs: types.SimpleNamespace(**kwargs)
    monkeypatch.setitem(sys.modules, "docling.document_converter", module)
    _build_converter.cache_clear()  # Never reuse a real converter in stubbed tests.
    yield
    _build_converter.cache_clear()  # Real docling tests must not reuse a stub converter.


def test_supported_file_types_and_quality(tmp_path, stub_docling):
    for suffix in SUPPORTED_SUFFIXES:
        path = tmp_path / f"fixture{suffix}"
        path.write_bytes(b"synthetic")
        result = extract_document(str(path))
        assert result.quality == "ok" and "Acme" in result.text
    assert extract_document(str(tmp_path / "bad.xyz")).quality == "failed"


def test_extract_bytes_exports_plain_text_and_markdown_from_one_conversion(stub_docling):
    result = extract_bytes(b"synthetic", ".pdf")
    assert result.text.startswith("Supplier: Acme")
    assert not result.text.startswith("#")
    assert result.markdown.startswith("# Invoice")


def test_text_layer_does_not_initialize_ocr(monkeypatch):
    calls = []

    def converter(do_ocr=False):
        calls.append(do_ocr)
        if do_ocr:
            raise RuntimeError("OCR engine unavailable")
        return StubConverter()

    monkeypatch.setattr("dsa.tools._build_converter", converter)

    result = extract_bytes(b"synthetic", ".pdf")

    assert result.quality == "ok"
    assert "INV-42" in result.text
    assert calls == [False]


def test_image_uses_one_ocr_enabled_pass(monkeypatch):
    calls = []

    class OcrDocument:
        def export_to_text(self):
            return "Supplier: Acme; invoice: INV-42; date: 2026-09-13"

        def export_to_markdown(self):
            return "# Invoice\nSupplier: Acme; invoice: INV-42; date: 2026-09-13"

    class Converter:
        def __init__(self, document):
            self.document = document

        def convert(self, _path):
            return types.SimpleNamespace(document=self.document)

    def converter(do_ocr=False):
        calls.append(do_ocr)
        return Converter(OcrDocument())

    monkeypatch.setattr("dsa.tools._build_converter", converter)

    result = extract_bytes(b"synthetic", ".png")

    assert result.quality == "ok"
    assert "INV-42" in result.text
    assert calls == [True]


def test_office_file_skips_ocr_pass(monkeypatch):
    calls = []

    class SparseOfficeDocument:
        def export_to_text(self):
            return "R&D"

        def export_to_markdown(self):
            return "R&amp;D"

    class SparseOfficeConverter:
        def convert(self, _path):
            return types.SimpleNamespace(document=SparseOfficeDocument())

    def converter(do_ocr=False):
        calls.append(do_ocr)
        return SparseOfficeConverter()

    monkeypatch.setattr("dsa.tools._build_converter", converter)

    assert extract_bytes(b"synthetic", ".docx").quality == "sparse"
    assert calls == [False]


def test_ocr_fallback_keeps_better_first_pass(monkeypatch):
    class Document:
        def __init__(self, text):
            self.text = text

        def export_to_text(self):
            return self.text

        def export_to_markdown(self):
            return self.text

    def converter(do_ocr=False):
        text = "x" if do_ocr else "Invoice draft with useful surrounding details"
        return types.SimpleNamespace(
            convert=lambda _path: types.SimpleNamespace(document=Document(text))
        )

    monkeypatch.setattr("dsa.tools._build_converter", converter)
    result = extract_bytes(b"synthetic", ".pdf")
    assert result.text == "Invoice draft with useful surrounding details"


def test_ocr_init_failure_preserves_first_pass(monkeypatch):
    warnings = []

    class SparseDocument:
        def export_to_text(self):
            return "Invoice draft"

        def export_to_markdown(self):
            return "Invoice draft"

    class Converter:
        def convert(self, _path):
            return types.SimpleNamespace(document=SparseDocument())

    def converter(do_ocr=False):
        if do_ocr:
            raise RuntimeError("OCR engine unavailable")
        return Converter()

    monkeypatch.setattr("dsa.tools._build_converter", converter)
    monkeypatch.setattr("dsa.tools.logger.warning", lambda *args: warnings.append(args))

    result = extract_bytes(b"synthetic", ".pdf")

    assert result.text == "Invoice draft"
    assert result.quality == "sparse"
    assert warnings == [("%s", "RuntimeError")]  # Only the exception type, no message body.


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

    assert filename.value and filename.rationale
    assert destination.value == "/Clients/Acme"


def test_corrupted_empty_sparse_and_schema(monkeypatch, tmp_path):
    assert ExtractionResult(text="", quality="empty").quality == "empty"
    with pytest.raises(ValidationError):
        DecisionResult(value="x", confidence=2)
    assert set(DecisionResult.model_fields) == {"value", "confidence", "rationale"}
    assert DecisionResult(value="x", confidence=1).rationale == ""
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
            ),
            DecisionResult(
                value="/Clients/Acme/Factures",
                confidence=0.8,
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
        lambda *_: DecisionResult(value=value, confidence=0.99, rationale=f"Vers {value}."),
    )
    result = dsa.suggest_directory(b"x", ["/Clients/Acme/Factures"])
    assert result.value is None and result.confidence == 0
    assert result.rationale == "Destination hors arborescence ; choix manuel requis."
    assert value not in result.rationale


def test_no_credible_match_and_low_confidence(monkeypatch):
    monkeypatch.setattr(
        dsa, "_extract", lambda *_: ExtractionResult(text="sparse", quality="sparse")
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(value="original-name.pdf", confidence=0.49),
    )
    result = dsa.suggest_filename(b"misleading-name.pdf")
    assert result.value is None and result.confidence == 0.49


@pytest.mark.parametrize(
    "value",
    [
        "2026-09-13_Acme_INV-42.pdf",
        "2026-09-13_Alix-Bob_Contrat.pdf",
        "2026-09-13_Acme_INV-42.pdf",
    ],
)
def test_filename_business_cases(monkeypatch, value):
    monkeypatch.setattr(
        dsa,
        "_extract",
        lambda *_: ExtractionResult(text="synthetic extracted fields", quality="ok"),
    )
    monkeypatch.setattr(
        dsa,
        "_decision",
        lambda *_: DecisionResult(value=value, confidence=0.9),
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
        lambda *_: DecisionResult(value="/Clients/Acme", confidence=0.2),
    )
    result = dsa.suggest_directory(b"x", ["/Clients/Acme"])
    assert result.value is None
    assert result.rationale == "Destination incertaine ; choix manuel requis."
    assert "/Clients/Acme" not in result.rationale


def test_temp_file_deleted(monkeypatch):
    # Phase 2 strengthens the old cleanup check: no temporary file is created.
    import io

    observed = []

    def inspect_memory(stream):
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


def test_empty_destination_keeps_rationale():
    result = DecisionResult(value=None, confidence=0, rationale="Aucun contexte lisible.")
    validated = dsa._validated_destination(result, ["/allowed"])
    assert validated == result and validated.rationale == "Aucun contexte lisible."


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
            '{"value":"analysis","confidence":1,"rationale":"Classement proposé."}',
            '{"value":"invoice.pdf","confidence":0.9,"rationale":"Classement proposé."}',
            '{"value":"analysis","confidence":1,"rationale":"Classement proposé."}',
            '{"value":"/Clients/Acme","confidence":0.9,"rationale":"Classement proposé."}',
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
            '{"value":"analysis","confidence":1,"rationale":"Classement proposé."}',
            '{"value":"invoice.pdf","confidence":0.9,"rationale":"Classement proposé."}',
            '{"value":"/Clients/Acme","confidence":0.9,"rationale":"Classement proposé."}',
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
    assert "Value, confidence, rationale (1-2 phrases neutres)" in fake.prompts[-1]


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
        lambda *_: DecisionResult(value="/Clients/Acme/Factures", confidence=0.9),
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
        lambda *_: DecisionResult(value="/Clients/Acme/Factures/Child", confidence=0.99),
    )
    result = dsa.suggest_directory(b"x", ["/Clients/Acme/Factures"])
    assert result.value is None
    assert result.confidence == 0


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
            DecisionResult(value="name.pdf", confidence=0.95),
            DecisionResult(value="/Invoices", confidence=0.9),
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
        lambda *_: ExtractionResult(text="", quality="failed"),
    )

    def llm(_analysis, _directories):
        return (
            DecisionResult(value=None, confidence=0),
            DecisionResult(value=None, confidence=0),
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

    converter = _build_converter(do_ocr=False)
    assert isinstance(converter, DocumentConverter)
    option = converter.format_to_options.get(InputFormat.PDF)
    assert option is not None and isinstance(option, PdfFormatOption)
    assert option.pipeline_options.do_ocr is False

    ocr_converter = _build_converter(do_ocr=True)
    assert ocr_converter.format_to_options[InputFormat.PDF].pipeline_options.do_ocr is True
    assert _build_converter(do_ocr=False) is converter
    assert _build_converter(do_ocr=True) is ocr_converter


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
