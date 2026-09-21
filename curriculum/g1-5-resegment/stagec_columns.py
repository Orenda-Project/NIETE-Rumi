# -*- coding: utf-8 -*-
"""Whole-column checks: the failures no single row can show.

A slice can be row-by-row impeccable and still be worthless. Every value
legal, every prerequisite real, and yet the column gives every day the
same answer, or copies the column beside it, or splits itself into exact
equal parts. None of that is visible from one row; all of it means the
column stopped describing the days. These four checks read the column
whole, which is why they live apart from the per-row verification.
"""
import stagec


CLOSED_VOCAB_COLUMNS = ("Reading strategy", "Collaboration structure",
                        "Interaction", "Gap")
DIVERSITY_COLUMNS = ("Collaboration structure", "Interaction", "Gap")
MIN_DISTINCT = 3          # any smaller and the column cannot separate anything
MAX_SHARE = 0.60          # a value past this is only flat if nothing rivals it
SECOND_MIN = 0.25         # ...and this is what "rivals it" means
MIN_ROWS_FOR_DIVERSITY = 12
MIN_ROWS_PER_SKILL = 8    # below this, insisting on variety is inventing
BIG_VOCABULARY = 8        # only here is within-skill-type variety expected
# Share, not count, decides whether a skill type has gone flat. An absolute
# cap means opposite things at different sizes -- seven of thirty-six Concrete
# days is variety, seven of eleven is a column that stopped reading the days --
# and a published count is a number workers aim at rather than describe toward.
# Only structure columns are judged this way: `Gap` and `Interaction` state
# facts about the task, and nine decoding days really may carry no information
# gap. Uniformity there is a finding for a curriculum lead, not a defect.
SKILL_SHARE_COLUMNS = ("Collaboration structure",)
CHORAL_MAX = 0.60         # paired work carrying no information gap
_PAIRED = ("pair", "group", "mingle")


def has_signal(group):
    """Did the source give an annotator anything to tell these days apart?

    Sixteen assessment rows carrying one sentence between them, differing
    only in the lesson number, are one day written sixteen times. A uniform
    column over them is a transcription, not a lapse, and faulting it pushes
    a worker to invent a split -- which is the failure the flatness rules
    exist to prevent, arrived at by the rule itself.

    Digits are stripped because the lesson counter is not a difference
    between days. Topic and description are read together: signal is
    whatever the row actually carries, not one privileged field.
    """
    seen, saw_text = set(), False
    for r in group:
        topic = (r.get("topic") or "").strip()
        desc = (r.get("slo_desc") or "").strip()
        saw_text = saw_text or bool(topic or desc)
        text = u"%s\u241f%s" % (topic, desc)
        seen.add(u"".join(ch for ch in text if not ch.isdigit()))
        if len(seen) > 1:
            return True
    # Nothing recorded is not the same as recorded and identical. A group
    # carrying no text at all is unread, not undifferentiated, so it keeps
    # the complaint rather than inheriting an exemption it never earned.
    return not saw_text


def check_diversity(rows, cells, columns):
    """Findings for columns that have gone flat across a slice.

    Small skill types are exempt: four Word-problem days that genuinely suit
    one structure are honest, and forcing a second value there would be
    inventing to fill a blank.
    """
    out = []
    present = [r for r in rows if str(r["row"]) in cells]
    if len(present) < MIN_ROWS_FOR_DIVERSITY:
        return out
    for col in columns:
        if col not in DIVERSITY_COLUMNS:
            continue
        seen = [cells[str(r["row"])].get(col) for r in present]
        seen = [s for s in seen if s]
        if not seen:
            continue
        counts = {}
        for s in seen:
            counts[s] = counts.get(s, 0) + 1
        if len(counts) < MIN_DISTINCT:
            out.append("%s uses only %d distinct values across %d rows"
                       % (col, len(counts), len(seen)))
        ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        top, n = ranked[0]
        share = float(n) / len(seen)
        runner = float(ranked[1][1]) / len(seen) if len(ranked) > 1 else 0.0
        # A dominant value with a real runner-up still tells days apart. One
        # whose rivals are tokens does not -- that is the dead column.
        if share > MAX_SHARE and runner < SECOND_MIN:
            out.append("%s is %r on %d of %d rows (%.0f%%) and nothing rivals "
                       "it: the column is flat"
                       % (col, top, n, len(seen), share * 100))
        if len(stagec.VOCAB.get(col, ())) < BIG_VOCABULARY:
            # Five values, two of which the spec discourages on oral days.
            # Nine Phonics days with no information gap between the children
            # is a true statement about phonics, not inattention.
            continue
        by_skill = {}
        for r in present:
            val = cells[str(r["row"])].get(col)
            if val:
                by_skill.setdefault(r.get("skill_type", "?"), []).append((r, val))
        for skill in sorted(by_skill):
            group = by_skill[skill]
            vals = [v for _, v in group]
            total = len(vals)
            if total < MIN_ROWS_PER_SKILL:
                continue
            tally = {}
            for s in vals:
                tally[s] = tally.get(s, 0) + 1
            if len(tally) < 2:
                if has_signal([r for r, _ in group]):
                    out.append("%s is a single value on all %d %r days"
                               % (col, total, skill))
                continue
            if col not in SKILL_SHARE_COLUMNS:
                continue
            ranked = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))
            share = float(ranked[0][1]) / total
            runner = float(ranked[1][1]) / total
            if share > MAX_SHARE and runner < SECOND_MIN:
                out.append("%s is %r on %d of %d %r days (%.0f%%) and nothing "
                           "rivals it: the column has stopped reading the days"
                           % (col, ranked[0][0], ranked[0][1], total, skill,
                              100 * share))
    return out



def check_choral_pairs(rows, cells):
    """The spec's own named failure, verbatim:

        "a whole term of `pair` at `Gap: none` is choral practice in pairs,
         and only both columns together reveal it"

    Neither column alone is wrong there. The pair of them is, which is why
    this cannot be folded into the per-column flatness checks.
    """
    present = [r for r in rows if str(r["row"]) in cells]
    if len(present) < MIN_ROWS_FOR_DIVERSITY:
        return []
    hollow = 0
    for r in present:
        c = cells[str(r["row"])]
        if c.get("Interaction") in _PAIRED and c.get("Gap") == "none":
            hollow += 1
    share = float(hollow) / len(present)
    if share > CHORAL_MAX:
        return ["%d of %d rows (%.0f%%) put children together with no "
                "information gap between them: this is choral practice in "
                "pairs" % (hollow, len(present), share * 100)]
    return []

def check_copied_columns(cells, columns):
    """Columns that never depart from one another are one column, not two.

    Each column is a separate question, and a slice that answers two of them
    identically on every row has answered one. The rows must actually vary:
    two columns honestly reading `none` throughout are a finding about the
    curriculum, which the dead-column rules already make, not a copy.
    """
    out = []
    rows = sorted(cells, key=int)
    for i, first in enumerate(columns):
        for second in columns[i + 1:]:
            pairs = [((cells[r].get(first) or "").strip(),
                      (cells[r].get(second) or "").strip()) for r in rows]
            pairs = [p for p in pairs if p[0] or p[1]]
            if not pairs or any(a != b for a, b in pairs):
                continue
            if len(set(a for a, _ in pairs)) < 2:
                continue
            out.append("%s and %s hold the same value on all %d rows: one of "
                       "them is not answering its own question"
                       % (first, second, len(pairs)))
    return out


EVEN_MIN_VALUES = 3
EVEN_MIN_ROWS = 8


def check_even_split(rows, cells, columns):
    """An exactly even column was counted, not read.

    Days are uneven, so honestly annotating them produces an uneven column:
    one answer that fits many days and a tail of ones. An exact tie across
    three or more values is the fingerprint of balancing to look varied,
    which the flatness rules cannot see because a balanced column is the
    most varied thing there is.

    Only an exact tie fires. Near-even is ordinary and stays legal: a
    repetitive stretch of curriculum honestly annotated lands close to
    level, and rejecting that would punish the curriculum rather than the
    annotation.
    """
    out = []
    by = {}
    for r in rows:
        by.setdefault(r.get("skill_type") or "", []).append(r)
    for skill in sorted(by):
        group = by[skill]
        if len(group) < EVEN_MIN_ROWS:
            continue
        for col in columns:
            if col not in CLOSED_VOCAB_COLUMNS:
                continue
            counts = {}
            for r in group:
                val = (cells.get(str(r["row"]), {}).get(col) or "").strip()
                if not val:
                    continue
                counts[val] = counts.get(val, 0) + 1
            sizes = sorted(counts.values())
            if len(counts) < EVEN_MIN_VALUES or sizes[0] != sizes[-1]:
                continue
            if sizes[-1] < 2:
                continue
            out.append("%s is split evenly %d ways across the %d %s days: "
                       "an exact tie is a column that was counted rather "
                       "than read"
                       % (col, len(counts), len(group), skill))
    return out
