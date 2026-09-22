"""Stage D0 — the video join. Unit tests.

Run: python3 -m pytest test_d0_media.py -q     (or: python3 test_d0_media.py)

bd-v2ikv. The renderer has read `sections[development].video` since v9.3 and nothing has ever
written it, so every primary lesson rendered the pending marker instead -- including the ones
whose SLO *is* mapped. These tests pin the seat, the two link shapes the map actually carries,
and the additive guarantee that a day with no mapping renders exactly as it does today.
"""

import copy
import json

import d0_media as M
import d0_primary as d0
from test_d0_primary import ENR, PT

# The real row for GRADE_3_MATH_CH2_SEG5 (SLO M-03-AS-02), from `Videos <-> SLOs`.
LIB = {"title": "Addition and Subtraction", "source": "Taleemabad library",
       "link": "Grade3MathsAdditionAndSubtractionAdditionAndSubtraction",
       "confidence": "high",
       "why": "Video's borrowing procedure for subtraction matches this day's SLO exactly."}

# The other shape: 617 of 1,461 mapped rows carry a real url instead of a library key.
YT = {"title": "Tricky Words and Sight Words Song", "source": "Epic Phonics",
      "link": "https://www.youtube.com/watch?v=TvMyssfAUx0", "confidence": "medium",
      "why": "Children chant and read common irregular sight words aloud."}


def build(media=None):
    enr = copy.deepcopy(ENR)
    return d0.to_lp_doc(enr, PT, day=1, total_days=10, media=media)


def _dev(doc):
    return [s for s in doc["sections"] if s["id"] == "development"][0]


# ── additive: an unmapped day is the document we already ship ─────────────────

def test_a_day_with_no_media_is_byte_identical_to_today():
    """71% of production days have no mapping. This is the test that says they render
    exactly as they did -- not 'about the same', identical."""
    assert json.dumps(build(), sort_keys=True) == json.dumps(
        d0.to_lp_doc(copy.deepcopy(ENR), PT, day=1, total_days=10), sort_keys=True)


def test_an_unmapped_day_carries_no_video_key_at_all():
    """Not `video: None`, absent. The renderer's videoRow() tests the key's truthiness and
    an unmapped day must take the branch that prints NOTHING (operator: pending is not
    relevant for Primary), so a falsy-but-present key is the same defect in a new costume."""
    assert "video" not in _dev(build())
    assert "video" not in _dev(build({}))


# ── the seat ──────────────────────────────────────────────────────────────────

def test_the_video_lands_on_development_because_that_is_where_the_renderer_reads():
    doc = build(LIB)
    assert "video" in _dev(doc)
    assert not [s for s in doc["sections"] if s["id"] != "development" and "video" in s]


# ── the two link shapes the map actually carries ──────────────────────────────

def test_a_library_key_resolves_to_the_r2_mp4_the_catalogue_links():
    """844 of 1,461 rows carry a bare key. The renderer refuses anything that is not
    http(s), so an unresolved key renders blank -- a mapped video silently lost."""
    assert _dev(build(LIB))["video"]["url"] == (
        "https://pub-0edccec5d5bd419782ba389c59faecac.r2.dev/videos/"
        "Grade3MathsAdditionAndSubtractionAdditionAndSubtraction.mp4")


def test_a_url_passes_through_untouched():
    assert _dev(build(YT))["video"]["url"] == YT["link"]


def test_the_title_is_carried_because_it_is_the_visible_run():
    assert _dev(build(LIB))["video"]["title"] == "Addition and Subtraction"


def test_confidence_and_why_are_carried_verbatim():
    """05-media.md: 'Why it maps here is not optional and is not generated prose.'
    Low confidence is shown, not hidden, so both survive the transform."""
    v = _dev(build(LIB))["video"]
    assert v["confidence"] == "high"
    assert v["why"] == LIB["why"]


# ── refusals are loud ─────────────────────────────────────────────────────────

def test_a_link_that_is_neither_a_url_nor_a_key_is_dropped_and_says_why():
    doc = build({"title": "x", "link": "javascript:alert(1)", "source": "?"})
    assert "video" not in _dev(doc)
    assert any("javascript" in g or "video" in g.lower() for g in doc["notes"]["gaps"])


def test_a_mapping_with_no_link_is_dropped_and_says_why():
    doc = build({"title": "Addition and Subtraction", "link": "", "source": "Taleemabad library"})
    assert "video" not in _dev(doc)
    assert any("video" in g.lower() for g in doc["notes"]["gaps"])


def test_a_mapping_with_no_title_still_seats_because_the_url_is_the_fallback_run():
    """template.js: `v.title || short` -- stored rows predate the title requirement and a
    video line with no visible run is worse than an id."""
    assert "video" in _dev(build({"link": YT["link"], "source": "x"}))


if __name__ == "__main__":
    import pytest, sys
    sys.exit(pytest.main([__file__, "-q"]))


# ── the renderer's own contract ───────────────────────────────────────────────

def _v9_schema():
    """The live v9 schema, or None when this machine has no vendor tree / no jsonschema.

    Same `LP_V9` lookup as test_d0_contract.py: it defaults to the clone the render actually
    deploys from, and points at a worktree when the render depends on an unmerged splice.
    """
    import os
    path = os.path.join(
        os.environ.get("LP_V9") or os.path.expanduser(
            "~/rumi/Rumi 10 April 2026/NIETE-Rumi/bot/vendor/lp-v9"),
        "schema/lp_doc.schema.json")
    if not os.path.exists(path):
        return None
    return json.load(open(path))


def test_a_mapped_document_validates_against_the_live_v9_schema():
    """`video` is a CLOSED object -- `additionalProperties: false`.

    test_d0_contract.py validates an UNMAPPED document, so it never reaches this branch:
    the first mapped render was refused outright ("should NOT have additional properties
    ('source')") with no lesson written at all. A field the sheet has and the renderer does
    not is a mapping decision, never an extra key.
    """
    schema = _v9_schema()
    if schema is None:
        return
    try:
        import jsonschema
    except ImportError:
        return
    jsonschema.validate(build(LIB), schema)


def test_every_carried_key_is_one_the_renderer_declares():
    """Named separately from the validation above so the failure says WHICH key."""
    schema = _v9_schema()
    if schema is None:
        return
    dev = schema["properties"]["sections"]["items"]["properties"]
    allowed = set(dev["video"]["properties"])
    for row in (LIB, YT):
        assert set(_dev(build(row))["video"]) <= allowed, set(_dev(build(row))["video"]) - allowed


def test_the_maps_source_becomes_the_renderers_channel():
    """The sheet calls it `source`, v9 calls it `channel`, and they mean the same thing:
    who published the video. Renaming it here is what keeps `additionalProperties: false`
    satisfied without dropping the attribution the teacher sees."""
    v = _dev(build(LIB))["video"]
    assert v["channel"] == "Taleemabad library"
    assert "source" not in v


# ── bd-ht067: the map's `why` is TWO audiences in one field ──────────────────
#
# The Urdu G3 Ch.2 LP printed this to the teacher, inside the video box on page 1:
#
#   "... || MANAGER: DEFLATED high->medium. The slodesc asks pupils to answer questions
#    ORALLY; this is the recitation clip, which supplies the listening stimulus but not
#    the Q&A ... I verified the companion questions video exists and plays -
#    sid=federal-urdu-3-3.2&v=u-3-read-comp-4a (yt GGGwaD87jD4) - and the ICT team
#    should pair or swap to it for the Q&A half."
#
# That is our own mapping pipeline's confidence note, addressed to us, in a document a
# teacher opens. It is set LTR inside an RTL block too, so it reads as garbage besides.
#
# It is not one bad row. `data/videos-by-slo.json` carries 1,461 `why` fields; 129 use the
# `||` convention (teacher half || our half) and a further 6 are ours end to end, opening
# `MANAGER-SOURCED FILL`. 135 of 1,461 -- 9% of every mapped video in the corpus.
#
# Operator, on what this field is for: *"for the video, just its URL and a description of
# what it entails is enough."* So `why` carries the teacher half and nothing else, and when
# there is no teacher half the field is DROPPED -- a video with no rationale is honest; a
# video whose rationale is addressed to someone else is not.

MGR_BAR = dict(LIB, why=(
    "This is a Naat recitation video, the exact genre named in the packet topic. "
    "|| MANAGER: DEFLATED high->medium. The slodesc asks pupils to answer questions "
    "ORALLY. I verified the companion questions video exists and plays - "
    "sid=federal-urdu-3-3.2&v=u-3-read-comp-4a (yt GGGwaD87jD4)."))

MGR_ONLY = dict(LIB, why=(
    "MANAGER-SOURCED FILL - the worker left this cluster unfilled because its WebSearch "
    "budget was exhausted. I searched YouTube live and found Sabaq's own lesson."))


def _why(media):
    return _dev(build(media))["video"].get("why")


def test_the_managers_half_never_reaches_the_teacher():
    w = _why(MGR_BAR)
    for leak in ("MANAGER", "DEFLATED", "I verified", "sid=", "||", "slodesc"):
        assert leak not in w, f"{leak!r} reached the teacher: {w!r}"


def test_the_teachers_half_survives_whole():
    assert _why(MGR_BAR) == (
        "This is a Naat recitation video, the exact genre named in the packet topic.")


def test_a_why_that_is_ours_end_to_end_is_dropped_not_printed():
    """No rationale is honest. A rationale addressed to the ICT team is not."""
    v = _dev(build(MGR_ONLY))["video"]
    assert "why" not in v, v.get("why")
    assert v["url"], "the video itself must still render -- only its rationale is ours"


def test_an_ordinary_why_is_untouched():
    """The 1,326 rows with no manager note must pass through byte-identical."""
    assert _why(LIB) == LIB["why"]
    assert _why(YT) == YT["why"]


def test_no_why_in_the_real_corpus_can_leak():
    """The guard is asserted against the actual map, not just the fixtures above."""
    import os
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "videos-by-slo.json")
    if not os.path.exists(p):
        return
    rows = []

    def walk(o):
        if isinstance(o, dict):
            if isinstance(o.get("why"), str):
                rows.append(o["why"])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(json.load(open(p, encoding="utf-8")))
    assert rows, "the corpus did not load"
    bad = []
    for raw in rows:
        out = M.teacher_half(raw)
        if out and ("MANAGER" in out or "||" in out):
            bad.append(out[:120])
    assert not bad, f"{len(bad)} of {len(rows)} still leak, e.g. {bad[:2]}"
