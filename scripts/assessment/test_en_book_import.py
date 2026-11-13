"""
Tests for the English-medium GK/SST book import (bd-uam6dh.3): the five page-truth books
land as ICT rows under their own subject codes, general_knowledge_en and social_studies_en,
so the Urdu-medium rows on general_knowledge / social_studies are never touched.

    python3 -m pytest scripts/assessment/test_en_book_import.py -q

Fixtures are fictional books written to tmp_path in the English page-truth shape: TOC
entries carry "number" (not GB's "chapter") and SST ends on a Glossary entry. A fake _rest
records every call; nothing reaches a network.
"""
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import en_book_import as ei  # noqa: E402
import textbook_import as ti  # noqa: E402
from gb_reader import chapter_number as gb_chapter  # noqa: E402

TOC = [{"number": 1, "title": "Start", "printed_start": 1, "printed_end": 2},
       {"number": 2, "title": "Middle", "printed_start": 3, "printed_end": 3},
       {"number": 3, "title": "Glossary", "printed_start": 4, "printed_end": 4}]


def write_book(root: Path, stem: str):
    d = root / stem
    d.mkdir(parents=True)
    (d / "_toc.json").write_text(json.dumps({"book_stem": stem, "chapters": TOC}))
    (d / "pg_fm01.json").write_text(json.dumps({
        "printed_page_number": None, "pdf_page_index": 1,
        "blocks": [{"type": "prose", "text": "cover"}]}))
    for n in (1, 2, 3, 4):
        (d / f"pg_{n:03d}.json").write_text(json.dumps({
            "printed_page_number": n, "pdf_page_index": n + 4,
            "blocks": [{"type": "prose", "lang": "en", "text": f"page {n} words"}]}))


@pytest.fixture
def pt(tmp_path):
    for stem in ei.BOOKS:
        write_book(tmp_path, stem)
    return tmp_path


class FakeDB:
    def __init__(self, textbooks=None, subjects=("general_knowledge_en", "social_studies_en")):
        self.calls, self.textbooks, self.subjects = [], dict(textbooks or {}), subjects

    def __call__(self, method, path, body=None, prefer=None, target="staging"):
        self.calls.append((method, path, body, target))
        if path.startswith("/rest/v1/subjects"):
            return [{"code": c} for c in self.subjects if f"code=eq.{c}" in path]
        if method == "POST" and path.startswith("/rest/v1/textbooks"):
            g, s = body[0]["grade"], body[0]["subject"]
            self.textbooks.setdefault(f"grade=eq.{g}&subject=eq.{s}", {"id": "new", "meta": {}})
        if method == "GET" and path.startswith("/rest/v1/textbooks"):
            return [self.textbooks[k] for k in self.textbooks if k in path]
        if method == "GET":
            return [{}] * 4 if "textbook_pages" in path else [{}, {}]
        return None


def run(argv, db, monkeypatch):
    monkeypatch.setattr(ti, "_rest", db)
    return ei.main(argv)


def test_the_five_books_and_their_codes():
    assert ei.BOOKS == {
        "grade_1_general_knowledge_en": (1, "general_knowledge_en"),
        "grade_2_general_knowledge_en": (2, "general_knowledge_en"),
        "grade_3_general_knowledge_en": (3, "general_knowledge_en"),
        "grade_4_social_studies_en": (4, "social_studies_en"),
        "grade_5_social_studies_en": (5, "social_studies_en"),
    }


def test_toc_reads_number_and_the_glossary_is_no_chapter():
    toc = ei.chapters_of(TOC)
    assert [c["chapter"] for c in toc] == [1, 2, "GLOSSARY"]
    assert [gb_chapter(c["chapter"]) for c in toc] == [1, 2, None]


def test_back_matter_glossary_ends_the_last_chapter(tmp_path):
    d = tmp_path / "grade_1_general_knowledge_en"
    write_book(tmp_path, d.name)
    (d / "_toc.json").write_text(json.dumps({"chapters": TOC[:2], "back_matter": [
        {"title": "Glossary", "printed": 4, "pdf": 8, "in_toc": False}]}))
    book = ei.build(d, d.name)
    assert [(t["chapter_number"], t["page_end"]) for t in book["toc"]] == [(1, 2), (2, 3)]


def test_a_book_has_chapters_and_keeps_glossary_pages(pt):
    book = ei.build(pt / "grade_4_social_studies_en", "grade_4_social_studies_en")
    assert [(t["chapter_number"], t["page_start"], t["page_end"]) for t in book["toc"]] == \
        [(1, 1, 2), (2, 3, 3)]
    assert [r["textbook_page_number"] for r in book["rows"]] == [1, 2, 3, 4]
    assert book["meta"]["source"] == "en_page_truth"


def test_dry_run_lists_all_five_and_touches_no_database(pt, monkeypatch, capsys):
    db = FakeDB()
    assert run(["--all", "--dry-run", "--page-truth", str(pt)], db, monkeypatch) == 0
    lines = [tuple(l.split()[:2]) for l in capsys.readouterr().out.splitlines() if l.startswith("G")]
    assert lines == [("G1", "general_knowledge_en"), ("G2", "general_knowledge_en"),
                     ("G3", "general_knowledge_en"), ("G4", "social_studies_en"),
                     ("G5", "social_studies_en")]
    assert db.calls == []


def test_write_lands_on_ict_under_the_english_code_never_the_urdu_one(pt, monkeypatch):
    db = FakeDB()
    assert run(["--grade", "1", "--page-truth", str(pt)], db, monkeypatch) == 0
    posts = [(p, b) for m, p, b, _ in db.calls if m == "POST"]
    tb = [b for p, b in posts if p.startswith("/rest/v1/textbooks")][0][0]
    assert (tb["province"], tb["curriculum"], tb["grade"], tb["subject"]) == \
        ("federal", "ict", 1, "general_knowledge_en")
    toc = [b for p, b in posts if p == "/rest/v1/textbook_toc"][0]
    assert {(t["curriculum"], t["subject"]) for t in toc} == {("ict", "general_knowledge_en")}
    touched = " ".join(p + json.dumps(b or "") for _, p, b, _ in db.calls)
    assert "subject=eq.general_knowledge&" not in touched
    assert '"subject": "general_knowledge"' not in touched


def test_write_refuses_a_code_missing_from_subjects(pt, monkeypatch, capsys):
    db = FakeDB(subjects=())
    assert run(["--grade", "4", "--page-truth", str(pt)], db, monkeypatch) == 1
    assert not any(m == "POST" for m, *_ in db.calls)
    assert "not in subjects" in capsys.readouterr().out


def test_unchanged_book_is_not_rewritten(pt, monkeypatch, capsys):
    book = ei.build(pt / "grade_1_general_knowledge_en", "grade_1_general_knowledge_en")
    db = FakeDB(textbooks={"grade=eq.1&subject=eq.general_knowledge_en": {
        "id": "t1", "meta": {"content_hash": book["meta"]["content_hash"]}}})
    assert run(["--grade", "1", "--page-truth", str(pt)], db, monkeypatch) == 0
    assert not any(m in ("POST", "DELETE", "PATCH") for m, *_ in db.calls)
    assert "unchanged" in capsys.readouterr().out


def test_verify_reports_mismatch_reads_only_and_fails(pt, monkeypatch, capsys):
    db = FakeDB(textbooks={"grade=eq.1&subject=eq.general_knowledge_en": {"id": "t1", "meta": {}}})
    assert run(["--grade", "1", "--verify", "--page-truth", str(pt)], db, monkeypatch) == 1
    assert "MISMATCH content_hash" in capsys.readouterr().out
    assert all(m == "GET" for m, *_ in db.calls)


def test_a_missing_book_dir_fails_that_book_and_says_so(pt, monkeypatch, capsys):
    import shutil
    shutil.rmtree(pt / "grade_5_social_studies_en")
    assert run(["--all", "--dry-run", "--page-truth", str(pt)], FakeDB(), monkeypatch) == 1
    assert "grade_5_social_studies_en" in capsys.readouterr().out


def test_needs_a_selection_and_rejects_dry_run_with_verify(pt):
    with pytest.raises(SystemExit):
        ei.main(["--page-truth", str(pt)])
    with pytest.raises(SystemExit):
        ei.main(["--all", "--dry-run", "--verify", "--page-truth", str(pt)])


def test_wired_into_the_ict_importer_as_source_en(pt, monkeypatch, capsys):
    import importlib.util
    spec = importlib.util.spec_from_file_location("iit", HERE / "import-ict-textbooks.py")
    iit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(iit)
    assert iit.main(["--source", "en", "--all", "--dry-run", "--page-truth", str(pt)]) == 0
    assert "G5 social_studies_en" in capsys.readouterr().out
