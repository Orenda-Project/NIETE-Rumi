#!/usr/bin/env python3
"""The `Videos <-> SLOs` sheet, turned into something d0_media.apply_video can be handed.

bd-v2ikv. The map is 2,045 rows on the NEW workbook; the lessons being rendered come off the
OLD production sheet's traces. The only thing that lets one serve the other is the join key, and
spec/05-media.md fixes it in its opening line: keyed on SLO, NEVER on day number. Measured
against the live sheet, that is also the tightest key available -- SLO alone yields 658 distinct
keys and grade+subject+SLO yields 659, because an SLO code already carries its own grade and
subject (`M-03-AS-02` is Maths, Grade 3). Adding chapter would buy nothing and would cost a
re-segmented day its video the moment the chapter boundary moved.

One SLO can legitimately carry several videos -- 388 rows are marked "MAPPED (additional)" and
the sheet's own header says "Each row is one teaching day x one video". That is why parse()
returns a LIST per SLO rather than one entry, and why the ordering is part of the contract: the
renderer seats exactly one video, so which one comes first is a pedagogical decision, not an
implementation detail. High confidence wins; ties keep sheet order, so the operator's own
ordering inside the sheet is what breaks them.
"""
from __future__ import annotations

import mediamap as M

HEADER = ["Grade", "Subject", "Chapter", "Chapter title", "Day #", "Topic", "Skill type",
          "Primary SLO", "Primary SLO description", "Bloom's", "Video — title",
          "Video — source", "Language", "Video — key / link", "Match confidence",
          "Why it matches", "Teacher note (context fit)", "Status"]

# The two real rows for M-03-AS-02, verbatim from the sheet: same video, two confidences.
AS02_HIGH = ["G3", "Maths", "Ch. 2", "Plus and Minus Mysteries", "Day 5", "Subtraction",
             "Number operations", "M-03-AS-02", "Subtract 4-digit numbers", "apply",
             "Addition and Subtraction", "Taleemabad library", "English",
             "Grade3MathsAdditionAndSubtractionAdditionAndSubtraction", "high",
             "Video's borrowing procedure matches this day's SLO exactly.", "", "MAPPED"]
AS02_MED = list(AS02_HIGH)
AS02_MED[4], AS02_MED[14] = "Day 6", "medium"

# A real open-source row: a URL rather than a library key.
VO01 = ["G1", "English", "Ch. 1", "Hello World!", "Day 1", "All About Me", "Vocabulary & grammar",
        "E-01-VO-01", "Pronounce familiar one-syllable words", "remember",
        "Tricky Words and Sight Words Song", "Epic Phonics", "English",
        "https://www.youtube.com/watch?v=TvMyssfAUx0", "medium",
        "Children chant and read common irregular sight words aloud.", "", "OPEN-SOURCE"]

# A GAP row: the day exists, deliberately carries no video.
GAP = ["G1", "English", "Ch. 1", "Hello World!", "Day 2", "Meet Pinky", "Reading comprehension",
       "E-01-RD-01", "Recognise sounds, words or phrases", "understand",
       "", "", "", "", "", "", "", "GAP"]


def idx(*rows):
    return M.parse([HEADER] + list(rows))


def test_a_gap_row_produces_no_entry_at_all():
    """"An unmapped day says so" (spec 05-media). A GAP must not become an empty video block --
    d0_media would then seat a key with no url and the renderer would print a blank row."""
    assert idx(GAP) == {}


def test_a_mapped_row_is_keyed_on_its_slo():
    assert list(idx(AS02_HIGH)) == ["M-03-AS-02"]


def test_the_entry_carries_the_three_columns_the_spec_calls_non_negotiable():
    """Video / Confidence / Why it maps here. The spec says the 'why' is "not optional and is not
    generated prose", so it has to survive the harvest verbatim."""
    e = idx(AS02_HIGH)["M-03-AS-02"][0]
    assert e["title"] == "Addition and Subtraction"
    assert e["confidence"] == "high"
    assert e["why"] == "Video's borrowing procedure matches this day's SLO exactly."


def test_the_link_is_carried_raw_because_resolving_it_is_d0_medias_job():
    """Two shapes live in this column -- 617 URLs and 844 bare library keys. The harvest must not
    pick one and normalise the other away; d0_media.resolve_url owns that decision."""
    assert idx(AS02_HIGH)["M-03-AS-02"][0]["link"] == \
        "Grade3MathsAdditionAndSubtractionAdditionAndSubtraction"
    assert idx(VO01)["E-01-VO-01"][0]["link"] == "https://www.youtube.com/watch?v=TvMyssfAUx0"


def test_source_and_status_survive_so_a_reviewer_can_tell_ours_from_third_party():
    e = idx(VO01)["E-01-VO-01"][0]
    assert e["source"] == "Epic Phonics"
    assert e["status"] == "OPEN-SOURCE"


def test_several_videos_on_one_slo_all_survive():
    """388 rows are "MAPPED (additional)". Dropping the extras would silently discard a
    deliberate second video."""
    assert len(idx(AS02_HIGH, AS02_MED)["M-03-AS-02"]) == 2


def test_high_confidence_is_offered_first_whatever_the_sheet_order():
    """The renderer seats ONE video. Ordering IS the choice of which."""
    first = idx(AS02_MED, AS02_HIGH)["M-03-AS-02"][0]
    assert first["confidence"] == "high"


def test_equal_confidence_keeps_sheet_order():
    """Ties break on the operator's own ordering, not on anything this code invents."""
    a, b = list(VO01), list(VO01)
    a[10], b[10] = "First song", "Second song"
    got = [e["title"] for e in idx(a, b)["E-01-VO-01"]]
    assert got == ["First song", "Second song"]


def test_low_confidence_is_kept_not_filtered():
    """"Low confidence is shown, not hidden" (spec 05-media). 98 rows are low."""
    low = list(VO01)
    low[14] = "low"
    assert idx(low)["E-01-VO-01"][0]["confidence"] == "low"


def test_columns_are_found_by_header_name_not_by_position():
    """The sheet is hand-maintained and columns get inserted. A positional read would then
    harvest the wrong column and say nothing."""
    moved_header = ["Status"] + HEADER[:-1]
    moved_row = [AS02_HIGH[-1]] + AS02_HIGH[:-1]
    assert M.parse([moved_header, moved_row])["M-03-AS-02"][0]["confidence"] == "high"


def test_best_returns_the_first_candidate_or_none():
    """The one call d0_media's caller actually makes."""
    i = idx(AS02_MED, AS02_HIGH, GAP)
    assert M.best(i, "M-03-AS-02")["confidence"] == "high"
    assert M.best(i, "E-01-RD-01") is None
    assert M.best(i, "") is None


def test_a_short_row_does_not_crash_the_harvest():
    """Sheets truncates trailing empty cells, so a GAP row arrives shorter than the header."""
    assert M.parse([HEADER, ["G1", "English", "Ch. 1"]]) == {}


# ── the snapshot on disk ─────────────────────────────────────────────────────
# The harvest runs against the NEW workbook; the render runs against the OLD production
# sheet's traces and must not reach the new workbook at all. The file in between is therefore
# a production input, and a production input that cannot say where it came from is the thing
# that makes two sheets confusing. These tests pin the provenance onto the artefact itself.

def test_the_snapshot_records_which_sheet_and_tab_it_came_from():
    snap = M.snapshot(idx(AS02_HIGH))
    assert snap["source"]["sheet_id"] == M.SHEET_ID
    assert snap["source"]["tab"] == M.TAB


def test_the_snapshot_is_dated_so_staleness_is_visible():
    snap = M.snapshot(idx(AS02_HIGH), harvested="2026-09-21")
    assert snap["source"]["harvested"] == "2026-09-21"


def test_the_snapshot_counts_what_it_holds_so_a_truncated_read_is_obvious():
    """A failed or partial sheet read would otherwise write a smaller file that still parses."""
    snap = M.snapshot(idx(AS02_HIGH, AS02_MED, VO01))
    assert snap["source"]["slos"] == 2
    assert snap["source"]["videos"] == 3


def test_loading_a_snapshot_gives_back_exactly_the_index(tmp_path):
    import json as _json
    p = tmp_path / "videos-by-slo.json"
    p.write_text(_json.dumps(M.snapshot(idx(AS02_HIGH))), encoding="utf-8")
    assert M.load(str(p)) == idx(AS02_HIGH)


# ── the lookup the build actually performs ───────────────────────────────────
# A lesson carries `slo_refs`, a LIST -- the G3 Maths sample has two, and the old production
# sheet's SLO Codes column is likewise multi-valued. The build has one video slot to fill, so
# the list has to collapse to one entry, in the lesson's own order of SLOs: the first SLO is
# the day's primary one, and a video for it beats a better-graded video for a secondary one.

def test_the_first_slo_that_has_a_video_wins():
    """Lesson order first, confidence only WITHIN an SLO. The primary SLO is what the day is
    actually teaching; promoting a high-confidence video for a secondary SLO would seat a video
    about the wrong thing."""
    med = list(VO01)                     # E-01-VO-01, medium
    i = idx(med, AS02_HIGH)              # M-03-AS-02, high
    got = M.for_slos(i, ["E-01-VO-01", "M-03-AS-02"])
    assert got["confidence"] == "medium"


def test_a_secondary_slo_is_used_when_the_primary_has_none():
    i = idx(AS02_HIGH)
    assert M.for_slos(i, ["E-01-RD-01", "M-03-AS-02"])["confidence"] == "high"


def test_no_slo_with_a_video_is_None_not_an_empty_dict():
    """d0_media treats a falsy media as "no mapping" and leaves the doc byte-identical."""
    assert M.for_slos(idx(AS02_HIGH), ["E-01-RD-01"]) is None
    assert M.for_slos(idx(AS02_HIGH), []) is None
    assert M.for_slos(idx(AS02_HIGH), None) is None


def test_a_bare_string_is_accepted_as_a_single_slo():
    """The old sheet's SLO Codes cell arrives as text, not a list."""
    assert M.for_slos(idx(AS02_HIGH), "M-03-AS-02")["confidence"] == "high"
