"""
Red-first tests for the GB (Gilgit-Baltistan, curriculum nbf_snc) book reader (bd-6nskfq).

    python3 -I -m pytest scripts/lib/test_gb_reader.py -q

Every fixture is fictional and built in-test. No textbook text appears here.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gb_reader as gb  # noqa: E402


def page(printed, pdf, blocks, chapter=None):
    return {"printed_page_number": printed, "pdf_page_index": pdf, "blocks": blocks,
            "chapter": chapter, "page_type": "content"}


# ── where GB rows land ───────────────────────────────────────────────────────

def test_gb_rows_never_land_on_ict_province_or_curriculum():
    # textbooks is UNIQUE(province, grade, subject): ICT's rows are ('federal', 'ict').
    assert gb.PROVINCE == "gilgit-baltistan"
    assert gb.CURRICULUM == "nbf_snc"


def test_book_map_covers_the_seventeen_gb_books_with_canonical_codes():
    assert len(gb.BOOKS) == 17
    assert gb.BOOKS["gb_g4_maths"] == (4, "maths")
    assert gb.BOOKS["gb_g1_urdu"] == (1, "urdu")
    assert gb.BOOKS["gb_g5_science"] == (5, "science")
    assert {c for _, c in gb.BOOKS.values()} == {"english", "urdu", "maths", "science"}


# ── page text ────────────────────────────────────────────────────────────────

def test_flatten_keeps_book_text_and_drops_metadata_answers_and_translations():
    blocks = [
        {"type": "heading", "text": "Unit One", "lang": "en"},
        {"type": "prose", "text": "Ali has a red ball.", "lang": "en", "note": "ocr check",
         "pedagogical_role": "reading"},
        {"type": "illustration", "description": "A boy holding a ball", "text_in_image": "PLAY"},
        {"type": "exercise", "instruction_verbatim": "Answer the questions.",
         "items": [{"label": "1", "prompt_verbatim": "What colour is the ball?",
                    "answer_key": "red", "answer_source": "p.3", "answer_confidence": "high",
                    "sample_answer": "It is red."}]},
        {"type": "prose", "text": "گیند", "roman": "gend", "meaning_en": "ball",
         "title_roman": "x", "title_meaning_en": "y"},
    ]
    text = gb.flatten(blocks)
    for kept in ("Unit One", "Ali has a red ball.", "A boy holding a ball", "PLAY",
                 "Answer the questions.", "What colour is the ball?", "گیند"):
        assert kept in text
    for dropped in ("heading", "ocr check", "reading", "p.3", "high", "It is red.",
                    "gend", "\nball", "en\n"):
        assert dropped not in text
    assert "red" in text  # from the prose, not the answer key
    assert text.count("red") == 1


def test_flatten_of_nothing_is_empty():
    assert gb.flatten(None) == ""
    assert gb.flatten([]) == ""


# ── chapter labels ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("label,expected", [
    (1, 1), ("1", 1), ("12", 12), ("L1", 1), ("L23", 23), ("QAIDA", 0),
    ("1b", None), ("1c", None),                       # sub-units fold into the parent
    ("R1", None), ("J3", None), ("Glossary", None), ("GL", None), ("GLOSS", None),
])
def test_chapter_number(label, expected):
    assert gb.chapter_number(label) == expected


def test_toc_ranges_titles_and_excluded_units():
    toc = [
        {"chapter": "QAIDA", "title_ur": "قاعدہ", "printed_start": 1},
        {"chapter": "L1", "title_ur": "حمد", "meaning_en": "Praise", "printed_start": 10},
        {"chapter": "J1", "title_ur": "جائزہ", "printed_start": 15},
        {"chapter": "L2", "title_ur": "سبق", "printed_start": 18},
        {"chapter": "GL", "title_ur": "فرہنگ", "printed_start": 30},
    ]
    assert gb.build_toc(toc, max_printed=32) == [
        {"chapter_number": 0, "chapter_title": "قاعدہ", "page_start": 1, "page_end": 9},
        {"chapter_number": 1, "chapter_title": "حمد", "page_start": 10, "page_end": 14},
        {"chapter_number": 2, "chapter_title": "سبق", "page_start": 18, "page_end": 29},
    ]


def test_toc_folds_sub_units_into_their_parent_chapter():
    toc = [
        {"chapter": 1, "title": "Whole Numbers", "printed_start": 5},
        {"chapter": "1b", "title": "Addition", "printed_start": 23},
        {"chapter": "1c", "title": "Multiplication", "printed_start": 37},
        {"chapter": 2, "title": "Factors", "printed_start": 48},
    ]
    assert gb.build_toc(toc, max_printed=60) == [
        {"chapter_number": 1, "chapter_title": "Whole Numbers", "page_start": 5, "page_end": 47},
        {"chapter_number": 2, "chapter_title": "Factors", "page_start": 48, "page_end": 60},
    ]


def test_toc_rejects_a_repeated_chapter_number():
    toc = [{"chapter": "1", "title": "A", "printed_start": 1},
           {"chapter": "L1", "title": "B", "printed_start": 5}]
    with pytest.raises(gb.GbBookError):
        gb.build_toc(toc, max_printed=9)


# ── the whole book ───────────────────────────────────────────────────────────

def test_build_book_rows_toc_and_meta():
    pages = [page(1, 7, [{"type": "prose", "text": "First page."}]),
             page(2, 8, [{"type": "prose", "text": "Second page."}]),
             page(None, 9, [{"type": "prose", "text": "Back cover."}]),   # unnumbered: dropped
             page(3, 10, [])]                                              # empty: dropped
    toc = [{"chapter": "1", "title": "Start", "printed_start": 1}]
    book = gb.build_book("gb_g9_fake", pages, toc)
    assert [r["textbook_page_number"] for r in book["rows"]] == [1, 2]
    assert book["rows"][0]["page_content"] == "First page."
    assert book["rows"][0]["pdf_page_index"] == 7
    assert book["toc"] == [{"chapter_number": 1, "chapter_title": "Start",
                            "page_start": 1, "page_end": 2}]
    assert book["offset"] == 6
    assert book["meta"]["source"] == "gb_page_truth"
    assert len(book["meta"]["content_hash"]) == 64
    assert book["report"]["pages"] == 2 and book["report"]["chapters"] == 1


def test_build_book_with_no_text_refuses():
    with pytest.raises(gb.GbBookError):
        gb.build_book("gb_g9_fake", [page(1, 1, [])], [])


def test_read_book_dir(tmp_path):
    import json
    d = tmp_path / "gb_g9_fake"
    d.mkdir()
    (d / "_book.json").write_text(json.dumps({"book_stem": "gb_g9_fake"}))
    (d / "_toc.json").write_text(json.dumps({"chapters": [
        {"chapter": "1", "title": "Start", "printed_start": 1}]}))
    (d / "pg_002.json").write_text(json.dumps(page(2, 2, [{"type": "prose", "text": "b"}])))
    (d / "pg_001.json").write_text(json.dumps(page(1, 1, [{"type": "prose", "text": "a"}])))
    pages, toc = gb.read_book_dir(d)
    assert [p["printed_page_number"] for p in pages] == [1, 2]
    assert toc[0]["title"] == "Start"


def test_rescanned_pages_sharing_a_pdf_index_are_both_kept():
    # Rescans are indexed in the rescan PDF, so their pdf index can collide with the
    # original's. Page truth is unique by printed page; that is the key.
    pages = [page(51, 53, [{"type": "prose", "text": "original scan"}]),
             page(93, 53, [{"type": "prose", "text": "rescanned page"}])]
    book = gb.build_book("gb_g9_fake", pages, [{"chapter": 1, "title": "A", "printed_start": 1}])
    assert [r["textbook_page_number"] for r in book["rows"]] == [51, 93]


def test_a_printed_page_given_twice_refuses():
    pages = [page(5, 5, [{"type": "prose", "text": "a"}]),
             page(5, 6, [{"type": "prose", "text": "b"}])]
    with pytest.raises(gb.GbBookError):
        gb.build_book("gb_g9_fake", pages, [])


def test_a_rescanned_page_gets_a_free_pdf_index_where_it_sits_in_the_book():
    # textbook_pages is UNIQUE(textbook_id, pdf_page_index): a rescan's index (in the
    # rescan PDF) must not reuse an original page's. It moves to printed + offset.
    pages = [page(n, n + 2, [{"type": "prose", "text": f"p{n}"}]) for n in (1, 2, 3)]
    pages.append(page(4, 3, [{"type": "prose", "text": "rescanned p4"}]))
    rows = gb.build_book("gb_g9_fake", pages, [{"chapter": 1, "title": "A", "printed_start": 1}])["rows"]
    assert [r["pdf_page_index"] for r in rows] == [3, 4, 5, 6]


def test_a_rescan_whose_natural_slot_is_taken_goes_past_the_last_index():
    pages = [page(n, n + 2, [{"type": "prose", "text": f"p{n}"}]) for n in (1, 2, 3, 4)]
    pages.append(page(6, 7, [{"type": "prose", "text": "p6"}]))           # holds 7
    pages.append(page(5, 3, [{"type": "prose", "text": "rescanned p5"}]))  # wants 5+2=7
    rows = gb.build_book("gb_g9_fake", pages, [])["rows"]
    assert [r["pdf_page_index"] for r in rows] == [3, 4, 5, 6, 8, 7]
