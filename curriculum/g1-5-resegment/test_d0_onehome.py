"""ONE HOME PER SOURCE FIELD — the invariant, on its own.

This is the regression that cost 34% of every page: the SLO sentence printed four
times, the key fact four times, the exit ticket three, because page2 copied the
teach pages instead of taking content from them. The render is paper, and a second
copy of a sentence spends a page's worth of it to say one thing.

It lives in its own file because the detector has to model what the RENDERER
prints, not what the JSON holds, and that model is now three rules deep (see
`_printed`). Folded into test_d0_primary it read as a helper; it is the rule.
"""

import d0_primary as d0
from test_d0_primary import ENR, PT, TOPIC, build

PRINTED = ("objectives", "slo", "sections", "page2")
# `one_screen` is the WhatsApp message body ("The PDF is the attachment", schema)
# and `notes` is the author-side record. Neither is printed, so neither spends
# paper -- the one-home rule is about the page, not about the JSON.


# The additive-field pattern (SYNC §3.16, §3.17) stores two forms of one field: a
# structured one the renderer prefers and a flat string the lint profile, Stage E's
# voicenotes and the WhatsApp body still address. Stored twice, PRINTED once -- so
# the detector has to make the renderer's choice or it reports a page fault that
# does not exist. `board.text` slipped past this for free only because its panel
# rows fall under the four-word floor; `turns` does not, and neither is a rule.
FALLBACK = {"turns": "steps", "panels": "text"}


def _printed(d):
    """One dict, reduced to the keys that actually reach paper."""
    return {k: v for k, v in d.items()
            if k not in {FALLBACK[p] for p in FALLBACK if p in d}}


def _strings(doc, min_words=4):
    """Every PRINTED string in the doc, normalised, long enough to matter."""
    import re

    def walk(o, skip=("type", "id", "mode", "kind", "label", "ref")):
        if isinstance(o, str):
            yield o
        elif isinstance(o, dict):
            for k, v in _printed(o).items():
                if k not in skip:
                    yield from walk(v)
        elif isinstance(o, list):
            for v in o:
                yield from walk(v)

    out = []
    for x in walk({k: doc[k] for k in PRINTED if k in doc}):
        n = re.sub(r"[^a-z0-9 ]", "", re.sub(r"\s+", " ", x.lower())).strip()
        if len(n.split()) >= min_words:
            out.append(n)
    return out


def _repeats(doc, min_words=4):
    """Strings printed more than once, INCLUDING one quoted inside another.

    Whole-string equality is not enough. `hookCharacters[].speechBubble` is quoted
    inside `hookStory` in 16 of the corpus's 39 character lines, so an equality
    check passed while the render printed the same sentence twice.
    """
    import collections

    got = _strings(doc, min_words)
    dupes = collections.Counter(got)
    dupes = {t: c for t, c in dupes.items() if c > 1}
    for a in set(got):
        for b in set(got):
            if a is not b and a != b and a in b:
                dupes.setdefault(a, 2)
    return dupes


def test_no_source_field_is_printed_twice():
    """ONE HOME PER SOURCE FIELD — the regression that cost 34% of every page.

    The SLO sentence printed 4x, the key fact 4x, the exit ticket 3x, the support
    strategy 3x, because page2 copied the teach pages instead of taking content
    from them. Paper is the budget; a second copy spends it for nothing.

    There is NO allowance. An earlier version of this test permitted the SLO
    statement to print twice, on the grounds that v9 has three required text slots
    in Section O and primary supplies two strings. Rendered, that excuse was two
    copies of one sentence stacked inside a single box. The third slot goes dark
    instead (see d0_primary._objectives).
    """
    dupes = _repeats(build())
    import re
    pending = re.sub(r"[^a-z0-9 ]", "", d0.B.DESIGN_PENDING.lower()).strip()
    dupes.pop(pending, None)   # a gap may be declared in several places
    assert not dupes, "printed more than once: " + "; ".join(
        f"{c}x {t[:60]}" for t, c in dupes.items())


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:
                fails += 1
                print(f"  FAIL {name}: {type(e).__name__}: {e}")
    print("FAILED" if fails else "all passed")
    raise SystemExit(1 if fails else 0)
