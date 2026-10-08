from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ExtractionResult(BaseModel):
    text: str = Field(repr=False)
    context: str = Field(default="", repr=False)
    quality: Literal["ok", "sparse", "empty", "failed"]
    warnings: list[str] = []


class DecisionResult(BaseModel):
    value: str | None
    confidence: float = Field(ge=0, le=1)
    signals: list[str]
    warnings: list[str] = []

    @field_validator("signals")
    @classmethod
    def labelled_signals(cls, signals: list[str]) -> list[str]:
        if any(":" not in signal for signal in signals):
            raise ValueError("every signal must be labelled")
        return signals


class SuggestionResult(BaseModel):
    filename: DecisionResult
    destination: DecisionResult
    extraction_quality: Literal["ok", "sparse", "empty", "failed"]
