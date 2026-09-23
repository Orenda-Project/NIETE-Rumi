# -*- coding: utf-8 -*-
"""The SLO sentences, written once each, keyed by (code, sentence).

bd-960al. `Supporting SLO descriptions` held 200,018 characters across 907
cells: the same sentences copied down every day row that touches the SLO.
A sentence is the SLO's own property, not the day's, so it wants naming
once and referring to -- the same move `spinetab` makes for the Moves
column, and `tracelinks` for the traces.

The key is the PAIR and not the code, and that is the whole design
decision. 171 of the 1,229 distinct codes carry more than one sentence,
169 of them substantively different (bd-i0upq). A tab with one row per
code would have to choose a winner, and choosing would erase the
disagreement instead of surfacing it -- "dark stages stay dark" applied to
a curriculum defect. So a colliding code gets one row per sentence, each
row saying on its face how many spellings the code has, and the day row
links to the sentence that day actually carries.

Pure: builds rows and runs, talks to no sheet.
"""
import stagec

COLUMNS = ("SLO", "Subject", "Grade", "Sentence", "Days", "Note")
TITLE = u"SLO SENTENCES"
STANDFIRST = (u"One row per (SLO code, sentence). A code that carries more "
              u"than one sentence has a row for each and says so in Note -- "
              u"that is a curriculum defect to resolve (bd-i0upq), not a "
              u"duplicate to merge. The code columns on the subject tabs "
              u"link here.")

#: 1-based sheet row of the header, once `titled` has run.
HEAD_ROW = 3

#: The sentence is what a reader following a link came for.
ANCHOR_COL = "D"

WIDTHS = {0: 110, 1: 80, 2: 60, 3: 620, 4: 55, 5: 210}

#: How the day row's code cell separates its codes -- `stageb` writes it.
SEP = ", "

_NOTE = u"⚠ this code carries %d different sentences (bd-i0upq)"


def _key(pair):
    return (pair["code"], pair["sentence"])


def _grades(pair):
    return ", ".join(str(g) for g in sorted(set(pair.get("grades") or [])))


def _ordered(pairs):
    """The pairs in the order they go on the tab: by code, then sentence.

    Deduplicated on the pair, so a caller may hand over one entry per day
    row; `days` is taken from the first entry that carries it.
    """
    seen = {}
    for p in pairs:
        seen.setdefault(_key(p), p)
    return [seen[k] for k in sorted(seen)]


def rows(pairs):
    """Header plus one row per distinct (code, sentence)."""
    ordered = _ordered(pairs)
    spellings = {}
    for p in ordered:
        spellings[p["code"]] = spellings.get(p["code"], 0) + 1
    out = [list(COLUMNS)]
    for p in ordered:
        n = spellings[p["code"]]
        out.append([p["code"], p.get("subject", ""), _grades(p),
                    p["sentence"], p.get("days", 0),
                    _NOTE % n if n > 1 else ""])
    return out


def index(pairs):
    """{(code, sentence): offset into `rows(pairs)`}."""
    return dict((_key(p), n + 1) for n, p in enumerate(_ordered(pairs)))


def sheet_row(offset):
    """1-based sheet row of `rows()[offset]`, once `titled` has run."""
    return HEAD_ROW + offset


def code_cell(codes, uris):
    """The day row's code cell, each code a link to its sentence's row.

    The runs are located with a moving cursor rather than a plain search:
    `E-03-GR-1` is a substring of `E-03-GR-11`, so a search from the start
    of the cell would put the second code's link on the first -- the same
    aliasing that `pg 2` and `pg 23` have in the traces column.

    A code with no row is left unlinked. There is no sentence to point at,
    and a link to a near-miss row is worse than no link at all.
    """
    codes = [c for c in codes if c]
    if not codes:
        return None
    text, runs, cursor = SEP.join(codes), [], 0
    for code in codes:
        at = text.index(code, cursor)
        cursor = at + len(code)
        if code in uris:
            runs.append({"start": at, "end": cursor, "uri": uris[code]})
    return {"text": text, "runs": runs}


def collisions(pairs):
    """{code: [sentence, ...]} for every code that says more than one thing."""
    out = {}
    for p in _ordered(pairs):
        out.setdefault(p["code"], []).append(p["sentence"])
    return dict((k, v) for k, v in out.items() if len(v) > 1)


def write(svc, sheetio, sid, tab, pairs):
    """Write and format the tab. Returns the rows as they went out."""
    body = rows(pairs)
    values, head = sheetio.titled(body, TITLE, STANDFIRST)
    sheetio.write_values(svc, tab, values)
    sheetio.format_grid(svc, sid, len(values), len(COLUMNS), freeze_cols=1,
                        head_row=head, band=True, widths=WIDTHS, rows=values)
    return values


assert stagec.DOT  # the module is the neighbour this one is modelled on
