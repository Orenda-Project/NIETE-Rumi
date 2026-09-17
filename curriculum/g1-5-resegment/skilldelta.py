"""FIRST APPEARANCE — the one block on the Skills Map that does not read the book.

Every other block here counts textbook day rows. This one answers "how far
into the year does each grade first reach this skill", and only the allocated
year can answer it: the Grade 1 English book reaches phonics a quarter of the
way in, the calendar teaches it in the first week, because the Grades 1-2 ramp
hands the spare periods to phonics from April. Reporting the book's number
under that heading told the reader the opposite of what the calendar does.

It lives in its own file because of that, and because the list of skills it
prints is not the book's either — the calendar teaches communicative language
and number fluency, which have no day row in any book at all.
"""
import skills
from skillgrid import *                                  # noqa: F401,F403


def _canonical(onsets):
    """The calendar's onsets, re-keyed to the skill keys the book uses.

    The two sources name the same skill differently and nothing upstream
    reconciles them. The corpus writes `skill_type: assessment` on an Urdu
    segment, the allocator carries that word through untouched, and the
    calendar reports its onset under it — while the book's key for the same
    skill is `jaiza`. `skills.ALIAS` exists because those are one skill.

    Compared as plain strings they are two, and the tab then printed Urdu
    assessment twice, contradicting itself: the book's row found no onset and
    rendered "no Day N row in any grade" about a skill with a day row in every
    grade, and a second row under the same name and code called it a basics
    period the calendar adds around the book. Revision did the same in Grade 5.

    Where two names collapse into one, the earlier period wins: the question
    is when the year FIRST reaches the skill, and it reached it under whichever
    name came first.
    """
    out = {}
    for (subject, grade), got in onsets.items():
        merged = {}
        for key, first in got.items():
            key = skills.canonical(key, subject)
            if key not in merged or first["period"] < merged[key]["period"]:
                merged[key] = first
        out[(subject, grade)] = merged
    return out


def delta_block(data, keymap, onsets=None):
    """First appearance, five grades side by side, so the shift is scannable.

    `onsets` is the CALENDAR's answer — {(subject, grade): {skill: {...}}}
    from caltab, built off the allocated year. Without it this block falls
    back to the book's own day sequence, and says so in its title, because the
    two are not the same question and for one build they were silently
    confused. The book puts phonics a quarter of the way through Grade 1
    English; the calendar teaches it in the first week, because the ramp gives
    Grades 1-2 their spare periods to phonics from April. Reporting the book's
    number under the heading "how far into the year" told the reader the
    opposite of what the calendar does.
    """
    real = onsets is not None
    onsets = _canonical(onsets) if real else None
    rows = [["FIRST APPEARANCE — how far into the year each grade reaches a "
             "skill for the first time"
             + (" (% of the periods to 24 December, read off the Teaching "
                "Calendar — basics periods included)" if real else
                " (% of the BOOK's teaching days — this is the textbook's own "
                "order, NOT the calendar's)")],
            list(HEAD_FA),
            # Alone on its line, so it overflows the whole tab. The three
            # marks below used to sit in the header's last column, where
            # there is nothing to their right to run into and the export cut
            # them off mid-sentence.
            [FA_MARKS]]
    cells = []
    for subject in SUBJECTS:
        subj = data["subjects"].get(subject)
        if not subj:
            continue
        for label, key, in_book in listed(
                keymap, subject, data["labels_seen_in_data"][subject],
                onsets if real else None):
            line = _row({SKILL_C: f"{subject} · {skills.label(key, subject)}",
                         CODE_C: skills.code(key, subject)})
            pts = []
            for i, g in enumerate("12345"):
                col, one = GRADE_C + i, subj["grades"].get(g)
                if one is None:
                    line[col] = "no book"      # no book is not an absence
                    continue
                fa = (onsets.get((subject, g), {}).get(key) if real
                      else one["first_appearance"].get(label))
                if not in_book:
                    # No day row to fall back on, so a missing onset here
                    # means the calendar did not reach it in this grade.
                    line[col] = f"{fa['pct_through']:.0f}%" if fa else "—"
                    if fa:
                        pts.append((g, fa["pct_through"]))
                        cells.append((len(rows), col, WHEN[
                            min(4, int(fa["pct_through"] // 20))]))
                    continue
                if not fa:
                    line[col] = "·" if one["slots_per_skill"].get(label) else "—"
                    continue
                pts.append((g, fa["pct_through"]))
                line[col] = f"{fa['pct_through']:.0f}%"
                cells.append((len(rows), col,
                              WHEN[min(4, int(fa["pct_through"] // 20))]))
            if pts:
                lo, hi = min(pts, key=lambda p: p[1]), max(pts, key=lambda p: p[1])
                line[NOTE_C] = (
                    f"calendar basics · earliest G{lo[0]} {lo[1]:.0f}%"
                    if not in_book else
                    f"earliest G{lo[0]} {lo[1]:.0f}% · "
                    f"latest G{hi[0]} {hi[1]:.0f}%")
                lane = [VOID] * SLICES      # each grade at its % of the
                for g, pct in pts:          # year, + where two share a slice
                    j = min(SLICES - 1, int(round(pct / 100 * (SLICES - 1))))
                    lane[j] = str(g) if lane[j] == VOID else "+"
                line[TRACK_C] = "".join(lane)
            else:
                line[NOTE_C] = "no Day N row in any grade"
                line[TRACK_C] = VOID * SLICES
            rows.append(line)
        rows.append([""] * N_COLS)
    return rows, cells
