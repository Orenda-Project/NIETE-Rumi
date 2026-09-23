"""bd-zrl25 (4) -- a split the SCHEMA cannot hold is not a split.

`key_points.items` caps at 6 in `schema/lp_doc.schema.json`, the live v9 file that the
renderer and the lint gate share. Over it, ajv refuses the whole document: no PDF at all.

Round 2 routed G3 English seg4 down the split path for the first time, and its narration
came out at EIGHT items -- so the one lesson in the trio that had always rendered stopped
rendering. Maths seg4 is at seven and is worse, because the QA gate skips that document
today ("No placeholders"), so nothing builds it and nothing complains.

The fix is the fail-safe the module already has everywhere else. A narration list that will
not fit is a split that cannot be expressed, so the hook falls back whole -- the same answer
`_CITED` and "no question found" already give. Truncating to 6 would silently delete two
authored lines, and merging the overflow would author a run-on sentence; this module routes
rather than authors, so it does neither.

These live apart from `test_d0_hook.py` only because that file is at 285 of the 300-line
limit. Same bead, same module.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d0_hook

# English seg4, verbatim. Eight narration items under round 2: the board setup, SEE, THINK,
# WONDER, the puzzle lead-in, the `-- but look` aside, `Is that a question...`, and the
# Punctuation Patrol line.
SEG4 = (
    "Look at the board: three columns, STATEMENT, QUESTION, EXCITEMENT, each with its own "
    "mark -- full stop, question mark, exclamation mark. SEE: write one thing you notice "
    "about the three marks. THINK: write one line on what job each mark does. WONDER: write "
    "one question you have about them. Here is today's puzzle: this page opens by asking "
    "'Did you notice my funny socks in the story?' -- but look, there's no punctuation mark "
    "at the end! Is that a question, a statement, or something else? Let's become "
    "Punctuation Patrol and find out."
)


SIX = " ".join("Item number %d here." % n for n in range(1, 7))


def items(hook, block_id):
    got = [b for b in d0_hook.hook_blocks(hook) if b.get("id") == block_id]
    return got[0]["items"] if got else []


def test_a_narration_list_the_schema_cannot_hold_falls_back_whole():
    assert d0_hook.hook_blocks(SEG4) == [
        {"type": "ask", "id": "hook", "hook": True, "question": SEG4}
    ]


def test_the_fallback_keeps_every_authored_word_of_it():
    printed = d0_hook.hook_blocks(SEG4)[0]["question"]
    assert "Punctuation Patrol" in printed and "funny socks" in printed


def test_a_narration_list_exactly_at_the_cap_still_splits():
    """Maths seg6 and seg7 sit on 6 today. The cap is inclusive or they break too."""
    hook = SIX + " Then ask: 'WHY does this happen?'"
    assert len(items(hook, "hook-setup")) == d0_hook.MAX_ITEMS == 6


def test_a_seventh_narration_item_tips_it_into_the_fallback():
    hook = SIX + " Item number 7 here. Then ask: 'WHY does this happen?'"
    assert items(hook, "hook-setup") == []
    assert d0_hook.hook_blocks(hook)[0]["hook"] is True


def test_the_read_aloud_list_is_held_to_the_same_cap():
    """`hook-say` is a `key_points` block too, so it takes the same refusal. Nothing in the
    corpus reaches it today -- the longest is 2 -- and it is guarded before something does.
    """
    tail = " ".join("Sentence %d here." % n for n in range(7))
    hook = "Set the scene. Then ask: 'WHY does this happen? %s'" % tail
    assert d0_hook.hook_blocks(hook)[0].get("hook") is True


def test_the_cap_matches_the_live_schema():
    """MAX_ITEMS is duplicated from JSON. This is what stops it drifting.

    Same pin as `test_d0_crux.py::test_the_id_vocabulary_matches_the_renderers_own_dc_phase_map`
    -- if the schema ever moves the cap, the module must move with it or it starts refusing
    splits that would have rendered, or emitting ones that will not.
    """
    import json
    path = os.path.join(
        os.environ.get("LP_V9") or os.path.expanduser(
            "~/rumi/Rumi 10 April 2026/NIETE-Rumi/bot/vendor/lp-v9"),
        "schema/lp_doc.schema.json")
    if not os.path.exists(path):
        return
    schema = json.load(open(path, encoding="utf-8"))
    caps = [b["properties"]["items"]["maxItems"]
            for b in schema["definitions"]["block"]["oneOf"]
            if b.get("properties", {}).get("type", {}).get("const") == "key_points"]
    assert caps, "key_points is gone from lp_doc.schema.json -- the seam moved"
    assert caps == [d0_hook.MAX_ITEMS]
