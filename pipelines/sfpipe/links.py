"""Analyse d'URL hébergeur → (provider, file_id) conforme au schéma compact (0013)."""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlsplit

# provider en base : enum video_provider ('onefichier' = 1fichier)
PIXELDRAIN = "pixeldrain"
ONEFICHIER = "onefichier"

FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,32}$")

_PIXELDRAIN_HOSTS = {"pixeldrain.com", "www.pixeldrain.com", "pixeldra.in", "www.pixeldra.in"}
# 1fichier + domaines miroirs officiels (même format ?ID)
_ONEFICHIER_HOSTS = {
    "1fichier.com", "alterupload.com", "cjoint.net", "desfichiers.com", "dfichiers.com", "megadl.fr",
    "mesfichiers.org", "piecejointe.net", "pjointe.com", "tenvoi.com", "dl4free.com",
}
_PD_PATH = re.compile(r"^/(?:u|api/file)/([A-Za-z0-9]+)/?(?:info)?$")


class LinkError(ValueError):
    pass


def _onefichier_host(host: str) -> str | None:
    for h in _ONEFICHIER_HOSTS:
        if host == h or host == f"www.{h}":
            return ""
        if host.endswith("." + h):  # ancien format https://<id>.1fichier.com/
            return host[: -len(h) - 1]
    return None


def parse_link(raw: str) -> tuple[str, str]:
    """URL brute → (provider, file_id). Lève LinkError si non reconnue."""
    url = (raw or "").strip()
    if not url:
        raise LinkError("URL vide")
    if "://" not in url:
        url = "https://" + url
    try:
        parts = urlsplit(url)
    except ValueError as e:
        raise LinkError(f"URL invalide : {e}") from e
    host = (parts.hostname or "").lower()

    if host in _PIXELDRAIN_HOSTS:
        if parts.path.startswith("/l/"):
            raise LinkError("liste Pixeldrain (/l/) non supportée : un fichier par ligne")
        m = _PD_PATH.match(parts.path)
        if not m:
            raise LinkError(f"chemin Pixeldrain non reconnu : {parts.path}")
        file_id = m.group(1)
        provider = PIXELDRAIN
    else:
        sub = _onefichier_host(host)
        if sub is None:
            raise LinkError(f"hébergeur non supporté : {host or '?'}")
        if sub:  # https://<id>.1fichier.com/
            file_id = sub
        else:
            # ?<id>&af=… → 1er élément de la query sans « = »
            first = parts.query.split("&", 1)[0]
            if first and "=" not in first:
                file_id = first
            else:
                keys = [k for k, v in parse_qsl(parts.query, keep_blank_values=True) if v == ""]
                if not keys:
                    raise LinkError("identifiant 1fichier introuvable dans la query")
                file_id = keys[0]
        provider = ONEFICHIER

    if not FILE_ID_RE.fullmatch(file_id):
        raise LinkError(f"file_id invalide : {file_id!r}")
    return provider, file_id
