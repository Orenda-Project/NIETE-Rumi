#!/usr/bin/env python3
"""
Read one G6–12 book from the held page-truth corpus and turn it into the rows the
textbook importer writes (contract 3: corpus-import.md §2–§6).

The text lives in two places that should agree:
    * R2, `lp612/page-truth/<stem>/pg_<NNN>.json`, one object per PRINTED page —
      the same objects the live grades 6–12 lesson-plan bot reads
      (`bot/shared/services/lp612-pagetruth.service.js`);
    * a local copy, `08_Grades 6-12 LP Build/languages/corpus/{pages,books}.jsonl`.
`--corpus-local <dir>` reads the local copy and never touches R2. Without it the
reader uses R2, and an R2 that cannot be configured or listed STOPS with an error
naming `--corpus-local`; it never falls back quietly, because the two can differ.

NORMALISATION IS NOT RE-IMPLEMENTED. Each corpus record is mapped to the importer's
input shape and handed to `textbook_import.normalise_pages`, so the row shape and
every repair rule (repeated pdf pages, duplicated printed numbers, empty pages
skipped) are byte-identical to what grades 1–5 shipped on.

WHAT THE CORPUS TAUGHT US (measured over 61 books, 2026-11-04)
    * Two Urdu books print one page number twice (`grade_12_urdu` 130–139,
      `grade_10_urdu` 33–36). R2 names a page by its printed number, so R2 can hold
      only one of each pair: those stems are LOCAL_ONLY until someone proves R2
      holds both copies. Locally, `normalise_pages` relabels the second copy by its
      pdf position (130 -> 140 …).
    * Anthologies number lessons from 1 in each part (G12 Urdu: prose, poetry,
      ghazal). A chapter is therefore a contiguous RUN of `(section, number)`, and
      a book whose run numbers are not unique integers gets 1-based ordinals —
      `textbook_toc` is read with `.eq('chapter_number', N).maybeSingle()`.
    * Figures are not imported (`page_images: []`).
    * R2 IS NOT A SOURCE TODAY (probed read-only over all 61 stems): its page
      objects are the raw page-truth stage — `blocks`, no flattened `text`, no
      `needs_human_review` — so `read_r2` fails on the first page by design.
      Import with `--corpus-local`. The R2 path stays for the day R2 holds records.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from textbook_import import clean_page_text, env, normalise_pages

R2_PREFIX = "lp612/page-truth"
R2_KEYS = ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME")
LOCAL_ONLY_STEMS = frozenset({"grade_10_urdu", "grade_12_urdu"})
EXCLUDED_STEMS = frozenset({"grade_9_10_chemistry_experiment"})   # DESIGN R25: practical book
REQUIRED_PAGE_KEYS = ("printed_page_number", "pdf_page_index", "text", "chapter",
                      "page_type", "confidence", "needs_human_review")
_PAGE_OBJECT = re.compile(r"^pg_(\d+)\.json$")
_POETRY = re.compile(r"poem|poetry|ghazal|nazm|verse|نظم|غزل|شعر", re.IGNORECASE)


class CorpusError(RuntimeError):
    """A book could not be read. The message names the stem or key, never a value."""


def assert_grade_6_12(grade) -> None:
    if not isinstance(grade, int) or isinstance(grade, bool) or not 6 <= grade <= 12:
        raise ValueError(f"corpus import writes grades 6-12 only, got {grade!r}")


# ── reading ──────────────────────────────────────────────────────────────────

def read_local(corpus_dir, stems=None) -> dict:
    """{stem: {"book": books.jsonl row or {}, "records": [...]}} in file order.
    One pass over pages.jsonl; the chemistry practical book is never kept."""
    corpus_dir = Path(corpus_dir)
    pages_path = corpus_dir / "pages.jsonl"
    if not pages_path.is_file():
        raise CorpusError(f"no pages.jsonl in {corpus_dir}")
    wanted = None if stems is None else set(stems)
    out: dict = {}
    with pages_path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            rec = json.loads(line)
            stem = rec.get("book_stem")
            if stem in EXCLUDED_STEMS or (wanted is not None and stem not in wanted):
                continue
            out.setdefault(stem, {"book": {}, "records": []})["records"].append(rec)
    books_path = corpus_dir / "books.jsonl"
    if books_path.is_file():
        for line in books_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                if row.get("book_stem") in out:
                    out[row["book_stem"]]["book"] = row
    return out


def make_r2_client():
    """(client, bucket) from the repo .env via the importer's own loader. Errors
    name the missing key and never carry a value."""
    values, missing = {}, []
    for key in R2_KEYS:
        try:
            values[key] = env(key)
        except (KeyError, OSError):
            missing.append(key)
    if missing:
        raise CorpusError(f"R2 not configured: {', '.join(missing)} missing from .env; "
                          f"pass --corpus-local <dir> to read the local corpus instead")
    try:
        import boto3  # lazy: a local run must not need it
    except ImportError:
        raise CorpusError("boto3 is not installed; pass --corpus-local <dir>") from None
    client = boto3.client("s3", endpoint_url=values["R2_ENDPOINT"],
                          aws_access_key_id=values["R2_ACCESS_KEY_ID"],
                          aws_secret_access_key=values["R2_SECRET_ACCESS_KEY"],
                          region_name="auto")
    return client, values["R2_BUCKET_NAME"]


def _r2_page_keys(client, bucket: str, prefix: str) -> list:
    keys, token = [], None
    while True:
        kw = {"Bucket": bucket, "Prefix": prefix}
        if token:
            kw["ContinuationToken"] = token
        resp = client.list_objects_v2(**kw)
        for obj in resp.get("Contents") or []:
            m = _PAGE_OBJECT.match(obj["Key"][len(prefix):])
            if m:
                keys.append((int(m.group(1)), obj["Key"]))
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return [k for _, k in sorted(keys)]


def _r2_json(client, bucket: str, key: str):
    return json.loads(client.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8"))


def read_r2(stem: str, *, client, bucket: str, local_count=None) -> dict:
    """The page objects of one stem from R2, in printed-page order. Fails loudly
    on a local-only stem, an empty listing, a page missing a key the importer
    needs, or fewer pages than the local copy holds."""
    if stem in EXCLUDED_STEMS:
        raise CorpusError(f"{stem} is never imported (practical book)")
    if stem in LOCAL_ONLY_STEMS:
        raise CorpusError(f"{stem} is local-only (R2 cannot hold its duplicate printed "
                          f"pages); pass --corpus-local <dir>")
    prefix = f"{R2_PREFIX}/{stem}/"
    try:
        keys = _r2_page_keys(client, bucket, prefix)
        if not keys:
            raise CorpusError(f"R2 lists no page objects under {prefix}; pass --corpus-local <dir>")
        records = [_r2_json(client, bucket, k) for k in keys]
        try:
            book = _r2_json(client, bucket, prefix + "_book.json")
        except Exception:
            book = {}
    except CorpusError:
        raise
    except Exception as e:  # a transport or auth error: name its type, not its text
        raise CorpusError(f"R2 read failed for {stem} ({type(e).__name__}); "
                          f"pass --corpus-local <dir>") from None
    for key, rec in zip(keys, records):
        absent = [k for k in REQUIRED_PAGE_KEYS if k not in rec]
        if absent:
            raise CorpusError(f"{key} lacks {', '.join(absent)}")
    if local_count is not None and len(records) < local_count:
        raise CorpusError(f"{stem}: R2 holds {len(records)} pages, local corpus {local_count}")
    return {"book": book, "records": records}


def load_book(stem: str, *, corpus_local=None, client_factory=make_r2_client,
              local_count=None) -> dict:
    if corpus_local is not None:
        got = read_local(corpus_local, {stem})
        if stem not in got:
            raise CorpusError(f"{stem} not in {corpus_local}/pages.jsonl")
        return got[stem]
    client, bucket = client_factory()
    return read_r2(stem, client=client, bucket=bucket, local_count=local_count)


# ── turning records into rows ────────────────────────────────────────────────

def to_importer_input(rec: dict) -> dict:
    return {"book_page_no": rec.get("printed_page_number"),
            "pdf_page_no": rec.get("pdf_page_index"),
            "text": rec.get("text") or "", "page_figures": []}


def section_key(section):
    """Whitespace collapsed, anything after the first spaced em dash removed:
    G12 Urdu carries an appendix note after the dash on some pages of a part."""
    if section is None:
        return None
    s = " ".join(str(section).split())
    return s.split(" — ", 1)[0].strip()


def _source_of(records: list):
    """A lookup from an emitted row back to its record: by pdf position (first
    copy, matching the importer's de-duplication), else by printed number."""
    by_pdf, by_printed = {}, {}
    for r in records:
        pdf = r.get("pdf_page_index")
        if pdf is not None:
            by_pdf.setdefault(pdf, r)
        else:
            by_printed.setdefault(r.get("printed_page_number"), r)

    def of(row):
        pdf = row["pdf_page_index"]
        return by_pdf.get(pdf) if pdf is not None else by_printed.get(row["textbook_page_number"])
    return of


def _is_int(n) -> bool:
    return isinstance(n, int) and not isinstance(n, bool)


def build_toc(rows: list, source_of) -> tuple:
    """(toc rows, numbering mode). A run is a maximal sequence of emitted rows
    with the same (section, number); a page with no chapter number ends it."""
    runs, current = [], None
    for row in rows:
        ch = (source_of(row) or {}).get("chapter") or {}
        number = ch.get("number")
        if number is None:
            current = None
            continue
        key = (section_key(ch.get("section")), number)
        page = row["textbook_page_number"]
        if current is not None and current["key"] == key:
            current["end"] = page
            continue
        current = {"key": key, "section": key[0], "number": number,
                   "title": ch.get("title"), "start": page, "end": page}
        runs.append(current)
    numbers = [r["number"] for r in runs]
    source = all(_is_int(n) for n in numbers) and len(set(numbers)) == len(numbers)
    toc = []
    for i, r in enumerate(runs, start=1):
        if source:
            title = r["title"] or r["section"] or f"pages {r['start']}-{r['end']}"
            number = r["number"]
        else:
            parts = [r["section"], str(r["number"]), r["title"]]
            title = " · ".join(p for p in parts if p)
            number = i
        toc.append({"chapter_number": number, "chapter_title": title,
                    "page_start": r["start"], "page_end": r["end"]})
    return toc, ("source" if source else "ordinal")


def content_hash(rows: list, toc: list) -> str:
    canon = json.dumps({"pages": rows, "toc": toc}, ensure_ascii=False,
                       sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def build_book(stem: str, records: list) -> dict:
    """{rows, toc, meta, report, offset} for one book. Pure: no I/O."""
    stats: dict = {}
    rows = normalise_pages([to_importer_input(r) for r in records], stats)
    if not rows:
        raise CorpusError(f"{stem} produced no usable pages")
    source_of = _source_of(records)
    toc, mode = build_toc(rows, source_of)
    sources = [source_of(r) or {} for r in rows]
    flagged = sum(1 for s in sources if s.get("needs_human_review") is True)
    low = sum(1 for s in sources if s.get("confidence") == "low")
    poetry_review = sum(
        1 for s in sources
        if _POETRY.search(f"{s.get('page_type') or ''} {(s.get('chapter') or {}).get('section') or ''}")
        and (s.get("needs_human_review") is True or s.get("confidence") in ("low", "medium")))
    numbers = [r["textbook_page_number"] for r in rows]
    meta = {"source": "corpus", "stem": stem, "pages_flagged": flagged,
            "pages_low_conf": low, "content_hash": content_hash(rows, toc)}
    report = {
        "stem": stem, "recs": len(records),
        "empty": sum(1 for r in records if not clean_page_text(r.get("text") or "")),
        "emit": len(rows), "flagged": flagged, "low": low, "poetry_review": poetry_review,
        "toc": len(toc), "numbering": mode,
        "page_range": (min(numbers), max(numbers)),
        "gaps": sorted(set(range(min(numbers), max(numbers) + 1)) - set(numbers)),
        "repeat_pdf_dropped": stats.get("repeat_pdf_dropped", 0),
        "relabelled": len(stats.get("relabelled") or []),
        "mislabelled_dropped": len(stats.get("mislabelled_dropped") or []),
    }
    return {"rows": rows, "toc": toc, "meta": meta, "report": report,
            "offset": stats.get("offset", 0)}
