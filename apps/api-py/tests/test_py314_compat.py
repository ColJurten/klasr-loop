from pydantic.v1 import BaseSettings, ValidationError
import pytest


def test_deferred_optional_field():
    class Settings(BaseSettings):
        limit: int | None = None

    assert Settings().limit is None
    assert Settings(limit="42").limit == 42
    with pytest.raises(ValidationError):
        Settings(limit="invalid")
