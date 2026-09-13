from datetime import date, datetime, timezone
from enum import Enum
from sqlalchemy import inspect


def serialize(value):
    if isinstance(value, datetime):
        return (
            value.replace(tzinfo=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, list):
        return [serialize(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize(item) for key, item in value.items()}
    if hasattr(value, "__table__"):
        return {
            prop.columns[0].name: serialize(getattr(value, prop.key))
            for prop in inspect(type(value)).column_attrs
        }
    return value
