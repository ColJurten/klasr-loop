import core.py314_compat  # noqa: F401 — PEP 649 shim for pydantic.v1 on 3.14
import os
from pathlib import Path
from typing import BinaryIO

from .schemas import DecisionResult, ExtractionResult, SuggestionResult
from .tools import extract_bytes, extract_document

CONFIDENCE_THRESHOLD = 0.5


def _local_suggestion(analysis: ExtractionResult, directories: list[str]):
    provider = os.getenv("KLASR_LLM_PROVIDER") or "local"
    if provider in {"local", "fake"} and not os.getenv("KLASR_LLM_MODEL"):
        from services.analysis import local_suggestion

        return local_suggestion(analysis, directories)


def _extract(file: str | Path | bytes | BinaryIO, suffix: str = ".pdf") -> ExtractionResult:
    if isinstance(file, (str, Path)):
        return extract_document(str(file))
    if isinstance(file, bytes):
        return extract_bytes(file, suffix)
    name = getattr(file, "name", "document.pdf")
    return extract_bytes(file.read(), Path(name).suffix)


def _decision(kind: str, analysis: ExtractionResult, directories: list[str]) -> DecisionResult:
    """Production CrewAI seam; tests replace this with a deterministic stub LLM."""
    if analysis.quality in {"empty", "failed"}:
        return DecisionResult(
            value=None,
            confidence=0,
            signals=[{"label": "extraction", "value": analysis.quality}],
            warnings=analysis.warnings,
        )
    if local := _local_suggestion(analysis, directories):
        return local.filename if kind == "filename" else local.destination
    from .crews import DocumentSortingAssistantCrew

    assistant = DocumentSortingAssistantCrew()
    crew = assistant.naming_crew() if kind == "filename" else assistant.destination_crew()
    output = crew.kickoff(
        inputs={"content": analysis.context or analysis.text, "directories": directories}
    )
    return DecisionResult.model_validate(output.pydantic or output.to_dict())


def _both_decisions(
    analysis: ExtractionResult, directories: list[str], allow_local: bool = True
) -> tuple[DecisionResult, DecisionResult]:
    if analysis.quality in {"empty", "failed"}:
        failure = _decision("filename", analysis, directories)
        return failure, failure.model_copy(deep=True)
    if allow_local and (local := _local_suggestion(analysis, directories)):
        return local.filename, local.destination
    from .crews import DocumentSortingAssistantCrew

    output = (
        DocumentSortingAssistantCrew()
        .combined_crew()
        .kickoff(inputs={"content": analysis.context or analysis.text, "directories": directories})
    )
    filename, destination = output.tasks_output[-2:]
    return (
        DecisionResult.model_validate(filename.pydantic or filename.to_dict()),
        DecisionResult.model_validate(destination.pydantic or destination.to_dict()),
    )


def _validated_destination(result: DecisionResult, directories: list[str]) -> DecisionResult:
    if result.value is None or "no_destination_match" in result.warnings:
        return result.model_copy(
            update={
                "value": None,
                "confidence": 0,
                "warnings": [
                    "no_destination_match",
                    *(warning for warning in result.warnings if warning != "no_destination_match"),
                ],
            }
        )
    allowed = {path.rstrip("/") or "/" for path in directories}
    value = result.value.rstrip("/")
    if value not in allowed:
        return DecisionResult(
            value=None,
            confidence=0,
            signals=result.signals,
            warnings=[*result.warnings, "destination_outside_tree"],
        )
    if result.confidence < CONFIDENCE_THRESHOLD:
        return result.model_copy(
            update={"value": None, "warnings": [*result.warnings, "low_confidence"]}
        )
    return result.model_copy(update={"value": value})


def suggest_filename(file: str | Path | bytes | BinaryIO, suffix: str = ".pdf") -> DecisionResult:
    extraction = _extract(file, suffix)
    result = _decision("filename", extraction, [])
    if result.confidence < CONFIDENCE_THRESHOLD:
        return result.model_copy(
            update={"value": None, "warnings": [*result.warnings, "low_confidence"]}
        )
    return result


def suggest_directory(
    file: str | Path | bytes | BinaryIO, directories: list[str], suffix: str = ".pdf"
) -> DecisionResult:
    return _validated_destination(
        _decision("directory", _extract(file, suffix), directories), directories
    )


def suggest(
    file: str | Path | bytes | BinaryIO, directories: list[str], suffix: str = ".pdf"
) -> SuggestionResult:
    extraction = _extract(file, suffix)
    filename, destination = _both_decisions(extraction, directories)
    if filename.confidence < CONFIDENCE_THRESHOLD:
        filename = filename.model_copy(
            update={"value": None, "warnings": [*filename.warnings, "low_confidence"]}
        )
    destination = _validated_destination(destination, directories)
    return SuggestionResult(
        filename=filename, destination=destination, extraction_quality=extraction.quality
    )


def suggest_text(
    extraction: ExtractionResult, directories: list[str], llm_factory
) -> SuggestionResult:
    """In-memory worker entry: no credential values cross this boundary."""
    from .crews import provider_factory

    token = provider_factory.set(llm_factory)
    try:
        filename, destination = _both_decisions(extraction, directories, allow_local=False)
        if filename.confidence < CONFIDENCE_THRESHOLD:
            filename = filename.model_copy(
                update={"value": None, "warnings": [*filename.warnings, "low_confidence"]}
            )
        return SuggestionResult(
            filename=filename,
            destination=_validated_destination(destination, directories),
            extraction_quality=extraction.quality,
        )
    finally:
        provider_factory.reset(token)
