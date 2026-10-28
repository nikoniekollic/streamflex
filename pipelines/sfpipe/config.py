from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _int(name: str, default: int) -> int:
    v = os.environ.get(name, "").strip()
    return int(v) if v else default


def _float(name: str, default: float) -> float:
    v = os.environ.get(name, "").strip()
    return float(v) if v else default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_key: str
    pixeldrain_key: str
    onefichier_key: str
    onefichier_folder_id: str
    pixeldrain_concurrency: int
    onefichier_concurrency: int
    pixeldrain_rps: float
    onefichier_api_min_interval: float
    max_retries: int
    retry_base_delay: float
    retry_max_delay: float
    pixeldrain_priority: int
    onefichier_priority: int
    state_file: Path

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        state = Path(os.environ.get("STATE_FILE", ".state/uploads.json"))
        return cls(
            supabase_url=os.environ.get("SUPABASE_URL", ""),
            supabase_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            pixeldrain_key=os.environ.get("PIXELDRAIN_API_KEY", ""),
            onefichier_key=os.environ.get("ONEFICHIER_API_KEY", ""),
            onefichier_folder_id=os.environ.get("ONEFICHIER_FOLDER_ID", ""),
            pixeldrain_concurrency=_int("PIXELDRAIN_CONCURRENCY", 3),
            onefichier_concurrency=_int("ONEFICHIER_CONCURRENCY", 2),
            pixeldrain_rps=_float("PIXELDRAIN_RPS", 2.0),
            onefichier_api_min_interval=_float("ONEFICHIER_API_MIN_INTERVAL", 2.5),
            max_retries=_int("MAX_RETRIES", 6),
            retry_base_delay=_float("RETRY_BASE_DELAY", 2.0),
            retry_max_delay=_float("RETRY_MAX_DELAY", 120.0),
            pixeldrain_priority=_int("PIXELDRAIN_PRIORITY", 10),
            onefichier_priority=_int("ONEFICHIER_PRIORITY", 20),
            state_file=state if state.is_absolute() else ROOT / state,
        )
