"""Can Stage C ground every segment of a book? Run this before it tries.

`pageres` decides one segment. This asks the question a book at a time and
answers it as a table, because the answer that matters is not "this segment is
fine" but "these eleven are not, and here is why" — a number you want before
spending a generation run, not after.

The distinction the table turns on:

  `not-in-book` almost always means the page truth is INCOMPLETE — a download
  that stopped, not a corpus that disagrees. Re-fetch before reading anything
  into it.

  `chapter-mismatch`, `ambiguous` and `keys-disagree` are real. They do not
  appear because a page is missing; they appear because the two page keys
  point somewhere the segment's own chapter does not.

So a book is only meaningfully checked once every page it should hold is
here, and this prints that count beside every row rather than making the
reader remember it.

What "should hold" means was wrong until 18 Sep 2026. A ±3 tolerance stood in
for it, and it did two things wrong at once — it called twelve complete books
half-downloaded, and it would have swallowed a book genuinely three pages
short.

`total_pdf_pages` is the wrong number to compare against: it counts the WHOLE
pdf, and Stage A describes content pages only. It never wrote a file for the
cover, the imprint, the QR page or the contents, and on three books it stops
one page before the end for a back cover. Every book states both boundaries
itself, so neither has to be guessed:

  `content_span.pdf_first` is where the content starts. Every one of the
  seventeen books begins its page truth exactly there.

  The content ends at `content_span.pdf_last`, or at
  `pdf_last_confirmed_footer` where the describer would only vouch for the
  footer it could read, or — where the book says neither — at the last pdf
  page less anything named in `back_matter_pages`.

Measured across the whole fetched corpus that leaves exactly one book
unaccounted for: Grade 1 Urdu describes pdf 5-139 of 140 and declares no back
matter for the 140th. It is also the book carrying 16 chapter-mismatch flags,
so it is reported rather than tolerated.
"""
import collections
import json
import os

import pageres

HERE = os.path.dirname(os.path.abspath(__file__))
TRUTH = os.path.join(HERE, "corpus-local", "pagetruth")
SEG = os.path.join(HERE, "corpus", "seg")

# A missing page is a download problem; the rest are corpus problems. Kept
# apart so a half-fetched tree cannot read as a grounding failure.
INCOMPLETE = ("not-in-book",)


def load_pages(book_dir):
    """Every page-truth file in `book_dir`, in printed order where known.

    `_book.json` and `_toc.json` are metadata, not pages, and a `.part` file
    is a download still in flight — none of them are pages.
    """
    out = []
    for fn in sorted(os.listdir(book_dir)):
        if fn.startswith("_") or not fn.endswith(".json"):
            continue
        with open(os.path.join(book_dir, fn)) as fh:
            out.append(json.load(fh))
    return out


def content_range(book):
    """The pdf pages a book says are content: `(first, last)`, either may be None."""
    span = book.get("content_span") or {}
    first = span.get("pdf_first")
    if first is None:
        front = book.get("front_matter_pages")
        first = len(front) + 1 if front is not None else None

    last = span.get("pdf_last", span.get("pdf_last_confirmed_footer"))
    if last is None:
        total = book.get("total_pdf_pages")
        if total is not None:
            last = total - len(book.get("back_matter_pages") or [])
    return first, last


def expected_pages(book_dir):
    """How many pages Stage A should have described, or None if unknowable."""
    path = os.path.join(book_dir, "_book.json")
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        first, last = content_range(json.load(fh))
    if first is None or last is None:
        return None
    return last - first + 1


def missing_indices(pages):
    """pdf indices inside the described range that no page truth file covers.

    A book fetched short is short at the end and this will not see it — that
    is what the count is for. This sees the other shape: one page that failed
    while its neighbours landed, which a count only notices by accident.
    """
    got = sorted(p["pdf_page_index"] for p in pages
                 if p.get("pdf_page_index") is not None)
    if not got:
        return []
    return [n for n in range(got[0], got[-1] + 1) if n not in set(got)]


class Report(object):
    """One book's answer. `groundable` is the only field a gate needs."""

    def __init__(self, stem, n_pages, expected, segments, unresolved, reasons,
                 duplicated, gaps=()):
        self.stem = stem
        self.n_pages = n_pages
        self.expected = expected
        self.gaps = list(gaps)                 # described range, pages absent
        self.segments = segments
        self.unresolved = unresolved           # [(segment_index, [reasons])]
        self.reasons = reasons                 # Counter
        self.duplicated = duplicated           # printed numbers naming >1 page

    @property
    def complete(self):
        """Is the page truth all here? An incomplete book proves nothing.

        Exact. A book one page short of its own count is one page short, and
        Grade 1 Urdu — the only book in the corpus that is — is also the book
        carrying 16 chapter-mismatch flags. A tolerance would have hidden it.
        """
        if self.gaps:
            return False
        return self.expected is None or self.n_pages >= self.expected

    @property
    def real_faults(self):
        """Flags a re-download would not fix."""
        return sum(n for r, n in self.reasons.items() if r not in INCOMPLETE)

    @property
    def groundable(self):
        return self.complete and not self.unresolved

    def line(self):
        state = ("OK       " if self.groundable else
                 "INCOMPLETE" if not self.complete else "FAULTS   ")
        detail = ", ".join(f"{r}={n}" for r, n in sorted(self.reasons.items()))
        return (f"{self.stem:<26} {state} pages {self.n_pages:>4}"
                f"/{self.expected if self.expected else '?':<4}"
                f" segs {self.segments:>4}  unresolved {len(self.unresolved):>4}"
                f"  {detail}")


def check(stem, truth=TRUTH, seg=SEG):
    """Resolve every segment of one book against its page truth."""
    book_dir = os.path.join(truth, stem)
    pages = load_pages(book_dir)
    idx = pageres.index(pages)
    with open(os.path.join(seg, stem + ".json")) as fh:
        segments = json.load(fh)["segments"]

    reasons, unresolved = collections.Counter(), []
    for s in segments:
        r = pageres.resolve(s, idx)
        for f in r.flags:
            reasons[f["reason"]] += 1
        if not r.resolved:
            unresolved.append((s.get("segment_index"),
                               sorted({f["reason"] for f in r.flags})))
    return Report(stem, len(pages), expected_pages(book_dir), len(segments),
                  unresolved, reasons, idx.duplicated, missing_indices(pages))


def books(truth=TRUTH, seg=SEG):
    """Every book that has BOTH page truth and a segmentation file."""
    if not os.path.isdir(truth):
        return []
    return sorted(s for s in os.listdir(truth)
                  if os.path.isdir(os.path.join(truth, s))
                  and os.path.exists(os.path.join(seg, s + ".json")))


def main():
    reports = [check(s) for s in books()]
    for r in reports:
        print(r.line())
    faults = [r for r in reports if r.complete and r.unresolved]
    pending = [r for r in reports if not r.complete]
    print(f"\n{len(reports) - len(faults) - len(pending)} groundable, "
          f"{len(faults)} with faults, {len(pending)} still downloading")
    if pending:
        print("re-run fetchtruth.py:", ", ".join(r.stem for r in pending))
    return 1 if faults else 0


if __name__ == "__main__":
    raise SystemExit(main())
