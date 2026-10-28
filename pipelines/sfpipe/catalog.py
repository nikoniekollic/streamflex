"""Accès Supabase (service_role) : résolution titre/épisode, idempotence, insertion media_sources."""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

from postgrest.exceptions import APIError
from supabase import AsyncClient, acreate_client

from .media import MediaFile
from .resilience import RetryableError


def db_checksum(checksum: str) -> str:
    """'qh1:<hex sha256>' → littéral bytea PostgREST '\\x<hex>' (32 octets en base au lieu de 68)."""
    hexdigest = checksum.split(":", 1)[-1]
    if len(hexdigest) != 64:
        raise ValueError(f"checksum inattendu: {checksum!r}")
    return "\\x" + hexdigest


def file_id_from(provider: str, external_id: str) -> str:
    """Seul l'ID est stocké (VARCHAR(32), ^[A-Za-z0-9_-]{4,32}$) ; l'URL est reconstruite à la lecture."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{4,32}", external_id or ""):
        raise ValueError(f"{provider}: identifiant de fichier invalide {external_id!r}")
    return external_id


@dataclass(frozen=True)
class Target:
    title_id: str
    episode_id: str | None = None


def _db_error(e: Exception, label: str) -> Exception:
    code = getattr(e, "code", "") or ""
    # 23505 unique / 23514 check / 42501 RLS → non récupérables ; le reste (réseau, 5xx) → retry
    if isinstance(e, APIError) and (code.startswith("23") or code.startswith("42") or code.startswith("PGRST")):
        return e
    return RetryableError(f"{label}: {e}")


class Catalog:
    def __init__(self, client: AsyncClient) -> None:
        self.db = client
        self._lock = asyncio.Lock()  # sérialise les créations titre/saison/épisode
        self._cache: dict[tuple, Target] = {}

    @classmethod
    async def connect(cls, url: str, service_key: str) -> "Catalog":
        if not url or not service_key:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants")
        return cls(await acreate_client(url, service_key))

    async def _one(self, query) -> dict | None:
        try:
            res = await query.limit(1).execute()
        except Exception as e:  # noqa: BLE001
            raise _db_error(e, "supabase select") from e
        return res.data[0] if res.data else None

    async def _insert(self, table: str, row: dict) -> dict:
        try:
            res = await self.db.table(table).insert(row).execute()
        except Exception as e:  # noqa: BLE001
            raise _db_error(e, f"supabase insert {table}") from e
        return res.data[0]

    async def _find_title(self, media: MediaFile, kind: str) -> dict | None:
        slugs = [media.slug]
        if media.parsed.year and not media.title_slug:
            slugs.append(f"{media.slug}-{media.parsed.year}")
        for slug in slugs:
            row = await self._one(self.db.table("titles").select("id, type").eq("slug", slug))
            if row:
                if row["type"] != kind:
                    raise ValueError(f"{media.path.name}: le titre '{slug}' est de type {row['type']}, attendu {kind}")
                return row
        return None

    async def resolve_target(self, media: MediaFile, create_missing: bool) -> Target | None:
        p = media.parsed
        key = (media.slug, p.kind, p.season, p.episode)
        if key in self._cache:
            return self._cache[key]
        async with self._lock:
            if key in self._cache:
                return self._cache[key]
            kind = "series" if p.kind == "episode" else "movie"
            title = await self._find_title(media, kind)
            if not title:
                if not create_missing:
                    return None
                title = await self._insert(
                    "titles",
                    {"type": kind, "slug": media.slug, "title": p.title, "release_year": p.year, "is_published": False},
                )
            if p.kind == "movie":
                target = Target(title["id"])
            else:
                season = await self._one(
                    self.db.table("seasons").select("id").eq("title_id", title["id"]).eq("season_number", p.season)
                ) or (create_missing or None) and await self._insert(
                    "seasons", {"title_id": title["id"], "season_number": p.season}
                )
                if not season:
                    return None
                episode = await self._one(
                    self.db.table("episodes").select("id").eq("season_id", season["id"]).eq("episode_number", p.episode)
                ) or (create_missing or None) and await self._insert(
                    "episodes", {"title_id": title["id"], "season_id": season["id"], "episode_number": p.episode}
                )
                if not episode:
                    return None
                target = Target(title["id"], episode["id"])
            self._cache[key] = target
            return target

    async def source_exists(self, provider: str, checksum: str) -> bool:
        row = await self._one(
            self.db.table("media_sources").select("id").eq("provider", provider).eq("checksum", db_checksum(checksum))
        )
        return row is not None

    async def insert_source(
        self, target: Target, media: MediaFile, provider: str, external_id: str, priority: int
    ) -> str:
        file_id = file_id_from(provider, external_id)
        row = {
            "title_id": None if target.episode_id else target.title_id,
            "episode_id": target.episode_id,
            "provider": provider,
            "file_id": file_id,  # aucune URL stockée
            "quality": media.quality,
            "container": media.container[:8] or None,
            "size_bytes": media.size,
            "checksum": db_checksum(media.checksum),
            "priority": media.priority if media.priority is not None else priority,
            "is_active": True,
            "last_status": 200,
        }
        try:
            return (await self._insert("media_sources", row))["id"]
        except APIError as e:
            if getattr(e, "code", "") == "23505":  # déjà présent (provider, file_id)
                existing = await self._one(
                    self.db.table("media_sources").select("id").eq("provider", provider).eq("file_id", file_id)
                )
                if existing:
                    return existing["id"]
            raise
