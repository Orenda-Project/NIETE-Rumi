#!/usr/bin/env python3
"""
Deterministic checks on a generated exam paper (bd-60021). No LLM.

The rule this file exists for: *a rule in a prompt is a hope; a rule in code is a
guarantee* (curriculum-baked-lesson-plans, Stage D0). Everything here is
mechanically decidable, so a judge should never be asked to eyeball it — and
because it is free, it runs on every paper before any model is paid.

HARD checks fail the paper outright (they produce a defect a child meets):
  D1 no item depends on a picture the paper does not carry
  D2 every item carries a mark value
  D3 the printed total equals the sum of the items
  D4 no duplicated item
  D5 an options-bearing item has at least two options
  D6 an MCQ's answer is one of its own options
  D7 no stem states the value it asks for

SOFT checks count toward the QA percentage but do not fail on their own:
  D8 the item count is within 15% of what was requested
  D9 every item has an answer in the key
  D10 no answer text is printed on the paper itself
  D11 mark values are proportionate to the work asked

Usage:
  python3 qa_checks.py <exam.json> --requested 15 [--total-marks 26] [--json]
"""
import argparse
import json
import re
import sys

# An item that needs something the paper does not print. Deliberately broad on
# the picture family (the paper carries none at all) and narrow elsewhere.
PICTURE = re.compile(
    r"\b(pictures?|images?|photos?|illustrations?|diagrams?|drawings?|figures?"
    r"|shown (?:below|above)|given (?:below|above)|look at the"
    r"|under (?:its|each|the) picture|colou?r the|trace the"
    r"|name (?:the|each) object|in the (?:box|figure|circle))\b", re.I)

# "Mark the level at 300 mL" names a target the child must still produce — that is
# legitimate, so a naming verb rescues a stem that would otherwise look self-answering.
NAMES_A_TARGET = re.compile(r"\b(mark|show|draw|circle|match|shade|point|write|label|find|locate)\b", re.I)

# The answer BELONGS in the stem for a whole family of legitimate items, and treating
# that as a defect fails every real paper. Measured: the first version of this guard
# flagged 8 items across all four Grade 3 English papers (2026-09-03) and every one was
# a false positive. Three shapes:
#   * IDENTIFY — "which word is the adverb in 'The cat walked quietly'?" The child's
#     task IS to pick the word out of the sentence shown.
#   * WORD BANK — "The ___ (beautiful/run) flowers smell nice." The options are printed
#     in the stem on purpose.
#   * TRANSFORM — "rewrite this sentence with correct capitalisation". The answer is the
#     stem, changed.
# A check that fires on these is measuring the wrong thing (LP skill: "when a gate fails
# everything, suspect the gate").
IDENTIFY = re.compile(
    r"\b(identify|which word|which one|choose the|pick|select|underline|circle the"
    r"|name the (?:word|noun|verb|adjective|adverb)|find the (?:word|noun|verb|adjective|adverb))\b", re.I)
TRANSFORM = re.compile(r"\b(rewrite|rearrange|correct|change|convert|put .* into|turn .* into)\b", re.I)
WORD_BANK = re.compile(r"\([^)]*/[^)]*\)")          # "(beautiful/run)" — options inline in the stem

WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)


def walk(exam):
    """(section, category, type, index-within-type, question) for every item, in printing order."""
    for section in ("seen", "unseen"):
        branch = exam.get(section)
        if not isinstance(branch, dict):
            continue
        for category, types in branch.items():
            if not isinstance(types, dict):
                continue
            for qtype, entry in types.items():
                lists = []
                if isinstance(entry, list):
                    lists = [entry]
                elif isinstance(entry, dict):        # Long Question: sub-type -> list
                    lists = [v for v in entry.values() if isinstance(v, list)]
                for lst in lists:
                    for i, q in enumerate(lst):
                        if isinstance(q, dict):
                            yield section, category, qtype, i, q


def item_text(q):
    parts = [q.get("main_question"), q.get("question")]
    for k in ("options", "words", "column_a", "column_b"):
        v = q.get(k)
        if isinstance(v, list):
            parts += [str(x) for x in v]
    return " ".join(str(p) for p in parts if p)


def answer_of(q):
    for k in ("answer", "answer_key", "solution", "model_answer"):
        v = q.get(k)
        if v not in (None, "", []):
            return v
    return None


def _self_answering(q):
    """Does the stem state the value it asks for?

    The canonical case is 'There are 3 balloons. How many balloons?'. Guarded two
    ways after the LP skill's own bugs: no length early-out (a short stem is the
    classic instance), and a naming verb exempts 'mark the level at 300 mL'.
    """
    stem = " ".join(str(q.get(k) or "") for k in ("main_question", "question"))
    if not stem.strip():
        return False
    # Item families where the answer legitimately appears in the stem.
    if IDENTIFY.search(stem) or TRANSFORM.search(stem) or WORD_BANK.search(stem):
        return False
    ans = answer_of(q)
    if ans is None:
        return False
    ans_s = str(ans).strip()
    if not ans_s:
        return False

    # A number in the answer that already appears in the stem, where the stem also
    # asks for it ("how many", "count", "what is the number").
    asks_quantity = re.search(r"\bhow many\b|\bcount\b|\bwhat number\b|\bhow much\b", stem, re.I)
    ans_nums = set(re.findall(r"\d+", ans_s))
    stem_nums = set(re.findall(r"\d+", stem))
    if asks_quantity and ans_nums and ans_nums <= stem_nums:
        return True

    # A word-for-word answer already in the stem, unless the stem names it as a
    # target the child must produce.
    if len(ans_s) > 2 and not NAMES_A_TARGET.search(stem):
        bare = re.sub(r"^\(?[a-z]\)?[\.\)]?\s*", "", ans_s, flags=re.I).strip().lower()
        if bare and bare in stem.lower() and len(bare) > 3:
            return True
    return False


def run_checks(exam, requested_count=None, total_marks=None, printed_answers=None):
    """Report every check with pass/fail. `hard_pass` is the gate's input."""
    items = list(walk(exam))
    res = []

    def add(cid, name, ok, hard, detail=""):
        res.append({"id": cid, "name": name, "pass": bool(ok), "hard": hard, "detail": detail})

    # ---- counts, as a child sees them -------------------------------------- #
    item_count = len(items)
    word_units = sum(len(q.get("words") or [1]) for *_, q in items)
    marks_sum = sum(float(q.get("marks") or 0) for *_, q in items)

    # ---- D1 picture dependence (HARD) -------------------------------------- #
    pic = [(n, item_text(q)[:90]) for n, (*_, q) in enumerate(items, 1)
           if PICTURE.search(item_text(q))]
    add("D1", "No item depends on a picture the paper does not carry", not pic, True,
        "; ".join(f"Q{n}: {t}" for n, t in pic[:4]))

    # ---- D2 marks present (HARD) ------------------------------------------- #
    nomarks = [n for n, (*_, q) in enumerate(items, 1)
               if q.get("marks") in (None, "", 0)]
    add("D2", "Every item carries a mark value", not nomarks, True,
        f"items without marks: {nomarks}" if nomarks else "")

    # ---- D3 total adds up (HARD when a total is claimed) ------------------- #
    if total_marks is not None:
        ok = abs(float(total_marks) - marks_sum) < 0.01
        add("D3", "Printed total equals the sum of the items", ok, True,
            "" if ok else f"printed {total_marks} vs items {marks_sum:g}")

    # ---- D4 duplicates (HARD) ---------------------------------------------- #
    seen_stems, dupes = {}, []
    for n, (*_, q) in enumerate(items, 1):
        key = re.sub(r"\s+", " ", item_text(q)).strip().lower()
        if not key:
            continue
        if key in seen_stems:
            dupes.append((seen_stems[key], n))
        else:
            seen_stems[key] = n
    add("D4", "No duplicated item", not dupes, True,
        "; ".join(f"Q{a}=Q{b}" for a, b in dupes[:4]))

    # ---- D5 / D6 option integrity (HARD) ----------------------------------- #
    thin, mismatched = [], []
    for n, (*_, q) in enumerate(items, 1):
        opts = q.get("options")
        if not isinstance(opts, list) or not opts:
            continue
        if len(opts) < 2:
            thin.append(n)
        ans = answer_of(q)
        if ans is not None:
            norm = lambda s: re.sub(r"^\(?[a-z]\)?[\.\)]?\s*", "", str(s), flags=re.I).strip().lower()
            if norm(ans) and norm(ans) not in {norm(o) for o in opts}:
                mismatched.append((n, str(ans)[:40]))
    add("D5", "An options-bearing item has at least two options", not thin, True,
        f"items: {thin}" if thin else "")
    add("D6", "An MCQ's answer is one of its own options", not mismatched, True,
        "; ".join(f"Q{n}: {a!r}" for n, a in mismatched[:4]))

    # ---- D7 self-answering stems (HARD) ------------------------------------ #
    selfans = [n for n, (*_, q) in enumerate(items, 1) if _self_answering(q)]
    add("D7", "No stem states the value it asks for", not selfans, True,
        f"items: {selfans}" if selfans else "")

    # ---- D8 length vs request (SOFT — A5e judges the band) ----------------- #
    if requested_count:
        lo, hi = requested_count * 0.85, requested_count * 1.15
        ok = lo <= item_count <= hi
        add("D8", "Item count within 15% of the request", ok, False,
            "" if ok else f"asked {requested_count}, printed {item_count} items ({word_units} word-units)")

    # ---- D9 key completeness (SOFT — A5f judges correctness) --------------- #
    noans = [n for n, (*_, q) in enumerate(items, 1) if answer_of(q) is None]
    add("D9", "Every item has an answer in the key", not noans, False,
        f"items without an answer: {noans}" if noans else "")

    # ---- D10 answers not printed on the paper (SOFT) ----------------------- #
    if printed_answers is not None:
        add("D10", "No answer text printed on the paper itself", not printed_answers, False,
            "paper HTML contains answer text" if printed_answers else "")

    # ---- D11 mark proportionality (SOFT) ----------------------------------- #
    odd = []
    for n, (*_, q) in enumerate(items, 1):
        m = float(q.get("marks") or 0)
        words = len(WORD.findall(item_text(q)))
        if m >= 5 and words < 12:
            odd.append((n, m))
        if m == 1 and (q.get("words") or []) and len(q["words"]) > 2:
            odd.append((n, m))
    add("D11", "Mark values are proportionate to the work asked", not odd, False,
        "; ".join(f"Q{n}={m:g}mk" for n, m in odd[:4]))

    hard = [c for c in res if c["hard"]]
    soft = [c for c in res if not c["hard"]]
    hard_failures = [c for c in hard if not c["pass"]]
    soft_failures = [c for c in soft if not c["pass"]]
    return {
        "checks": res,
        "hard_pass": not hard_failures,
        "hard_failures": hard_failures,
        "soft_failures": soft_failures,
        "soft_pct": round(100 * sum(1 for c in soft if c["pass"]) / len(soft), 1) if soft else 100.0,
        "item_count": item_count,
        "word_units": word_units,
        "marks_sum": marks_sum,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("exam")
    ap.add_argument("--requested", type=int, default=None)
    ap.add_argument("--total-marks", type=float, default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    rep = run_checks(json.load(open(a.exam)), a.requested, a.total_marks)
    if a.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        for c in rep["checks"]:
            mark = "ok  " if c["pass"] else ("FAIL" if c["hard"] else "warn")
            print(f"{mark} {c['id']:4} {c['name']}" + (f"  — {c['detail']}" if c["detail"] else ""))
        print(f"\nhard_pass={rep['hard_pass']}  soft={rep['soft_pct']}%  "
              f"items={rep['item_count']} word-units={rep['word_units']} marks={rep['marks_sum']:g}")
    return 0 if rep["hard_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
