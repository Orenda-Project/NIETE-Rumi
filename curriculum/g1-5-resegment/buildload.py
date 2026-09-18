"""Where the corpus comes from, and the per-subject arithmetic over it.

Split out of build.py, which had grown past the 300-line limit. The seam is
the natural one: this module knows the corpus and nothing about Sheets, so
it stays importable by a test without credentials. build.py re-exports
`load_corpus` and the paths, so anything that already says
`build.load_corpus()` keeps working.
"""
import glob
import os

import corpuscheck
import fde
import stageb

# The corpus lives in `corpus/` beside this file and is NOT committed: its
# licence is restricted-educational-internal, so page-truth, the pipeline
# intermediates and any rendered output stay local (see ../.gitignore). Point
# the env vars elsewhere to build from a corpus kept outside the repo.
HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.environ.get("CORPUS_DIR", os.path.join(HERE, "corpus"))

FDE_DIR = os.environ.get("FDE_DIR", os.path.join(CORPUS, "fde"))

SKILLSMAP_JSON = os.environ.get("SKILLSMAP_JSON",
                                os.path.join(CORPUS, "skillsmap.json"))

SEG_DIR = os.environ.get("SEG_DIR", os.path.join(CORPUS, "seg"))

# The order every tab is written in, and the order `all_rows` concatenates
# in. Science trails because it is G4-5 only.
SUBJECTS = ("English", "Urdu", "Maths", "Science")

TALLIED = ("days", "tails", "introduces", "overlapping")


def load_corpus():
    corpuscheck.require(SEG_DIR, FDE_DIR, SKILLSMAP_JSON)
    by_subject, runs, books, breaks = {}, [], [], {}
    for path in sorted(glob.glob(os.path.join(SEG_DIR, "grade_*.json"))):
        stem, grade, subject, meta, segments = stageb.load_book(path)
        rec = fde.load(FDE_DIR, stem)
        syllabus = set(rec["chapters"]) if rec else None
        rows, st = stageb.build_rows(stem, grade, subject, segments, syllabus)
        by_subject.setdefault(subject, []).append((grade, rows, st))
        runs.append((grade, subject, segments, syllabus))
        books.append((grade, subject, st, rows, rec))
        for w in (rec["weeks"] if rec else []):
            if w["kind"] == "break":
                breaks.setdefault(w["title"], []).append(stem)
    for subject in by_subject:
        by_subject[subject].sort(key=lambda t: t[0])
    order = {s: i for i, s in enumerate(SUBJECTS)}
    runs.sort(key=lambda t: (t[0], order[t[1]]))
    return by_subject, runs, books, breaks


def subject_totals(corpus):
    """Per-subject stats, every row in sheet order, and the grand total.

    `tails` is derived — rows minus teaching days — because a chapter tail
    is any row that is not a `Day N`. Nothing counts them separately, so the
    two figures can never disagree.
    """
    subject_stats, all_rows = [], []
    for subject in SUBJECTS:
        books = corpus.get(subject, [])
        days = sum(b[2]["days"] for b in books)
        rows_n = sum(b[2]["rows"] for b in books)
        subject_stats.append((subject, {
            "days": days, "tails": rows_n - days,
            "introduces": sum(b[2]["introduces"] for b in books),
            "overlapping": sum(b[2]["overlapping"] for b in books)}))
        for _, rows, _ in books:
            all_rows.extend(rows)
    total = {k: sum(s[1][k] for s in subject_stats) for k in TALLIED}
    return subject_stats, all_rows, total
