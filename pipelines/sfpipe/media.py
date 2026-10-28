"""Découverte des fichiers, parsing des noms, qualité, empreinte rapide."""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import re
import shutil
import threading
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

VIDEO_EXT = {".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi", ".ts"}
QUALITIES = ("480p", "720p", "1080p", "2160p")

_EP_RE = re.compile(r"^(?P<show>.+?)[\s._-]*[\[(]?S(?P<s>\d{1,2})[\s._-]?E(?P<e>\d{1,3})", re.I)
_YEAR_RE = re.compile(r"^(?P<title>.+?)[\s._\-(\[]+(?P<year>(?:19|20)\d{2})(?:[)\]\s._-]|$)")
_QUALITY_RE = re.compile(r"(?<![0-9])(2160p|4k|uhd|1080p|720p|576p|480p)(?![0-9a-z])", re.I)
_SEP_RE = re.compile(r"[._]+")


def slugify(value: str) -> str:
    v = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", v).strip("-")


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", _SEP_RE.sub(" ", s)).strip(" -")


def quality_from_name(name: str) -> str | None:
    m = _QUALITY_RE.search(name)
    if not m:
        return None
    q = m.group(1).lower()
    return {"4k": "2160p", "uhd": "2160p", "576p": "480p"}.get(q, q)


def quality_from_height(height: int) -> str:
    if height >= 1600:
        return "2160p"
    if height >= 900:
        return "1080p"
    if height >= 600:
        return "720p"
    return "480p"


@dataclass
class ParsedName:
    kind: Literal["movie", "episode"]
    title: str
    year: int | None = None
    season: int | None = None
    episode: int | None = None

    @property
    def slug(self) -> str:
        return slugify(self.title)


def parse_filename(path: Path | str) -> ParsedName:
    stem = Path(path).stem
    m = _EP_RE.match(stem)
    if m:
        show = _clean(m.group("show"))
        ym = _YEAR_RE.match(show + " ")
        year = int(ym.group("year")) if ym else None
        if ym:
            show = _clean(ym.group("title"))
        return ParsedName("episode", show, year, int(m.group("s")), int(m.group("e")))
    m = _YEAR_RE.match(stem)
    if m:
        return ParsedName("movie", _clean(m.group("title")), int(m.group("year")))
    title = _QUALITY_RE.split(stem)[0]
    return ParsedName("movie", _clean(title) or _clean(stem))


@dataclass
class MediaFile:
    path: Path
    size: int
    parsed: ParsedName
    quality: str = "1080p"
    checksum: str = ""
    title_slug: str | None = None  # override manifest
    priority: int | None = None
    extra: dict = field(default_factory=dict)

    @property
    def slug(self) -> str:
        return self.title_slug or self.parsed.slug

    @property
    def container(self) -> str:
        return self.path.suffix.lstrip(".").lower()

    @property
    def label(self) -> str:
        p = self.parsed
        if p.kind == "episode":
            return f"{self.slug} S{p.season:02d}E{p.episode:02d} [{self.quality}]"
        return f"{self.slug}{f' ({p.year})' if p.year else ''} [{self.quality}]"


def scan(paths: Iterable[Path]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        p = p.expanduser()
        if p.is_dir():
            out.extend(f for f in sorted(p.rglob("*")) if f.is_file() and f.suffix.lower() in VIDEO_EXT and not f.name.startswith("."))
        elif p.is_file() and p.suffix.lower() in VIDEO_EXT:
            out.append(p)
    seen: set[Path] = set()
    return [f for f in (x.resolve() for x in out) if not (f in seen or seen.add(f))]


def load_manifest(path: Path) -> dict[Path, dict]:
    """CSV (path,title_slug,kind,season,episode,quality,priority) ou JSON [{...}]."""
    base = path.parent
    rows: list[dict] = json.loads(path.read_text("utf-8")) if path.suffix == ".json" else list(csv.DictReader(path.open(encoding="utf-8")))
    out: dict[Path, dict] = {}
    for r in rows:
        p = Path(r["path"]).expanduser()
        out[(p if p.is_absolute() else base / p).resolve()] = {k: v for k, v in r.items() if v not in (None, "")}
    return out


QUICK_CHUNK = 4 * 1024 * 1024


def quick_hash(path: Path) -> str:
    """Empreinte rapide : taille + 3 blocs de 4 Mio (début/milieu/fin). Stable et O(1) sur gros fichiers."""
    size = path.stat().st_size
    h = hashlib.sha256(str(size).encode())
    with path.open("rb") as f:
        for offset in sorted({0, max(0, size // 2 - QUICK_CHUNK // 2), max(0, size - QUICK_CHUNK)}):
            f.seek(offset)
            h.update(f.read(QUICK_CHUNK))
    return "qh1:" + h.hexdigest()


async def probe_height(path: Path) -> int | None:
    if not shutil.which("ffprobe"):
        return None
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    try:
        return int(out.decode().strip().splitlines()[0])
    except (ValueError, IndexError):
        return None


async def build_media(path: Path, manifest_row: dict | None = None) -> MediaFile:
    row = manifest_row or {}
    parsed = parse_filename(path)
    if row.get("kind") in ("movie", "episode"):
        parsed.kind = row["kind"]
    if "season" in row:
        parsed.season, parsed.kind = int(row["season"]), "episode"
    if "episode" in row:
        parsed.episode, parsed.kind = int(row["episode"]), "episode"
    if parsed.kind == "episode" and (parsed.season is None or parsed.episode is None):
        raise ValueError(f"{path.name}: saison/épisode introuvables")

    quality = row.get("quality") or quality_from_name(path.name)
    if not quality:
        h = await probe_height(path)
        quality = quality_from_height(h) if h else "1080p"
    if quality not in QUALITIES:
        raise ValueError(f"{path.name}: qualité invalide {quality}")

    return MediaFile(
        path=path,
        size=path.stat().st_size,
        parsed=parsed,
        quality=quality,
        checksum=await asyncio.to_thread(quick_hash, path),
        title_slug=row.get("title_slug"),
        priority=int(row["priority"]) if "priority" in row else None,
    )


class ProgressFile(io.BufferedReader):
    """Fichier binaire qui notifie les octets lus (thread-safe). Reconnu par aiohttp comme BufferedReader
    → streaming + Content-Length automatiques, sans charger le fichier en mémoire."""

    def __init__(self, path: Path, on_read: Callable[[int], None] | None = None, buffer_size: int = 1024 * 1024) -> None:
        super().__init__(io.FileIO(str(path), "rb"), buffer_size=buffer_size)
        self._on_read = on_read
        self._lock = threading.Lock()

    def read(self, size: int | None = -1) -> bytes:  # type: ignore[override]
        data = super().read(size)
        if data and self._on_read:
            with self._lock:
                self._on_read(len(data))
        return data
