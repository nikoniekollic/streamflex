import tempfile
import unittest
from pathlib import Path

from sfpipe.media import ProgressFile, parse_filename, quality_from_height, quality_from_name, quick_hash, slugify


class ParseTests(unittest.TestCase):
    def test_movie_year(self):
        p = parse_filename("Horizon.Ecarlate.2021.1080p.WEB.mkv")
        self.assertEqual((p.kind, p.title, p.year, p.slug), ("movie", "Horizon Ecarlate", 2021, "horizon-ecarlate"))

    def test_movie_parens(self):
        p = parse_filename("Les Ombres de Lyon (2019).mp4")
        self.assertEqual((p.title, p.year), ("Les Ombres de Lyon", 2019))

    def test_episode(self):
        p = parse_filename("Code.Neon.S01E02.720p.mkv")
        self.assertEqual((p.kind, p.title, p.season, p.episode), ("episode", "Code Neon", 1, 2))

    def test_episode_with_year(self):
        p = parse_filename("Polaris (2024) - S02E10 - Finale.mkv")
        self.assertEqual((p.kind, p.title, p.year, p.season, p.episode), ("episode", "Polaris", 2024, 2, 10))

    def test_no_year(self):
        p = parse_filename("Silence Radio 1080p.mkv")
        self.assertEqual((p.kind, p.title, p.year), ("movie", "Silence Radio", None))

    def test_quality(self):
        self.assertEqual(quality_from_name("x.2160p.mkv"), "2160p")
        self.assertEqual(quality_from_name("x.4K.HDR.mkv"), "2160p")
        self.assertIsNone(quality_from_name("x.mkv"))
        self.assertEqual(quality_from_height(1080), "1080p")
        self.assertEqual(quality_from_height(800), "720p")

    def test_slugify(self):
        self.assertEqual(slugify("L'Archipel — Été"), "l-archipel-ete")


class FileTests(unittest.TestCase):
    def test_quick_hash_and_progress(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "a.mkv"
            f.write_bytes(b"x" * 10_000_000)
            h1 = quick_hash(f)
            self.assertTrue(h1.startswith("qh1:"))
            f.write_bytes(b"x" * 10_000_001)
            self.assertNotEqual(h1, quick_hash(f))
            seen = []
            with ProgressFile(f, seen.append) as pf:
                while pf.read(1 << 20):
                    pass
            self.assertEqual(sum(seen), 10_000_001)


if __name__ == "__main__":
    unittest.main()
