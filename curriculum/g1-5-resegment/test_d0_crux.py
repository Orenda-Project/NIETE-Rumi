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
