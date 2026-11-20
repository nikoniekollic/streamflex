"""StreamFlex : travailleur autonome (durées réelles + images de jaquettes).

Tourne en arrière-plan sur le PC de l'admin (connexion de particulier : Alldebrid et 1fichier refusent les serveurs).
Boucle : demande un lot de vidéos au site (fonction media-worker), débride chaque lien avec Alldebrid, lit la durée
(ffprobe), prend une image au moment de la jaquette (ffmpeg, WebP ~8 Ko) et renvoie le tout. Rien à faire : pause 10 min.
Un fichier que le débrideur dit supprimé est signalé ; la surveillance 1fichier le vérifie et le retire du site.

Réglages : worker.env à côté de ce fichier (SUPABASE_URL, WORKER_SECRET, PARALLEL facultatif).
Journal  : worker.log à côté de ce fichier.
Lancement automatique à l'ouverture de session : setup_worker.ps1.
Bibliothèque standard seulement (aucun pip install) ; ffmpeg et ffprobe doivent être installés.
"""
from __future__ import annotations

import base64
import json
import logging
import logging.handlers
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ALLDEBRID = "https://api.alldebrid.com/v4"
IDLE_SLEEP_S = 600  # rien à traiter : on revient dans 10 min
ERROR_SLEEP_S = 60
BATCH = 12
STILL_MAX_BYTES = 60_000
# fichier supprimé (LINK_TEMPORARY_UNAVAILABLE = hébergeur momentanément indisponible : pas une suppression)
GONE = ("LINK_DOWN", "LINK_NOT_FOUND", "LINK_ERROR", "DELAYED_FAILED")
BUSY = ("LINK_HOST_UNAVAILABLE", "LINK_HOST_FULL", "LINK_HOST_LIMIT_REACHED", "LINK_TOO_MANY_DOWNLOADS", "RATE_LIMIT", "DELAYED_TIMEOUT")
NO_WINDOW = 0x08000000 if os.name == "nt" else 0  # pas de fenêtre noire pour chaque ffmpeg

log = logging.getLogger("worker")


def setup_log() -> None:
    h = logging.handlers.RotatingFileHandler(HERE / "worker.log", maxBytes=2_000_000, backupCount=2, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"))
    log.addHandler(h)
    if sys.stdout and sys.stdout.isatty():
        log.addHandler(logging.StreamHandler(sys.stdout))
    log.setLevel(logging.INFO)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    p = HERE / "worker.env"
    if p.exists():
        for line in p.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    for k in ("SUPABASE_URL", "WORKER_SECRET", "PARALLEL", "FFMPEG_DIR"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    return env


class Busy(Exception):
    """Alldebrid / hébergeur saturé : on lève le pied."""


class Gone(Exception):
    """Fichier supprimé chez l'hébergeur."""


class Worker:
    def __init__(self, env: dict[str, str]):
        self.url = env["SUPABASE_URL"].rstrip("/") + "/functions/v1/media-worker"
        self.secret = env["WORKER_SECRET"]
        self.parallel = max(1, min(6, int(env.get("PARALLEL") or 2)))
        ffdir = env.get("FFMPEG_DIR")
        self.ffmpeg = str(Path(ffdir) / "ffmpeg.exe") if ffdir else shutil.which("ffmpeg")
        self.ffprobe = str(Path(ffdir) / "ffprobe.exe") if ffdir else shutil.which("ffprobe")
        self.busy_until = 0.0

    # ───────── site
    def call(self, action: str, **payload) -> dict:
        data = json.dumps({"action": action, **payload}).encode()
        req = urllib.request.Request(self.url, data=data, method="POST", headers={"Content-Type": "application/json", "x-worker-secret": self.secret})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode(errors="replace")
            raise RuntimeError(f"site HTTP {e.code} : {body}") from None

    # ───────── Alldebrid
    def debrid(self, path: str, d: dict, **params) -> dict:
        q = urllib.parse.urlencode({"agent": d["agent"], "apikey": d["key"], **params})
        try:
            with urllib.request.urlopen(f"{ALLDEBRID}{path}?{q}", timeout=20) as r:
                body = json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                raise Busy("RATE_LIMIT") from None
            raise
        if body.get("status") != "success" or not body.get("data"):
            code = (body.get("error") or {}).get("code", "UNKNOWN")
            if code.startswith(GONE):
                raise Gone(code)
            if code.startswith(BUSY):
                raise Busy(code)
            raise RuntimeError(f"Alldebrid {code}")
        return body["data"]

    def unlock(self, file_id: str, d: dict) -> str:
        data = self.debrid("/link/unlock", d, link=f"https://1fichier.com/?{file_id}")
        if data.get("link"):
            return data["link"]
        if data.get("delayed"):
            for _ in range(6):
                time.sleep(5)  # la doc demande 5 s minimum entre deux interrogations
                s = self.debrid("/link/delayed", d, id=str(data["delayed"]))
                if s.get("status") == 2 and s.get("link"):
                    return s["link"]
                if s.get("status") == 3:
                    raise Gone("DELAYED_FAILED")
            raise Busy("DELAYED_TIMEOUT")
        raise RuntimeError("Alldebrid : aucun lien")

    # ───────── ffmpeg
    def probe(self, url: str) -> float | None:
        r = subprocess.run(
            [self.ffprobe, "-v", "error", "-rw_timeout", "20000000", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", url],
            capture_output=True, timeout=90, creationflags=NO_WINDOW,
        )
        try:
            d = float(r.stdout.decode().strip().splitlines()[0])
            return d if 1 <= d <= 86_400 else None
        except (ValueError, IndexError):
            return None

    def still(self, url: str, at: float) -> bytes | None:
        # 320 px de large (vidéo horizontale) ou 480 px de haut (verticale) : la taille d'une jaquette, ~8 Ko
        scale = "scale='if(gte(iw,ih),min(320,iw),-2)':'if(gte(iw,ih),-2,min(480,ih))':flags=lanczos"
        for quality in (55, 35):
            r = subprocess.run(
                [self.ffmpeg, "-v", "error", "-rw_timeout", "20000000", "-ss", f"{at:.2f}", "-i", url, "-frames:v", "1", "-vf", scale,
                 "-c:v", "libwebp", "-quality", str(quality), "-f", "webp", "pipe:1"],
                capture_output=True, timeout=120, creationflags=NO_WINDOW,
            )
            img = r.stdout
            if r.returncode == 0 and img[:4] == b"RIFF" and len(img) <= STILL_MAX_BYTES:
                return img
            if r.returncode != 0:
                log.debug("ffmpeg : %s", r.stderr[-300:].decode(errors="replace"))
                return None
        return None

    # ───────── une vidéo
    def process(self, it: dict, d: dict) -> dict | None:
        tid = it["title_id"]
        if time.time() < self.busy_until:
            return None  # saturé : la réservation expire, la vidéo reviendra plus tard
        try:
            link = self.unlock(it["file_id"], d)
        except Gone as e:
            log.info("%s : fichier supprimé (%s)", tid, e)
            return {"id": tid, "dead": True}
        except Busy as e:
            self.busy_until = time.time() + 120
            log.warning("Alldebrid saturé (%s) : pause 2 min", e)
            return None
        except Exception as e:  # noqa: BLE001
            log.warning("%s : débridage impossible (%s)", tid, e)
            return {"id": tid, "failed": True}

        dur = it.get("duration_s")
        if not dur:
            dur = self.probe(link)
        out: dict = {"id": tid}
        if dur and not it.get("duration_s"):
            out["duration"] = round(dur)
        if it.get("need_still"):
            pos = it.get("cover_pos")
            at = (pos if pos is not None else 0.2) * dur if dur else 10.0
            at = max(1.0, min(at, (dur or 20) - 1))
            img = self.still(link, at)
            if img:
                try:
                    self.call("still", id=tid, pos=pos, image=base64.b64encode(img).decode())
                except Exception as e:  # noqa: BLE001
                    log.warning("%s : envoi de l'image impossible (%s)", tid, e)
                    out["failed"] = True
            else:
                out["failed"] = True
        if not dur:
            out["failed"] = True
        return out

    def run(self) -> None:
        log.info("Démarrage : %s vidéo(s) en parallèle", self.parallel)
        done = 0
        while True:
            try:
                r = self.call("claim", n=BATCH)
                items, d = r.get("items") or [], r.get("debrid")
                if not items:
                    st = r.get("stats") or {}
                    log.info("Rien à faire (sans durée : %s, sans image : %s, images : %s Mo). Pause %s min.",
                             st.get("no_duration"), st.get("no_still"), st.get("stills_mb"), IDLE_SLEEP_S // 60)
                    time.sleep(IDLE_SLEEP_S)
                    continue
                if not d:
                    log.error("Clé Alldebrid non configurée sur le site. Pause %s min.", IDLE_SLEEP_S // 60)
                    time.sleep(IDLE_SLEEP_S)
                    continue
                with ThreadPoolExecutor(self.parallel) as ex:
                    results = [x for x in ex.map(lambda it: self.process(it, d), items) if x]
                if results:
                    self.call("report", items=results)
                done += len(results)
                ok = sum(1 for x in results if not x.get("failed") and not x.get("dead"))
                st = r.get("stats") or {}
                log.info("Lot : %s/%s traité(s), %s fichier(s) supprimé(s). Total session : %s. Restant ~%s sans durée, ~%s sans image%s.",
                         ok, len(items), sum(1 for x in results if x.get("dead")), done, st.get("no_duration"), st.get("no_still"),
                         "" if r.get("stills") else " (stockage des images plein : durées seulement)")
                if time.time() < self.busy_until:
                    time.sleep(max(0, self.busy_until - time.time()))
            except Exception as e:  # noqa: BLE001
                log.error("Erreur : %s. Nouvel essai dans %s s.", e, ERROR_SLEEP_S)
                time.sleep(ERROR_SLEEP_S)


def main() -> int:
    setup_log()
    # une seule instance à la fois (lancement automatique + lancement à la main)
    lock = socket.socket()
    try:
        lock.bind(("127.0.0.1", 47851))
    except OSError:
        log.info("Déjà en cours d'exécution : arrêt de cette copie.")
        return 0
    env = load_env()
    missing = [k for k in ("SUPABASE_URL", "WORKER_SECRET") if not env.get(k)]
    if missing:
        log.error("worker.env incomplet : %s", ", ".join(missing))
        return 1
    w = Worker(env)
    if not w.ffmpeg or not w.ffprobe or not Path(w.ffmpeg).exists() or not Path(w.ffprobe).exists():
        log.error("ffmpeg / ffprobe introuvables. Installe-les : winget install --id Gyan.FFmpeg -e (puis rouvre la session).")
        return 1
    w.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
