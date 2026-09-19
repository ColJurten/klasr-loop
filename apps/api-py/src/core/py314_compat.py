"""Resolve Python 3.14 deferred annotations before pydantic.v1 builds models.

Import before chromadb/crewai: pydantic.v1 otherwise misses annotated fields
with None defaults and raises ConfigError. This is a no-op before Python 3.14.
"""

import sys

if sys.version_info >= (3, 14):
    import pydantic.v1.main as _pm

    _original_new = _pm.ModelMetaclass.__new__

    def _patched_new(mcs, name, bases, namespace, **kwargs):
        if "__annotate_func__" in namespace and "__annotations__" not in namespace:
            af = namespace.pop("__annotate_func__")
            try:
                namespace["__annotations__"] = af(1)
            except Exception:
                namespace["__annotate_func__"] = af
        return _original_new(mcs, name, bases, namespace, **kwargs)

    _pm.ModelMetaclass.__new__ = _patched_new
