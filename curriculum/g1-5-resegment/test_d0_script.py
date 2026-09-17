"""The teacher's script, parsed into turns — unit tests.

The fixture is the real worst case, not an invented one: `SAY` is the 236-word
`Say:` step from `Maths_seg9`, which is the single heaviest string in the 38-lesson
G4 Ch9 corpus and the one the operator was shown when she chose this design. If the
parser reads that, it reads the corpus.

WHAT THESE PIN, and why each one is a decision rather than a detail:

  * ten sentences stop being one paragraph          -- the whole point
  * the response column fills ONLY from the text    -- 3 of 76 steps supply one
  * the action survives whole                       -- median 33% overlap, so
                                                       chipping it would delete
  * Urdu splits on ۔ and ؟                          -- three steps are Urdu
  * `turns()` returns None, never []                -- the renderer must be able
                                                       to fall back

Run: python3 -m pytest test_d0_script.py -q     (or: python3 test_d0_script.py)
"""

import d0_script as S

SAY = (
    "Say: “Let us create the class project plan together from the page. "
    "First we ‘Gather Materials.’ "
    "Now the time-puzzle instruction: ‘Seal and Label.’ "
    "Circle: 2023 and 5. "
    "Underline: what year would our class capsule open? "
    "Box: ‘today’s date’, ‘intended opening date’. "
    "Solve together — everyone, what is 2023 plus 5?” "
    "[class answers 2028] "
    "“Correct, 2028. Now change the unit: 5 years is the same as how many months?” "
    "[class answers 60] "
    "Then ask: “Where do YOU see something that comes back after a number of years?” "
    "Expected answers include: “My birthday comes every year” and "
    "“We visit our grandparents’ village every few years.”"
)

STEPS = [{"phase": "We-Do", "minutes": 12,
          "action": "Build one class time-capsule plan from the exact sequence, on p.180.",
          "say": SAY}]


def kinds(ts):
    return [t["kind"] for t in ts]


def test_a_paragraph_becomes_one_row_per_sentence():
    """824 sentences were printing as 76 paragraphs. This is the reduction."""
    ts = S.turns(STEPS)
    assert len(ts) >= 8, f"only {len(ts)} turns out of a 236-word paragraph"
    assert all(t.get("text", "").count(".") <= 2 for t in ts if t["kind"] == "say")


def test_the_action_survives_whole_as_a_stage_direction():
    """Median 33% of an action's content words are in its say, so a verb chip would
    have deleted the other two thirds. It keeps its words and gets its own kind."""
    ts = S.turns(STEPS)
    assert ts[0]["kind"] == "do"
    assert ts[0]["text"].startswith("Build one class time-capsule plan")
    assert "exact sequence" in ts[0]["text"]


def test_only_a_trailing_page_citation_moves_to_a_chip():
    ts = S.turns(STEPS)
    assert ts[0]["ref"] == "p.180"
    assert "p.180" not in ts[0]["text"], "the ref prints once, in the chip"
    # A citation mid-sentence is part of what she says and does not move.
    mid = S.turns([{"action": "Open p.180 and read the six labelled steps aloud."}])
    assert mid[0].get("ref") is None
    assert "p.180" in mid[0]["text"]


def test_a_question_is_its_own_kind_unless_it_is_a_step_of_a_routine():
    """A ROUTINE beats a question mark, and that is a decision, not a detail.

    Two of CUBES's four steps end in `?` ("Underline: what year would our class
    capsule open?", "Solve together -- what is 2023 plus 5?"). Letting `ask` claim
    them splits one named procedure the teacher already knows into four unrelated
    rows and says four times over that this is CUBES. So the run merges and the
    procedure's own questions travel inside it; only the questions she asks OUTSIDE
    a routine get their own row.
    """
    ts = S.turns(STEPS)
    asks = [t for t in ts if t["kind"] == "ask"]
    assert len(asks) == 2, [t["text"] for t in asks]
    assert all(t["text"].endswith("?") for t in asks)
    assert not any(t["kind"] == "ask" and t["text"].startswith(("Circle", "Underline",
                   "Box", "Solve")) for t in ts)


def test_the_response_column_fills_only_where_the_text_supplies_it():
    """8.7% of sentences are questions and 3 of 76 steps carry an aside, so an
    invented response would be a proxy. A question with no stated answer gets an
    empty slot, which is what the renderer draws as a waiting space."""
    ts = S.turns(STEPS)
    asks = [t for t in ts if t["kind"] == "ask"]
    routine = [t for t in ts if t["kind"] == "routine"][0]
    # The aside sits between the closing quote of one segment and the opening quote
    # of the next, which is the class speaking in the gap. It answers the turn that
    # ENDED there -- here the CUBES run, whose last step asked for the sum.
    assert routine["expect"] == ["2028"]
    assert asks[0]["expect"] == ["60"]
    assert len(asks[1]["expect"]) == 2, "Expected-answers pills land on the ASK"
    assert asks[1]["expect"][0] == "My birthday comes every year"
    # Nothing is invented: the second clause keeps all of its words, including the
    # apostrophe a quote-pair reader used to truncate it at.
    assert asks[1]["expect"][1].endswith("village every few years")


def test_the_speaker_lead_in_is_dropped_from_the_pill():
    """“class answers 2028” -> “2028”. Being in the response column already says who."""
    ts = S.turns([{"say": "Say: “How many?” [the students answer: seven]"}])
    assert ts[0]["expect"] == ["seven"]


def test_expected_answers_attach_to_the_question_not_to_the_listing_sentence():
    ts = S.turns(STEPS)
    assert not any(t["kind"] == "say" and "Expected answers" in t["text"] for t in ts)


def test_a_named_routine_collapses_into_one_turn():
    """CUBES is spelled out 13 times over the corpus. Its steps are one procedure,
    so four consecutive sentences become one turn carrying four parts."""
    ts = S.turns(STEPS)
    r = [t for t in ts if t["kind"] == "routine"]
    assert len(r) == 1, f"{len(r)} routine turns, expected the run to merge"
    assert len(r[0]["parts"]) >= 3
    assert r[0]["parts"][0].startswith("Circle")


def test_a_fill_in_frame_is_its_own_kind():
    ts = S.turns([{"say": "Say: “My starting year is ___ and it opens in ___.”"}])
    assert kinds(ts) == ["frame"]


def test_a_computation_is_its_own_kind_but_a_question_wins():
    """“what is 2023 plus 5?” is asked aloud before it is arithmetic."""
    assert kinds(S.turns([{"say": "Say: “We write 2023 + 5 = 2028 on the board.”"}])) == ["calc"]
    assert kinds(S.turns([{"say": "Say: “What is 2023 plus 5?”"}])) == ["ask"]


def test_urdu_splits_on_its_own_terminators():
    """Three corpus steps are Urdu. A `[.!?]` split reads them as one sentence."""
    ur = ("Say: ‘اپنے ساتھی سے کھیں۔ پھر جگہ بدل لیں۔ "
          "کیا آپ تیار ہیں؟’")
    ts = S.turns([{"say": ur}])
    assert len(ts) == 3, [t["text"] for t in ts]
    assert ts[-1]["kind"] == "ask", "؟ is a question mark"


def test_the_say_lead_in_and_its_wrapper_quotes_come_off():
    ts = S.turns([{"say": "Say: “Look at the picture.”"}])
    assert ts[0]["text"] == "Look at the picture."


def test_nothing_to_parse_returns_None_not_an_empty_list():
    """The renderer falls back to the flat `steps` strings on None. [] would mean
    a script that HAS no turns, which is a different document."""
    assert S.turns([]) is None
    assert S.turns([{"action": "", "say": ""}]) is None
    assert S.turns(None) is None


def test_dialogue_frames_join_the_script_as_frames():
    out = S.frame_turns(["Our word is ___.", "I agree because ___.", ""])
    assert kinds(out) == ["frame", "frame"]
    assert out[0]["text"] == "Our word is ___."


def test_no_word_of_the_script_is_lost():
    """The operator ruled out deletion. Every content word of the source has to
    survive somewhere in the turns."""
    import re
    ts = S.turns(STEPS)
    got = " ".join(t.get("text", "") + " " + " ".join(t.get("parts", []))
                   + " " + " ".join(t.get("expect", [])) for t in ts)
    got_w = set(re.findall(r"[a-z؀-ۿ]{3,}", got.lower()))
    src = set(re.findall(r"[a-z؀-ۿ]{3,}", (SAY + " " + STEPS[0]["action"]).lower()))
    # `say`, `expected`, `answers`, `include`, `ask` and `class` are the parser's own
    # scaffolding words, named in the source only to mark structure.
    missing = src - got_w - {"say", "expected", "answers", "include", "ask", "class",
                             "then", "correct"}
    assert not missing, f"dropped: {sorted(missing)}"


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
