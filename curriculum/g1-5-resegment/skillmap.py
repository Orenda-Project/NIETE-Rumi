"""Skills Map — when in the year a skill appears, and how that moves G1 → G5.

The Skill Taxonomy tab already counts days, so this tab never repeats a count.
It answers what a count cannot: WHERE in the year a skill sits (a track per
skill-and-grade, the grade's days cut into 40 equal slices in block characters
— never a chart object, which floats over a grid this build rewrites every
run); HOW IT MOVES DOWN THE GRADES (the Coverage Map groups by grade; this tab
inverts that, skill outside and G1..G5 stacked under it); WHERE IT IS ABSENT (a
struck band, never a blank row); WHEN IT STARTS (the five grades' "% through
the year" side by side); and WHAT SHAPE A CHAPTER HAS (one modal template per
grade, follow/deviate counted, never every chapter). Loops run off
`labels_seen_in_data`, never skills.ORDER — ORDER is missing the live Science
label `review_assess` and an ORDER-driven loop drops it silently.
"""
import collections

import skills
from skilldelta import delta_block          # noqa: F401
# The tab's column roles, characters, colour ramp and row helpers.
from skillgrid import *                                  # noqa: F401,F403


def timeline_block(subject, subj, keymap, labels):
    """Skill on the outside, G1..G5 stacked under it. Returns local markers."""
    grades = sorted(subj["grades"])
    seqs = {g: [lab for lab, n in subj["grades"][g]["day_sequence_runs"]
                for _ in range(n)] for g in grades}   # run lengths expanded
    rows = [[f"{subject.upper()} — where each skill's days fall across the "
             f"BOOK, {len(labels)} skills × {len(grades)} grades. This is the "
             f"textbook's own order; for where a skill lands in the calendar "
             f"year, read FIRST APPEARANCE below."],
            list(HEAD_TL)]
    tint, absent, slotonly, gaps = [], [], [], []
    if len(grades) < 5:
        # Dark stages stay dark: a missing book is not a missing skill, so
        # grades with no book are named and left out, not drawn as absences.
        rows.append([f"There is no {subject} book below Grade {grades[0]} in "
                     f"this matrix, so Grades 1–{int(grades[0]) - 1} are named "
                     f"here and not drawn as empty tracks."])
    for label in _ordered(keymap, subject, labels):
        key = _key(keymap, subject, label)
        # skills.colour() does NOT canonicalise; a key that skips canonical()
        # silently paints an Urdu revision/assessment row the wrong colour.
        hexc = skills.colour(skills.canonical(key, subject))
        first = True
        for g in grades:
            one, seq = subj["grades"][g], seqs[g]
            hits = [i + 1 for i, lab in enumerate(seq) if lab == label]
            line = _row({SKILL_C: skills.label(key, subject) if first else "",
                         CODE_C: skills.code(key, subject) if first else "",
                         GRADE_C: f"G{g}", YEAR_C: one["n_days"]})
            slots = one["slots_per_skill"].get(label, 0)
            if hits:
                fa, bar = one["first_appearance"].get(label, {}), track(seq, label)
                line[FIRST_C] = hits[0]
                line[PCT_C] = f"{fa.get('pct_through', 0):.0f}%"
                line[CH_C] = fa.get("chapter", "")
                line[NOTE_C] = (f"day {hits[0]} → day {hits[-1]} · "
                                f"{sum(1 for c in bar if c != VOID)} of "
                                f"{SLICES} slices")
                line[TRACK_C] = bar
                tint.append((len(rows), hexc))
            elif slots:
                line[NOTE_C] = f"chapter-close slot only — {slots} slots, " \
                               f"no Day N row"
                line[TRACK_C] = VOID * SLICES
                slotonly.append(len(rows))
            else:
                line[NOTE_C] = "never appears in this grade"
                line[TRACK_C] = f"not taught in G{g}"
                absent.append(len(rows))
                gaps.append((subject, key, g))
            rows.append(line)
            first = False
        rows.append([""] * N_COLS)
    return rows, tint, absent, slotonly, gaps



def _template(chapters, keymap, subject):
    """(template, chapters following it, chapters deviating). The signature is
    the chapter's skill codes in order, run lengths collapsed."""
    tally = collections.Counter(
        tuple(lab for lab, _n in ch["day_sequence_runs"]) for ch in chapters)
    if not tally:
        return "", 0, 0
    best = max(tally, key=lambda s: (tally[s], -len(s)))
    runs = [skills.code(_key(keymap, subject, lab), subject) for lab in best]
    return " → ".join(runs) or "—", tally[best], len(chapters) - tally[best]


def template_block(data, keymap):
    """One modal chapter template per grade, never every chapter."""
    rows = [["THE CHAPTER TEMPLATE — the most common order of skill codes "
             "inside a chapter, one per grade"], list(HEAD_CT)]
    for subject in SUBJECTS:
        subj = data["subjects"].get(subject)
        if not subj:
            continue
        for g in sorted(subj["grades"]):
            one = subj["grades"][g]
            tmpl, follow, dev = _template(one["chapters"], keymap, subject)
            n_ch = one["n_chapters"]
            rows.append(_row({
                SKILL_C: f"{subject} · G{g}", GRADE_C: n_ch,
                YEAR_C: follow, FIRST_C: dev, TRACK_C: tmpl,
                NOTE_C: (f"{follow} of {n_ch} chapters"
                         if follow >= max(n_ch, 1) / 3 else
                         f"no dominant shape — best is {follow} of {n_ch}")}))
        rows.append([""] * N_COLS)
    return rows




def absence_block(gaps):
    """Two different findings that both look like "this skill has no day row".

    The timeline blocks find a skill with no days in a grade; comparing the
    subject's vocabulary against the data finds one with no days anywhere. A
    skill absent from EVERY grade draws no track at all — the timeline loops
    run off labels seen in the data — so without this roll-up it would
    disappear instead of reading as a gap: Maths Abstract is zero in all five
    grades and had no row anywhere on the tab.

    But two kinds of absence land here and they are not the same thing, and
    for one build this block said so only in its last column while striking
    every row through in red under a heading reading WHAT IS NEVER TAUGHT.
    Communicative language was in that list. The Teaching Calendar allocates
    it as a basics period from the first week of April in every Grade 1 and 2
    English and Urdu week — a thing taught every week of the year, printed on
    the tab beside it as never taught at all. A row's own wording cannot undo
    the heading above it, so the two are separated here: a gap is struck, a
    basics period is a note under its own heading.
    """
    rows = [["WHAT IS NEVER TAUGHT — a skill the subject's vocabulary carries "
             "and the teaching does not touch; what a grade teaches in that "
             "place instead is not in this file"], list(HEAD_AB)]
    real = [(subject, key, g) for subject, key, g in gaps if key not in BASICS]
    kept = [(subject, key, g) for subject, key, g in gaps if key in BASICS]
    struck, basics, heads = [], [], []

    def add(subject, key, g, note, track):
        rows.append(_row({
            SKILL_C: f"{subject} · {skills.label(key, subject)}",
            CODE_C: skills.code(key, subject),
            # "every grade" does not fit a 56px column and came out as
            # "every gra". The distinction it was drawing — this grade, or
            # all of them — is made in the last column anyway.
            GRADE_C: f"G{g}" if g else "all",
            NOTE_C: note, TRACK_C: track}))

    for subject, key, g in real:
        struck.append(len(rows))
        add(subject, key, g,
            "no day row and no chapter-close slot" if g
            else "no day row in any grade with a book",
            f"not taught in G{g}" if g else "never taught in this subject")
    if not real:
        struck.append(len(rows))
        rows.append(_row({SKILL_C: "Every skill its subject carries appears "
                                   "in every grade that has a book."}))
    if kept:
        rows.append([""] * N_COLS)
        heads.append(len(rows))
        rows.append(["TAUGHT, BUT NOT IN THIS FILE — basics periods the "
                     "Teaching Calendar allocates outside the textbook, so "
                     "the book has no day row to find"])
        rows.append(list(HEAD_AB))
        for subject, key, g in kept:
            basics.append(len(rows))
            add(subject, key, g, "a basics period, not a textbook day",
                "allocated on the Teaching Calendar, inside the "
                "chapter the class is in")
    return rows, struck, basics, heads


def build(data, onsets=None):
    """Returns (rows, plan). Rows are padded to plan['n_cols'].

    `onsets` comes from caltab's plan and is the only thing on this tab that
    knows about the calendar. Everything else here — the tracks, the chapter
    templates — is the book's own shape, which is the right source for those.
    """
    # (subject, label) -> skills key. The file's own reference beats
    # skills.KEY_BY_LABEL: it is what the analysis actually saw.
    keymap = {(r["subject"], r["label"]): r["key"]
              for r in data["skill_reference"]}
    out, tint, cells, sections = [], [], [], []
    absent, slotonly, prose, gaps = [], [], [], []
    out += [[TITLE], [CONVENTION], list(HEAD_TOP), [LEGEND], [""] * N_COLS]
    prose.append(3)                       # the legend is the one prose row here
    for subject in SUBJECTS:
        subj = data["subjects"].get(subject)
        if not subj:
            continue
        sections.append(len(out))
        block, t, ab, so, gp = timeline_block(
            subject, subj, keymap, data["labels_seen_in_data"][subject])
        gaps += gp
        # A skill absent from every grade never gets a track, so it is found
        # here by comparing the vocabulary against what the data shows.
        seen = set(data["labels_seen_in_data"][subject])
        gaps += [(subject, k, None) for k in skills.ORDER.get(subject, ())
                 if skills.label(k, subject) not in seen]
        tint += [(len(out) + r, c) for r, c in t]
        absent += [len(out) + r for r in ab]
        slotonly += [len(out) + r for r in so]
        if len(subj["grades"]) < 5:
            prose.append(len(out) + 2)        # the "no book below Gn" line
        out += block
    sections.append(len(out))
    block, cs = delta_block(data, keymap, onsets)
    cells += [(len(out) + r, c, h) for r, c, h in cs]
    # The marks legend is one sentence alone on its row, and skillfmt._wrap
    # wraps the whole body: without a place in prose_rows it is cut at the
    # edge of column A. It is found by its text rather than its offset, so
    # moving it inside the block cannot quietly un-register it.
    prose += [len(out) + r for r, row in enumerate(block)
              if row and row[SKILL_C] == FA_MARKS]
    out += block
    sections.append(len(out))
    out += template_block(data, keymap)
    sections.append(len(out))
    block, ab, kept, heads = absence_block(gaps)
    absent += [len(out) + r for r in ab]
    slotonly += [len(out) + r for r in kept]
    sections += [len(out) + r for r in heads]
    out += block
    n_cols = max([len(r) for r in out] + [N_COLS])
    out = [r + [""] * (n_cols - len(r)) for r in out]
    return out, {"n_cols": n_cols, "sections": sections, "tint": tint,
                 "cells": cells, "widths": WIDTHS, "wrap_cols": (),
                 "head_rows": 3, "absent_rows": absent,
                 "slot_rows": slotonly, "prose_rows": prose,
                 "track_col": TRACK_C, "skill_cols": (SKILL_C, CODE_C)}
