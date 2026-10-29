"""bd-suk84 — the abbreviation guard in `d0_lines._sentences`, pinned.

`_ends_in_abbreviation` stops a sentence cut landing on an abbreviation's own
period (`p. 104`, `Mrs. Khan`, `e.g. a ruler`). The judge's mutation run left two
of its parts unprotected:

  M11  dropping `"p"` from `_ABBREV` SURVIVED -- `p.` is 124 of the guard's 156
       corpus suppressions, the single biggest claim in the bead, and no test
       covered it.
  M10  the `_CLOSERS` strip loop SURVIVED. It is NOT dead weight: over the built
       corpus plus the source enrichment it flips the verdict at four real
       positions (`... object etc.’`, `Expected answer: "No."`), which is exactly
       where a test was missing.

It also over-fires. Census of the 335 built lessons (method: a cut `_SENT` offers
at a whitespace boundary, with a tail of at least MIN_SENTENCE_WORDS, that ONLY
the abbreviation guard refuses) -- 156 suppressions: `p.` 124, `No.` 11, `pp.` 11,
`e.g.` 7, `Mr.` 1, `i.e.` 1, `etc.` 1. Eleven of those are real sentence ends the
guard swallows, and every one is `No.` or `etc.` used as an ordinary WORD:

    'Does a circle have any straight sides? No. | So we write 0 sides and 0 corners.'
    "...like a robot, cartoon character, an everyday object etc. | First we predict."

So `No.` and `etc.` -- and only those two -- yield to a capitalised next word.
A title must NOT: `Dear Mr. Ahmed` is the case the unconditional guard exists for.
Nor may `e.g.`/`i.e.`, whose whole job is to be followed by the example
(`E.g. Bat, cat, hat.`), nor `p.`/`pp.`, where a capital can be a roman-numeral
page (`p. XII`).

Run: /usr/bin/python3 -W ignore -m pytest test_d0_abbrev.py -q
"""

import re

import d0_lines as L


def words(s):
    return [w for w in re.split(r"\s+", (s or "").strip()) if w]


def _rows(src):
    return L.split_line(src)


# ── M11: `p` must stay in _ABBREV ─────────────────────────────────────────────

P_LINE = ("Open the textbook at p. 104 and copy the whole four-column reference "
          "table into your notebook, then read the caption underneath it aloud "
          "to your partner before you start the first question.")


def test_a_page_citation_is_never_cut_at_its_own_period():
    """Drop `\"p\"` from `_ABBREV` and this line splits into `... at p.` and
    `104 and copy ...` -- a row ending on a bare `p.` and a row opening on a
    page number."""
    out = _rows(P_LINE)
    assert any("p. 104" in r for r in out), out
    assert not any(r.rstrip().endswith("p.") for r in out), out
    assert not any(words(r) and words(r)[0].isdigit() for r in out), out


def test_the_p_guard_is_the_thing_doing_it():
    """Red-before-green in one assertion: with `p` taken out of the set, the
    same line DOES break at the citation."""
    kept = set(L._ABBREV)
    try:
        L._ABBREV.discard("p")
        assert any(r.rstrip().endswith("p.") for r in _rows(P_LINE)), _rows(P_LINE)
    finally:
        L._ABBREV.clear()
        L._ABBREV.update(kept)
    assert not any(r.rstrip().endswith("p.") for r in _rows(P_LINE)), "guard not restored"


# ── M10: the closing quote must not hide the abbreviation ─────────────────────

ETC_LOWER = ("Ask the children to imagine any character they like -- a robot, a "
             "cartoon character, an everyday object etc.” and then let them "
             "whisper the idea to a partner before anybody writes a single word "
             "down on the slate in front of them.")


def test_a_closing_quote_does_not_hide_the_abbreviation():
    """`etc.”` ends in a quote, not a period. Without the `_CLOSERS` strip
    the guard never sees `etc` and the row breaks after the quote."""
    out = _rows(ETC_LOWER)
    assert all(not r.rstrip().endswith("etc.”") for r in out), out


# ── the over-fire: `No.` and `etc.` as ordinary words ─────────────────────────

NO_LINE = ("Point at the shape on the board and ask the whole class together: "
           "does a circle have any straight sides? No. So we write 0 sides and "
           "0 corners in the two boxes underneath the drawing.")

ETC_CAP = ("Let them imagine any character at all, a robot, a cartoon character, "
           "an everyday object etc. First we predict what that character would "
           "say to the class before we write anything down in the notebook.")


def test_no_yields_to_a_capitalised_sentence():
    out = _rows(NO_LINE)
    assert len(out) > 1, out
    assert any(r.rstrip().endswith("No.") for r in out), out
    assert any(r.startswith("So we write") for r in out), out


def test_etc_yields_to_a_capitalised_sentence():
    out = _rows(ETC_CAP)
    assert len(out) > 1, out
    assert any(r.startswith("First we predict") for r in out), out


def test_no_still_holds_in_front_of_a_lowercase_continuation():
    src = ("The teacher asks whether the answer is no. and then waits for the "
           "class to think about it quietly for a moment before anybody puts a "
           "single hand up in the air at all.")
    assert _rows(src) == [src], _rows(src)


# ── the abbreviations that must NEVER yield ───────────────────────────────────

def test_a_title_never_yields_to_a_capitalised_name():
    src = ("Copy this opening onto the board: Dear Mr. Ahmed, thank you very "
           "much for keeping our school clean every single day of the week, "
           "and please tell us how we can help you with it.")
    assert not any(r.rstrip().endswith("Mr.") for r in _rows(src)), _rows(src)


def test_eg_never_yields_to_a_capitalised_example():
    src = ("Remind the class that rhyming words are those words which sound the "
           "same right at the end of them. E.g. Bat, cat, hat, and then ask "
           "them for one more of their own.")
    assert not any(r.rstrip().endswith("E.g.") for r in _rows(src)), _rows(src)


def test_a_page_citation_never_yields_to_a_roman_numeral():
    src = ("Turn back to the contents list on p. XII and read the chapter names "
           "out loud together, then find the page number for the chapter we are "
           "going to start reading later on today.")
    assert not any(r.rstrip().endswith("p.") for r in _rows(src)), _rows(src)


def test_only_no_and_etc_carry_the_terminal_sense():
    assert L._TERMINAL_SENSE == {"no", "etc"}
    assert L._TERMINAL_SENSE <= L._ABBREV


def test_the_guard_only_knows_the_abbreviations_in_the_set():
    """`fig.` is in `_ABBREV` and holds in front of a capital; `q.` is not in it
    and must not be guarded just because it is abbreviation-SHAPED."""
    assert L._ends_in_abbreviation("look at fig.", " Two")
    assert not L._ends_in_abbreviation("look at q.", " Two")
    assert not L._ends_in_abbreviation("look at the table", " Two")


def test_a_quoted_sentence_start_still_counts_as_a_sentence_start():
    """`_OPENERS`. A sentence may open inside a quote, and the capital is then
    one character in rather than zero: `No. “Yes,” she said.` The guard must
    still stand down.

    DEFENSIVE, and said so plainly: unlike the `_CLOSERS` strip (4 real corpus
    positions) this strip changes the verdict at ZERO positions in the current
    corpus. The nearest real one is `... do those end sounds match? No. 'sweet'
    and 'side'?`, where the quoted word is lowercase and both arms agree. It is
    kept because dropping it fails in the same direction as the bug bd-suk84
    exists to fix -- the guard over-firing on a real sentence end -- and quoted
    material demonstrably occurs here (`Expected answer: "No."`).
    """
    assert L._opens_a_sentence("“Yes,” she said.") is True
    assert L._opens_a_sentence("'Sweet' rhymes with 'street'.") is True
    assert L._opens_a_sentence("(Yes, every time.)") is True
    # and the strip must not manufacture a capital that is not there
    assert L._opens_a_sentence("“yes,” she said.") is False


def test_a_one_argument_call_is_the_unconditional_guard():
    """No tail means no evidence that anything ended, so `_TERMINAL_SENSE` has
    nothing to stand down for and the guard must hold. This is also the contract
    the default argument promises every existing one-argument caller."""
    assert L._ends_in_abbreviation("... any straight sides? No.") is True
    assert L._ends_in_abbreviation("... any straight sides? No.", "") is True
    assert L._ends_in_abbreviation("... an everyday object etc.", "   ") is True


def test_every_known_abbreviation_is_one_the_token_pattern_can_see():
    """`_ABBREV` and `_ABBREV_TOKEN` have to agree or a member is silently dead.

    This also settles mutant M13 (`{1,4}` -> `{1,3}`) as EQUIVALENT rather than
    survived: no member of `_ABBREV` has a part longer than three characters, so
    both bounds accept exactly the same tokens. The 4 is headroom for a
    `Prof.`-shaped addition, and this test is what would fail if one were added
    without widening the pattern.
    """
    for abbrev in L._ABBREV:
        m = L._ABBREV_TOKEN.search("text " + abbrev + ".")
        assert m is not None, abbrev
        assert m.group(1).lower() == abbrev, (abbrev, m.group(1))
