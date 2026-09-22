"""Stage D0 — the support page (page2) for the primary lp_doc.

v9's page2 is the G6-12 teacher's REFERENCE half: the finished board, a model
answer for every item, the mistakes to expect, differentiation, the homework key,
the coach corner and an exam bank. The schema makes eight of those REQUIRED.

Primary does not have that half. Measured on the G4 Ch9 corpus (38 segments,
26 enrichment fields, all present in all 38), only three of the eight have a
source that is not already printed on the teach pages:

    differentiation <- weakLearnerSupport + challengeExtension  (moved here)
    next_period   <- nextTopicPreview   (moved here; the day rail no longer repeats it)

    board_final   <- boardWork.instruction   (STORED, NOT PRINTED -- see below)

`board_final` is required by the schema, so it is still emitted, but it no longer
reaches paper. Its only primary source is `boardWork.instruction`, the draw script --
"Draw the five-line cinquain ladder and the grammar choice arrows" -- and the operator
has ruled that off the page: *"its a block of text that should show clearly how it
should be ordered rather than give a script of what to draw and how"*.

The suppression is the RENDERER's, not this module's, and deliberately so. v9 hoists
`board_final` out of page2 and prints it beside the teach page's own ON THE BOARD note
(template.js boardPlanAtoms), so a D0 that emitted nothing would be asking the schema
to bend for one grade band. Instead `boardPlanAtoms` now drops the plan when the flow
already carries a board laid out in panels -- a plan for a board is worth nothing once
the board is on the page, whatever grade wrote it. The field stays in the document for
Stage C and for lint; it simply has nowhere left to print.

The other five have NO primary source of their own:

    model_answers — the textbook problems and their solutions print once, on the
                    teach page, beside the YOU DO items where the teacher needs them.
    homework_key  — primary sets no answerable homework; the task prints in §HW.
    mistakes      — `subject_elements.misconception_preempt` is the nearest thing
                    and it is present in 13 of 38 segments.
    exam_bank     — primary has no board exam at all.

Those five carry DESIGN_PENDING. Nothing here copies a field that already prints
on the teach pages: a duplicated field costs paper twice, and an earlier pass
spent 34% of every page that way.
"""

from __future__ import annotations

from d0_blocks import DESIGN_PENDING

# The five surfaces v9 requires and primary cannot fill. Kept as data so the
# render, the gate report and the enrichment backlog all read the same list.
NO_PRIMARY_SOURCE = ("model_answers", "homework_key", "exam_bank", "mistakes")


def _mistakes(g):
    """Prefer the subject-specific misconception pre-empt; never fabricate one."""
    se = g.get("subject_elements") or {}
    raw = se.get("misconception_preempt")
    out = []
    for m in raw if isinstance(raw, list) else [raw] if raw else []:
        if isinstance(m, str) and len(m) >= 3:
            # A STRING pre-empt is a TEACHER MOVE, not a pupil error: the corpus writes it
            # as an instruction she performs ("Explicitly contrast the two apostrophe
            # purposes before the pairs work"). The box is labelled "What pupils write" /
            # "You ask", so filing it on the left put her own move in a child's mouth and
            # left the column she actually reads blank. It goes in the teacher-move slot,
            # and the error stays dark because Stage C did not author one -- reverse-
            # engineering the error from the move would be inventing a proxy.
            out.append({"pupil_says": DESIGN_PENDING, "you_ask": m})
        elif isinstance(m, dict):
            says = (m.get("misconception") or m.get("pupil_says")
                    or m.get("error") or "").strip()
            asks = (m.get("correction") or m.get("you_ask")
                    or m.get("preempt") or m.get("teacher_move") or "").strip()
            if len(says) >= 3:
                out.append({"pupil_says": says, "you_ask": asks or DESIGN_PENDING})
    return out or [{"pupil_says": DESIGN_PENDING, "you_ask": DESIGN_PENDING}]


def _draw_order(board):
    """`boardWork.instruction`, split into its authored sentences.

    Emitted because `page2.board_final.draw_order` is required and minItems 1. NOT
    printed: see the module docstring, and boardPlanAtoms in the renderer.
    """
    order = [l.strip() for l in (board.get("instruction") or "").split(". ") if l.strip()]
    return order or [DESIGN_PENDING]


def build(g):
    support = (g.get("weakLearnerSupport") or "").strip()
    extend = (g.get("challengeExtension") or "").strip()
    return {
        "board_final": {"draw_order": _draw_order(g.get("boardWork") or {})},
        "differentiation": {
            "stuck": support or DESIGN_PENDING,
            # v9 asks for a separate language/access barrier move. Primary carries
            # one support strategy, not two, so this stays dark rather than echo it.
            "barrier": DESIGN_PENDING,
            "early": extend or DESIGN_PENDING,
        },
        "next_period": (g.get("nextTopicPreview") or "").strip() or DESIGN_PENDING,
        "coaching_reflection": (g.get("coachingReflection") or "").strip() or DESIGN_PENDING,
        # bd-18os1. OPERATOR: *"coaching corner should hve a look for"*. This field carried
        # DESIGN_PENDING in every document ever built, and the docstring above explains why:
        # the only candidate was `cfuExplain`, a teach-time check that already prints in front
        # of the class. Enrichment now authors `coachingLookfor` -- what a COACH watching the
        # lesson looks for -- which is a different question from the one `coachingReflection`
        # asks the teacher to count afterwards. A field with a source of its own is not dark.
        "coaching_lookfor": (g.get("coachingLookfor") or "").strip() or DESIGN_PENDING,
        # --- the five with no primary source (see module docstring) ---
        "model_answers": [{"ref": DESIGN_PENDING, "answer": DESIGN_PENDING}],
        "homework_key": [{"ref": DESIGN_PENDING, "answer": DESIGN_PENDING}],
        "mistakes": _mistakes(g),
        "exam_bank": {},
    }
