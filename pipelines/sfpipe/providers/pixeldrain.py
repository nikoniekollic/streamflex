"""Pixeldrain : PUT /api/file/{name} (stream brut, Basic auth ':<api_key>') → {"id": "..."}"""
from __future__ import annotations

from collections.abc import Callable
from urllib.parse import quote

import aiohttp

from ..media import MediaFile, ProgressFile
from ..resilience import FatalError, RateLimiter, RetryableError
from .base import API_TIMEOUT, NETWORK_ERRORS, UPLOAD_TIMEOUT, UploadResult, raise_for_status

API = "https://pixeldrain.com/api"


class PixeldrainUploader:
    name = "pixeldrain"

    def __init__(self, api_key: str, limiter: RateLimiter, api_base: str = API) -> None:
        if not api_key:
            raise FatalError("PIXELDRAIN_API_KEY manquant")
        self._auth = aiohttp.BasicAuth("", api_key)
        self._limiter = limiter
        self._api = api_base.rstrip("/")

    @property
    def limiter(self) -> RateLimiter:
        return self._limiter

    async def upload(self, session: aiohttp.ClientSession, media: MediaFile, on_read: Callable[[int], None]) -> UploadResult:
        url = f"{self._api}/file/{quote(media.path.name)}"
        await self._limiter.acquire()
        try:
            with ProgressFile(media.path, on_read) as body:
                async with session.put(url, data=body, auth=self._auth, timeout=UPLOAD_TIMEOUT) as resp:
                    await raise_for_status(resp, "pixeldrain upload")
                    payload = await resp.json(content_type=None)
        except NETWORK_ERRORS as e:
            raise RetryableError(f"pixeldrain upload: {type(e).__name__}: {e}") from e

        file_id = payload.get("id") if isinstance(payload, dict) else None
        if not file_id:
            raise RetryableError(f"pixeldrain upload: réponse inattendue {payload!r}")
        await self._verify(session, file_id, media.size)
        return UploadResult(external_id=file_id, raw_url=f"https://pixeldrain.com/u/{file_id}")

    async def _verify(self, session: aiohttp.ClientSession, file_id: str, expected_size: int) -> None:
        await self._limiter.acquire()
        try:
            async with session.get(f"{self._api}/file/{file_id}/info", auth=self._auth, timeout=API_TIMEOUT) as resp:
                await raise_for_status(resp, "pixeldrain info")
                info = await resp.json(content_type=None)
        except NETWORK_ERRORS as e:
            raise RetryableError(f"pixeldrain info: {e}") from e
        size = info.get("size") if isinstance(info, dict) else None
        if size is not None and int(size) != expected_size:
            raise RetryableError(f"pixeldrain: taille {size} ≠ {expected_size} (upload tronqué)")
