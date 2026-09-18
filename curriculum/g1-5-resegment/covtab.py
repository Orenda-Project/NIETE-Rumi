"""Coverage — what the year teaches, and what it misses, as a picture.

Two tabs, because three differently shaped tables under one frozen header row
told the reader the wrong thing about two of them. `Coverage Map` = the mix
bars and the chapter grid; `Coverage — gaps` = the two work lists.

Bars are block characters, not charts: a chart floats and breaks on rebuild.

Both tabs are drawn from ONE tally, and the tally is the only thing in this
file that has nothing to do with columns, so it lives in `covdata` — see the
same split at caltab/calfmt and skillmap/skillgrid. This file is layout: rows
and a plan. `covfmt` paints the plan, and is never imported from here.

COLUMN CONTRACT. Every block on a tab shares one set of widths AND fills every
column it shares, so no wide column sits empty down a block.

FROZEN COLUMNS ARE DELIBERATELY OFF on both tabs: `OVERFLOW_CELL` cannot cross
a frozen-column boundary and every banner starts in column A. Both tabs are
under 1200px anyway, so a column freeze buys nothing, and dropping it is what
lets the banners be merged and wrapped — merging and freezing are exclusive.
"""
import covdata
import skillgrid
import skills

BLOCK, HALF = "█", "▌"
# Coverage Map: 0 Grade · 1 Subject · 2 Skill type/Chapter · 3 Days/Ch., then
# 52px cols — mix: Share + bar (overflowing right); grid: one per skill code.
GRADE_C, SUBJ_C, TEXT_C, NUM_C, SHARE_C, BAR_C = 0, 1, 2, 3, 4, 5
SKILL_C, NARROW = 4, 52
COV_W = {GRADE_C: 64, SUBJ_C: 110, TEXT_C: 230, NUM_C: 52}
# Coverage — gaps: four number columns both blocks fill, then two text columns.
GAP_COLS = 9
GAP_W = {0: 64, 1: 110, 2: 52, 3: 56, 4: 56, 5: 56, 6: 64, 7: 300, 8: 420}
N1, N2, N3, N4, WIDE_C, LIST_C = 3, 4, 5, 6, 7, 8

TITLE = "COVERAGE MAP — what the year teaches"
SUB = ("Read the bars for balance and the grid for holes. Counts are teaching "
       "days; revision, assessment and chapter review get their own line per "
       "book so the mix is not flattered by them. Each bar is scaled within "
       "its own subject — same length across subjects is not the same thing.")
GRID_NOTE = ("A blank cell is a chapter that never teaches that skill; a "
             "blank column is a book that never teaches it. Darker = more.")
# Three rows of the mix count zero and are not gaps — Communicative language
# in English and in Urdu, Number fluency in Maths. The Teaching Calendar
# teaches them in basics periods, which sit outside the textbook days this tab
# counts, so a dash there is an accounting boundary and not a finding. The tab
# says so on the row itself, because this is the tab that goes to FDE and an
# unexplained dash beside a 0% share gets reported as a hole in the year.
# `skillgrid` names the set for the Skills Map and both tabs read that one
# set: two tabs disagreeing about which zero is innocent is the failure here.
BASICS_WHERE = ("taught in basics periods the Teaching Calendar allocates "
                "outside these textbook days")
BASICS_NOTE = f"not a gap — {BASICS_WHERE}"
GAP_TITLE = "COVERAGE — GAPS — what the year misses"
GAP_SUB = ("Two work lists. Above: chapters that never teach a skill their "
           "subject is supposed to carry every chapter. Below: SLOs the book "
           "names and no day ever introduces — the costliest late surprise.")
SLO_BAND = "SLO COVERAGE — does every SLO get a day that introduces it?"
SLO_NOTE = ("SLOs = codes the book names  ·  Intro = SLOs with an introducing "
            "day  ·  Never = named but never introduced  ·  Per SLO = days.")


def bar(n, scale, width=20):
    """n days as block characters, half a block for the remainder."""
    units = n * width * 2 // scale if n > 0 and scale > 0 else 0
    return BLOCK * (units // 2) + (HALF if units % 2 else "")


def _basics_note(key):
    """The sentence a basics skill's empty row carries, or nothing."""
    return BASICS_NOTE if key in skillgrid.BASICS else ""


def grid_note(keys, subject):
    """The chapter grid's note, plus the basics exception when the grid shows
    one. Here it matters more than in the mix: the grid's empty cells are
    RINGED, so a basics column arrives as one red hole per chapter."""
    basics = [skills.label(k, subject) for k in keys if k in skillgrid.BASICS]
    if not basics:
        return GRID_NOTE
    return (f"{GRID_NOTE} {' and '.join(basics)} "
            f"{'is' if len(basics) == 1 else 'are'} the exception: "
            f"{BASICS_WHERE}, so an empty column there is not a gap.")


def _row(n, *pairs):
    line = [""] * n
    for col, value in pairs:
        line[col] = value
    return line


def _plan(n_cols, widths, wrap):
    return {"n_cols": n_cols, "widths": widths, "wrap_cols": wrap,
            "freeze_rows": 3, "title_row": 0, "note_rows": [1],
            "band_rows": [], "head_rows": [], "row_heights": [], "tint": [],
            "bars": [], "cells": [], "flags": [], "filters": [],
            "overflow": []}


def _block(plan, out, rows, name, basic, px):
    """Register a block's header row, filter range and data row height."""
    plan["head_rows"].append(len(out))
    plan["filters"].append((name, len(out), len(out) + len(rows), 0,
                            plan["n_cols"], basic))
    plan["row_heights"].append((len(out) + 1, len(out) + len(rows), px))


def _section(plan, out, band, note):
    """A coral section band and the cream note row that unpacks it."""
    for row, key in ((band, "band_rows"), (note, "note_rows")):
        out.append(_row(plan["n_cols"], (0, row)))
        plan[key].append(len(out) - 1)


def _mix(prepared, plan, base):
    """One filterable table: grade x skill type, every subject at once."""
    n = plan["n_cols"]
    rows = [_row(n, *enumerate(
        ["Grade", "Subject", "Skill type", "Days", "Share",
         "Of the year — bar scaled within its own subject"]))]
    for subject, (books, keys, extra, counted) in prepared.items():
        scale = max([counted[g][0].get(k, 0) for g in counted
                     for k in keys] + [1])
        for grade, _r, _st in books:
            per, _by, admin = counted[grade]
            total = sum(per.get(k, 0) for k in keys) or 1
            for key in keys:
                days, at = per.get(key, 0), base + len(rows)
                hexcode = skills.colour(skills.canonical(key, subject))
                plan["tint"].append((at, TEXT_C, hexcode))
                # A basics skill with no textbook day spends the bar's lane
                # saying where it IS taught, and is flagged like the
                # bookkeeping line below: a row carrying a sentence is not a
                # bar of length zero. Tag a basics day in the corpus and it
                # is a textbook day like any other — count it, drop the note.
                note = "" if days else _basics_note(key)
                if days:
                    plan["bars"].append((at, BAR_C, hexcode))
                if key in extra or note:
                    plan["flags"].append((at, TEXT_C))
                rows.append(_row(
                    n, (GRADE_C, f"G{grade}"), (SUBJ_C, subject),
                    (TEXT_C, skills.label(key, subject) +
                     ("  ⚠ not in the taxonomy" if key in extra else "")),
                    # Zero days is a dash, not a blank, so it reads the same
                    # as the Share beside it. The heat grid below keeps its
                    # blanks — there a blank is the signal.
                    (NUM_C, days or "—"),
                    (SHARE_C, f"{100 * days / total:.0f}%" if days else "—"),
                    (BAR_C, note or bar(days, scale))))
            plan["flags"].append((base + len(rows), TEXT_C))
            # Share stays a dash: only the bar column overflows on these rows,
            # so the sentence goes there and the 52px Share column does not
            # try to hold it and lose half of it to the clip.
            rows.append(_row(n, (GRADE_C, f"G{grade}"), (SUBJ_C, subject),
                             (TEXT_C, "Revision, assessment & review"),
                             (NUM_C, admin or "—"), (SHARE_C, "—"),
                             (BAR_C, "not counted in the mix above")))
    return rows


def _grid(subject, books, keys, counted, plan, base):
    """Chapters down, skill types across, days in the cells."""
    n = plan["n_cols"]
    rows = [_row(n, (GRADE_C, "Grade"), (SUBJ_C, "Subject"),
                 (TEXT_C, "Chapter"), (NUM_C, "Ch."),
                 *[(SKILL_C + i, skills.code(k, subject))
                   for i, k in enumerate(keys)])]
    for grade, book, _st in books:
        titles = {r["chapter"]: r["chapter_title"] for r in book
                  if r["chapter"] is not None}
        _per, by_chapter, _admin = counted[grade]
        for ch in sorted(by_chapter):
            got, at = by_chapter[ch], base + len(rows)
            plan["cells"] += [(at, SKILL_C + i, got.get(k, 0))
                              for i, k in enumerate(keys)]
            rows.append(_row(
                n, (GRADE_C, f"G{grade}"), (SUBJ_C, subject),
                (TEXT_C, (titles.get(ch, "") or "")[:60]), (NUM_C, ch),
                *[(SKILL_C + i, got.get(k, 0) or "")
                  for i, k in enumerate(keys)]))
    return rows


def build(corpus):
    """corpus: {subject: [(grade, rows, stats)]}. Returns (rows, plan)."""
    prepared = covdata.prepare(corpus)
    n = max([SKILL_C + len(v[1]) for v in prepared.values()] + [BAR_C + 1])
    widths = {**COV_W, **{c: NARROW for c in range(NUM_C + 1, n)}}
    plan = _plan(n, widths, [TEXT_C])
    out = [_row(n, (0, TITLE)), _row(n, (0, SUB))]
    mix = _mix(prepared, plan, len(out))
    _block(plan, out, mix, "Mix", True, 26)
    plan["overflow"].append((len(out) + 1, len(out) + len(mix), BAR_C, n))
    out += mix
    for subject, (books, keys, _extra, counted) in prepared.items():
        _section(plan, out, f"{subject.upper()} — every chapter against "
                            "every skill type", grid_note(keys, subject))
        block = _grid(subject, books, keys, counted, plan, len(out))
        _block(plan, out, block, f"Chapters — {subject}", False, 32)
        out += block
    return out, plan


def _gap_rows(prepared):
    """Every chapter missing a skill its subject should carry every chapter."""
    rows = [_row(GAP_COLS, (0, "Grade"), (1, "Subject"), (2, "Ch."),
                 (N1, "Days"), (N2, "Types"), (N3, "Missing"), (N4, "% book"),
                 (WIDE_C, "Chapter"),
                 (LIST_C, "Missing — the skills this subject is supposed to "
                          "carry in every chapter"))]
    for subject, (books, _k, _e, counted) in prepared.items():
        for grade, book, _st in books:
            titles = {r["chapter"]: r["chapter_title"] for r in book
                      if r["chapter"] is not None}
            _per, by_chapter, _admin = counted[grade]
            total = sum(sum(c.values()) for c in by_chapter.values()) or 1
            for ch in sorted(by_chapter):
                got = by_chapter[ch]
                missing = [skills.label(k, subject) for k in covdata.EXPECTED[subject]
                           if not got.get(k)]
                if not missing:
                    continue
                days = sum(got.values())
                rows.append(_row(
                    GAP_COLS, (0, f"G{grade}"), (1, subject), (2, ch),
                    (N1, days), (N2, len([v for v in got.values() if v])),
                    (N3, len(missing)), (N4, f"{100 * days / total:.0f}%"),
                    (WIDE_C, (titles.get(ch, "") or "")[:60]),
                    (LIST_C, ", ".join(missing))))
    if len(rows) == 1:
        rows.append(_row(GAP_COLS, (LIST_C, "Every chapter carries every "
                                            "skill its subject expects.")))
    return rows


def _slo_rows(prepared, cap=10):
    """Whether every SLO the book names gets a day that introduces it."""
    rows = [_row(GAP_COLS, (0, "Grade"), (1, "Subject"), (2, "Ch."),
                 (N1, "SLOs"), (N2, "Intro"), (N3, "Never"), (N4, "Per SLO"),
                 (WIDE_C, "Introduced — share of the SLOs the book names"),
                 (LIST_C, "Never introduced — the codes"))]
    for subject, (books, _k, _e, _c) in prepared.items():
        for grade, book, _st in books:
            named, intro, days = set(), set(), 0
            chapters = {r["chapter"] for r in book if r["chapter"] is not None}
            for r in book:
                if r["kind"] != "day":
                    continue
                days += 1
                sup = (r.get("supporting_slos") or "").split(",")
                named.update(c.strip() for c in [r.get("primary_slo")] + sup
                             if c and c.strip())
                if r.get("slo_role") == "introduces" and r.get("primary_slo"):
                    intro.add(r["primary_slo"])
            gap, tot = sorted(named - intro), len(named) or 1
            rows.append(_row(
                GAP_COLS, (0, f"G{grade}"), (1, subject), (2, len(chapters)),
                (N1, len(named)), (N2, len(intro)), (N3, len(gap) or "—"),
                (N4, f"{days / len(named):.1f}" if named else "—"),
                (WIDE_C, f"{100 * len(intro) // tot:>3}%  "
                         f"{bar(len(intro), tot)}"),
                (LIST_C, ", ".join(gap[:cap]) +
                 (f"  … +{len(gap) - cap} more" if len(gap) > cap else ""))))
    return rows


def gaps_build(corpus):
    """The second tab: thin chapters and SLO coverage. Returns (rows, plan)."""
    prepared = covdata.prepare(corpus)
    plan = _plan(GAP_COLS, dict(GAP_W), [WIDE_C, LIST_C])
    out = [_row(GAP_COLS, (0, GAP_TITLE)), _row(GAP_COLS, (0, GAP_SUB))]
    gaps = _gap_rows(prepared)
    _block(plan, out, gaps, "Thin chapters", True, 34)
    out += gaps
    _section(plan, out, SLO_BAND, SLO_NOTE)
    slo = _slo_rows(prepared)
    _block(plan, out, slo, "SLO coverage", False, 40)
    out += slo
    return out, plan
