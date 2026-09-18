"""Stage D0 — what the close prints, and where the check sits.

Split out of `d0_primary` when that file passed the 300-line limit. One topic: the last
two sections of the plan (CHECK and HOMEWORK) and the one pass that has to run after the
diagram slots, because a diagram swaps a block out whole and would take the check with it.

Operator's page map for the close: *"exit ticket only 1 related to the SLO and lesson, HW,
remember and coaching corner"*.
"""

from __future__ import annotations

import d0_blocks as B


def conclusion(g):
    """Exactly one exit ticket (spec/01-format.md), and the one line to remember.

    The check for understanding used to sit here as a stand-alone `ask`. It closes the
    worked example now (`_seat_the_check`): a check printed pages after the modelling it
    checks is a check the teacher reads too late.
    """
    et = g.get("exitTicket") or {}
    task = (et.get("task") or "").strip()
    criteria = (et.get("success_criteria") or "").strip()
    # REMEMBER -- operator's page map: *"exit ticket only 1 related to the SLO and lesson,
    # HW, remember and coaching corner"*. Nothing in the 26 enrichment fields is a remember
    # line, and the nearest candidate was rejected rather than used as a proxy: `keyFact`
    # IS the outcome and already prints in the page-1 outcome box, so reprinting it here
    # would re-commit the repetition the operator has complained about three times. Dark
    # stages stay dark -- the surface is built and names what is missing, which is also the
    # note Stage-C needs in order to author it.
    #
    # A `key_points` block with a `title`, not a new block type: the schema documents
    # `title` as "Overrides the printed \"Key points\" label", which is exactly the
    # mechanism `hw` already uses. Zero schema change, zero renderer change.
    #
    # It also keeps `blocks` at its schema minimum of 1 now that the CFU has left, which
    # would otherwise make every corpus conclusion invalid.
    blocks = [{"type": "key_points", "id": "remember", "title": "Remember",
               "items": [B.DESIGN_PENDING]}]
    # No key_points echo of keyFact (it is the outcome) and no `checkpoint`:
    # v9's checkpoint is a board-style NEW-context question, and primary's
    # exitTicket is already exactly that. spec/01-format.md: ONE exit ticket.
    sec = {"id": "conclusion", "title": "Check", "minutes": 0, "blocks": blocks}
    if len(task) >= 5 and criteria:
        sec["exit_ticket"] = [{"q": task, "a": criteria}]
    return sec


def seat_the_check(sections, g):
    """Seat `cfuExplain` in the box it checks, in place. Nothing to check, and it stays put.

    Operator: *"worked example should be better formatted ending with a CFU like usual"*.
    `cfuExplain` is an instruction to the teacher ("ask for the clue, not the word") and it
    needs no answer beside it -- no `look_for`, which used to be `success_criteria` and
    printed that one line twice in 30 of the corpus's 38 lessons.

    RUNS AFTER THE DIAGRAM SLOTS, and that ordering is the whole reason this is a separate
    pass. `apply_slots` swaps a block out WHOLE, so a check written onto the worked example
    before the explanation diagram replaced it would leave the document inside the block it
    was attached to. Seating it last means the question survives the swap.
    """
    cfu = (g.get("cfuExplain") or "").strip()
    if len(cfu) < 3:
        return
    dev = [s for s in sections if s["id"] == "development"]
    boxes = [b for b in (dev[0]["blocks"] if dev else [])
             if b.get("type") == "worked_example"]
    if boxes:
        # The LAST one. The check belongs between the modelling and the guided turn, not
        # between two modelled examples.
        boxes[-1]["cfu"] = cfu
        return
    # No box to close: the check keeps its old seat rather than falling on the floor.
    concl = [s for s in sections if s["id"] == "conclusion"][0]
    concl["blocks"].insert(0, {"type": "ask", "id": "cfu", "question": cfu})


def homework(g):
    hw = (g.get("homework") or "").strip()
    blocks = [{"type": "key_points", "id": "hw", "title": "Homework", "items": [hw]}] \
        if len(hw) >= 3 else []
    return {"id": "homework", "title": "Homework", "minutes": 0, "blocks": blocks}
