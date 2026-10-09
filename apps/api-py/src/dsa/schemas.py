import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

SIGNAL_LABELS = (
    "date",
    "invoice",
    "contract",
    "reference",
    "amount",
    "party",
    "organization",
    "subject",
    "identifier",
    "document_type",
)
SIGNAL_LABEL_RE = re.compile(
    rf"^({'|'.join(SIGNAL_LABELS)})(?:[ _-]+(?:number|id))?\b\s*[:#-]?\s*",
    re.IGNORECASE,
)


class Signal(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    label: str = Field(min_length=1)
    value: str = Field(min_length=1)


class ExtractionResult(BaseModel):
    text: str = Field(repr=False)
    markdown: str = Field(default="", repr=False)
    context: str = Field(default="", repr=False)
    quality: Literal["ok", "sparse", "empty", "failed"]
    warnings: list[str] = Field(default_factory=list, exclude=True)
    first_pass_quality: Literal["ok", "sparse", "empty"] | None = Field(default=None, exclude=True)
    first_pass_text_chars: int = Field(default=0, exclude=True)
    first_pass_md_chars: int = Field(default=0, exclude=True)
    ocr_pass: bool = Field(default=False, exclude=True)


class DecisionResult(BaseModel):
    value: str | None
    confidence: float = Field(ge=0, le=1)
    rationale: str = ""
    _signals: list[Signal] = PrivateAttr(default_factory=list)
    _warnings: list[str] = PrivateAttr(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def labelled_signals(cls, data: Any) -> Any:
        if not isinstance(data, dict) or not isinstance(data.get("signals"), list):
            return data
        normalized = []
        changed = False
        for signal in data["signals"]:
            if not isinstance(signal, str):
                normalized.append(signal)
                continue
            signal = signal.strip()
            if not signal:
                normalized.append(signal)
                continue
            match = SIGNAL_LABEL_RE.match(signal)
            if match and not signal[match.end() :]:
                normalized.append(signal)
                continue
            label = match.group(1).lower() if match else "unlabelled"
            normalized.append({"label": label, "value": signal})
            changed = True
        if not changed and normalized == data["signals"]:
            return data
        warnings = data.get("warnings", [])
        if not isinstance(warnings, list):
            return {**data, "signals": normalized}
        warnings = [*warnings, "unlabelled_signal"]
        return {**data, "signals": normalized, "warnings": warnings}

    def __init__(self, **data):
        legacy = self.labelled_signals(data)
        signals = legacy.get("signals", [])
        warnings = legacy.get("warnings", [])
        validated = LegacyDecision.model_validate({"signals": signals, "warnings": warnings})
        super().__init__(**legacy)
        self._signals = validated.signals
        self._warnings = validated.warnings

    @property
    def signals(self):
        return self._signals

    @property
    def warnings(self):
        return self._warnings


class LegacyDecision(BaseModel):
    signals: list[Signal] = []
    warnings: list[str] = []


class SuggestionResult(BaseModel):
    filename: DecisionResult
    destination: DecisionResult
    extraction_quality: Literal["ok", "sparse", "empty", "failed"]
