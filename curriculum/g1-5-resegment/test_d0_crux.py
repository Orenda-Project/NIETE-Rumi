"""bd-pcbed -- THE AUTHORED CRUX IS SEATED ON THE BLOCK, OR IT SAYS WHY NOT.

OPERATOR: *"the crux of what should be done should be highlighted in the move
since there is alot of script to go through"*.

The renderer already prints `block.crux` (lp-v9 lib/template.js, movePill) --
bd-3jemp. Nothing emitted it, so the feature was inert. This module is the one
seam that seats it, and it follows the contract the diagram slots and the video
row already set in `to_lp_doc`: additive, keyed, and a spec that cannot be
seated is DROPPED WHOLE and says why in `notes.gaps`.

WHY KEYED BY BLOCK ID AND NOT BY DC PHASE. The author thinks in moves, so a
phase key reads better -- but `you-do` and `you-do-task` are both the DC's
`independent`, and a phase key would stamp one crux onto both, printing the
same line twice in the same move. The block id is one-to-one with what prints.

WHY A TYPO IS A GAP AND NOT A CRASH. These files are hand-authored per lesson.
A silent drop means an operator reviews a sheet whose crux never appeared and
has no way to tell that from a block nobody wrote one for.
"""

import d0_crux


def _sections():
    """Two sections shaped like `to_lp_doc` builds them, ids the DC map knows."""
    return [
        {"id": "intro", "blocks": [{"type": "ask", "id": "hook", "question": "q"}]},
        {"id": "development", "blocks": [
            {"type": "big_idea", "id": "big-idea", "text": "t"},
            {"type": "worked_example", "id": "i-do", "steps": []},
        ]},
    ]


def _blocks(sections):
    return {b["id"]: b for s in sections for b in s["blocks"]}


def test_an_authored_line_lands_on_its_block():
    secs = _sections()
    gaps = d0_crux.apply_crux(secs, {"i-do": "Model 3,600 - 47 on the board, digit by digit."})
    assert _blocks(secs)["i-do"]["crux"] == "Model 3,600 - 47 on the board, digit by digit."
    assert gaps == []


def test_blocks_with_no_authored_line_are_untouched():
    """The renderer prints nothing without the key, so absence must stay absence."""
    secs = _sections()
    d0_crux.apply_crux(secs, {"i-do": "Model it."})
    assert "crux" not in _blocks(secs)["hook"]
    assert "crux" not in _blocks(secs)["big-idea"]


def test_no_crux_at_all_changes_nothing():
    """Every corpus lesson today. None must not mean a crash or an empty key."""
    secs = _sections()
    assert d0_crux.apply_crux(secs, None) == []
    assert all("crux" not in b for b in _blocks(secs).values())


def test_a_key_that_matches_no_block_is_dropped_and_reported():
    secs = _sections()
    gaps = d0_crux.apply_crux(secs, {"we-do": "Pairs try one."})
    assert all("crux" not in b for b in _blocks(secs).values())
    assert len(gaps) == 1 and "we-do" in gaps[0]


def test_a_line_past_the_schema_cap_is_dropped_and_reported():
    """The schema caps `crux` at 140. Seating a longer one renders a lint failure
    on a sheet that otherwise passed, so it is refused here where it can be read."""
    secs = _sections()
    gaps = d0_crux.apply_crux(secs, {"i-do": "x" * 141})
    assert "crux" not in _blocks(secs)["i-do"]
    assert len(gaps) == 1 and "i-do" in gaps[0]


def test_a_blank_line_is_not_seated():
    secs = _sections()
    d0_crux.apply_crux(secs, {"i-do": "   "})
    assert "crux" not in _blocks(secs)["i-do"]


def test_the_line_is_stripped():
    secs = _sections()
    d0_crux.apply_crux(secs, {"i-do": "  Model it.  "})
    assert _blocks(secs)["i-do"]["crux"] == "Model it."


def test_only_dc_mapped_ids_may_carry_one():
    """`hook-characters` is a cast list, not the hook move -- the renderer's
    `dcPhaseOf` matches exactly for this reason. A crux on a block the DC does
    not score is a line the teacher reads as scored when it is not."""
    secs = [{"id": "intro", "blocks": [
        {"type": "key_points", "id": "hook-characters", "items": ["a"]}]}]
    gaps = d0_crux.apply_crux(secs, {"hook-characters": "Read the cast."})
    assert "crux" not in secs[0]["blocks"][0]
    assert len(gaps) == 1 and "hook-characters" in gaps[0]


def test_the_id_vocabulary_matches_the_renderers_own_dc_phase_map():
    """DC_IDS is duplicated from JavaScript. This is what stops it drifting.

    If the renderer gains a phase (its LPs grow a `recall` or `peer_review`
    surface, both of which it deliberately leaves unmapped today) and this set
    does not, the builder silently refuses to seat a crux on a block that now
    prints a chip -- and nothing anywhere would say so.
    """
    import os
    import re
    tmpl = os.path.join(
        os.environ.get("LP_V9") or os.path.expanduser(
            "~/rumi/Rumi 10 April 2026/NIETE-Rumi/bot/vendor/lp-v9"),
        "lib/template.js")
    if not os.path.exists(tmpl):
        return
    src = open(tmpl, encoding="utf-8").read()
    body = re.search(r"const DC_PHASE = \{(.*?)\n\};", src, re.S)
    assert body, "DC_PHASE is gone from template.js -- the seam moved"
    keys = set(re.findall(r"^\s*([A-Za-z0-9_]+)\s*:", body.group(1), re.M))
    assert keys == d0_crux.DC_IDS


# ── bd-rd65e — THE OPENING IS ONE MOVE, NOT FOUR ────────────────────────────
#
# OPERATOR, three messages in a row:
#   *"engliush opening warmup has a strategy, how do the teacher do it when you
#    also have 3 questions added?"*
#   *"the opening makes no sense when you have added strategies for the sake of it"*
#   *"If I see the Opening, there is a strategy, then 3 questions then a hook and
#    then a open with this question, doesnt make sense what to do and what not to do"*
#
# The rendered Opening stacked FOUR labelled things in one three-minute slot:
# the warm-up's named strategy, its three retrieval questions, the hook's crux
# line, and the hook question itself. Two of those four are the SAME move --
# the crux `"See, Think, Wonder on the page 13 picture, written, before any
# reading."` sits directly above the question that says SEE / THINK / WONDER in
# full. It is also a SECOND named strategy inside an opening the operator has
# ruled carries one: *"it should be just 1 not multiple strategies since opening
# is a whole provocation on its own"*.
#
# WHY THE HOOK AND NOTHING ELSE. This module's own charter is that a crux is "a
# different, shorter instruction", never a summary of the script -- because the
# complaint it answers is that there is too much script. That holds for the
# blocks that carry multi-step scripts (i-do, we-do, you-do, hw). The hook is not
# one of them: an `ask` block is a single utterance, so a line above it can only
# restate it. The refusal is therefore about the SHAPE of the block, not about
# whether the Digital Coach scores it -- `hook` stays in DC_IDS and keeps its
# phase chip.


def _hook_only():
    return [{"id": "intro", "blocks": [{"type": "ask", "id": "hook", "question": "q"}]}]


def test_the_hook_takes_no_crux():
    secs = _hook_only()
    d0_crux.apply_crux(secs, {"hook": "See, Think, Wonder on the picture, written."})
    assert "crux" not in secs[0]["blocks"][0]


def test_the_refused_hook_crux_says_why():
    """Dropped whole and reported, like every other refusal here -- an author who
    wrote one must be able to tell that from a lesson nobody wrote one for."""
    gaps = d0_crux.apply_crux(_hook_only(), {"hook": "See, Think, Wonder."})
    assert len(gaps) == 1 and "hook" in gaps[0]


def test_the_scripted_moves_still_take_their_crux():
    """The seam guard. The hook is the ONE refusal; widening it would silently
    strip the line the operator asked for off the blocks that need it most."""
    secs = _sections()
    gaps = d0_crux.apply_crux(secs, {"i-do": "Model it.", "big-idea": "Name it."})
    assert _blocks(secs)["i-do"]["crux"] == "Model it."
    assert _blocks(secs)["big-idea"]["crux"] == "Name it."
    assert gaps == []


def test_the_hook_keeps_its_dc_phase():
    """It is refused for its SHAPE, not for being unscored. Dropping it out of
    DC_IDS would break the renderer-drift guard below and would be a lie about
    what the Digital Coach reads."""
    assert "hook" in d0_crux.DC_IDS
    assert d0_crux.NO_CRUX <= d0_crux.DC_IDS


# ── bd-xa8cf — "No talking" is not a move tag ───────────────────────────────
#
# OPERATOR: *"You cant add No talking in the We Do tag"*.
#
# The crux prints inside the move's tag cluster (lp-v9 `movePill`), immediately
# before `WE DO · class practises together`. A tag NAMES the move. A prohibition
# there makes the move itself read as forbidden -- the teacher sees "WE DO" and
# "No talking" set as one label and cannot tell which is the instruction.
#
# The rule is not lost: every crux that carried it opens `"Chalk Talk, silent."`
# and the block's own prompt says `"Nobody stands and nobody speaks."` -- the
# instruction text, which is where a classroom-management rule belongs. So the
# trailing prohibition is CUT, never the block and never the whole crux.

WEDO_CRUX = ("Chalk Talk, silent. They write, slide the copy one place, "
             "mark a partner's columns, slide it back. No talking, nobody stands.")


def _wedo(prompt="Whole class. Nobody stands and nobody speaks."):
    return [{"id": "activity", "blocks": [
        {"type": "faded_example", "id": "we-do", "prompt": prompt,
         "steps": ["one"]}]}]


def test_the_trailing_prohibition_is_cut_from_the_tag():
    secs = _wedo()
    d0_crux.apply_crux(secs, {"we-do": WEDO_CRUX})
    assert "talking" not in secs[0]["blocks"][0]["crux"].lower()


def test_what_the_teacher_does_survives_the_cut():
    """Rewrite, never empty -- the move keeps its crux and keeps `silent`, which
    says the same thing as what she DOES rather than as what is banned."""
    secs = _wedo()
    d0_crux.apply_crux(secs, {"we-do": WEDO_CRUX})
    assert secs[0]["blocks"][0]["crux"] == (
        "Chalk Talk, silent. They write, slide the copy one place, "
        "mark a partner's columns, slide it back.")


def test_a_crux_that_is_nothing_but_the_prohibition_is_left_alone():
    """Never empty. With nothing else in it the line is all the teacher has, and
    a blank crux renders a tag cluster with a gap in it."""
    secs = _wedo()
    d0_crux.apply_crux(secs, {"we-do": "No talking."})
    assert secs[0]["blocks"][0]["crux"] == "No talking."


def test_the_cut_is_reported_when_the_instruction_does_not_already_say_it():
    """Moved, not deleted. If the block's own instruction never states the rule
    the cut would lose it, so the gap names the block an author must fix."""
    gaps = d0_crux.apply_crux(_wedo(prompt="Whole class, one copy each."),
                              {"we-do": WEDO_CRUX})
    assert len(gaps) == 1 and "we-do" in gaps[0]


def test_no_gap_when_the_instruction_already_carries_the_rule():
    assert d0_crux.apply_crux(_wedo(), {"we-do": WEDO_CRUX}) == []


def test_an_ordinary_crux_is_not_touched():
    secs = _sections()
    d0_crux.apply_crux(secs, {"i-do": "Read p.14 aloud. Point at the apostrophe."})
    assert _blocks(secs)["i-do"]["crux"] == "Read p.14 aloud. Point at the apostrophe."
