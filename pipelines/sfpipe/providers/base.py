from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import aiohttp

from ..media import MediaFile
from ..resilience import FatalError, RetryableError, parse_retry_after

UPLOAD_TIMEOUT = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=600)
API_TIMEOUT = aiohttp.ClientTimeout(total=60, sock_connect=15)
NETWORK_ERRORS = (aiohttp.ClientError, asyncio.TimeoutError, ConnectionError)


@dataclass(frozen=True)
class UploadResult:
    external_id: str
    raw_url: str


class Uploader(Protocol):
    name: str  # = enum video_provider

    async def upload(self, session: aiohttp.ClientSession, media: MediaFile, on_read: Callable[[int], None]) -> UploadResult: ...


async def raise_for_status(resp: aiohttp.ClientResponse, label: str) -> None:
    if resp.status < 400:
        return
    body = (await resp.text(errors="replace"))[:300]
    retry_after = parse_retry_after(resp.headers.get("Retry-After"))
    if resp.status == 429 or resp.status >= 500 or resp.status == 408:
        raise RetryableError(f"{label}: HTTP {resp.status} {body}", retry_after or (30.0 if resp.status == 429 else None))
    raise FatalError(f"{label}: HTTP {resp.status} {body}")
