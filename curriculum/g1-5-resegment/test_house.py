"""The §5 numbers live in exactly one place, and every formatter reads them.

Six formatters paint a title band — `sheetio.format_grid` for the header-plus-
rows tabs, and bespoke passes in `calfmt` (twice), `covfmt`, `skillfmt`,
`reviewtab` and `navtab`, because those tabs merge, freeze or band in ways the
generic grid cannot. Each carried its own copy of the size, and the copies had
already diverged: three tabs shipped a 13pt title, three a 14pt one, and §5.1
asks for 16. Nothing failed, because nothing compared them.

So the scan below is the test that matters. Pinning `house.TITLE_PT == 16` only
pins the constant; what went wrong is that a formatter hardcoded a number
beside it. A new tab added next month gets caught here.
"""
import glob
import os
import re
import unittest

import house

HERE = os.path.dirname(os.path.abspath(__file__))

# Every module that paints a title band, and must therefore read `house`.
PAINTERS = ("sheetio.py", "calfmt.py", "calfde.py", "covfmt.py",
            "skillfmt.py", "reviewtab.py", "navtab.py")


def source(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as fh:
        return fh.read()


class TheSpecNumbers(unittest.TestCase):
    """§5.1-5.2, quoted so a reader can check them against the skill."""

    def test_title_is_16pt_over_42px(self):
        self.assertEqual((house.TITLE_PT, house.TITLE_PX), (16, 42))

    def test_subtitle_is_11pt(self):
        self.assertEqual(house.SUB_PT, 11)

    def test_headers_are_10pt_bold(self):
        self.assertEqual(house.HEAD_PT, 10)

    def test_data_is_arial_9_per_section_5_2(self):
        # Held at 10 for a while because a laptop reader had asked for an
        # easier read. Amena took the call on 2026-09-18: go to 9. It is the
        # spec value, so this is now a plain conformance test with no note to
        # keep in step — which is the state a deviation should end in.
        self.assertEqual(house.DATA_PT, 9)


class NoFormatterKeepsItsOwnCopy(unittest.TestCase):
    """The scan. A hardcoded title-sized font in a painter is the defect."""

    # 13 and 14 are what the six copies had drifted to; 16 hardcoded is the
    # same mistake even when it happens to be right today.
    STRAY = re.compile(r'"fontSize":\s*(1[3-9]|2\d)|fontSize=(1[3-9]|2\d)')

    def test_no_painter_hardcodes_a_title_sized_font(self):
        for name in PAINTERS:
            for i, line in enumerate(source(name).splitlines(), 1):
                hit = self.STRAY.search(line)
                self.assertIsNone(
                    hit, f"{name}:{i} hardcodes a title-sized font "
                         f"({hit.group(0) if hit else ''}) — read house "
                         f"instead: {line.strip()[:70]}")

    def test_every_painter_imports_house(self):
        for name in PAINTERS:
            self.assertRegex(source(name), r"(?m)^import house$",
                             f"{name} paints a title band without house")

    def test_the_painter_list_is_not_stale(self):
        # A module that paints ink["title"] but is absent from PAINTERS would
        # slip the scan entirely, so the list is checked against the tree.
        found = {os.path.basename(p) for p in glob.glob(os.path.join(HERE, "*.py"))
                 if not os.path.basename(p).startswith("test_")
                 and re.search(r'ink\["title"\]|INK\["title"\]', source(
                     os.path.basename(p)))}
        self.assertEqual(found, set(PAINTERS))


class HouseStaysPure(unittest.TestCase):
    """It is imported by five modules that must not reach a vendor SDK."""

    def test_house_imports_nothing(self):
        body = [l for l in source("house.py").splitlines()
                if re.match(r"^\s*(import|from)\s", l)]
        self.assertEqual(body, [])


if __name__ == "__main__":
    unittest.main()
