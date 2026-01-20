import time
from typing import Any, Optional

# Basit in-memory TTL cache (Phase-1 için yeterli)
# Not: Uvicorn reload/çoklu worker olduğunda cache paylaşılmaz, MVP için OK.

_cache: dict[str, tuple[float, Any]] = {}


def cache_get(key: str) -> Optional[Any]:
    item = _cache.get(key)
    if not item:
        return None

    expires_at, value = item
    if expires_at < time.time():
        # expired
        _cache.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    expires_at = time.time() + ttl
    _cache[key] = (expires_at, value)


def cache_clear() -> None:
    _cache.clear()
