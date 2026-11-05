"""
Red-first tests for the corpus path of the ICT textbook importer (contract 3,
corpus-import.md §1, §5, §7, §8; T10, T12–T17).

    python3 -m pytest scripts/assessment/test_import_corpus_cli.py -q

The database is a fake `_rest`; nothing here opens a connection. Fixtures are
the fictional three-page book in scripts/lib/fixtures/corpus_mini.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import corpus_import as ci  # noqa: E402
sys.path.insert(0, str(HERE.parent / "lib"))
import textbook_import as ti  # noqa: E402

MINI = HERE.parent / "lib" / "fixtures" / "corpus_mini"
STEM = "grade_7_example"


def load_cli():
    spec = importlib.util.spec_from_file_location("ict_cli", HERE / "import-ict-textbooks.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mini_books(monkeypatch):
    """Point the map at the fictional book: (7, 'english') -> grade_7_example."""
    monkeypatch.setattr(ci, "load_books_6_12", lambda path=None: {(7, "english"): STEM})


class FakeDB:
    """Answers the REST calls the importer makes; records every call."""

    def __init__(self, gate=True, subjects=("english",), meta=None, pages=None, toc=None):
        self.gate, self.subjects, self.meta = gate, set(subjects), meta
        self.pages, self.toc = pages, toc
        self.calls = []

    def __call__(self, method, path, body=None, prefer=None, target="staging"):
        self.calls.append((method, path.split("?")[0], target))
        if path.startswith("/rest/v1/app_settings"):
            return [{"key": "assessment_grades_6_12"}] if self.gate else []
        if path.startswith("/rest/v1/subjects"):
            code = path.split("code=eq.")[1]
            return [{"code": code}] if code in self.subjects else []
        if method == "GET" and path.startswith("/rest/v1/textbooks"):
            if self.meta is None and not any(c[0] == "POST" and c[1] == "/rest/v1/textbooks"
                                             for c in self.calls):
                return []
            return [{"id": "tb-1", "meta": self.meta or {}}]
        if method == "GET" and path.startswith("/rest/v1/textbook_pages"):
            return [{"textbook_page_number": n} for n in (self.pages or [])]
        if method == "GET" and path.startswith("/rest/v1/textbook_toc"):
            return [{"chapter_number": n} for n in (self.toc or [])]
        return None

    def writes(self):
        return [c for c in self.calls if c[0] in ("POST", "PATCH", "DELETE")]


def run(argv, db, monkeypatch):
    monkeypatch.setattr(ti, "_rest", db)
    return ci.main(argv)


def built():
    import corpus_reader as cr
    return cr.build_book(STEM, cr.read_local(MINI)[STEM]["records"])


# ── T10: the map ─────────────────────────────────────────────────────────────

def test_registry_map_61_entries_codes_and_stems():
    books = ci.load_books_6_12()
    assert len(books) == 61
    assert all(6 <= g <= 12 for g, _ in books)
    assert "grade_9_10_chemistry_experiment" not in books.values()
    cli = load_cli()
    assert not set(books) & set(cli.BOOKS)
    assert books[(6, "general_science")] == "grade_6_general_science"
    assert books[(10, "pakistan_studies_ur")] == "grade_10_pak_studies_urdu"
    assert books[(12, "pakistan_studies")] == "grade_12_pak_studies_english"
    assert {c for _, c in books} == {
        "biology", "chemistry", "computer_science", "english", "general_science", "geography",
        "history", "islamiat", "maths", "pakistan_studies", "pakistan_studies_ur", "physics",
        "urdu", "zarai_taleem"}


def test_map_rejects_grade_5_row(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"books": [{"grade": 5, "code": "english", "book_stem": "x"}]}))
    with pytest.raises(ValueError):
        ci.load_books_6_12(p)


# ── T12 / T13: G1–5 untouched; usage errors ──────────────────────────────────

def test_g1_5_path_byte_identical(capsys, monkeypatch):
    cli = load_cli()
    assert cli.main(["--list"]) == 0
    assert capsys.readouterr().out == (HERE / "fixtures" / "g1_5_list.txt").read_text()
    calls = []
    monkeypatch.setattr(cli, "import_book", lambda **kw: calls.append(kw) or (_ for _ in ()).throw(
        RuntimeError("stop")))
    assert cli.main(["--all", "--dry-run"]) == 1
    assert len(calls) == 27
    assert all(c["schema"] == "fde_staging" and c["grade"] <= 5 for c in calls)


def test_all_without_source_is_g1_5_only(monkeypatch):
    cli = load_cli()
    seen = []
    monkeypatch.setattr(cli, "import_book", lambda **kw: seen.append(kw["grade"]) or (_ for _ in ()).throw(
        RuntimeError("stop")))
    monkeypatch.setattr(ci, "main", lambda argv: pytest.fail("corpus path reached"))
    cli.main(["--all", "--dry-run"])
    assert max(seen) == 5


def test_source_corpus_dispatches(monkeypatch):
    cli = load_cli()
    got = []
    monkeypatch.setattr(ci, "main", lambda argv: got.append(argv) or 0)
    assert cli.main(["--source", "corpus", "--grade", "7", "--dry-run"]) == 0
    assert got == [["--grade", "7", "--dry-run"]]


@pytest.mark.parametrize("argv", [
    ["--grade", "5", "--subject", "english", "--dry-run"],
    ["--grade", "13", "--dry-run"],
    ["--subject", "Eng", "--dry-run"],
    ["--dry-run"],
    ["--all", "--dry-run", "--verify"],
    ["--all", "--verify"],
])
def test_source_corpus_usage_errors(argv, monkeypatch):
    with pytest.raises(SystemExit) as e:
        run(argv, FakeDB(), monkeypatch)
    assert e.value.code == 2


# ── T14: N1 ordering rule; dry run needs no DB ───────────────────────────────

def test_refuses_when_gate_row_absent(mini_books, monkeypatch, capsys):
    db = FakeDB(gate=False)
    assert run(["--all", "--corpus-local", str(MINI)], db, monkeypatch) == 1
    assert "gate not deployed on staging" in capsys.readouterr().out
    assert db.writes() == []


def test_gate_override_flag_allows_write(mini_books, monkeypatch, capsys):
    db = FakeDB(gate=False)
    assert run(["--all", "--corpus-local", str(MINI), "--i-know-the-gate-is-live"], db, monkeypatch) == 0
    assert "WARNING" in capsys.readouterr().out
    assert db.writes()


def test_dry_run_needs_no_db(mini_books, monkeypatch, capsys):
    db = FakeDB()
    assert run(["--all", "--dry-run", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    assert db.calls == []
    out = capsys.readouterr().out
    assert "grade 7 english" in out and "pages 2" in out


def test_dry_run_report_markdown(mini_books, monkeypatch, tmp_path):
    md = tmp_path / "r.md"
    run(["--all", "--dry-run", "--corpus-local", str(MINI), "--report-md", str(md)], FakeDB(), monkeypatch)
    text = md.read_text()
    assert "| 7 | english | `grade_7_example` | 3 | 2 |" in text
    assert "Sample" not in text and "Alpha" not in text      # counts only, never page text


# ── T15: idempotency ─────────────────────────────────────────────────────────

def test_first_import_writes_pages_toc_then_meta_last(mini_books, monkeypatch):
    db = FakeDB()
    assert run(["--all", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    w = [(m, p) for m, p, _ in db.writes()]
    assert w[0] == ("POST", "/rest/v1/textbooks")
    assert ("DELETE", "/rest/v1/textbook_pages") in w and ("POST", "/rest/v1/textbook_toc") in w
    assert w[-1] == ("PATCH", "/rest/v1/textbooks")


def test_meta_payload(mini_books, monkeypatch):
    sent = []
    db = FakeDB()

    def spy(method, path, body=None, prefer=None, target="staging"):
        if method == "PATCH":
            sent.append(body)
        return db(method, path, body, prefer, target)
    monkeypatch.setattr(ti, "_rest", spy)
    assert ci.main(["--all", "--corpus-local", str(MINI)]) == 0
    assert sent == [{"meta": built()["meta"]}]


def test_unchanged_hash_skips_writes(mini_books, monkeypatch, capsys):
    db = FakeDB(meta=built()["meta"])
    assert run(["--all", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    assert db.writes() == []
    assert "unchanged" in capsys.readouterr().out


def test_changed_hash_replaces_pages_and_toc(mini_books, monkeypatch):
    db = FakeDB(meta={"content_hash": "old"})
    assert run(["--all", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    paths = [(m, p) for m, p, _ in db.writes()]
    assert ("DELETE", "/rest/v1/textbook_pages") in paths
    assert ("DELETE", "/rest/v1/textbook_toc") in paths


def test_force_rewrites(mini_books, monkeypatch):
    db = FakeDB(meta=built()["meta"])
    assert run(["--all", "--corpus-local", str(MINI), "--force"], db, monkeypatch) == 0
    assert db.writes()


def test_target_is_passed_through(mini_books, monkeypatch):
    db = FakeDB()
    run(["--all", "--corpus-local", str(MINI), "--target", "prod"], db, monkeypatch)
    assert {t for _, _, t in db.calls} == {"prod"}


# ── T16: verify ──────────────────────────────────────────────────────────────

def test_verify_ok_is_select_only(mini_books, monkeypatch, capsys):
    b = built()
    db = FakeDB(meta=b["meta"], pages=[r["textbook_page_number"] for r in b["rows"]],
                toc=[t["chapter_number"] for t in b["toc"]])
    assert run(["--all", "--verify", "--corpus-local", str(MINI)], db, monkeypatch) == 0
    assert {m for m, _, _ in db.calls} == {"GET"}
    assert "OK" in capsys.readouterr().out


def test_verify_flags_mismatch(mini_books, monkeypatch, capsys):
    b = built()
    db = FakeDB(meta={"content_hash": "x"}, pages=[1], toc=[t["chapter_number"] for t in b["toc"]])
    assert run(["--all", "--verify", "--corpus-local", str(MINI)], db, monkeypatch) == 1
    out = capsys.readouterr().out
    assert "MISMATCH pages db=1 expected=2" in out and "MISMATCH content_hash" in out
    assert db.writes() == []


def test_verify_missing_book(mini_books, monkeypatch, capsys):
    assert run(["--all", "--verify", "--corpus-local", str(MINI)], FakeDB(), monkeypatch) == 1
    assert "MISMATCH textbook absent" in capsys.readouterr().out


# ── T17: unknown subject code ────────────────────────────────────────────────

def test_unknown_subject_code_refused(mini_books, monkeypatch, capsys):
    db = FakeDB(subjects=())
    assert run(["--all", "--corpus-local", str(MINI)], db, monkeypatch) == 1
    assert "subject english not in subjects" in capsys.readouterr().out
    assert db.writes() == []


def test_one_failure_does_not_stop_the_run(monkeypatch, capsys):
    monkeypatch.setattr(ci, "load_books_6_12",
                        lambda path=None: {(7, "english"): STEM, (8, "english"): "grade_8_none"})
    db = FakeDB()
    assert run(["--all", "--dry-run", "--corpus-local", str(MINI)], db, monkeypatch) == 1
    out = capsys.readouterr().out
    assert "FAILED" in out and "grade 7 english" in out


def test_filter_by_grade_and_subject(monkeypatch):
    books = {(7, "english"): "a", (7, "urdu"): "b", (8, "english"): "c"}
    assert ci.select(books, 7, None, False) == [(7, "english"), (7, "urdu")]
    assert ci.select(books, None, "english", False) == [(7, "english"), (8, "english")]
    assert ci.select(books, 7, "urdu", False) == [(7, "urdu")]
    assert ci.select(books, None, None, True) == sorted(books)
