import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    quality: Literal["ok", "sparse", "empty", "failed"]
    warnings: list[str] = []


class DecisionResult(BaseModel):
    value: str | None
    confidence: float = Field(ge=0, le=1)
    signals: list[Signal]
    warnings: list[str] = []

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
            if ":" in signal:
                label, value = signal.split(":", 1)
            elif match := SIGNAL_LABEL_RE.match(signal):
                label, value = match.group(1).lower(), signal[match.end() :]
                changed = True
            else:
                label, value = "evidence", signal
                changed = True
            normalized.append({"label": label.strip(), "value": value.strip()})
        if not changed and normalized == data["signals"]:
            return data
        warnings = list(data.get("warnings") or [])
        if changed:
            warnings.append("signal sans label normalisé")
        return {**data, "signals": normalized, "warnings": warnings}


class SuggestionResult(BaseModel):
    filename: DecisionResult
    destination: DecisionResult
    extraction_quality: Literal["ok", "sparse", "empty", "failed"]
