import asyncio
import random
import unittest

from sfpipe.resilience import FatalError, RateLimiter, RetryableError, backoff_delay, parse_retry_after, with_retries


class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_then_success(self):
        calls, sleeps = [], []

        async def fn():
            calls.append(1)
            if len(calls) < 3:
                raise RetryableError("boom")
            return "ok"

        async def fake_sleep(d):
            sleeps.append(d)

        self.assertEqual(await with_retries(fn, label="t", attempts=5, base=1, cap=10, sleep=fake_sleep), "ok")
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(sleeps), 2)

    async def test_retry_after_honored_and_penalizes(self):
        sleeps = []
        lim = RateLimiter(rate=100)

        async def fn():
            if not sleeps:
                raise RetryableError("429", retry_after=42)
            return 1

        async def fake_sleep(d):
            sleeps.append(d)

        await with_retries(fn, label="t", attempts=3, base=1, cap=5, limiter=lim, sleep=fake_sleep)
        self.assertGreaterEqual(sleeps[0], 42)
        self.assertGreater(lim._blocked_until, 0)

    async def test_fatal_not_retried(self):
        calls = []

        async def fn():
            calls.append(1)
            raise FatalError("401")

        with self.assertRaises(FatalError):
            await with_retries(fn, label="t", attempts=5, base=0.01, cap=0.01)
        self.assertEqual(len(calls), 1)

    async def test_exhausted(self):
        async def fn():
            raise RetryableError("x")

        async def fake_sleep(_):
            pass

        with self.assertRaises(RetryableError):
            await with_retries(fn, label="t", attempts=3, base=1, cap=1, sleep=fake_sleep)

    async def test_rate_limiter_spacing(self):
        lim = RateLimiter.min_interval(0.05)
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        for _ in range(4):
            await lim.acquire()
        self.assertGreaterEqual(loop.time() - t0, 0.14)

    async def test_rate_limiter_concurrent(self):
        lim = RateLimiter(rate=20, burst=1)
        loop = asyncio.get_running_loop()
        stamps = []

        async def hit():
            await lim.acquire()
            stamps.append(loop.time())

        await asyncio.gather(*(hit() for _ in range(6)))
        stamps.sort()
        gaps = [b - a for a, b in zip(stamps, stamps[1:])]
        self.assertTrue(all(g >= 0.04 for g in gaps), gaps)

    def test_backoff_bounds(self):
        rng = random.Random(1)
        for a in range(10):
            d = backoff_delay(a, 2, 60, rng)
            self.assertGreaterEqual(d, 1)
            self.assertLessEqual(d, 60)

    def test_parse_retry_after(self):
        self.assertEqual(parse_retry_after("12"), 12)
        self.assertIsNone(parse_retry_after(None))
        self.assertIsNone(parse_retry_after("garbage"))


if __name__ == "__main__":
    unittest.main()
