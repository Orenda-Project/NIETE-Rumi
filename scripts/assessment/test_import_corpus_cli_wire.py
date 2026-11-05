"""
Wire-level tests for the corpus import CLI: the exact REST calls, payloads and
messages (contract 3 §1, §7, §8). Split from test_import_corpus_cli.py (300-line rule).

    python3 -m pytest scripts/assessment/test_import_corpus_cli_wire.py -q
"""
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from test_import_corpus_cli import (  # noqa: E402
    MINI, FakeDB, built, ci, mini_books, run, ti)  # noqa: F401


# ── added after the mutation run: exact wire calls and messages ──────────────

class Recorder(FakeDB):
    def __call__(self, method, path, body=None, prefer=None, target="staging"):
        self.full = getattr(self, "full", [])
        self.full.append((method, path, prefer, target,
                          None if body is None else (body if isinstance(body, dict) else len(body))))
        return super().__call__(method, path, body, prefer, target)


def test_exact_rest_calls_first_import(mini_books, monkeypatch, capsys):
    db = Recorder()
    assert run(["--all", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    m = built()["meta"]
    assert db.full == [
        ("GET", "/rest/v1/app_settings?select=key&key=eq.assessment_grades_6_12", None, "staging", None),  # gitleaks:allow (settings key name, not a secret)
        ("GET", "/rest/v1/subjects?select=code&code=eq.english", None, "staging", None),
        ("GET", "/rest/v1/textbooks?select=id,meta&province=eq.federal&grade=eq.7&subject=eq.english",
         None, "staging", None),
        ("POST", "/rest/v1/textbooks?on_conflict=province,grade,subject",
         "resolution=merge-duplicates,return=minimal", "staging", 1),
        ("GET", "/rest/v1/textbooks?select=id&province=eq.federal&grade=eq.7&subject=eq.english",
         None, "staging", None),
        ("DELETE", "/rest/v1/textbook_pages?textbook_id=eq.tb-1", "return=minimal", "staging", None),
        ("POST", "/rest/v1/textbook_pages", "return=minimal", "staging", 2),
        ("DELETE", "/rest/v1/textbook_toc?textbook_id=eq.tb-1", "return=minimal", "staging", None),
        ("POST", "/rest/v1/textbook_toc", "return=minimal", "staging", 1),
        ("PATCH", "/rest/v1/textbooks?id=eq.tb-1", "return=minimal", "staging", {"meta": m}),
    ]
    assert capsys.readouterr().out == (
        "grade 7 english <- grade_7_example: records 3, pages 2 (empty skipped 1), flagged 1, "
        "low-conf 1, chapters 1 (source)  written on staging\n")


def test_textbook_row_payload(mini_books, monkeypatch):
    bodies = []
    db = FakeDB()

    def spy(method, path, body=None, prefer=None, target="staging"):
        if method == "POST":
            bodies.append((path.split("?")[0], body))
        return db(method, path, body, prefer, target)
    monkeypatch.setattr(ti, "_rest", spy)
    ci.main(["--all", "--corpus-local", str(MINI)])
    tb = dict(bodies)["/rest/v1/textbooks"][0]
    assert {k: tb[k] for k in ("province", "curriculum", "grade", "subject", "filename",
                               "total_pages", "pdf_page_offset")} == {
        "province": "federal", "curriculum": "ict", "grade": 7, "subject": "english",
        "filename": "A Made-Up Reader Grade 7", "total_pages": 2, "pdf_page_offset": 1}
    toc = dict(bodies)["/rest/v1/textbook_toc"][0]
    assert toc == {"textbook_id": "tb-1", "chapter_number": 1, "chapter_title": "Sample unit",
                   "page_start": 12, "page_end": 12, "curriculum": "ict", "grade": 7,
                   "subject": "english"}


def test_exact_rest_calls_verify(mini_books, monkeypatch, capsys):
    b = built()
    db = Recorder(meta=b["meta"], pages=[12, 11], toc=[1])
    assert run(["--all", "--verify", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    assert [c[1] for c in db.full] == [
        "/rest/v1/textbooks?select=id,meta&province=eq.federal&grade=eq.7&subject=eq.english",
        "/rest/v1/textbook_pages?select=textbook_page_number&textbook_id=eq.tb-1",
        "/rest/v1/textbook_toc?select=chapter_number&textbook_id=eq.tb-1"]
    assert capsys.readouterr().out == "grade 7 english: OK\n"


def test_verify_toc_and_hash_messages(mini_books, monkeypatch, capsys):
    db = FakeDB(meta={}, pages=[11, 12], toc=[1, 2])
    assert run(["--all", "--verify", "--corpus-local", str(MINI)], db, monkeypatch) == 1
    h = built()["meta"]["content_hash"][:12]
    assert capsys.readouterr().out == (
        f"grade 7 english: MISMATCH toc db=2 expected=1; MISMATCH content_hash db=absent expected={h}…\n")


def test_unchanged_message_exact(mini_books, monkeypatch, capsys):
    run(["--all", "--corpus-local", str(MINI)], FakeDB(meta=built()["meta"]), monkeypatch)
    assert capsys.readouterr().out.endswith("  unchanged on staging\n")


def test_gate_messages_exact(mini_books, monkeypatch, capsys):
    run(["--all", "--corpus-local", str(MINI)], FakeDB(gate=False), monkeypatch)
    assert capsys.readouterr().out == (
        "gate not deployed on staging: no assessment_grades_6_12 row in app_settings. Deploy the gate "
        "PR first (or, after checking it is live, pass --i-know-the-gate-is-live).\n")
    run(["--all", "--corpus-local", str(MINI), "--i-know-the-gate-is-live", "--target", "prod"],
        FakeDB(gate=False), monkeypatch)
    assert capsys.readouterr().out.startswith(
        "WARNING: no assessment_grades_6_12 row on prod; writing because "
        "--i-know-the-gate-is-live was passed\n")


def test_subject_refusal_message_exact(mini_books, monkeypatch, capsys):
    run(["--all", "--corpus-local", str(MINI)], FakeDB(subjects=()), monkeypatch)
    assert capsys.readouterr().out == (
        "grade 7 english (grade_7_example)  FAILED: subject english not in subjects on staging; "
        "add it first (never inserted here)\n")


@pytest.mark.parametrize("argv,msg", [
    (["--all", "--dry-run", "--verify"], "--dry-run and --verify cannot be combined"),
    (["--grade", "5"], "--source corpus takes --grade 6..12 (grades 1-5 use the default source)"),
    (["--grade", "6", "--subject", "Eng"], "--subject must be a registry code: biology, chemistry"),
    (["--dry-run"], "give --grade and/or --subject, or --all"),
    (["--all", "--verify"], "--verify needs --corpus-local (it recomputes the expected rows)"),
])
def test_usage_messages_exact(argv, msg, capsys):
    with pytest.raises(SystemExit):
        ci.main(argv)
    assert msg in capsys.readouterr().err


def test_grade_bounds_accept_6_and_12(mini_books, monkeypatch):
    for g in ("6", "12"):
        assert run(["--grade", g, "--dry-run", "--corpus-local", str(MINI)], FakeDB(), monkeypatch) == 0


def test_dry_run_default_local_corpus(mini_books, monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(ci, "DEFAULT_CORPUS", MINI)
    md = tmp_path / "r.md"
    assert run(["--all", "--dry-run", "--report-md", str(md)], FakeDB(), monkeypatch) == 0
    out = capsys.readouterr().out
    assert out.splitlines()[0] == "source=local-default"
    assert out.splitlines()[1] == (
        "grade 7 english <- grade_7_example: records 3, pages 2 (empty skipped 1), flagged 1, "
        "low-conf 1, chapters 1 (source)  -> would write (7, english)")
    assert md.read_text().startswith(f"Source: `{MINI}`. Books: 1. Records 3, pages written 2, "
                                     "empty skipped 1, flagged 1, low-confidence 1, poetry pages "
                                     "to review 0, chapters 1, ordinal-numbered books 0.\n\n| grade |")


def test_default_corpus_is_workspace_lp_build():
    assert ci.DEFAULT_CORPUS == HERE.parents[2] / "08_Grades 6-12 LP Build" / "languages" / "corpus"


def test_without_local_reads_r2(mini_books, monkeypatch, capsys):
    import corpus_reader as cr
    monkeypatch.setattr(ci, "DEFAULT_CORPUS", HERE / "absent")
    made = []
    monkeypatch.setattr(cr, "make_r2_client", lambda: made.append(1) or ("C", "bkt"))
    monkeypatch.setattr(cr, "read_r2", lambda stem, client, bucket: cr.read_local(MINI)[stem]
                        if (client, bucket) == ("C", "bkt") else None)
    assert run(["--all", "--dry-run"], FakeDB(), monkeypatch) == 0
    assert made == [1]
    assert "source=local-default" not in capsys.readouterr().out


def test_report_md_skipped_when_nothing_built(monkeypatch, tmp_path):
    monkeypatch.setattr(ci, "load_books_6_12", lambda path=None: {(8, "english"): "grade_8_none"})
    md = tmp_path / "r.md"
    run(["--all", "--dry-run", "--corpus-local", str(MINI), "--report-md", str(md)], FakeDB(), monkeypatch)
    assert not md.exists()
