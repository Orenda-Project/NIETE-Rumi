"""
Tests for the GB book import CLI (bd-6nskfq): book selection, dry run, the REST
writes and where they land, and --verify.

    python3 -m pytest scripts/assessment/test_gb_import.py -q

Fixtures are fictional two-page books written to tmp_path. A fake _rest records
every call; nothing reaches a network.
"""
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "lib"))
import gb_import as gi  # noqa: E402
import textbook_import as ti  # noqa: E402


def write_book(root: Path, stem: str):
    d = root / stem
    d.mkdir(parents=True)
    (d / "_toc.json").write_text(json.dumps({"chapters": [
        {"chapter": "1", "title": "Start", "printed_start": 1}]}))
    for n in (1, 2):
        (d / f"pg_{n:03d}.json").write_text(json.dumps({
            "printed_page_number": n, "pdf_page_index": n + 4,
            "blocks": [{"type": "prose", "text": f"page {n} words"}]}))


@pytest.fixture
def pt(tmp_path):
    import gb_reader as gb
    for stem in gb.BOOKS:
        write_book(tmp_path, stem)
    return tmp_path


class FakeDB:
    def __init__(self, textbooks=None, subjects=("english", "urdu", "maths", "science")):
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
            return [{}, {}] if "textbook_pages" in path else [{}]
        return None


def run(argv, db, monkeypatch):
    monkeypatch.setattr(ti, "_rest", db)
    return gi.main(argv)


def test_order_is_english_urdu_maths_then_science(pt, monkeypatch, capsys):
    assert run(["--all", "--dry-run", "--page-truth", str(pt)], FakeDB(), monkeypatch) == 0
    lines = [tuple(l.split()[:2]) for l in capsys.readouterr().out.splitlines() if l.startswith("G")]
    want = [(f"G{g}", s) for s in ("english", "urdu", "maths") for g in range(1, 6)]
    assert lines == want + [("G4", "science"), ("G5", "science")]


def test_dry_run_touches_no_database(pt, monkeypatch):
    db = FakeDB()
    assert run(["--subject", "english", "--dry-run", "--page-truth", str(pt)], db, monkeypatch) == 0
    assert db.calls == []


def test_a_missing_book_dir_fails_that_book_and_says_so(pt, monkeypatch, capsys):
    import shutil
    shutil.rmtree(pt / "gb_g1_maths")
    assert run(["--subject", "maths", "--dry-run", "--page-truth", str(pt)], FakeDB(),
               monkeypatch) == 1
    assert "gb_g1_maths" in capsys.readouterr().out


def test_write_lands_on_gb_province_and_curriculum_never_ict(pt, monkeypatch):
    db = FakeDB()
    assert run(["--grade", "1", "--subject", "urdu", "--page-truth", str(pt)], db, monkeypatch) == 0
    posts = [(p, b) for m, p, b, _ in db.calls if m == "POST"]
    tb = [b for p, b in posts if p.startswith("/rest/v1/textbooks")][0][0]
    assert (tb["province"], tb["curriculum"], tb["grade"], tb["subject"]) == \
        ("gilgit-baltistan", "nbf_snc", 1, "urdu")
    toc = [b for p, b in posts if p == "/rest/v1/textbook_toc"][0]
    assert {t["curriculum"] for t in toc} == {"nbf_snc"}
    assert not any("province=eq.federal" in p for _, p, _, _ in db.calls)
    assert not any(b and "federal" in json.dumps(b) for _, _, b, _ in db.calls)


def test_write_refuses_an_unknown_subject(pt, monkeypatch, capsys):
    db = FakeDB(subjects=("english",))
    assert run(["--grade", "1", "--subject", "urdu", "--page-truth", str(pt)], db, monkeypatch) == 1
    assert not any(m == "POST" for m, *_ in db.calls)
    assert "not in subjects" in capsys.readouterr().out


def test_unchanged_book_is_not_rewritten(pt, monkeypatch, capsys):
    import gb_reader as gb
    book = gb.build_book("gb_g1_urdu", *gb.read_book_dir(pt / "gb_g1_urdu"))
    db = FakeDB(textbooks={"grade=eq.1&subject=eq.urdu": {
        "id": "t1", "meta": {"content_hash": book["meta"]["content_hash"]}}})
    assert run(["--grade", "1", "--subject", "urdu", "--page-truth", str(pt)], db, monkeypatch) == 0
    assert not any(m in ("POST", "DELETE", "PATCH") for m, *_ in db.calls)
    assert "unchanged" in capsys.readouterr().out


def test_verify_reports_mismatch_and_fails(pt, monkeypatch, capsys):
    db = FakeDB(textbooks={"grade=eq.1&subject=eq.urdu": {"id": "t1", "meta": {}}})
    assert run(["--grade", "1", "--subject", "urdu", "--verify", "--page-truth", str(pt)], db,
               monkeypatch) == 1
    out = capsys.readouterr().out
    assert "MISMATCH content_hash" in out
    assert all(m == "GET" for m, *_ in db.calls)


def test_needs_a_selection_and_rejects_dry_run_with_verify(pt):
    with pytest.raises(SystemExit):
        gi.main(["--page-truth", str(pt)])
    with pytest.raises(SystemExit):
        gi.main(["--all", "--dry-run", "--verify", "--page-truth", str(pt)])


def test_wired_into_the_ict_importer_as_source_gb(pt, monkeypatch, capsys):
    import importlib.util
    spec = importlib.util.spec_from_file_location("iit", HERE / "import-ict-textbooks.py")
    iit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(iit)
    assert iit.main(["--source", "gb", "--all", "--dry-run", "--page-truth", str(pt)]) == 0
    assert "G4 science" in capsys.readouterr().out
