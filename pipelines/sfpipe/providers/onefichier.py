"""1fichier : get_upload_server.cgi → POST multipart upload.cgi?id= → end.pl?xid= (header JSON: 1)."""
from __future__ import annotations

import asyncio
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse

import aiohttp

from ..media import MediaFile, ProgressFile
from ..resilience import FatalError, RateLimiter, RetryableError
from .base import API_TIMEOUT, NETWORK_ERRORS, UPLOAD_TIMEOUT, UploadResult, raise_for_status

API = "https://api.1fichier.com/v1"


def extract_file_id(download_url: str) -> str:
    """https://1fichier.com/?abc123&af=... → abc123"""
    q = urlparse(download_url).query
    first = q.split("&", 1)[0]
    if first and "=" not in first:
        return first
    vals = parse_qs(q)
    if vals:
        return next(iter(vals))
    raise ValueError(f"id 1fichier introuvable dans {download_url}")


class OneFichierUploader:
    name = "onefichier"

    def __init__(self, api_key: str, api_limiter: RateLimiter, folder_id: str = "", api_base: str = API) -> None:
        if not api_key:
            raise FatalError("ONEFICHIER_API_KEY manquant")
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._limiter = api_limiter  # API 1fichier très sensible au flood (ban temporaire)
        self._folder = folder_id
        self._api = api_base.rstrip("/")

    @property
    def limiter(self) -> RateLimiter:
        return self._limiter

    async def _get_upload_server(self, session: aiohttp.ClientSession) -> tuple[str, str]:
        await self._limiter.acquire()
        async with session.post(
            f"{self._api}/upload/get_upload_server.cgi", json={}, headers=self._headers, timeout=API_TIMEOUT
        ) as resp:
            await self._check_flood(resp)
            await raise_for_status(resp, "1fichier get_upload_server")
            data = await resp.json(content_type=None)
        if not isinstance(data, dict) or not data.get("url") or not data.get("id"):
            raise RetryableError(f"1fichier get_upload_server: réponse inattendue {data!r}")
        return str(data["url"]), str(data["id"])

    async def _check_flood(self, resp: aiohttp.ClientResponse) -> None:
        if resp.status in (403, 429):
            text = (await resp.text(errors="replace")).lower()
            if "flood" in text or "too many" in text or resp.status == 429:
                self._limiter.penalize(60)
                raise RetryableError("1fichier: limite de requêtes atteinte", retry_after=60)

    def _upload_base(self, server: str) -> str:
        return server if server.startswith("http") else f"https://{server}"

    async def upload(self, session: aiohttp.ClientSession, media: MediaFile, on_read: Callable[[int], None]) -> UploadResult:
        try:
            server, upload_id = await self._get_upload_server(session)
            base = self._upload_base(server)

            with ProgressFile(media.path, on_read) as body:
                form = aiohttp.FormData()
                form.add_field("file[]", body, filename=media.path.name, content_type="application/octet-stream")
                if self._folder:
                    form.add_field("did", self._folder)
                async with session.post(
                    f"{base}/upload.cgi", params={"id": upload_id}, data=form,
                    headers=self._headers, timeout=UPLOAD_TIMEOUT, allow_redirects=False,
                ) as resp:
                    if resp.status not in (200, 302, 303):
                        await raise_for_status(resp, "1fichier upload.cgi")

            link = await self._finalize(session, base, upload_id)
        except NETWORK_ERRORS as e:
            raise RetryableError(f"1fichier: {type(e).__name__}: {e}") from e

        if int(link.get("size") or media.size) != media.size:
            raise RetryableError(f"1fichier: taille {link.get('size')} ≠ {media.size}")
        download = str(link["download"])
        return UploadResult(external_id=extract_file_id(download), raw_url=download)

    async def _finalize(self, session: aiohttp.ClientSession, base: str, upload_id: str) -> dict:
        for attempt in range(8):
            async with session.get(
                f"{base}/end.pl", params={"xid": upload_id}, headers={**self._headers, "JSON": "1"}, timeout=API_TIMEOUT
            ) as resp:
                await raise_for_status(resp, "1fichier end.pl")
                data = await resp.json(content_type=None)
            links = data.get("links") if isinstance(data, dict) else None
            if links and links[0].get("download"):
                return links[0]
            await asyncio.sleep(min(2 ** attempt, 15))
        raise RetryableError(f"1fichier end.pl: aucun lien pour {upload_id}")
