"""Stage D0 -- Urdu print-string localisation. Unit tests (bd-p8g50, W1).

Run: python3 -m pytest test_d0_i18n_ur.py -q
"""

import copy

import d0_blocks as B
import d0_i18n_ur as ur


def test_english_medium_is_a_no_op():
    """The structural guarantee: an English doc must come back unchanged, so
    an English render is byte-identical to before this module existed."""
    doc = {"sections": [{"id": "homework", "title": "Homework",
                          "blocks": [{"type": "key_points", "id": "hw", "title": "Homework",
                                      "items": ["Say: do this."]}]}]}
    before = copy.deepcopy(doc)
    out = ur.translate_doc(doc, "en")
    assert out == before


def test_block_titles_baked_by_build_are_translated():
    doc = {"sections": [{"id": "development",
                          "blocks": [{"type": "key_points", "id": "you-do-task",
                                      "title": "Set the task going", "items": []},
                                     {"type": "key_points", "id": "hook-characters",
                                      "title": "On the page · read aloud", "items": []}]}]}
    out = ur.translate_doc(doc, "ur")
    titles = [b["title"] for b in out["sections"][0]["blocks"]]
    assert titles == ["کام کا آغاز کریں", "کتاب میں · بلند آواز سے پڑھیں"]


def test_homework_and_remember_block_titles_translate():
    doc = {"sections": [
        {"id": "conclusion", "title": "Check",
         "blocks": [{"type": "key_points", "id": "remember", "title": "Remember",
                     "items": [B.DESIGN_PENDING]}]},
        {"id": "homework", "title": "Homework",
         "blocks": [{"type": "key_points", "id": "hw", "title": "Homework", "items": ["x"]}]},
    ]}
    out = ur.translate_doc(doc, "ur")
    assert out["sections"][0]["blocks"][0]["title"] == "یاد رکھیں"
    assert out["sections"][0]["blocks"][0]["items"] == ["یہ حصہ ابھی تیار نہیں ہوا"]
    assert out["sections"][1]["blocks"][0]["title"] == "گھر کا کام"
    # Section-level chrome ("Check"/"Homework" as a section `title`) is left
    # alone -- the renderer's own chromeText/LABELS.ur fallback already
    # rescues it; a second, possibly-inconsistent Urdu wording here would be
    # unsurgical. See the module docstring.
    assert out["sections"][0]["title"] == "Check"
    assert out["sections"][1]["title"] == "Homework"


def test_say_prefix_translates_and_keeps_the_rest_verbatim():
    doc = {"x": ["Say: “The title is 'X'.”"]}
    out = ur.translate_doc(doc, "ur")
    assert out["x"] == ["کہیے: “The title is 'X'.”"]


def test_halfway_check_paragraph_translates():
    doc = {"sections": [{"id": "development", "blocks": [
        {"type": "paragraph", "id": "halfway",
         "text": "Halfway check · minute 12. By now the class should be starting WE DO."}
    ]}]}
    out = ur.translate_doc(doc, "ur")
    assert out["sections"][0]["blocks"][0]["text"] == (
        "وقفہ جانچ · منٹ 12۔ اس وقت تک جماعت کو مل کر کریں کا آغاز کر دینا چاہیے۔")


def test_routine_paragraph_min_abbreviation_translates():
    doc = {"sections": [{"id": "introduction", "blocks": [
        {"type": "paragraph", "id": "routine", "text": "Settle and open · 5 min. Take the register."}
    ]}]}
    out = ur.translate_doc(doc, "ur")
    assert "5 منٹ" in out["sections"][0]["blocks"][0]["text"]
    assert "min." not in out["sections"][0]["blocks"][0]["text"]


def test_design_pending_sentinel_translates_and_is_findable():
    doc = {"blocks": [{"items": [B.DESIGN_PENDING]}]}
    out = ur.translate_doc(doc, "ur")
    assert out["blocks"][0]["items"][0] == "یہ حصہ ابھی تیار نہیں ہوا"


def test_video_why_note_is_dropped_not_translated():
    doc = {"sections": [{"id": "development", "video": {
        "url": "https://example.com/v.mp4", "title": "Eeraab",
        "why": "Direct match: SLO is specifically...", "channel": "Sabaq"}}]}
    out = ur.translate_doc(doc, "ur")
    video = out["sections"][0]["video"]
    assert "why" not in video
    assert video["title"] == "اعراب"


def test_mixed_script_video_title_strips_the_latin_run():
    doc = {"v": {"url": "https://x", "title": "Urdu Diacritics Or Accent Marks اعراب: پیش"}}
    out = ur.translate_doc(doc, "ur")
    assert out["v"]["title"] == "اعراب: پیش"


def test_text_verbatim_is_frozen():
    doc = {"slo": {"text_verbatim": "Say: this must never change."}}
    out = ur.translate_doc(doc, "ur")
    assert out["slo"]["text_verbatim"] == "Say: this must never change."


def test_section_and_move_chrome_are_left_alone():
    """Opening/Explanation/We Do · You Do/Worked example/Teacher models and the
    section `move` enum are the renderer's job (chromeText + LABELS.ur /
    the move-pill normaliser) -- confirmed by reading lib/template.js and
    lib/overlay.js, and by their absence from scan_before.txt."""
    doc = {"sections": [{"id": "introduction", "title": "Opening", "move": None},
                         {"id": "development", "title": "Explanation", "move": "I DO",
                          "blocks": [{"type": "worked_example", "id": "worked",
                                      "title": "Worked example"}]}]}
    out = ur.translate_doc(doc, "ur")
    assert out["sections"][0]["title"] == "Opening"
    assert out["sections"][1]["title"] == "Explanation"
    assert out["sections"][1]["move"] == "I DO"
    assert out["sections"][1]["blocks"][0]["title"] == "Worked example"
