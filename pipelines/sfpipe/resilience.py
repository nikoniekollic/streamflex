"""Rate limiting (token bucket + pénalité globale) et retries à backoff exponentiel avec jitter."""
from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")
log = logging.getLogger("sfpipe.retry")


class RetryableError(Exception):
    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class FatalError(Exception):
    """Erreur non récupérable (auth, fichier refusé…) : pas de retry."""


class RateLimiter:
    """Token bucket async. `rate` jetons par `per` secondes, capacité `burst`.
    `penalize(s)` gèle le bucket pour tous les workers (ex. 429 / Retry-After)."""

    def __init__(self, rate: float, per: float = 1.0, burst: int = 1, clock: Callable[[], float] = time.monotonic) -> None:
        if rate <= 0 or per <= 0:
            raise ValueError("rate et per doivent être > 0")
        self._interval = per / rate
        self._burst = max(1, burst)
        self._tokens = float(self._burst)
        self._clock = clock
        self._last = clock()
        self._blocked_until = 0.0
        self._lock = asyncio.Lock()

    @classmethod
    def min_interval(cls, seconds: float) -> "RateLimiter":
        return cls(rate=1, per=seconds, burst=1)

    def penalize(self, seconds: float) -> None:
        self._blocked_until = max(self._blocked_until, self._clock() + seconds)

    def _refill(self, now: float) -> None:
        self._tokens = min(self._burst, self._tokens + (now - self._last) / self._interval)
        self._last = now

    def _wait_time(self) -> float:
        now = self._clock()
        if now < self._blocked_until:
            return self._blocked_until - now
        self._refill(now)
        if self._tokens >= 1:
            self._tokens -= 1
            return 0.0
        return (1 - self._tokens) * self._interval

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                wait = self._wait_time()
                if wait <= 0:
                    return
                await asyncio.sleep(wait)

    async def __aenter__(self) -> "RateLimiter":
        await self.acquire()
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


def backoff_delay(attempt: int, base: float, cap: float, rng: random.Random | None = None) -> float:
    """Full jitter : U(0, min(cap, base·2^attempt)), minimum base/2."""
    r = rng or random
    ceiling = min(cap, base * (2**attempt))
    return max(base / 2, r.uniform(0, ceiling))


def parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        from email.utils import parsedate_to_datetime

        try:
            return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
        except (TypeError, ValueError):
            return None


async def with_retries(
    fn: Callable[[], Awaitable[T]],
    *,
    label: str,
    attempts: int,
    base: float,
    cap: float,
    retry_on: tuple[type[BaseException], ...] = (RetryableError,),
    limiter: RateLimiter | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    last: BaseException | None = None
    for attempt in range(attempts):
        try:
            return await fn()
        except FatalError:
            raise
        except retry_on as e:  # type: ignore[misc]
            last = e
            if attempt == attempts - 1:
                break
            hint = getattr(e, "retry_after", None)
            delay = max(hint, backoff_delay(attempt, base, cap)) if hint else backoff_delay(attempt, base, cap)
            if hint and limiter:
                limiter.penalize(hint)
            log.warning("%s: tentative %d/%d échouée (%s) → retry dans %.1fs", label, attempt + 1, attempts, e, delay)
            await sleep(delay)
    raise RetryableError(f"{label}: échec après {attempts} tentatives: {last}") from last
