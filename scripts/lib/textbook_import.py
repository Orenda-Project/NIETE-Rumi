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
    They have no printed number because they are not printed pages.
"""
from __future__ import annotations

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


def normalise_pages(pages: list[dict]) -> list[dict]:
    """Source page entries → our rows. Front matter (no printed page number) is
    dropped; it is not a page of the book."""
    out = []
    for p in pages:
        printed = p.get("book_page_no")
        if printed is None:
            continue
        content = clean_page_text(p.get("text") or "")
        if not content:
            continue
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

    pages = normalise_pages(src["pages"])
    if not pages:
        raise LookupError(f"book {book_id} produced no usable pages")

    numbers = [p["textbook_page_number"] for p in pages]
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
        "chapters": len(src["chapters"]),
        "pdf_page_offset": src["buffer_pages"],
        "target": target,
        "written": False,
    }
    if dry_run:
        return report

    textbook_id = upsert_textbook(
        province=province, curriculum=curriculum, grade=grade, subject=subject,
        filename=src["title"], total_pages=len(pages),
        pdf_page_offset=src["buffer_pages"] or 0, target=target,
    )
    report["textbook_id"] = textbook_id
    report["pages_written"] = replace_pages(textbook_id, pages, target=target)
    report["chapters_written"] = replace_chapters(
        textbook_id, src["chapters"], curriculum=curriculum, grade=grade,
        subject=subject, target=target)
    report["written"] = True
    return report
