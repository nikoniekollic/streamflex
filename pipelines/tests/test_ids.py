import re
import sys
import types
import unittest

# catalog.py importe supabase/postgrest : stubs minimaux pour tester les helpers purs
for name in ("supabase", "postgrest", "postgrest.exceptions"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["supabase"].AsyncClient = object
sys.modules["supabase"].acreate_client = None
sys.modules["postgrest.exceptions"].APIError = type("APIError", (Exception,), {})

from sfpipe.catalog import db_checksum, file_id_from  # noqa: E402


class IdTests(unittest.TestCase):
    def test_checksum_bytea(self):
        h = "a" * 64
        self.assertEqual(db_checksum(f"qh1:{h}"), "\\x" + h)
        with self.assertRaises(ValueError):
            db_checksum("qh1:abc")

    def test_file_id(self):
        self.assertEqual(file_id_from("pixeldrain", "AbCd1234"), "AbCd1234")
        self.assertEqual(file_id_from("onefichier", "x7k2m9p4q1w8e3r5t6y0"), "x7k2m9p4q1w8e3r5t6y0")
        for bad in ("", "abc", "https://1fichier.com/?x7k2", "a" * 33, "id with space"):
            with self.assertRaises(ValueError):
                file_id_from("onefichier", bad)
        self.assertTrue(re.fullmatch(r"[A-Za-z0-9_-]{4,32}", "x7k2m9p4q1w8e3r5t6y0"))


if __name__ == "__main__":
    unittest.main()
