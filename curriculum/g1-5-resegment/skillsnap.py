# -*- coding: utf-8 -*-
"""Regenerate `skillsmap.json` from the corpus. bd-7j5rs.

`Skills Map` is the one analysis tab built from a snapshot rather than from
the corpus, so it is the only one that can fall behind a build -- and twice
now it has (bd-hlq38, then bd-7j5rs, where it called G1 English 86 teaching
days against the corpus's 87 and put every position after Ch.1 Day 5 one out).
`skillmap` already refuses to make an ABSENCE claim from the snapshot for
exactly that reason; POSITION it still has to take on trust.

The lag was structural, not an oversight. The original file was scraped off
the published sheet -- its own `meta` still carried a `sheet_id` and a tab
name per subject -- so it recorded what had last been PAINTED, which is a
different thing from what the corpus holds. This module derives the same
shape from `buildload.load_corpus()` instead, and the regenerated `meta`
says `"source": "corpus"` so the next reader can tell which kind of file
they have.

The counting rules are not reinvented here. The snapshot documents three of
them in `meta` and `skillmap` reads the result; changing one silently would
move numbers on a tab nobody rebuilt. They are carried over verbatim:

  * a DAY is a teaching day. A chapter close consumes a period and teaches
    nothing, so it is never counted as one -- that is the 86-vs-87 defect.
  * a SLOT is a day row or a chapter-close row, both of which carry a skill
    type. Days answer "how much teaching"; slots answer "how much calendar".
  * `pct_through` is `100 * (zero-based index of the first DAY row carrying
    that skill) / (total day rows in the grade)`.

`stale()` is the part that keeps this from happening a third time: it names
the grades whose day count has moved since the snapshot was taken, so the
drift is reported rather than lived with.
"""
import argparse
import collections
import datetime
import json
import os
import sys

import skills

#: The three rules above, kept in the file so it carries its own contract.
RULES = {
    "day_row": "a row whose kind is 'day' -- a chapter close is not one",
    "slot_row": ("day rows PLUS chapter-close rows (Ch. Assessment / "
                 "Ch. Review), which also carry a skill type"),
    "pct_through_formula": ("100 * (zero-based index of the first DAY row "
                            "carrying that skill) / (total day rows in the "
                            "grade)")}


def is_day(row):
    return row.get("kind") == "day"


def label_of(row):
    return row.get("skill_type") or u""


def slots_of(rows):
    """Day rows and chapter closes, in corpus order. Anything with neither a
    day's kind nor a skill type is not a slot and is not counted twice."""
    return [r for r in rows if is_day(r) or label_of(r)]


def runs(labels):
    """Run-length encoding: `[a, a, b] -> [[a, 2], [b, 1]]`.

    A label returning later starts a new run, which is the point -- the tab
    draws the rhythm of a grade, and collapsing every occurrence of a skill
    into one number would hide whether it was taught in a block or spread.
    """
    out = []
    for lbl in labels:
        if out and out[-1][0] == lbl:
            out[-1][1] += 1
        else:
            out.append([lbl, 1])
    return out


def per_skill(labels):
    counts = collections.Counter(l for l in labels if l)
    return dict(counts)


def first_appearance(days):
    """Where each skill opens, by the rules above. Day rows only."""
    out = {}
    for i, row in enumerate(days):
        lbl = label_of(row)
        if not lbl or lbl in out:
            continue
        out[lbl] = {"first_day_ordinal": i + 1,
                    "n_days_in_grade": len(days),
                    "pct_through": round(100.0 * i / len(days), 1),
                    "chapter": row.get("chapter")}
    return out


def chapter_blocks(rows):
    """One block per chapter, in the order the corpus teaches them."""
    order, held = [], {}
    for row in slots_of(rows):
        ch = row.get("chapter")
        if ch not in held:
            order.append(ch)
            held[ch] = []
        held[ch].append(row)
    out = []
    for ch in order:
        group = held[ch]
        days = [r for r in group if is_day(r)]
        out.append({
            "chapter": ch,
            "title": (group[0].get("chapter_title") or u""),
            "n_days": len(days),
            "n_slots": len(group),
            "days_per_skill": per_skill([label_of(r) for r in days]),
            "slots_per_skill": per_skill([label_of(r) for r in group]),
            "day_sequence_runs": runs([label_of(r) for r in days])})
    return out


def grade_block(rows):
    """One grade of one subject, in the shape `skillmap` reads."""
    days = [r for r in rows if is_day(r)]
    slots = slots_of(rows)
    chapters = chapter_blocks(rows)
    return {
        "n_days": len(days),
        "n_slots": len(slots),
        "n_chapters": len(chapters),
        "chapters": chapters,
        "days_per_skill": per_skill([label_of(r) for r in days]),
        "slots_per_skill": per_skill([label_of(r) for r in slots]),
        "day_sequence_runs": runs([label_of(r) for r in days]),
        "slot_sequence_runs": runs([label_of(r) for r in slots]),
        "first_appearance": first_appearance(days)}


def progression(grades):
    """How a subject's vocabulary changes from its lowest grade to its
    highest. A grade a skill is never taught in is left out of its row
    rather than written as a zero -- absent and never-offered read the
    same as 0 and are not the same claim."""
    keys = sorted(grades, key=lambda g: int(g))
    lo, hi = keys[0], keys[-1]
    matrix = {}
    for g in keys:
        for lbl, n in grades[g]["days_per_skill"].items():
            matrix.setdefault(lbl, {})[g] = n
    low, high = set(matrix) & set(grades[lo]["days_per_skill"]), \
        set(matrix) & set(grades[hi]["days_per_skill"])
    return {"lowest_grade": lo, "highest_grade": hi,
            "in_lowest_not_highest": sorted(low - high),
            "in_highest_not_lowest": sorted(high - low),
            "days_matrix": matrix,
            "skills_per_grade_count": dict(
                (g, len(grades[g]["days_per_skill"])) for g in keys)}


def known_labels(subject):
    """Every spelling of a skill this subject's ORDER names.

    Both the printed label and the raw key, because the corpus writes some
    days one way and some the other (`covdata` canonicalises for the same
    reason) -- matching on the label alone would report a raw `duhrai` as a
    skill the taxonomy has never heard of.
    """
    out = set()
    for key in skills.ORDER.get(subject, ()):
        out.add(key)
        out.add(skills.canonical(key, subject))
        out.add(skills.label(key, subject))
    return out


def reference(subjects):
    """The legend: every skill each subject's ORDER names, in ORDER's order."""
    out = []
    for subject in subjects:
        for key in skills.ORDER.get(subject, ()):
            out.append({"subject": subject, "key": key,
                        "label": skills.label(key, subject),
                        "code": skills.code(key, subject),
                        "hex": skills.colour(key, subject),
                        "gloss": skills.gloss(key, subject)})
    return out


def build(corpus, today=None):
    """The whole snapshot, from `buildload.load_corpus()`'s `by_subject`."""
    subjects, seen, unnamed = {}, {}, {}
    for subject in sorted(corpus):
        grades = {}
        labels = set()
        for grade, rows, _st in corpus[subject]:
            grades[str(grade)] = grade_block(rows)
            labels |= set(label_of(r) for r in slots_of(rows) if label_of(r))
        subjects[subject] = {"grades": grades,
                             "progression": progression(grades)}
        seen[subject] = sorted(labels)
        odd = sorted(labels - known_labels(subject))
        if odd:
            unnamed[subject] = odd
    meta = {"source": "corpus",
            "generated": (today or datetime.date.today()).isoformat(),
            "generator": "skillsnap.py (bd-7j5rs)"}
    meta.update(RULES)
    return {"meta": meta,
            "skill_reference": reference(sorted(corpus)),
            "labels_seen_in_data": seen,
            "labels_not_in_ORDER": unnamed,
            "subjects": subjects}


def stale(data, corpus):
    """Grades whose teaching-day count has moved since the snapshot.

    Returns `(subject, grade, in the snapshot or None, in the corpus)` per
    drifted grade. This is the check that would have caught bd-7j5rs on the
    build that caused it rather than two builds later.
    """
    held = data.get("subjects") or {}
    out = []
    for subject in sorted(corpus):
        grades = (held.get(subject) or {}).get("grades") or {}
        for grade, rows, _st in corpus[subject]:
            g = str(grade)
            was = (grades.get(g) or {}).get("n_days")
            now = len([r for r in rows if is_day(r)])
            if was != now:
                out.append((subject, g, was, now))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="", help="default: buildload's path")
    ap.add_argument("--check", action="store_true",
                    help="report drift against the current file, write nothing")
    a = ap.parse_args()
    import buildload
    path = a.out or buildload.SKILLSMAP_JSON
    corpus = buildload.load_corpus()[0]
    if a.check:
        with open(path, encoding="utf-8") as fh:
            drift = stale(json.load(fh), corpus)
        for subject, grade, was, now in drift:
            print(u"%-8s G%s  snapshot %s  corpus %d"
                  % (subject, grade, "absent" if was is None else was, now))
        print("%d grade(s) adrift" % len(drift))
        return 1 if drift else 0
    data = build(corpus)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    days = sum(g["n_days"] for s in data["subjects"].values()
               for g in s["grades"].values())
    print("wrote %s  %d subjects  %d teaching days"
          % (os.path.relpath(path), len(data["subjects"]), days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
