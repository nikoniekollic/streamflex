import unittest

from sfpipe.links import LinkError, parse_link


class LinkTests(unittest.TestCase):
    def test_pixeldrain(self):
        self.assertEqual(parse_link("https://pixeldrain.com/u/AbCd1234"), ("pixeldrain", "AbCd1234"))
        self.assertEqual(parse_link("pixeldrain.com/api/file/AbCd1234"), ("pixeldrain", "AbCd1234"))
        self.assertEqual(parse_link("https://pixeldrain.com/api/file/AbCd1234/info"), ("pixeldrain", "AbCd1234"))
        with self.assertRaises(LinkError):
            parse_link("https://pixeldrain.com/l/List1234")

    def test_onefichier(self):
        self.assertEqual(parse_link("https://1fichier.com/?x7k2m9p4q1w8e3r5t6y0"), ("onefichier", "x7k2m9p4q1w8e3r5t6y0"))
        self.assertEqual(parse_link("https://1fichier.com/?x7k2m9p4q1&af=3601689"), ("onefichier", "x7k2m9p4q1"))
        self.assertEqual(parse_link("http://www.alterupload.com/?abcd1234"), ("onefichier", "abcd1234"))
        self.assertEqual(parse_link("https://ab12cd34.1fichier.com/"), ("onefichier", "ab12cd34"))

    def test_rejects(self):
        for bad in ("", "https://example.com/x", "https://1fichier.com/", "https://1fichier.com/?a=b", "https://pixeldrain.com/u/ab",
                    "https://evil-1fichier.com/?abcd1234"):
            with self.assertRaises(LinkError, msg=bad):
                parse_link(bad)


if __name__ == "__main__":
    unittest.main()
