#!/usr/bin/env python3
"""
PRODUCTION GATE for a generated exam paper (bd-60021).

A paper PASSES when ALL of:
  (a) deterministic hard-QA passes      — qa_checks.run_checks -> hard_pass
  (b) no rubric check rated 1           — a missing/inadequate check always fails
  (c) no BLOCKING check rated 2         — answerability, key correctness and
                                          sensitive content have zero tolerance,
                                          because a 2 there is a defect a child meets
  (d) at most MAX_TWOS other checks rated 2
  (e) composite >= the judge's bar      — composite = mean(judge %, soft-QA %)

Shape and rationale inherited from `lp_reviewer/production_gate.py`, with two
deliberate differences:

  * BLOCKING vs tolerated. The LP gate tolerates any two 2s. Here, three checks
    are exempt from that tolerance: A5a (item needs a picture the paper lacks),
    A5f (answer key wrong or incomplete) and A3d (sensitive content). Each of
    those, at a 2, ships something a child or a teacher cannot use.

  * No JUDGE_STRICT exemption list. The LP gate exempts check 1A because the
    judge awards it a 4 in under 5% of reviews regardless of model. We have no
    measured equivalent yet, so nothing is exempted — and adding one requires a
    calibration run, not a hunch. (Softening a cap to reach a number is the
    self-certifying gate in a new costume: SP-071.)

Fail path: one targeted regeneration fed the named defects, re-score, and if it
still fails, escalate to a stronger generator once. Never soften the gate.

gate(score) -> {"pass": bool, "reasons": [...]}
"""
import glob
import json
import sys

COMPOSITE_MIN = 92.0

# Zero-tolerance checks: a rating of 2 fails on its own.
BLOCKING = {"A5a", "A5f", "A3d"}
MAX_TWOS = 2

# Judge bias correction. A lenient judge must face a higher bar to hold the same
# effective standard. These are the LP reviewer's MEASURED offsets, reused as a
# starting point — they must be re-measured for this rubric before being trusted
# (full-distribution calibration, not a mean delta: LP judge-swap lesson).
JUDGE_BARS = {
    "sonnet": 94.0,     # LP-measured: rates ~+1.9 vs opus
    "luna": 91.5,       # LP-measured: ~-0.7 vs opus
}


def _ratings(review):
    """(check_id, rating) for every scored check, item-level ratings included.

    A notAssessable check is skipped entirely — never counted as low. An
    unjustified notAssessable (no contextMissing) is NOT rescued here; `score.tally`
    already converts it to a 1, and it arrives as a normal rating.
    """
    out = []

    def walk(node):
        if isinstance(node, dict):
            cid = node.get("id")
            r = node.get("rating", node.get("score"))
            if cid and node.get("notAssessable") and r is None:
                pass                                    # excluded, by contract
            elif cid and isinstance(r, (int, float)):
                out.append((cid, int(r)))
            for k, v in node.items():
                if k != "id":
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(review)
    return out


def bar_for(judge):
    j = str(judge or "").lower()
    for key, bar in JUDGE_BARS.items():
        if key in j:
            return bar
    return COMPOSITE_MIN


def gate(score):
    reasons = []

    if not score.get("qa_hard_pass"):
        names = "; ".join(h.get("name", h.get("id", "?"))
                          for h in score.get("qa_hard_failures", []))
        reasons.append(f"hard-QA fail: {names}" if names else "hard-QA fail")

    ratings = _ratings(score.get("review", {}))
    ones = [cid for cid, r in ratings if r <= 1]
    if ones:
        reasons.append("checks rated 1 (missing/inadequate): " + ", ".join(sorted(set(ones))))

    blocking_twos = sorted({cid for cid, r in ratings if r == 2 and cid in BLOCKING})
    if blocking_twos:
        reasons.append("blocking checks rated 2 (no tolerance — reaches a child): "
                       + ", ".join(blocking_twos))

    other_twos = sorted({cid for cid, r in ratings if r == 2 and cid not in BLOCKING})
    if len(other_twos) > MAX_TWOS:
        reasons.append(f"{len(other_twos)} checks rated 2 (> {MAX_TWOS} tolerated): "
                       + ", ".join(other_twos))

    bar = bar_for(score.get("judge"))
    composite = score.get("composite_pct", 0)
    if composite < bar:
        adj = " (judge-adjusted)" if bar != COMPOSITE_MIN else ""
        reasons.append(f"composite {composite} < {bar}{adj}")

    return {"pass": not reasons, "reasons": reasons}


if __name__ == "__main__":
    files = sys.argv[1:] or glob.glob("*.score.json")
    ok = bad = 0
    for f in files:
        g = gate(json.load(open(f)))
        if g["pass"]:
            ok += 1
            print(f"PASS {f}")
        else:
            bad += 1
            print(f"FAIL {f}: {'; '.join(g['reasons'])}")
    print(f"\n{ok} pass / {bad} fail")
    sys.exit(1 if bad else 0)
