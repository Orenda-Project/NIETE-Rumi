#!/usr/bin/env python3
"""
Import a Taleemabad textbook — its pages, its chapters — into our own tables.

General on purpose: it knows how to read one book out of a Taleemabad tenant and
write it here, and nothing about why you want it. Callers supply the book list.
`scripts/assessment/import-ict-textbooks.py` is the one that knows about ICT.

WHERE THE TEXT LIVES
    fde_staging.book_library_book.book_text — a JSON array, one entry per scanned
    page: {book_page_no, pdf_page_no, text, page_figures?, page_type}.

    Note the tenant. The same books exist in fde_production under the same ids,
    but book_text is NULL there for every one of them: the OCR ran in staging and
    was never promoted. Reading production and finding nothing is not a permission
    problem and not a wrong id — it is the wrong tenant.

TWO PAGE NUMBERS, AND THEY DIFFER
    `book_page_no` is the number printed on the page — what a teacher means by
    "page 34". `pdf_page_no` is the position in the scan. They differ by the front
    matter: in English Grade 1, printed page 1 is PDF page 4. Both are kept; the
    teacher-facing paths use the printed one.

WHAT GETS REPAIRED
    The OCR text carries four mechanical defects, counted over English Grade 1's
    166 pages before writing any of this:
      * literal "\\n" — a backslash and an n, two characters, where a line break
        belongs (32 pages). Left alone, a page arrives as one run-on line and its
        paragraph structure is gone.
      * literal "\\t" (1 page) and real tabs (2 pages).
      * runs of three or more blank lines (2 pages).
    Everything else is left exactly as it is — in particular the "Object: ..."
    lines, which are the OCR describing an illustration. In a Grade 1 reader the
    pictures carry much of the meaning, so they are content.

WHAT IS SKIPPED
    Pages with no `book_page_no` are front matter — cover, QR page, contents.
    They have no printed number because they are not printed pages. The Urdu
    books number those same pages -2, -1, 0 and Science G5 numbers them 0; a
    number <= 0 is treated exactly like none.

WHAT THE 27 ICT BOOKS TAUGHT US (2026-09-02, bd-60012)
    Counted over every book before the full import; each rule below is tested
    in `test_textbook_import.py` with the smallest array that shows it.

    * A pdf page can appear twice. Islamiat G2/G3/G5 repeat a few pdf pages
      with identical text; Maths G4's array is two whole OCR runs of the same
      scan back to back (464 entries for a 232-page PDF). Our table has
      UNIQUE (textbook_id, pdf_page_index), so the first occurrence wins.
    * A printed number can be misread. English G2 reads pdf page 104 as "8",
      leaving 100 missing. Only pages whose number is a DUPLICATE are touched:
      the copy that disagrees with the book's dominant pdf→printed offset is
      moved to the number its position implies when that number is otherwise
      missing, and dropped when the implied number is <= 0 (GK G1's cover,
      copyright, foreword and contents all claim to be page 1 or 2). Unique
      numbers are never changed, even off-offset.
    * THE CHAPTER TABLE IS IN PDF POSITIONS, NOT PRINTED NUMBERS. In English
      G1 the chapter-4 opener is pdf page 41 (printed 38) and chapter 5 opens
      at pdf 54; chapter 1 "starts on page 4" in every book whose printed page
      1 is pdf page 4. Our bot reads page_start/page_end as printed numbers,
      so `chapters_to_printed` subtracts the offset and clamps to the printed
      range. The first import of English G1 stored the raw values and every
      chapter was three pages late.
    * `buffer_pages` on the book row is not a reliable offset (Maths G4 says 1,
      the pages say 4). The offset is measured from the pages themselves.
"""
from __future__ import annotations

import collections
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

import psycopg2

REPO = Path(__file__).resolve().parent.parent.parent
ENV = REPO / ".env"


# ── environment ──────────────────────────────────────────────────────────────

def env(key: str, default: str | None = None) -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    if default is not None:
        return default
    raise KeyError(f"{key} not in {ENV}")


# ── source ───────────────────────────────────────────────────────────────────

def source_connection():
    """Read-only connection to the Taleemabad tenant that actually has the OCR."""
    return psycopg2.connect(
        host=env("TALEEMABAD_STAGING_DB_HOST"),
        port=int(env("TALEEMABAD_STAGING_DB_PORT", "5432")),
        dbname=env("TALEEMABAD_STAGING_DB_NAME"),
        user=env("TALEEMABAD_STAGING_DB_USER"),
        password=env("TALEEMABAD_STAGING_DB_PASSWORD"),
        sslmode=env("TALEEMABAD_STAGING_DB_SSLMODE", "require"),
        connect_timeout=30,
    )


def fetch_book(conn, book_id: int, schema: str) -> dict:
    """The book row, its pages and its chapters, straight from the source."""
    cur = conn.cursor()
    cur.execute(
        f"SELECT title, book_text, buffer_pages FROM {schema}.book_library_book WHERE id = %s",
        (book_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise LookupError(f"book {book_id} not found in {schema}")
    title, book_text, buffer_pages = row
    if not isinstance(book_text, list):
        raise LookupError(
            f"book {book_id} ({title!r}) has no page array in {schema} — "
            f"book_text is {type(book_text).__name__}. Wrong tenant?"
        )

    cur.execute(
        f"""SELECT chapter_number, title, start_page, end_page
            FROM {schema}.book_library_bookchapter
            WHERE book_id = %s AND deleted_at IS NULL AND is_active
            ORDER BY chapter_number""",
        (book_id,),
    )
    chapters = [
        {"chapter_number": cn, "title": t, "start_page": sp, "end_page": ep}
        for cn, t, sp, ep in cur.fetchall()
    ]
    cur.close()
    return {"title": title, "pages": book_text, "chapters": chapters,
            "buffer_pages": buffer_pages}


# ── cleaning ─────────────────────────────────────────────────────────────────

# LaTeX that the OCR emitted instead of the arrow actually printed on the page.
# It shows up in match-the-columns exercises. Worth fixing here rather than
# downstream: the generator's own prompt carries a "DO NOT use LaTeX symbols
# (\\longleftrightarrow, \\rightarrow, \\to)" instruction, which is a rule written
# to fight this very text. Repair the input and the instruction has nothing to do.
_LATEX_ARROWS = {
    r"\longleftrightarrow": "↔", r"\leftrightarrow": "↔",
    r"\longrightarrow": "→", r"\rightarrow": "→", r"\to": "→",
    r"\longleftarrow": "←", r"\leftarrow": "←",
}


def clean_page_text(raw: str) -> str:
    """Undo the mechanical defects, and nothing else. No rewording and no dropping
    of content, so a page that was already clean comes back byte-identical."""
    if not raw:
        return ""
    text = raw

    # Double-encoded escapes. Decode \uXXXX by pattern rather than through
    # `unicode_escape`, which is latin-1 based and would mangle every Urdu book
    # that follows this one.
    text = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), text)
    # A bare \u with no hex digits behind it is a truncated escape, never valid.
    # Rare — two occurrences on one page of English Grade 1 — and a space is what
    # the sentence wants: "Pinky comes\uto\u play" reads as "comes to play".
    text = re.sub(r"\\u(?![0-9a-fA-F]{4})", " ", text)
    text = text.replace("\\n", "\n").replace("\\t", "\t")

    # Longest first, so \longleftrightarrow is not eaten by \leftarrow.
    for tex, char in sorted(_LATEX_ARROWS.items(), key=lambda kv: -len(kv[0])):
        text = text.replace(tex, char)

    text = text.replace("\t", " ")              # tabs → spaces
    text = re.sub(r"\n{3,}", "\n\n", text)      # runs of blank lines
    return text.strip()


def _is_printed(n) -> bool:
    return isinstance(n, int) and not isinstance(n, bool) and n > 0


def _dedupe_pdf_pages(pages: list[dict], stats: dict | None = None) -> list[dict]:
    """One entry per pdf page — the first one. A repeated pdf page is either an
    exact duplicate or a second OCR run of the same scan; either way the first
    is the one the rest of the array was built around."""
    seen, out, dropped = set(), [], 0
    for p in pages:
        k = p.get("pdf_page_no")
        if k is not None and k in seen:
            dropped += 1
            continue
        if k is not None:
            seen.add(k)
        out.append(p)
    if stats is not None:
        stats["repeat_pdf_dropped"] = dropped
    return out


def dominant_offset(pages: list[dict]) -> int:
    """pdf_page_no − book_page_no, as most of the book agrees it is. Printed
    page 1 is pdf page offset+1."""
    diffs = collections.Counter(
        p["pdf_page_no"] - p["book_page_no"]
        for p in _dedupe_pdf_pages(pages)
        if _is_printed(p.get("book_page_no")) and isinstance(p.get("pdf_page_no"), int)
    )
    return diffs.most_common(1)[0][0] if diffs else 0


def _resolve_duplicate_printed(pages: list[dict], offset: int,
                               stats: dict | None = None) -> list[tuple[int, dict]]:
    """(printed number, page) for every page that keeps a number. Unique numbers
    pass through untouched. Within a duplicate group the copy that agrees with
    the offset keeps the number (else the first copy does); each other copy is
    moved to the number its pdf position implies if that number is free and
    >= 1, otherwise dropped as mislabelled front matter."""
    groups: dict[int, list[dict]] = collections.defaultdict(list)
    for p in pages:
        groups[p["book_page_no"]].append(p)
    taken = set(groups)
    relabelled, dropped, out = [], [], []
    for n, group in groups.items():
        if len(group) == 1:
            out.append((n, group[0]))
            continue
        agreeing = [p for p in group if p.get("pdf_page_no") is not None
                    and p["pdf_page_no"] - n == offset]
        keeper = agreeing[0] if agreeing else group[0]
        out.append((n, keeper))
        for p in group:
            if p is keeper:
                continue
            pdf = p.get("pdf_page_no")
            implied = pdf - offset if pdf is not None else None
            if implied is not None and implied >= 1 and implied not in taken:
                taken.add(implied)
                relabelled.append((pdf, n, implied))
                out.append((implied, p))
            else:
                dropped.append((pdf, n))
    if stats is not None:
        stats["relabelled"] = sorted(relabelled)
        stats["mislabelled_dropped"] = sorted(dropped, key=lambda t: (t[0] is None, t[0]))
    return out


def normalise_pages(pages: list[dict], stats: dict | None = None) -> list[dict]:
    """Source page entries → our rows. Front matter (no printed page number, or
    one <= 0) is dropped; it is not a page of the book. Repeated pdf pages and
    duplicated printed numbers are resolved as the module docstring records.
    Pass `stats` to get the counts of what was done."""
    stats = stats if stats is not None else {}
    pages = _dedupe_pdf_pages(pages, stats)
    offset = dominant_offset(pages)
    stats["offset"] = offset

    numbered = []
    nonpositive = 0
    for p in pages:
        printed = p.get("book_page_no")
        if printed is None:
            continue
        if not _is_printed(printed):
            nonpositive += 1
            continue
        if not clean_page_text(p.get("text") or ""):
            continue
        numbered.append(p)
    stats["nonpositive_dropped"] = nonpositive

    out = []
    for printed, p in _resolve_duplicate_printed(numbered, offset, stats):
        content = clean_page_text(p.get("text") or "")
        figures = p.get("page_figures") or []
        out.append({
            "textbook_page_number": printed,
            "pdf_page_index": p.get("pdf_page_no"),
            "page_content": content,
            "page_images": figures if isinstance(figures, list) else [],
            "content_length": len(content),
        })
    out.sort(key=lambda r: r["textbook_page_number"])
    return out


def chapters_to_printed(chapters: list[dict], *, offset: int, max_printed: int) -> list[dict]:
    """Source chapter ranges are pdf positions; ours are printed numbers. Subtract
    the offset and clamp to [1, max_printed]. `clamped` marks a range the source
    had running off either end of the printed pages; `empty` marks one with no
    pages left (a missing bound, or end before start — GK G3 lists chapter 1 as
    0-0) and the caller leaves those out; `source_*` keep the raw values for the
    report."""
    out = []
    for c in chapters:
        sp, ep = c.get("start_page"), c.get("end_page")
        ns = max(1, sp - offset) if sp is not None else None
        ne = min(max_printed, ep - offset) if ep is not None else None
        clamped = (sp is not None and ns != sp - offset) or (ep is not None and ne != ep - offset)
        empty = ns is None or ne is None or ne < ns
        out.append({**c, "start_page": ns, "end_page": ne, "clamped": clamped, "empty": empty,
                    "source_start_page": sp, "source_end_page": ep})
    return out


# ── destination ──────────────────────────────────────────────────────────────

# Which database a run writes to is never inferred from whichever .env happened
# to load. "staging" is the default everywhere below; reaching production takes
# passing --target prod on purpose.
TARGETS = {
    "staging": ("STAGING_SUPABASE_URL", "STAGING_SUPABASE_SERVICE_ROLE_KEY"),
    "prod":    ("SUPABASE_URL",         "SUPABASE_SERVICE_ROLE_KEY"),
}


def _rest(method: str, path: str, body=None, prefer: str | None = None,
          target: str = "staging"):
    url_key, key_key = TARGETS[target]
    url = env(url_key).rstrip("/") + path
    headers = {
        "apikey": env(key_key),
        "Authorization": "Bearer " + env(key_key),
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read()
            return json.loads(payload) if payload else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code} {e.read().decode()[:400]}")


def upsert_textbook(*, province: str, curriculum: str, grade: int, subject: str,
                    filename: str, total_pages: int, pdf_page_offset: int,
                    target: str = "staging") -> str:
    """One row per (province, grade, subject). Returns its id."""
    _rest("POST", "/rest/v1/textbooks?on_conflict=province,grade,subject",
          [{
              "province": province, "curriculum": curriculum,
              "grade": grade, "subject": subject, "filename": filename,
              "total_pages": total_pages, "pdf_page_offset": pdf_page_offset,
              "ocr_status": "completed", "ocr_completed_at": "now()",
          }],
          prefer="resolution=merge-duplicates,return=minimal", target=target)
    found = _rest("GET", f"/rest/v1/textbooks?select=id&province=eq.{province}"
                         f"&grade=eq.{grade}&subject=eq.{subject}", target=target)
    return found[0]["id"]


def replace_pages(textbook_id: str, rows: list[dict], target: str = "staging") -> int:
    """Pages are a full replacement: a re-import of a re-OCR'd book should not
    leave orphans from the previous run behind."""
    _rest("DELETE", f"/rest/v1/textbook_pages?textbook_id=eq.{textbook_id}",
          prefer="return=minimal", target=target)
    payload = [dict(r, textbook_id=textbook_id) for r in rows]
    for i in range(0, len(payload), 250):
        _rest("POST", "/rest/v1/textbook_pages", payload[i:i + 250],
              prefer="return=minimal", target=target)
    return len(payload)


def replace_chapters(textbook_id: str, chapters: list[dict], *,
                     curriculum: str, grade: int, subject: str,
                     target: str = "staging") -> int:
    _rest("DELETE", f"/rest/v1/textbook_toc?textbook_id=eq.{textbook_id}",
          prefer="return=minimal", target=target)
    payload = [{
        "textbook_id": textbook_id,
        "chapter_number": c["chapter_number"],
        "chapter_title": c["title"],
        "page_start": c["start_page"],
        "page_end": c["end_page"],
        "curriculum": curriculum, "grade": grade, "subject": subject,
    } for c in chapters]
    if payload:
        _rest("POST", "/rest/v1/textbook_toc", payload, prefer="return=minimal", target=target)
    return len(payload)


# ── the operation ────────────────────────────────────────────────────────────

def import_book(*, book_id: int, province: str, curriculum: str, grade: int,
                subject: str, schema: str, dry_run: bool = False,
                target: str = "staging") -> dict:
    """Fetch one book, repair it, write it. Returns a report worth reading."""
    with source_connection() as conn:
        src = fetch_book(conn, book_id, schema)

    stats: dict = {}
    pages = normalise_pages(src["pages"], stats)
    if not pages:
        raise LookupError(f"book {book_id} produced no usable pages")

    numbers = [p["textbook_page_number"] for p in pages]
    offset = stats["offset"]
    converted = chapters_to_printed(src["chapters"], offset=offset, max_printed=max(numbers))
    chapters = [c for c in converted if not c["empty"]]
    last_end = max((c["end_page"] for c in chapters if c["end_page"] is not None), default=None)
    report = {
        "book_id": book_id, "title": src["title"],
        "grade": grade, "subject": subject,
        "source_pages": len(src["pages"]),
        "front_matter_skipped": len(src["pages"]) - len(pages),
        "pages": len(pages),
        "page_range": (min(numbers), max(numbers)),
        "gaps": sorted(set(range(min(numbers), max(numbers) + 1)) - set(numbers)),
        "chars": sum(p["content_length"] for p in pages),
        "pages_with_figures": sum(1 for p in pages if p["page_images"]),
        "chapters": len(chapters),
        "pdf_page_offset": offset,
        "buffer_pages": src["buffer_pages"],
        "repeat_pdf_dropped": stats["repeat_pdf_dropped"],
        "nonpositive_dropped": stats["nonpositive_dropped"],
        "relabelled": stats["relabelled"],
        "mislabelled_dropped": stats["mislabelled_dropped"],
        "chapters_clamped": [(c["chapter_number"], c["source_start_page"], c["source_end_page"],
                              c["start_page"], c["end_page"]) for c in chapters if c["clamped"]],
        "chapters_dropped": [(c["chapter_number"], c["source_start_page"], c["source_end_page"])
                             for c in converted if c["empty"]],
        "pages_after_last_chapter": (max(numbers) - last_end) if last_end is not None else None,
        "target": target,
        "written": False,
    }
    if dry_run:
        return report

    textbook_id = upsert_textbook(
        province=province, curriculum=curriculum, grade=grade, subject=subject,
        filename=src["title"], total_pages=len(pages),
        pdf_page_offset=offset, target=target,
    )
    report["textbook_id"] = textbook_id
    report["pages_written"] = replace_pages(textbook_id, pages, target=target)
    report["chapters_written"] = replace_chapters(
        textbook_id, chapters, curriculum=curriculum, grade=grade,
        subject=subject, target=target)
    report["written"] = True
    return report
