"""Gate G4 — the composite scoring gate, assembled.

The skill puts this before Stage C and says why: "at 2,000-lesson scale,
unmeasured quality is drift you find after the money is spent" (SKILL.md,
G4). Most of the gate already existed and was already calibrated against trial
data on 2026-08-03 — the v3 rubric, the deterministic QA checks, and
`production_gate.gate` v1.1 with its bias-corrected per-judge bars.

What never existed is the join. `score_lp.py` writes `score_pct`;
`production_gate.gate` reads `composite_pct`, `qa_hard_pass`,
`qa_hard_failures` and `judge`. Nothing produced the second shape from the
first, so the calibrated gate has never actually run end to end. That join is
`compose`, and it is deliberately the dullest function here.

Two hard checks are added, both things this build knows and the imported
reviewer cannot:

  W1, the word budget. `spec/07-lp-production.md` §4, DECIDED B. The imported
  QA checks read a camelCase v9 body (`warmUp`, `keyWords`, `exitTicket`);
  this build's surfaces are snake_case, so the budget would go unmeasured
  otherwise — and a checker pointed at the wrong schema does not complain, it
  passes. Over cap fails: the renderer never trims.

  G1, page grounding. `qa_checks` H5 asks whether the segment CARRIES a page
  reference. It cannot ask whether that page exists in the book and belongs to
  the segment's chapter, because it has never seen the book. Grade 5 Urdu
  prints pages 130-137 twice, so those are different questions, and the whole
  no-fabrication guarantee rests on the second one.

Both enter as entries in `qa_hard_failures` rather than as a forked gate. The
thresholds in `production_gate` were calibrated on real scores; re-deriving
them here to bolt on two checks would throw that calibration away for nothing.

What a check did NOT look at is recorded in `not_checked` rather than counted
as a pass. Scoring a render has no snake_case body to measure and scoring a
lesson without its book has no page to resolve; calling either a pass is the
one way this gate could quietly become decoration.
"""
import os
import sys

import wordbudget

# The migrated reviewer (PROVENANCE.md, D-017) lives in the skill, outside this
# repo. Relative on purpose: root CLAUDE.md forbids hardcoded absolute paths,
# and NIETE-Rumi is a public fork that must not name a machine.
REVIEWER_REL = os.path.join(
    "..", "..", "..", ".claude", "skills",
    "curriculum-baked-lesson-plans", "reference", "lp_reviewer")


def reviewer_path():
    """Where the migrated score-only reviewer lives."""
    override = os.environ.get("LP_REVIEWER_PATH")
    if override:
        return override
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, REVIEWER_REL))


def reviewer(module):
    """Import one module of the migrated reviewer, or say plainly why not.

    Lazy, because the gate's pure half must stay importable on a machine that
    has this build checked out and not the skill — and loud, because a silently
    absent gate is worse than no gate.
    """
    path = reviewer_path()
    if not os.path.isdir(path):
        raise RuntimeError(
            "the migrated lp_reviewer is not at %s. It ships with the "
            "curriculum-baked-lesson-plans skill; set LP_REVIEWER_PATH if it "
            "lives elsewhere on this machine." % path)
    if path not in sys.path:
        sys.path.insert(0, path)
    return __import__(module)


def _budget_failures(body):
    """The word budget as hard failures, one per surface over its cap."""
    return [{"id": "W1",
             "name": "%s is %d words, cap %d (over by %d)"
                     % (f["surface"], f["words"], f["cap"], f["over"])}
            for f in wordbudget.over(body)]


def _grounding_failure(grounding):
    """An unresolved segment, named by the reasons `pageres` gave."""
    reasons = sorted({f.get("reason", "?") for f in grounding.get("flags", [])})
    return {"id": "G1",
            "name": "pages do not resolve in the book: "
                    + (", ".join(reasons) or "unknown")}


def compose(qa, judge_pct=None, judge="", review=None, body=None,
            grounding=None):
    """Build the score dict `production_gate.gate` reads.

    `qa` is a `qa_checks.run_checks` result. `judge_pct` is the v3 rubric
    percentage from `score_lp`. `body` and `grounding` are optional; leaving
    one out records its check as not looked at, never as passed.
    """
    failures = list(qa.get("hard_failures") or [])
    not_checked = []

    if judge_pct is None:
        failures.append({"id": "not-judged",
                         "name": "no judge score — the lesson was never rated"})
        composite = None
    else:
        composite = (judge_pct + qa.get("soft_pct", 0.0)) / 2.0

    # A body carrying none of the five capped surfaces has not been measured —
    # it has been looked past. `wordbudget` returns no findings either way, so
    # the distinction has to be drawn here or the budget quietly stops applying
    # the first time a body arrives in a different shape.
    if body is None or not wordbudget.totals(body):
        not_checked.append("W1")
    else:
        failures.extend(_budget_failures(body))

    if grounding is None:
        not_checked.append("G1")
        flags = []
    else:
        flags = [f.get("reason") for f in grounding.get("flags", [])]
        if not grounding.get("resolved"):
            failures.append(_grounding_failure(grounding))

    return {"qa_hard_pass": bool(qa.get("hard_pass")) and not failures,
            "qa_hard_failures": failures,
            "soft_pct": qa.get("soft_pct"),
            "judge_pct": judge_pct,
            "composite_pct": composite,
            "judge": judge,
            "review": review if review is not None else {},
            "grounding_flags": flags,
            "not_checked": not_checked}


def verdict(score):
    """Run the imported, calibrated v1.1 gate over a composed score."""
    gate = reviewer("production_gate").gate
    if score.get("composite_pct") is None:
        # An unscored lesson is not a zero-quality lesson, but it is not a
        # passing one either, and the bar comparison needs a number.
        score = dict(score, composite_pct=0.0)
    return gate(score)


def evaluate(lp, segment, review, judge="", subject=None, grounding=None):
    """Score one enriched lesson end to end: QA checks, budget, grounding, judge.

    The single call Stage C makes. Everything it depends on that is not pure
    is resolved here, once.
    """
    checks = reviewer("qa_checks").run_checks(lp, segment)
    # `tally` returns (total, denom, flags), and a denominator of zero means
    # every check came back notAssessable — an unscored lesson, not a zero.
    total, denom, _ = reviewer("score_lp").tally(review, subject) if review \
        else (0, 0, [])
    judge_pct = round(100.0 * total / denom, 1) if denom else None
    score = compose(checks, judge_pct=judge_pct, judge=judge, review=review,
                    body=lp.get("generated", lp), grounding=grounding)
    return score, verdict(score)
