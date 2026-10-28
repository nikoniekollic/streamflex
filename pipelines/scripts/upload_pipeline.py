#!/usr/bin/env python3
"""StreamFlex — upload asynchrone en masse vers Pixeldrain / 1fichier + enregistrement dans media_sources.

Exemples :
  python scripts/upload_pipeline.py ../media/inbox --dry-run
  python scripts/upload_pipeline.py ../media/inbox --providers pixeldrain,onefichier --create-missing
  python scripts/upload_pipeline.py film.mkv --manifest manifest.csv --providers pixeldrain
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import signal
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import aiohttp  # noqa: E402

from sfpipe.catalog import Catalog, Target  # noqa: E402
from sfpipe.config import Settings  # noqa: E402
from sfpipe.media import MediaFile, build_media, load_manifest, scan  # noqa: E402
from sfpipe.providers import OneFichierUploader, PixeldrainUploader, Uploader  # noqa: E402
from sfpipe.resilience import FatalError, RateLimiter, RetryableError, with_retries  # noqa: E402
from sfpipe.state import UploadState  # noqa: E402

log = logging.getLogger("sfpipe")
HASH_CONCURRENCY = 4


@dataclass
class Job:
    media: MediaFile
    provider: str
    sent: int = 0
    started: float = 0.0

    @property
    def label(self) -> str:
        return f"[{self.provider}] {self.media.label}"


@dataclass
class Report:
    uploaded: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)


def human(n: float) -> str:
    for unit in ("o", "Ko", "Mo", "Go", "To"):
        if abs(n) < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} Po"


async def progress_reporter(active: dict[int, Job], every: float) -> None:
    while True:
        await asyncio.sleep(every)
        now = time.monotonic()
        for job in list(active.values()):
            pct = 100 * job.sent / job.media.size if job.media.size else 100
            speed = job.sent / max(0.001, now - job.started)
            log.info("↑ %s %5.1f%% %s/s", job.label, pct, human(speed))


class Pipeline:
    def __init__(self, settings: Settings, args: argparse.Namespace) -> None:
        self.s = settings
        self.args = args
        self.state = UploadState(settings.state_file)
        self.report = Report()
        self.active: dict[int, Job] = {}
        self.catalog: Catalog | None = None
        self.uploaders: dict[str, Uploader] = {}
        self.concurrency: dict[str, int] = {}
        self.priority: dict[str, int] = {}

    def _setup_providers(self, names: list[str]) -> None:
        for name in names:
            if name == "pixeldrain":
                self.uploaders[name] = PixeldrainUploader(
                    self.s.pixeldrain_key, RateLimiter(rate=self.s.pixeldrain_rps, burst=max(1, int(self.s.pixeldrain_rps)))
                )
                self.concurrency[name] = self.s.pixeldrain_concurrency
                self.priority[name] = self.s.pixeldrain_priority
            elif name == "onefichier":
                self.uploaders[name] = OneFichierUploader(
                    self.s.onefichier_key, RateLimiter.min_interval(self.s.onefichier_api_min_interval), self.s.onefichier_folder_id
                )
                self.concurrency[name] = self.s.onefichier_concurrency
                self.priority[name] = self.s.onefichier_priority
            else:
                raise SystemExit(f"provider inconnu : {name}")

    async def _retry(self, label: str, fn: Callable, limiter: RateLimiter | None = None):
        return await with_retries(
            fn, label=label, attempts=self.s.max_retries, base=self.s.retry_base_delay, cap=self.s.retry_max_delay, limiter=limiter
        )

    async def collect(self) -> list[MediaFile]:
        files = scan(Path(p) for p in self.args.paths)
        manifest = load_manifest(Path(self.args.manifest)) if self.args.manifest else {}
        sem = asyncio.Semaphore(HASH_CONCURRENCY)
        out: list[MediaFile] = []

        async def one(path: Path) -> None:
            async with sem:
                try:
                    out.append(await build_media(path, manifest.get(path)))
                except (ValueError, OSError) as e:
                    log.error("✗ %s : %s", path.name, e)
                    self.report.failed.append({"file": str(path), "provider": "-", "error": str(e)})

        await asyncio.gather(*(one(p) for p in files))
        out.sort(key=lambda m: str(m.path))
        return out

    async def process(self, session: aiohttp.ClientSession, job: Job) -> None:
        m, provider = job.media, job.provider
        uploader = self.uploaders[provider]
        saved = self.state.get(provider, m.checksum)
        if saved and saved.get("db"):
            self.report.skipped.append({"file": str(m.path), "provider": provider, "reason": "déjà traité (état local)"})
            return

        target: Target | None = None
        if self.catalog:
            target = await self._retry(f"{job.label} catalogue", lambda: self.catalog.resolve_target(m, self.args.create_missing))
            if target is None:
                self.report.skipped.append(
                    {"file": str(m.path), "provider": provider, "reason": f"titre '{m.slug}' absent (utiliser --create-missing ou --manifest)"}
                )
                log.warning("⤼ %s : titre introuvable", job.label)
                return
            if await self._retry(f"{job.label} dédup", lambda: self.catalog.source_exists(provider, m.checksum)):
                await self.state.record(provider, m.checksum, file=str(m.path), db=True)
                self.report.skipped.append({"file": str(m.path), "provider": provider, "reason": "déjà en base (checksum)"})
                return

        if saved and saved.get("external_id"):
            external_id, raw_url = saved["external_id"], saved["raw_url"]
            log.info("↺ %s : upload déjà fait (%s), reprise de l'insertion", job.label, external_id)
        else:
            def on_read(n: int) -> None:
                job.sent += n

            async def attempt():
                job.sent, job.started = 0, time.monotonic()
                return await uploader.upload(session, m, on_read)

            key = id(job)
            self.active[key] = job
            t0 = time.monotonic()
            try:
                result = await self._retry(job.label, attempt, limiter=getattr(uploader, "limiter", None))
            finally:
                self.active.pop(key, None)
            external_id, raw_url = result.external_id, result.raw_url
            dt = time.monotonic() - t0
            log.info("✓ %s → %s (%s en %.0fs, %s/s)", job.label, external_id, human(m.size), dt, human(m.size / max(dt, 0.001)))
            await self.state.record(provider, m.checksum, file=str(m.path), external_id=external_id, raw_url=raw_url, db=False)

        source_id = None
        if self.catalog and target:
            source_id = await self._retry(
                f"{job.label} insert",
                lambda: self.catalog.insert_source(target, m, provider, external_id, self.priority[provider]),
            )
            await self.state.record(provider, m.checksum, db=True, source_id=source_id)
        self.report.uploaded.append(
            {"file": str(m.path), "provider": provider, "external_id": external_id, "raw_url": raw_url, "source_id": source_id}
        )

    async def worker(self, session: aiohttp.ClientSession, queue: asyncio.Queue[Job]) -> None:
        while True:
            job = await queue.get()
            try:
                await self.process(session, job)
            except asyncio.CancelledError:
                raise
            except (RetryableError, FatalError, Exception) as e:  # noqa: BLE001
                log.error("✗ %s : %s", job.label, e)
                self.report.failed.append({"file": str(job.media.path), "provider": job.provider, "error": str(e)})
            finally:
                queue.task_done()

    async def run(self) -> int:
        providers = [p.strip() for p in self.args.providers.split(",") if p.strip()]
        medias = await self.collect()
        if not medias:
            log.warning("Aucun fichier vidéo trouvé.")
            return 1 if self.report.failed else 0

        log.info("%d fichier(s), %s au total → %s", len(medias), human(sum(m.size for m in medias)), ", ".join(providers))
        if self.args.dry_run:
            for m in medias:
                print(f"  {m.label:<60} {human(m.size):>10}  {m.checksum[:16]}  {m.path.name}")
            return 0

        self._setup_providers(providers)
        if not self.args.no_db:
            self.catalog = await Catalog.connect(self.s.supabase_url, self.s.supabase_key)

        connector = aiohttp.TCPConnector(limit=sum(self.concurrency.values()) * 2 + 4, ttl_dns_cache=300)
        async with aiohttp.ClientSession(connector=connector, headers={"User-Agent": "streamflex-pipeline/0.1"}) as session:
            queues: dict[str, asyncio.Queue[Job]] = {p: asyncio.Queue() for p in providers}
            for m in medias:
                for p in providers:
                    queues[p].put_nowait(Job(m, p))
            workers = [
                asyncio.create_task(self.worker(session, queues[p]), name=f"{p}-{i}")
                for p in providers
                for i in range(self.concurrency[p])
            ]
            reporter = asyncio.create_task(progress_reporter(self.active, self.args.progress_every))
            try:
                await asyncio.gather(*(q.join() for q in queues.values()))
            finally:
                for t in (*workers, reporter):
                    t.cancel()
                await asyncio.gather(*workers, reporter, return_exceptions=True)

        return self.summary()

    def summary(self) -> int:
        r = self.report
        log.info("Terminé : %d envoyé(s), %d ignoré(s), %d échec(s)", len(r.uploaded), len(r.skipped), len(r.failed))
        if self.args.report:
            Path(self.args.report).write_text(
                json.dumps({"uploaded": r.uploaded, "skipped": r.skipped, "failed": r.failed}, indent=2, ensure_ascii=False), "utf-8"
            )
        for f in r.failed:
            log.error("  ✗ %s [%s] %s", Path(f["file"]).name, f["provider"], f["error"])
        return 2 if r.failed else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Upload asynchrone StreamFlex → Pixeldrain / 1fichier → Supabase")
    ap.add_argument("paths", nargs="+", help="fichiers ou dossiers (récursif)")
    ap.add_argument("--providers", default="pixeldrain,onefichier", help="pixeldrain,onefichier")
    ap.add_argument("--manifest", help="CSV/JSON : path,title_slug,kind,season,episode,quality,priority")
    ap.add_argument("--create-missing", action="store_true", help="crée titres/saisons/épisodes absents (non publiés)")
    ap.add_argument("--no-db", action="store_true", help="upload seul, sans Supabase")
    ap.add_argument("--dry-run", action="store_true", help="liste le plan sans rien envoyer")
    ap.add_argument("--report", help="écrit un rapport JSON")
    ap.add_argument("--progress-every", type=float, default=15.0, help="intervalle de log de progression (s)")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    pipeline = Pipeline(Settings.from_env(), args)

    loop = asyncio.new_event_loop()
    task = loop.create_task(pipeline.run())
    if sys.platform != "win32":
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, task.cancel)
    try:
        return loop.run_until_complete(task)
    except (asyncio.CancelledError, KeyboardInterrupt):
        log.warning("Interrompu — l'état est sauvegardé, relancer la même commande pour reprendre.")
        return 130
    finally:
        loop.close()


if __name__ == "__main__":
    sys.exit(main())
