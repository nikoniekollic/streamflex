"""État local (reprise/idempotence) : upload effectué ? inséré en base ?"""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path


class UploadState:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = asyncio.Lock()
        self._data: dict[str, dict] = {}
        if path.exists():
            try:
                self._data = json.loads(path.read_text("utf-8"))
            except json.JSONDecodeError:
                path.rename(path.with_suffix(f".corrupt-{int(time.time())}.json"))

    @staticmethod
    def key(provider: str, checksum: str) -> str:
        return f"{provider}:{checksum}"

    def get(self, provider: str, checksum: str) -> dict | None:
        return self._data.get(self.key(provider, checksum))

    async def record(self, provider: str, checksum: str, **fields: object) -> None:
        async with self._lock:
            entry = self._data.setdefault(self.key(provider, checksum), {})
            entry.update(fields, updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            self._flush()

    def _flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), "utf-8")
        os.replace(tmp, self.path)
