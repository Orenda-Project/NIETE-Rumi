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

  W1, the word budget. `spec/07-lp-production.md` §4, DECIDED B. Over cap
  fails: the renderer never trims. It is measured on the RENDERED D0
  document, because the budget is a property of the printed page — §4's caps
  exist to keep the p90 lesson inside the 5-8 phone-page band, and the
  Stage-C body has no pages.

  That artifact was wrong when this gate shipped on 18 Sep 2026, and so was
  the surface match. `wordbudget` read dict KEYS while a capped surface is a
  block TYPE, and `evaluate` handed it the Stage-C body, which carries no
  blocks at all. On `grade_1_english_ch1_seg1` the render broke three of the
  five caps — `faded_example` 627/470, `worked_example` 515/470, `key_points`
  367/120 — and the gate reported nothing. Worse, the body's
  `instance_ledger.worked_example` is a real dict key holding five words of
  provenance, so the result was non-empty and the not-checked net below never
  fired either.

  G1, page grounding. `qa_checks` H5 asks whether the segment CARRIES a page
  reference. It cannot ask whether that page exists in the book and belongs to
  the segment's chapter, because it has never seen the book. Grade 5 Urdu
  prints pages 130-137 twice, so those are different questions, and the whole
  no-fabrication guarantee rests on the second one.

Both enter as entries in `qa_hard_failures` rather than as a forked gate. The
thresholds in `production_gate` were calibrated on real scores; re-deriving
them here to bolt on two checks would throw that calibration away for nothing.

What a check did NOT look at is recorded in `not_checked` rather than counted
as a pass. A document carrying no capped block has not been measured — on a
render that is not "inside budget", it is "this is not a render" — and a
lesson scored without its book has no page to resolve. Calling either a pass
is the one way this gate could quietly become decoration, and for one day it
did.
"""
import os
import sys

import d0_route
import wordbudget
import wslint
import wssoft

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


def _budget_failures(render):
    """The word budget as hard failures, one per surface over its cap."""
    return [{"id": "W1",
             "name": "%s is %d words, cap %d (over by %d)"
                     % (f["surface"], f["words"], f["cap"], f["over"])}
            for f in wordbudget.over(render)]


def _grounding_failure(grounding):
    """An unresolved segment, named by the reasons `pageres` gave."""
    reasons = sorted({f.get("reason", "?") for f in grounding.get("flags", [])})
    return {"id": "G1",
            "name": "pages do not resolve in the book: "
                    + (", ".join(reasons) or "unknown")}


def worksheet_findings(lp, segment):
    """The lint's findings for a 995, or None because this is not one.

    The single place that decides, so a content lesson cannot be measured
    against worksheet rules by accident and a worksheet cannot escape them.
    """
    if d0_route.kind(lp, segment) != "assessment":
        return None
    return wslint.findings(lp, segment)


def compose(qa, judge_pct=None, judge="", review=None, render=None,
            grounding=None, lint=None):
    """Build the score dict `production_gate.gate` reads.

    `qa` is a `qa_checks.run_checks` result, run over the Stage-C body it was
    written for. `judge_pct` is the v3 rubric percentage from `score_lp`.
    `render` is the D0 document the word budget measures. `render` and
    `grounding` are optional; leaving one out records its check as not looked
    at, never as passed.
    """
    failures = list(qa.get("hard_failures") or [])
    not_checked = []

    if judge_pct is None:
        failures.append({"id": "not-judged",
                         "name": "no judge score — the lesson was never rated"})

    # A soft score of None is not a soft score of zero. It means nothing
    # measured that half. Averaging a real judge score against an absence
    # would report a number nobody computed, so the composite simply does not
    # form and `S1` says why. A worksheet used to land here always; `wssoft`
    # now measures it, and a suite may still hand back individual checks it
    # could not measure — those come through by their own ids, not as `S1`.
    soft = qa.get("soft_pct")
    if soft is None:
        not_checked.append("S1")
    not_checked.extend(qa.get("not_checked") or [])
    composite = (None if judge_pct is None or soft is None
                 else (judge_pct + soft) / 2.0)

    # A document carrying none of the five capped BLOCKS has not been
    # measured — it has been looked past. `wordbudget` returns no findings
    # either way, so the distinction has to be drawn here or the budget
    # quietly stops applying the first time the wrong artifact arrives. It
    # did: handed the Stage-C body, which has no blocks, this read as clean.
    #
    # A worksheet is the one artefact for which W1 is not "unmeasured" but
    # "inapplicable": it has no `key_points` and never will. Its own lint
    # takes W1's place, so `lint` being a list — even an empty one — is the
    # signal that this is a 995 and the caps are not the question.
    if lint is not None:
        failures.extend({"id": f["id"], "name": f["name"]} for f in lint)
    elif render is None or not wordbudget.totals(render):
        not_checked.append("W1")
    else:
        failures.extend(_budget_failures(render))

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
            "checks": list(qa.get("checks") or []),
            "judge_pct": judge_pct,
            "composite_pct": composite,
            "judge": judge,
            "review": review if review is not None else {},
            "grounding_flags": flags,
            "not_checked": not_checked}


def _worksheet_qa(lp, segment):
    """The checks for a 995: its own lint and its own soft suite, nothing borrowed.

    `qa_checks` is the LESSON suite. It asks for `warmUp`, `steps` and
    `exitTicket`, and a student worksheet has none of the three and never
    will. Run against the real `grade_1_english_ch1_seg995` — ten questions,
    32 marks, clean on every one of WS-01..WS-16 — it produced six hard
    failures the artefact cannot ever clear. A gate that does that is a gate
    somebody switches off, and the one check that does apply goes with it.

    So the lint replaces it whole, exactly as it already replaces W1 inside
    `compose`, and `worksheet_findings` stays the single place that decides
    which artefact is in hand.

    The soft half is `wssoft`, which asks the questions a lint may not refuse
    on — variety beyond the floor, an mcq whose answer is among its own
    options, a key that is not one answer repeated, a writing space that fits
    the answer, an instruction inside the grade's reading band. Until it
    existed this returned `soft_pct: None` and `compose` reported `S1`; the
    composite could not form, so a judged worksheet still could not be gated.
    """
    soft = wssoft.checks(lp, segment)
    return {"hard_pass": True, "hard_failures": [],
            "soft_pct": soft["soft_pct"], "checks": soft["checks"],
            "not_checked": soft["not_checked"]}


def verdict(score):
    """Run the imported, calibrated v1.1 gate over a composed score."""
    gate = reviewer("production_gate").gate
    if score.get("composite_pct") is None:
        # An unscored lesson is not a zero-quality lesson, but it is not a
        # passing one either, and the bar comparison needs a number.
        score = dict(score, composite_pct=0.0)
    return gate(score)


def evaluate(lp, segment, review, judge="", subject=None, grounding=None,
             render=None):
    """Score one enriched lesson end to end: QA checks, budget, grounding, judge.

    The single call Stage C makes. Everything it depends on that is not pure
    is resolved here, once.

    Two artifacts, deliberately both named. `lp` is the Stage-C envelope, and
    its camelCase v9 `generated` body is what the imported `qa_checks` reads.
    `render` is the D0 document, and it is what the word budget measures.
    Passing the body where the render belongs is how the budget went
    unenforced for a day, so the caller says which is which.
    """
    lint = worksheet_findings(lp, segment)
    checks = _worksheet_qa(lp, segment) if lint is not None else \
        reviewer("qa_checks").run_checks(lp, segment)
    # `tally` returns (total, denom, flags), and a denominator of zero means
    # every check came back notAssessable — an unscored lesson, not a zero.
    total, denom, _ = reviewer("score_lp").tally(review, subject) if review \
        else (0, 0, [])
    judge_pct = round(100.0 * total / denom, 1) if denom else None
    score = compose(checks, judge_pct=judge_pct, judge=judge, review=review,
                    render=render, grounding=grounding, lint=lint)
    return score, verdict(score)
