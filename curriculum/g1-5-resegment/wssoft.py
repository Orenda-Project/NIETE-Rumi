"""How good is this worksheet? — the half of the gate `wslint` deliberately is not.

`wslint` decides whether a sheet may render. Everything it reports is a refusal:
too few questions, a missing mark badge, a closed question with no answer. A
sheet that trips one of those is broken, and the engine stops.

This asks the other question. A sheet can clear every WS rule and still be a
poor paper — ten questions of three kinds, an mcq whose answer is not among its
own options, the same sentence of common errors copied under every question, a
drawing question offered ruled lines, an instruction written at an adult's
sentence length for a six-year-old who is being assessed on reading it. None of
those should stop a render. All of them should cost marks.

Until this existed a 995 had no soft score at all: `_worksheet_qa` returned
`soft_pct: None`, `S1` said so in `not_checked`, and the composite could not
form — a worksheet could be judged and still not be gated (bd-nr311, from
bd-4p01d).

Two things this deliberately does NOT do.

It does not re-ask a WS rule. The mark total against the badges, the three-type
floor, answer coverage, common-errors presence and a declared space are all
already refusals. Scoring them again here would make one broken sheet look
doubly broken while telling nobody anything new, and would quietly double the
weight of shape against quality.

It does not guess a grade. An instruction is only long or short relative to who
reads it, and a picture is only owed on a sheet for a child who reads pictures.
Where the grade is unknown those two checks go to `not_checked` and the score is
taken over what was actually measured — the same distinction the S1 defect came
from, kept on purpose. "Not applicable" is different again: at Grade 4 the
picture rule does not apply, so it is not reported at all rather than reported
as unmeasured.

Pure. No I/O, no imports beyond `re` and the lint's own vocabulary, so the
quality rule stays testable without the corpus.
"""
import re

import wslint

# Beyond the lint's floor of three. Three kinds is what a sheet needs to render;
# four is the least that lets a chapter show more than one way of knowing.
GOOD_VARIETY = 4

# A sheet that only ever asks a child to pick shows what they recognise and
# nothing about what they can make.
MIN_PRODUCTION = 1.0 / 3.0

# Above half, one answer or one sentence of common errors is boilerplate rather
# than a key. Below it, a paper may genuinely repeat itself.
REPEAT_SHARE = 0.5
MIN_KEYED = 4                  # under four, a "share" of the key means nothing

# Longest instruction sentence a child of that grade should meet on a paper
# they are being assessed on. Sentence length, not word count: the items under
# an instruction are the child's work, not prose.
BANDS = {1: 12, 2: 14, 3: 16, 4: 18, 5: 20}

PICTURE_GRADES = (1, 2, 3)

# The space an answer needs, by what the answer is. `mcq` and `match` are
# absent on purpose — they are answered on the question itself, and wslint
# already does not require a space for them.
FITS = {"draw": ("box", "grid"),
        "compute": ("box", "grid", "lines"),
        "fill": ("lines", "box"),
        "short": ("lines", "box"),
        "word": ("lines", "box")}

SENTENCE = re.compile(r"[.!?]+")
WORD = re.compile(r"[0-9A-Za-z؀-ۿ]")


def _val(d, key):
    """`key present but null` is absent, exactly as wslint reads it."""
    v = (d or {}).get(key)
    return None if v is None else v


def _norm(v):
    return " ".join(str(v).split()).strip().lower()


def _questions(enr):
    return _val(_val(enr, "generated") or {}, "questions") or []


def grade_of(enr, segment=None):
    """The grade this sheet is for, or None. Never a default.

    The segment is asked first because it is the build's own record of what
    the day is; the envelope and the lesson id are what the artefact remembers
    about itself.
    """
    for v in (_val(segment or {}, "grade"),
              _val(_val(_val(enr, "doc") or {}, "provenance") or {}, "grade")):
        try:
            return int(v)
        except (TypeError, ValueError):
            pass
    m = re.search(r"grade[_-]?(\d)", str(_val(enr, "lesson_id") or ""))
    return int(m.group(1)) if m else None


def _words(text):
    return [w for w in str(text).split() if WORD.search(w)]


def longest_sentence(text):
    """Words in the longest sentence of the INSTRUCTION, ignoring the items.

    A blank line ends the instruction. What follows is the child's work — a
    list of seven days, a row of letters with a gap — and counting it as prose
    would fail every well-made sheet.
    """
    head = str(text or "").split("\n\n")[0]
    return max([len(_words(s)) for s in SENTENCE.split(head)] or [0])


def _repeated(values):
    """The largest share any one value takes of `values`."""
    if not values:
        return 0.0
    counts = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return max(counts.values()) / float(len(values))


def _check(cid, name, ok, detail=""):
    return {"id": cid, "name": name, "pass": bool(ok), "hard": False,
            "detail": detail}


def _variety(qs):
    kinds = sorted({q.get("type") for q in qs} & set(wslint.TYPES))
    return _check("WSS-01", "more than the minimum variety of question",
                  len(kinds) >= GOOD_VARIETY,
                  "%d kinds: %s" % (len(kinds), ", ".join(kinds)))


def _production(qs):
    made = [q for q in qs if q.get("type") in wslint.NEEDS_SPACE]
    share = len(made) / float(len(qs))
    return _check("WSS-02", "the child produces, not only recognises",
                  share >= MIN_PRODUCTION,
                  "%d of %d questions ask the child to write or draw"
                  % (len(made), len(qs)))


def _mcq_keys(qs):
    bad = []
    for q in qs:
        if q.get("type") != "mcq":
            continue
        opts, ans = _val(q, "options"), _val(q, "answer")
        if not opts or ans is None:
            continue                      # wslint's refusal, not this one's
        if _norm(ans) not in [_norm(o) for o in opts]:
            bad.append(q.get("id"))
    return _check("WSS-03", "every mcq answer is one of its own options",
                  not bad, "not among the options: %s" % ", ".join(map(str, bad))
                  if bad else "")


def _key_spread(qs):
    keys = [_norm(_val(q, "answer")) for q in qs if _val(q, "answer")]
    if len(keys) < MIN_KEYED:
        return _check("WSS-04", "the key is not one answer repeated", True,
                      "only %d keyed questions" % len(keys))
    share = _repeated(keys)
    return _check("WSS-04", "the key is not one answer repeated",
                  share <= REPEAT_SHARE,
                  "one answer covers %d%% of the key" % round(share * 100))


def _error_spread(qs):
    firsts = [_norm(_val(q, "common_errors")[0])
              for q in qs if _val(q, "common_errors")]
    share = _repeated(firsts)
    return _check("WSS-05", "common errors are specific to their question",
                  share <= REPEAT_SHARE,
                  "one error covers %d%% of the questions that name any"
                  % round(share * 100))


def _space_fits(qs):
    bad = []
    for q in qs:
        want = FITS.get(q.get("type"))
        space = _val(q, "space")
        if want and space and space not in want:
            bad.append("%s (%s wants %s, got %s)"
                       % (q.get("id"), q.get("type"), "/".join(want), space))
    return _check("WSS-06", "the writing space fits the answer asked for",
                  not bad, "; ".join(bad))


def _readable(qs, grade):
    cap = BANDS[grade]
    worst, worst_id = 0, None
    for q in qs:
        n = longest_sentence(_val(q, "childText"))
        if n > worst:
            worst, worst_id = n, q.get("id")
    return _check("WSS-07", "instructions sit inside the grade's reading band",
                  worst <= cap,
                  "longest sentence %d words on %s, band for grade %d is %d"
                  % (worst, worst_id, grade, cap))


def _pictures(qs):
    n = sum(1 for q in qs if _val(q, "illustration"))
    return _check("WSS-08", "a primary sheet shows pictures", n >= 1,
                  "%d illustrated questions" % n)


def checks(enr, segment=None):
    """Score one worksheet's quality.

    Returns the shape `qa_checks.run_checks` returns — plus `not_checked`, so a
    check that could not be measured is visible rather than silently counted as
    a pass. `soft_pct` is None when there is nothing to score at all.
    """
    qs = _questions(enr)
    ids = ["WSS-0%d" % n for n in range(1, 9)]
    if not qs:
        # wslint already refuses this. Reporting 0.0 would put a number on an
        # artefact nothing looked at.
        return {"soft_pct": None, "checks": [], "not_checked": ids}

    out = [_variety(qs), _production(qs), _mcq_keys(qs), _key_spread(qs),
           _error_spread(qs), _space_fits(qs)]
    not_checked = []

    grade = grade_of(enr, segment)
    if grade in BANDS:
        out.append(_readable(qs, grade))
    else:
        not_checked.append("WSS-07")

    if grade in PICTURE_GRADES:
        out.append(_pictures(qs))
    elif grade not in BANDS:
        # Unknown grade: cannot tell whether the rule applies. At grade 4 or 5
        # it simply does not, and an inapplicable rule is not a dark stage.
        not_checked.append("WSS-08")

    passed = sum(1 for c in out if c["pass"])
    return {"soft_pct": round(100.0 * passed / len(out), 1),
            "checks": out, "not_checked": not_checked}


def soft_pct(enr, segment=None):
    return checks(enr, segment)["soft_pct"]
