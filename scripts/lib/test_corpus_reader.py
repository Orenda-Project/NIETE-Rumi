"""
Red-first tests for the G6–12 corpus reader (contract 3, corpus-import.md §2–§6, T1–T11).

    python3 -I -m pytest scripts/lib/test_corpus_reader.py -q

Every fixture is fictional: a made-up three-page book in fixtures/corpus_mini and
small in-test records. No textbook text appears here.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import corpus_reader as cr  # noqa: E402

MINI = Path(__file__).resolve().parent / "fixtures" / "corpus_mini"


def R(printed, pdf, text="some words", number=1, title="Unit", section=None,
      flagged=False, conf="high", page_type="content", chapter=True):
    ch = None
    if chapter:
        ch = {"number": number, "title": title}
        if section is not None:
            ch["section"] = section
    return {"printed_page_number": printed, "pdf_page_index": pdf, "text": text,
            "chapter": ch, "needs_human_review": flagged, "confidence": conf,
            "page_type": page_type}


# ── T1 / T2: row shape and mapping ───────────────────────────────────────────

def test_row_shape_exact():
    book = cr.build_book("grade_7_example", cr.read_local(MINI)["grade_7_example"]["records"])
    for row in book["rows"]:
        assert set(row) == {"textbook_page_number", "pdf_page_index", "page_content",
                            "page_images", "content_length"}
        assert row["page_images"] == []
        assert row["content_length"] == len(row["page_content"])


def test_field_mapping():
    assert cr.to_importer_input(R(12, 13, text="a\\nb")) == {
        "book_page_no": 12, "pdf_page_no": 13, "text": "a\\nb", "page_figures": []}
    book = cr.build_book("s", [R(12, 13, text="a\\nb\n\n\n\nc")])
    assert book["rows"][0]["textbook_page_number"] == 12
    assert book["rows"][0]["pdf_page_index"] == 13
    assert book["rows"][0]["page_content"] == "a\nb\n\nc"


def test_figures_never_imported():
    rec = R(1, 1)
    rec["image"] = "grade_x/p001.jpg"
    assert cr.to_importer_input(rec)["page_figures"] == []


# ── T3: empty pages ──────────────────────────────────────────────────────────

def test_empty_page_skipped_and_reported():
    recs = [R(1, 1), R(2, 2, text="", page_type="missing"), R(3, 3)]
    book = cr.build_book("s", recs)
    assert [r["textbook_page_number"] for r in book["rows"]] == [1, 3]
    assert book["report"]["gaps"] == [2]
    assert book["report"]["empty"] == 1
    assert book["report"]["recs"] == 3 and book["report"]["emit"] == 2


def test_local_fixture_counts():
    book = cr.build_book("grade_7_example", cr.read_local(MINI)["grade_7_example"]["records"])
    rep = book["report"]
    assert (rep["recs"], rep["empty"], rep["emit"], rep["toc"]) == (3, 1, 2, 1)
    assert (rep["flagged"], rep["low"]) == (1, 1)


# ── T4: duplicated printed numbers ───────────────────────────────────────────

def test_duplicate_printed_pair_relabelled_by_pdf():
    # offset 10 everywhere; printed 30 appears twice, the second copy sits at pdf 50.
    recs = [R(n, n + 10) for n in range(28, 33)] + [R(30, 50)]
    book = cr.build_book("s", recs)
    nums = [r["textbook_page_number"] for r in book["rows"]]
    assert 40 in nums and nums.count(30) == 1
    assert len(book["rows"]) == 6


# ── T5–T7: TOC ───────────────────────────────────────────────────────────────

def test_toc_keyed_by_section_and_number_and_contiguity():
    recs = ([R(n, n, number=1, title="Prose one", section="Prose") for n in (1, 2)]
            + [R(3, 3, number=2, title="Prose two", section="Prose")]
            + [R(n, n, number=1, title="Poem one") for n in (4, 5)]
            + [R(6, 6, number=1, title="Ghazal one", section="Ghazal — a note")])
    toc = cr.build_book("s", recs)["toc"]
    assert len(toc) == 4
    assert [t["chapter_number"] for t in toc] == [1, 2, 3, 4]
    assert (toc[2]["page_start"], toc[2]["page_end"]) == (4, 5)
    assert toc[2]["chapter_title"] == "1 · Poem one"
    assert toc[3]["chapter_title"] == "Ghazal · 1 · Ghazal one"


def test_section_key_strips_dash_note_and_whitespace():
    assert cr.section_key("  Part   A — appendix note") == "Part A"
    assert cr.section_key("Part A") == "Part A"
    assert cr.section_key(None) is None


def test_toc_ordinal_mode_when_numbers_repeat_or_non_int():
    book = cr.build_book("s", [R(1, 1, number="A", title="Letters"), R(2, 2, number=1, title="One")])
    assert book["report"]["numbering"] == "ordinal"
    assert [t["chapter_number"] for t in book["toc"]] == [1, 2]
    assert book["toc"][0]["chapter_title"] == "A · Letters"


def test_toc_ordinal_mode_when_bool_number():
    book = cr.build_book("s", [R(1, 1, number=True), R(2, 2, number=2)])
    assert book["report"]["numbering"] == "ordinal"


def test_toc_source_mode_when_unique_ints():
    recs = [R(1, 1, number=3, title="Three"), R(2, 2, number=3, title="Three"),
            R(3, 3, number=5, title="Five")]
    book = cr.build_book("s", recs)
    assert book["report"]["numbering"] == "source"
    assert book["toc"] == [
        {"chapter_number": 3, "chapter_title": "Three", "page_start": 1, "page_end": 2},
        {"chapter_number": 5, "chapter_title": "Five", "page_start": 3, "page_end": 3}]


def test_null_chapter_number_ends_run():
    recs = [R(1, 1, number=1), R(2, 2, chapter=False), R(3, 3, number=1)]
    book = cr.build_book("s", recs)
    assert len(book["toc"]) == 2
    assert book["report"]["numbering"] == "ordinal"
    recs = [R(1, 1, number=1), R(2, 2, number=None), R(3, 3, number=1)]
    assert len(cr.build_book("s", recs)["toc"]) == 2


def test_dropped_empty_page_does_not_split_run():
    recs = [R(1, 1, number=1), R(2, 2, number=1, text=""), R(3, 3, number=1)]
    toc = cr.build_book("s", recs)["toc"]
    assert len(toc) == 1 and (toc[0]["page_start"], toc[0]["page_end"]) == (1, 3)


def test_title_fallbacks():
    toc = cr.build_book("s", [R(4, 4, number=1, title=None, section="Sec"),
                              R(5, 5, number=2, title=None)])["toc"]
    assert toc[0]["chapter_title"] == "Sec"
    assert toc[1]["chapter_title"] == "pages 5-5"


def test_relabelled_page_carries_its_own_chapter():
    recs = [R(n, n + 10, number=1, title="First") for n in range(28, 33)]
    recs.append(R(30, 50, number=2, title="Second"))
    toc = cr.build_book("s", recs)["toc"]
    assert toc[-1]["chapter_title"] == "Second" and toc[-1]["page_start"] == 40


def test_no_pages_raises():
    with pytest.raises(cr.CorpusError):
        cr.build_book("s", [R(1, 1, text="")])


# ── T8: meta and hash ────────────────────────────────────────────────────────

def test_meta_counts_over_emitted_pages():
    recs = [R(1, 1, flagged=True, conf="low"), R(2, 2, flagged=True, conf="medium"),
            R(3, 3, text="", flagged=True, conf="low")]
    meta = cr.build_book("stem_x", recs)["meta"]
    assert meta["source"] == "corpus" and meta["stem"] == "stem_x"
    assert meta["pages_flagged"] == 2
    assert meta["pages_low_conf"] == 1
    assert set(meta) == {"source", "stem", "pages_flagged", "pages_low_conf", "content_hash"}


def test_content_hash_is_sha256_of_canonical_json():
    rec = [r for r in cr.read_local(MINI)["grade_7_example"]["records"]
           if r["printed_page_number"] == 12]
    book = cr.build_book("grade_7_example", rec)
    assert book["rows"][0]["content_length"] == 60
    assert book["toc"] == [{"chapter_number": 1, "chapter_title": "Sample unit",
                            "page_start": 12, "page_end": 12}]
    assert book["meta"]["content_hash"] == (
        "4aa2dd5b71ceb5a3bacd12cc02c7626e988c8e90281264d20e97c46bc86e0542")


def test_hash_ignores_flags_but_not_text():
    a = cr.build_book("s", [R(1, 1)])["meta"]["content_hash"]
    assert cr.build_book("s", [R(1, 1, flagged=True)])["meta"]["content_hash"] == a
    assert cr.build_book("s", [R(1, 1, text="other")])["meta"]["content_hash"] != a


# ── T9: never read / never written ───────────────────────────────────────────

def test_grade_le_5_never_written():
    for bad in (5, 1, 13, 0):
        with pytest.raises(ValueError):
            cr.assert_grade_6_12(bad)
    cr.assert_grade_6_12(6)
    cr.assert_grade_6_12(12)


def test_chemistry_experiment_stem_never_read(tmp_path):
    (tmp_path / "pages.jsonl").write_text(
        json.dumps(dict(R(1, 1), book_stem="grade_9_10_chemistry_experiment")) + "\n"
        + json.dumps(dict(R(1, 1), book_stem="grade_7_x")) + "\n")
    (tmp_path / "books.jsonl").write_text(
        json.dumps({"book_stem": "grade_7_x", "title": "T"}) + "\n")
    got = cr.read_local(tmp_path)
    assert "grade_9_10_chemistry_experiment" not in got and "grade_7_x" in got
    assert got["grade_7_x"]["book"]["title"] == "T"
    with pytest.raises(cr.CorpusError):
        cr.read_r2("grade_9_10_chemistry_experiment", client=object(), bucket="b")


def test_read_local_filters_stems():
    assert cr.read_local(MINI, stems={"nope"}) == {}
    assert list(cr.read_local(MINI, stems={"grade_7_example"})) == ["grade_7_example"]


def test_read_local_missing_dir_names_path(tmp_path):
    with pytest.raises(cr.CorpusError, match="pages.jsonl"):
        cr.read_local(tmp_path / "absent")


# ── added after the mutation run: each test kills a named survivor ───────────

def test_hash_uses_utf8_not_ascii_escapes():
    import hashlib
    book = cr.build_book("s", [R(1, 1, text="سبق ایک")])
    canon = json.dumps({"pages": book["rows"], "toc": book["toc"]}, ensure_ascii=False,
                       sort_keys=True, separators=(",", ":"))
    assert book["meta"]["content_hash"] == hashlib.sha256(canon.encode("utf-8")).hexdigest()

def test_poetry_review_counts_only_uncertain_verse_pages():
    recs = [R(1, 1, page_type="poem", flagged=True),
            R(2, 2, page_type="ghazal", conf="medium"),
            R(3, 3, page_type="Nazm page", conf="low"),
            R(4, 4, page_type="poem", conf="high"),
            R(5, 5, page_type="content", flagged=True),
            R(6, 6, page_type="content", section="حصہ نظم", conf="medium")]
    assert cr.build_book("s", recs)["report"]["poetry_review"] == 4

def test_report_repair_fields():
    recs = [R(n, n + 10) for n in range(28, 33)] + [R(30, 50), R(31, 41)]
    rep = cr.build_book("s", recs)["report"]
    assert rep["page_range"] == (28, 40)
    assert rep["repeat_pdf_dropped"] == 1
    assert rep["relabelled"] == 1 and rep["mislabelled_dropped"] == 0
    assert cr.build_book("s", recs)["offset"] == 10

def test_report_counts_mislabelled_drop():
    rep = cr.build_book("s", [R(1, 5), R(2, 6), R(1, 2)])["report"]
    assert rep["mislabelled_dropped"] == 1

def test_error_messages_exact(tmp_path):
    with pytest.raises(ValueError, match=r"^corpus import writes grades 6-12 only, got 5$"):
        cr.assert_grade_6_12(5)
    with pytest.raises(cr.CorpusError, match=r"^no pages.jsonl in "):
        cr.read_local(tmp_path)
    with pytest.raises(cr.CorpusError, match=r"^s produced no usable pages$"):
        cr.build_book("s", [R(1, 1, text="")])
    with pytest.raises(cr.CorpusError, match=r"^grade_8_none not in .*/pages.jsonl$"):
        cr.load_book("grade_8_none", corpus_local=MINI)

def test_read_local_skips_blank_lines_and_reads_utf8(tmp_path):
    (tmp_path / "pages.jsonl").write_text(
        "\n" + json.dumps(dict(R(1, 1, text="اردو"), book_stem="g")) + "\n\n", encoding="utf-8")
    (tmp_path / "books.jsonl").write_text(
        "\n" + json.dumps({"book_stem": "g", "title": "کتاب"}, ensure_ascii=False) + "\n"
        + json.dumps({"book_stem": "other"}) + "\n", encoding="utf-8")
    got = cr.read_local(tmp_path)
    assert list(got) == ["g"] and got["g"]["records"][0]["text"] == "اردو"
    assert got["g"]["book"]["title"] == "کتاب"
