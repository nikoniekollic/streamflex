#!/usr/bin/env python3
"""StreamFlex — import massif de liens vidéo (CSV / NDJSON / JSON) vers `media_sources`.

Lecture en flux (jamais le fichier entier en mémoire), transformation à la volée (URL → provider + file_id),
insertion par lots via PostgREST (`ON CONFLICT (provider, file_id) DO NOTHING` → relançable sans doublon),
lots en parallèle avec mémoire bornée, erreurs non bloquantes dans `import_errors.log`.
Aucune dépendance externe (stdlib uniquement).

Colonnes reconnues (CSV avec en-tête, ou clés JSON) :
  url*                       lien Pixeldrain ou 1fichier (ou domaine miroir)
  title_id | episode_id      cible directe (UUID)        ─┐ une des trois
  slug [+ season + episode]  cible par slug du titre     ─┘ (+ saison/épisode pour une série)
  quality (480p|720p|1080p|2160p, déf. 1080p) · priority · size_bytes · audio (fr,en) · subtitles · container

Exemples :
  python scripts/mass_import.py liens.csv --dry-run
  python scripts/mass_import.py liens.csv --batch-size 2000 --workers 4
  python scripts/mass_import.py liens.ndjson --default-slug mon-film
"""
from __future__ import annotations

import argparse
import csv
import http.client
import json
import os
import random
import re
import sys
import threading
import time
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sfpipe.config import load_dotenv  # noqa: E402
from sfpipe.links import LinkError, parse_link  # noqa: E402

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
SLUG_RE = re.compile(r"^[a-z0-9-]{1,120}$")
LANG_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$")
QUALITIES = {"480p", "720p", "1080p", "2160p"}
QUALITY_ALIASES = {"4k": "2160p", "uhd": "2160p", "fhd": "1080p", "hd": "720p", "sd": "480p", "576p": "480p"}
DEFAULT_PRIORITY = {"pixeldrain": 10, "onefichier": 20}
COLUMNS = ("title_id", "episode_id", "provider", "file_id", "quality", "priority", "is_active",
           "size_bytes", "container", "audio_languages", "subtitle_languages")


# ═════════════ Journal d'erreurs (thread-safe, JSON Lines)
class ErrorLog:
    def __init__(self, path: Path) -> None:
        self._f = path.open("a", encoding="utf-8")
        self._lock = threading.Lock()
        self.count = 0

    def write(self, line: int | None, reason: str, raw: object = None) -> None:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "line": line, "reason": reason[:500]}
        if raw is not None:
            rec["raw"] = raw if isinstance(raw, (str, int, float)) else json.dumps(raw, ensure_ascii=False)[:500]
        with self._lock:
            self._f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            self.count += 1

    def close(self) -> None:
        self._f.close()


# ═════════════ Lecture en flux
def read_rows(path: Path, fmt: str, delimiter: str | None) -> Iterator[tuple[int, dict]]:
    """Générateur (n° de ligne, dict) — mémoire O(1) quelle que soit la taille du fichier."""
    if fmt == "csv":
        with path.open("r", encoding="utf-8-sig", newline="") as f:
            sample = f.read(8192)
            f.seek(0)
            dialect: type[csv.Dialect] = csv.excel
            if delimiter:
                dialect = type("Custom", (csv.excel,), {"delimiter": delimiter})
            else:
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
                except csv.Error:
                    pass
            reader = csv.DictReader(f, dialect=dialect)
            if not reader.fieldnames or "url" not in [h.strip().lower() for h in reader.fieldnames]:
                raise SystemExit("En-tête CSV requis avec au moins une colonne « url »")
            for row in reader:
                yield reader.line_num, {(k or "").strip().lower(): (v or "").strip() for k, v in row.items() if k}
    elif fmt == "ndjson":
        with path.open("r", encoding="utf-8") as f:
            for n, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError as e:
                    yield n, {"__error__": f"JSON invalide : {e.msg}", "__raw__": line[:300]}
                    continue
                yield n, obj if isinstance(obj, dict) else {"__error__": "objet JSON attendu", "__raw__": line[:300]}
    else:  # tableau JSON : flux via ijson si installé (pip install ijson), sinon refus explicite
        try:
            import ijson  # type: ignore
        except ImportError:
            raise SystemExit("Tableau JSON : installe `ijson` (lecture en flux) ou convertis en NDJSON (une ligne = un objet)")
        with path.open("rb") as f:
            for n, obj in enumerate(ijson.items(f, "item"), 1):
                yield n, obj if isinstance(obj, dict) else {"__error__": "objet JSON attendu"}


# ═════════════ Transformation
class RowError(ValueError):
    pass


@dataclass
class Parsed:
    line: int
    provider: str
    file_id: str
    title_id: str | None = None
    episode_id: str | None = None
    slug: str | None = None
    season: int | None = None
    episode: int | None = None
    quality: str = "1080p"
    priority: int | None = None
    size_bytes: int | None = None
    container: str | None = None
    audio: list[str] | None = None
    subtitles: list[str] | None = None
    raw_url: str = ""


def _int(v: object, name: str, lo: int, hi: int) -> int | None:
    if v in (None, ""):
        return None
    try:
        n = int(str(v).strip())
    except ValueError:
        raise RowError(f"{name} non entier : {v!r}")
    if not lo <= n <= hi:
        raise RowError(f"{name} hors bornes [{lo}, {hi}] : {n}")
    return n


def _langs(v: object) -> list[str] | None:
    if v in (None, "", []):
        return None
    items = v if isinstance(v, list) else re.split(r"[,;| ]+", str(v))
    out = [str(x).strip() for x in items if str(x).strip()]
    bad = [x for x in out if not LANG_RE.fullmatch(x)]
    if bad:
        raise RowError(f"langue(s) invalide(s) : {bad}")
    return out or None


def transform(line: int, row: dict, default_slug: str | None) -> Parsed:
    if "__error__" in row:
        raise RowError(row["__error__"])
    url = str(row.get("url") or row.get("link") or row.get("lien") or "").strip()
    try:
        provider, file_id = parse_link(url)
    except LinkError as e:
        raise RowError(str(e))

    p = Parsed(line=line, provider=provider, file_id=file_id, raw_url=url)
    tid = str(row.get("title_id") or "").strip()
    eid = str(row.get("episode_id") or "").strip()
    slug = str(row.get("slug") or default_slug or "").strip().lower()
    if eid:
        if not UUID_RE.fullmatch(eid):
            raise RowError(f"episode_id invalide : {eid}")
        p.episode_id = eid
    elif tid:
        if not UUID_RE.fullmatch(tid):
            raise RowError(f"title_id invalide : {tid}")
        p.title_id = tid
    elif slug:
        if not SLUG_RE.fullmatch(slug):
            raise RowError(f"slug invalide : {slug}")
        p.slug = slug
        p.season = _int(row.get("season"), "season", 0, 999)
        p.episode = _int(row.get("episode"), "episode", 1, 9999)
        if (p.season is None) != (p.episode is None):
            raise RowError("season et episode doivent être fournis ensemble")
    else:
        raise RowError("cible manquante : title_id, episode_id ou slug")

    q = str(row.get("quality") or "").strip().lower()
    q = QUALITY_ALIASES.get(q, q)
    if q:
        if q not in QUALITIES:
            raise RowError(f"quality invalide : {q}")
        p.quality = q
    p.priority = _int(row.get("priority"), "priority", 0, 32767)
    p.size_bytes = _int(row.get("size_bytes") or row.get("size"), "size_bytes", 1, 2**62)
    container = str(row.get("container") or "").strip().lower()
    p.container = container[:8] or None
    p.audio = _langs(row.get("audio") or row.get("audio_languages"))
    p.subtitles = _langs(row.get("subtitles") or row.get("subtitle_languages"))
    return p


# ═════════════ Client PostgREST minimal (keep-alive par thread)
class Rest:
    def __init__(self, base_url: str, key: str, timeout: float = 60) -> None:
        u = urlsplit(base_url.rstrip("/"))
        self.https = u.scheme == "https"
        self.host = u.hostname or ""
        self.port = u.port
        self.prefix = (u.path or "") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        self.timeout = timeout
        self._local = threading.local()

    def _conn(self) -> http.client.HTTPConnection:
        c = getattr(self._local, "conn", None)
        if c is None:
            cls = http.client.HTTPSConnection if self.https else http.client.HTTPConnection
            c = cls(self.host, self.port, timeout=self.timeout)
            self._local.conn = c
        return c

    def request(self, method: str, path: str, body: bytes | None = None, extra: dict | None = None) -> tuple[int, bytes, dict]:
        for attempt in range(2):  # 1 reconnexion transparente si la connexion keep-alive a été fermée
            conn = self._conn()
            try:
                conn.request(method, self.prefix + path, body=body, headers={**self.headers, **(extra or {})})
                r = conn.getresponse()
                data = r.read()
                return r.status, data, {k.lower(): v for k, v in r.getheaders()}
            except (http.client.HTTPException, ConnectionError, OSError):
                conn.close()
                self._local.conn = None
                if attempt == 1:
                    raise
        raise RuntimeError("unreachable")


# ═════════════ Résolution slug → title_id / episode_id (par lot, avec cache)
class Resolver:
    def __init__(self, rest: Rest) -> None:
        self.rest = rest
        self.titles: dict[str, tuple[str, str] | None] = {}  # slug → (id, type) | None
        self.episodes: dict[tuple[str, int, int], str | None] = {}
        self.lock = threading.Lock()

    def _get(self, path: str) -> list[dict]:
        status, data, _ = self.rest.request("GET", path)
        if status != 200:
            raise RuntimeError(f"GET {path[:80]} → HTTP {status} {data[:200]!r}")
        return json.loads(data)

    def prepare(self, rows: list[Parsed]) -> None:
        with self.lock:
            missing = sorted({r.slug for r in rows if r.slug and r.slug not in self.titles})
        for i in range(0, len(missing), 200):
            chunk = missing[i : i + 200]
            found = self._get(f"/titles?select=id,slug,type&slug=in.({','.join(chunk)})")
            with self.lock:
                for s in chunk:
                    self.titles.setdefault(s, None)
                for t in found:
                    self.titles[t["slug"]] = (t["id"], t["type"])
        # épisodes des séries concernées
        with self.lock:
            series = sorted({
                self.titles[r.slug][0] for r in rows
                if r.slug and r.season is not None and self.titles.get(r.slug) and self.titles[r.slug][1] == "series"
                and (r.slug, r.season, r.episode) not in self.episodes
            })
        for i in range(0, len(series), 50):
            ids = series[i : i + 50]
            eps = self._get(f"/episodes?select=id,title_id,episode_number,seasons(season_number)&title_id=in.({','.join(ids)})&limit=100000")
            by_title = {tid: slug for slug, v in self.titles.items() if v for tid in [v[0]]}
            with self.lock:
                for e in eps:
                    slug = by_title.get(e["title_id"])
                    sn = (e.get("seasons") or {}).get("season_number")
                    if slug is not None and sn is not None:
                        self.episodes[(slug, sn, e["episode_number"])] = e["id"]

    def apply(self, r: Parsed) -> None:
        if not r.slug:
            return
        t = self.titles.get(r.slug)
        if not t:
            raise RowError(f"titre introuvable pour le slug « {r.slug} »")
        tid, ttype = t
        if r.season is None:
            if ttype != "movie":
                raise RowError(f"« {r.slug} » est une série : season et episode requis")
            r.title_id = tid
        else:
            eid = self.episodes.get((r.slug, r.season, r.episode))
            if not eid:
                raise RowError(f"épisode introuvable : {r.slug} S{r.season:02d}E{r.episode:02d}")
            r.episode_id = eid


def to_record(r: Parsed) -> dict:
    """Forme exacte du schéma compact (mêmes clés pour toutes les lignes : exigence PostgREST)."""
    return {
        "title_id": None if r.episode_id else r.title_id,
        "episode_id": r.episode_id,
        "provider": r.provider,
        "file_id": r.file_id,
        "quality": r.quality,
        "priority": r.priority if r.priority is not None else DEFAULT_PRIORITY[r.provider],
        "is_active": True,
        "size_bytes": r.size_bytes,
        "container": r.container,
        "audio_languages": r.audio,
        "subtitle_languages": r.subtitles,
    }


# ═════════════ Envoi des lots (retries + bissection des lots rejetés)
@dataclass
class Stats:
    read: int = 0
    invalid: int = 0
    sent: int = 0
    failed: int = 0
    batches: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, **kw: int) -> None:
        with self.lock:
            for k, v in kw.items():
                setattr(self, k, getattr(self, k) + v)


class Importer:
    PATH = "/media_sources?on_conflict=provider,file_id&columns=" + ",".join(COLUMNS)
    PREFER = {"Prefer": "return=minimal,resolution=ignore-duplicates"}

    def __init__(self, rest: Rest, errors: ErrorLog, stats: Stats, retries: int = 5) -> None:
        self.rest, self.errors, self.stats, self.retries = rest, errors, stats, retries

    def _post(self, rows: list[tuple[int, dict]]) -> tuple[int, str]:
        body = json.dumps([rec for _, rec in rows], separators=(",", ":")).encode()
        for attempt in range(self.retries):
            try:
                status, data, headers = self.rest.request("POST", self.PATH, body, self.PREFER)
            except (OSError, http.client.HTTPException) as e:
                status, data, headers = 0, str(e).encode(), {}
            if status in (200, 201, 204):
                return status, ""
            if status in (0, 408, 429, 500, 502, 503, 504) and attempt < self.retries - 1:
                wait = float(headers.get("retry-after", 0) or 0) or min(30.0, 0.5 * 2**attempt) * (0.5 + random.random())
                time.sleep(wait)
                continue
            return status, data[:400].decode("utf-8", "replace")
        return 0, "échec après retries"

    def send(self, rows: list[tuple[int, dict]]) -> None:
        status, err = self._post(rows)
        if not err:
            self.stats.add(sent=len(rows), batches=1)
            return
        if status in (400, 409, 422) and len(rows) > 1:
            mid = len(rows) // 2  # une ligne fautive fait échouer tout le lot → bissection pour l'isoler
            self.send(rows[:mid])
            self.send(rows[mid:])
            return
        for line, rec in rows:
            self.errors.write(line, f"insertion refusée (HTTP {status}) : {err}", f"{rec['provider']}:{rec['file_id']}")
        self.stats.add(failed=len(rows))


# ═════════════ Orchestration
def run(args: argparse.Namespace) -> int:
    load_dotenv()
    path = Path(args.file)
    if not path.is_file():
        raise SystemExit(f"Fichier introuvable : {path}")
    fmt = args.format or ("ndjson" if path.suffix.lower() in (".ndjson", ".jsonl") else "json" if path.suffix.lower() == ".json" else "csv")

    errors = ErrorLog(Path(args.errors))
    stats = Stats()
    rest = None if args.dry_run else Rest(args.url or os.environ.get("SUPABASE_URL", ""), args.key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    if rest and (not rest.host or not rest.headers["apikey"]):
        raise SystemExit("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis (pipelines/.env ou --url/--key)")
    resolver = Resolver(rest) if rest else None
    importer = Importer(rest, errors, stats) if rest else None

    pool = ThreadPoolExecutor(max_workers=args.workers, thread_name_prefix="batch")
    inflight = threading.BoundedSemaphore(args.workers * 2)  # mémoire bornée : ≤ 2 lots en attente par worker
    futures: set[Future] = set()
    t0 = last = time.monotonic()

    def process(batch: list[Parsed]) -> None:
        try:
            if resolver:
                try:
                    resolver.prepare(batch)
                except Exception as e:  # noqa: BLE001 — erreur réseau sur la résolution : lot journalisé
                    for r in batch:
                        errors.write(r.line, f"résolution des cibles impossible : {e}", r.raw_url)
                    stats.add(failed=len(batch))
                    return
            ready: list[tuple[int, dict]] = []
            for r in batch:
                try:
                    if resolver:
                        resolver.apply(r)
                    ready.append((r.line, to_record(r)))
                except RowError as e:
                    errors.write(r.line, str(e), r.raw_url)
                    stats.add(invalid=1)
            if ready and importer:
                importer.send(ready)
            elif ready:
                stats.add(sent=len(ready), batches=1)  # dry-run : lignes valides comptées comme « prêtes »
        finally:
            inflight.release()

    def submit(batch: list[Parsed]) -> None:
        inflight.acquire()
        fut = pool.submit(process, batch)
        futures.add(fut)
        fut.add_done_callback(futures.discard)

    batch: list[Parsed] = []
    try:
        for line, row in read_rows(path, fmt, args.delimiter):
            stats.add(read=1)
            if stats.read <= args.skip:
                continue
            if args.limit and stats.read > args.skip + args.limit:
                break
            try:
                batch.append(transform(line, row, args.default_slug))
            except RowError as e:
                errors.write(line, str(e), row.get("url") or row.get("__raw__"))
                stats.add(invalid=1)
            if len(batch) >= args.batch_size:
                submit(batch)
                batch = []
            now = time.monotonic()
            if now - last >= args.progress_every:
                last = now
                rate = stats.read / max(now - t0, 1e-6)
                print(f"… {stats.read:>9,} lues · {stats.sent:>9,} envoyées · {stats.invalid + stats.failed:>7,} erreurs · {rate:,.0f} lignes/s", flush=True)
        if batch:
            submit(batch)
    except KeyboardInterrupt:
        print("\nInterrompu — relancer avec --skip <lignes déjà lues> (les doublons sont ignorés en base).", file=sys.stderr)
    finally:
        pool.shutdown(wait=True)
        errors.close()

    dt = time.monotonic() - t0
    print(
        f"{'[DRY-RUN] ' if args.dry_run else ''}Terminé en {dt:,.1f} s : {stats.read:,} lues · "
        f"{stats.sent:,} {'valides' if args.dry_run else 'envoyées (doublons ignorés en base)'} · "
        f"{stats.invalid:,} invalides · {stats.failed:,} rejetées · {stats.batches:,} lots · "
        f"{stats.read / max(dt, 1e-6):,.0f} lignes/s"
    )
    if errors.count:
        print(f"→ {errors.count:,} erreur(s) détaillée(s) dans {args.errors}")
    return 0 if not (stats.invalid or stats.failed) else 2


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Import massif de liens Pixeldrain / 1fichier vers media_sources")
    ap.add_argument("file", help="CSV (en-tête), NDJSON (.ndjson/.jsonl) ou tableau JSON (.json, nécessite ijson)")
    ap.add_argument("--format", choices=("csv", "ndjson", "json"))
    ap.add_argument("--delimiter", help="séparateur CSV (auto-détecté sinon)")
    ap.add_argument("--batch-size", type=int, default=2000, help="lignes par requête (1000–2500 recommandé)")
    ap.add_argument("--workers", type=int, default=4, help="lots envoyés en parallèle")
    ap.add_argument("--default-slug", help="slug cible si la colonne est absente (un seul titre)")
    ap.add_argument("--skip", type=int, default=0, help="ignorer les N premières lignes (reprise)")
    ap.add_argument("--limit", type=int, default=0, help="ne traiter que N lignes")
    ap.add_argument("--errors", default="import_errors.log")
    ap.add_argument("--dry-run", action="store_true", help="analyse et validation seules, aucun envoi")
    ap.add_argument("--url", help="SUPABASE_URL (sinon .env)")
    ap.add_argument("--key", help="clé service_role (sinon .env)")
    ap.add_argument("--progress-every", type=float, default=5.0)
    a = ap.parse_args(argv)
    if not 1 <= a.batch_size <= 5000:
        ap.error("--batch-size entre 1 et 5000")
    if not 1 <= a.workers <= 16:
        ap.error("--workers entre 1 et 16")
    return a


if __name__ == "__main__":
    sys.exit(run(parse_args()))
