"""Stage D0 — primary (G1-5) slide-script transform.

Enrichment JSON (Stage C, gate-passed) -> lp_doc v3.0 for the v9 HTML renderer.

This is the format fork described in spec/01-format.md: G1-5 leaves the image
path (one Nano-Banana call per printed page) for the deterministic HTML path
already used by G6-12.

Move coding is applied HERE, in code, not by a model. `steps[].phase` in the
enrichment already carries I-Do / We-Do / You-Do with its own minutes; this
module maps it onto lp_doc's closed block enum (see d0_blocks).

ONE HOME PER SOURCE FIELD. The render is paper. A field printed in two places
costs two pages' worth of paper to say one thing, and an earlier pass of this
module spent 34% of every lesson that way -- the SLO four times, the key fact
four times, the exit ticket three times. Each of the 26 enrichment fields now
renders in exactly one place, and where v9 offers two homes for it the teach
page wins and the page2 surface goes dark (see d0_page2.NO_PRIMARY_SOURCE).

Two enrichment fields are deliberately never printed: `scope_declaration` is a
generation guard for Stage C ("ONE lesson, ONE class period..."), and `segment_id`
is a pipeline key that already rides in `lesson_id`. Neither is teacher content.

Nothing is trimmed to fit. If the result is over cap the renderer FAILS and
that is the answer (spec/00-program.md, binding working rules).
"""

from __future__ import annotations

import d0_blocks as B
import d0_bigidea
import d0_board
import d0_diagram
import d0_hook
import d0_page2

# v9's `lp_type` is a G6-12 vocabulary and primary's is a different axis
# (content / revision / assessment). The schema enum is closed, so D0 maps onto
# the variant whose published definition matches primary's spine:
#   STEM-2 "worked example (I do) · faded practice (We do) · independent (You do)"
#   LL-2   "teacher annotates aloud (I do) · class together (We do) · unaided (You do)"
#   RECALL "recall-floor: secure the facts, active retrieval, extend after"
# G1-5 has no FBISE board surface, so the exam-facing half of those definitions
# does not apply. The primary type is preserved verbatim in notes.supplied.
LANGUAGE_SUBJECTS = {"english", "urdu"}


def _lp_type(primary_type, subject):
    if (primary_type or "").lower() in ("revision", "assessment"):
        return "RECALL"
    return "LL-2" if (subject or "").lower() in LANGUAGE_SUBJECTS else "STEM-2"


BLOOM_TO_LEVEL = {
    "remember": "K", "understand": "U", "apply": "A",
    "analyze": "A", "analyse": "A", "evaluate": "A", "create": "A",
}

# lp_doc's section ids are a closed enum. Primary's five moves map onto them:
#   Warm-up + hook -> introduction     I Do  -> development
#   We Do / You Do -> activity         Check -> conclusion      HW -> homework
SECTION_ORDER = ["introduction", "development", "activity", "conclusion", "homework"]


def _medium(book_stem: str) -> str:
    return "ur" if book_stem.endswith("_urdu") else "en"


def _intro(g, page):
    """THE ONE OPENING BOX (operator's page map).

    *"kie.ai has a Warm Up and Opening boxes, thgere should be 1 opening box that first
    has a warm up that helps kids settle and prepare for activating prior knowledge /
    then the actual hook to engage students with a provocation to help link prior
    knowledge to the new concept being introduced"* -- so: warm-up, then hook, inside one
    section, in that order. `sec["warmup"]` prints above `blocks`, which is that order.

    The hook is no longer one block. `hookStory` runs the teacher's DO, her ASK and her
    READ-ALOUD together in a single 84-word string, and printing it whole is what made
    page 1 a wall; d0_hook splits it into the three without dropping a word.
    """
    warm = g.get("warmUp") or {}
    blocks = []
    hook = (g.get("hookStory") or "").strip()
    items = B.warmup_items(warm)
    # No `look_for` and no `closed_by`: both were filled with keyFact, which is the
    # lesson's outcome and prints once, in the outcome box.
    blocks += d0_hook.hook_blocks(hook)
    say = B.hook_character_block(g.get("hookCharacters"), hook)
    if say:
        blocks.append(say)
    kw = B.keywords_block(g.get("keyWords"), page)
    if kw:
        blocks.append(kw)
    # WRITE ON THE BOARD closes page 1 -- last thing she reads before she starts.
    board = d0_board.board_block(g.get("boardWork"))
    if board:
        blocks.append(board)
    # OPENING, not "Warm-up and hook" -- operator: *"Warm Up and Hook should come under
    # opening header"*. The band names the PHASE of the lesson and the warm-up and the hook are
    # both contents of it (SYNC 3.22 made the opening ONE box, settle then provoke), so naming
    # the band after its two parts said twice what the box already labels once.
    sec = {"id": "introduction", "title": "Opening",
           "minutes": int(warm.get("minutes") or 0), "blocks": blocks}
    if items:
        sec["warmup"] = {"items": items}
    return sec


def _development(g):
    """The Big Idea, then I Do — the modelled move, then whatever the worked example adds."""
    ido = B.steps_by_phase(g.get("steps"), "I-Do")
    # THE BIG IDEA opens EXPLANATION, ahead of I Do: a teacher cannot model a distinction
    # she has not been told. Printed after the worked example it reads as a footnote to
    # teaching that already happened, which is why the seat is index 0 and not appended.
    blocks = [d0_bigidea.big_idea_block(g.get("bigIdea"))]
    ido_blk = B.i_do_block(ido)
    if ido_blk:
        blocks.append(ido_blk)
    # No `board` block here: boardWork.content prints once, at the end of page 1
    # (d0_board.board_block). boardWork.instruction is not printed at all -- see there.
    we = (g.get("workedExample") or "").strip()
    if we:
        said = B.move_lines(g.get("steps") or [])
        steps = B.drop_lines_already_said(
            [l.strip() for l in we.split("\n") if len(l.strip()) >= 2], said)
        if steps:
            blocks.append({"type": "worked_example", "id": "worked",
                           "title": "Worked example", "steps": steps})
    # EXPLANATION + an I DO tag -- operator: *"Explanation header with an I Do tag on the
    # extreme right to understand the moves"*. `title` is the phase, `move` is what she DOES
    # inside it, and they are two fields because she asked for a POSITION (the extreme right)
    # which a single string cannot carry. The renderer prints `move` as an amber pill after the
    # minutes; see bar() in template.js, SYNC 3.28.
    return {"id": "development", "title": "Explanation", "move": B.MOVE_TITLE["I-Do"],
            "minutes": B.minutes_of(ido), "blocks": blocks}


def _activity(g):
    """We Do (guided) then You Do (independent), with differentiation."""
    wedo = B.steps_by_phase(g.get("steps"), "We-Do")
    youdo = B.steps_by_phase(g.get("steps"), "You-Do")
    blocks = [b for b in [B.we_do_block(wedo, g.get("partnerActivity"))] if b]
    blocks += B.you_do_blocks(youdo, g.get("problems"))
    # No `support_extension` block: weakLearnerSupport and challengeExtension are
    # v9's differentiation pair and print once, on page2.differentiation.
    return {"id": "activity", "title": "We Do · You Do",
            "minutes": B.minutes_of(wedo) + B.minutes_of(youdo), "blocks": blocks}


def _conclusion(g):
    """Exactly one exit ticket (spec/01-format.md), plus the check for understanding."""
    et = g.get("exitTicket") or {}
    task = (et.get("task") or "").strip()
    criteria = (et.get("success_criteria") or "").strip()
    blocks = []
    cfu = (g.get("cfuExplain") or "").strip()
    if len(cfu) >= 3:
        # No `look_for`: it was `success_criteria`, which is the exit ticket's
        # ANSWER and prints there. Measured on the corpus, that one line printed
        # twice in 30 of 38 lessons. cfuExplain is an instruction to the teacher
        # ("ask for the clue, not the word"), and it needs no answer beside it.
        blocks.append({"type": "ask", "id": "cfu", "question": cfu})
    # No key_points echo of keyFact (it is the outcome) and no `checkpoint`:
    # v9's checkpoint is a board-style NEW-context question, and primary's
    # exitTicket is already exactly that. spec/01-format.md: ONE exit ticket.
    sec = {"id": "conclusion", "title": "Check", "minutes": 0, "blocks": blocks}
    if len(task) >= 5 and criteria:
        sec["exit_ticket"] = [{"q": task, "a": criteria}]
    return sec


def _homework(g):
    hw = (g.get("homework") or "").strip()
    blocks = [{"type": "key_points", "id": "hw", "title": "Homework", "items": [hw]}] \
        if len(hw) >= 3 else []
    return {"id": "homework", "title": "Homework", "minutes": 0, "blocks": blocks}


def _objectives(g):
    """Section O is ONE box: the outcome, its SLO citation, then the objectives.

    v9 gives Section O three text slots -- `outcome`, `slo.text_verbatim` and
    `objectives.items[].text`. A G6-12 author fills all three with DIFFERENT
    strings: a pupil-facing outcome, the board-verbatim SLO, and two or three
    authored objectives ("Two or three objectives... Each is modelled, practised
    in class AND assessed today", schema).

    Primary Stage-C authors two of the three. `keyFact` is the outcome and
    `slo_statement` is the citation. There is no third: nothing in the 26
    enrichment fields is a lesson objective. An earlier pass filled the slot by
    reprinting slo_statement, so the same sentence appeared twice inside one box,
    which is what it looked like on paper.

    The nearest candidates were checked and rejected as proxies: `scope_declaration`
    is a generation guard ("ONE lesson, ONE class period..."), not something a
    pupil does, and `keyFact` is already the outcome. So the slot goes dark and
    names what is missing -- which is also the note Stage-C needs in order to
    author it.
    """
    statement = (g.get("slo_statement") or "").strip()
    codes = [c for c in (g.get("slo_refs") or []) if c][:5]
    outcome = (g.get("keyFact") or "").strip() or statement
    return {"outcome": outcome,
            "items": [{"text": B.DESIGN_PENDING,
                       "slo_code": codes[0] if codes else None}]}


def _one_screen(g):
    parts = [(g.get("keyFact") or "").strip(),
             ((g.get("exitTicket") or {}).get("task") or "").strip()]
    return "\n\n".join(p for p in parts if p) or B.DESIGN_PENDING


def to_lp_doc(enr, page_truth, day=None, total_days=None, seq=None, topic=None):
    """Build an lp_doc v3.0 from one gate-passed enrichment record.

    `enr`        the enrichment file (its `generated` payload)
    `page_truth` one Stage-A page record, for provenance only
    `day`,`total_days`  drive the chapter progress rail (spec/01-format.md)
    `seq`        {"previous","next","checkpoint"} topic labels, or None
    `topic`      the row's own topic from the curriculum matrix, e.g. "Chapter
                 Vocabulary + Dance Moves (Memory Lane)". This is the page HEADER,
                 the continuation strip, the page2 title and the browser title --
                 four printings, so it must be a NAME. An earlier pass put the
                 216-character SLO sentence here and it filled the header.
    """
    g = enr["generated"]
    pt = page_truth or {}
    stem = pt.get("book_stem") or ""
    chapter = pt.get("chapter") or {}
    page = pt.get("printed_page_number")

    # THE THREE ANCHORED DIAGRAM SLOTS (bd-abkz9). Additive: no `diagrams` key means no
    # call does anything, which is every corpus lesson today. A spec that cannot be seated
    # is dropped whole and says why in notes.gaps -- see d0_diagram.
    sections = [_intro(g, page), _development(g), _activity(g),
                _conclusion(g), _homework(g)]
    dia_gaps = d0_diagram.apply_slots(sections, g.get("diagrams"))

    doc = {
        "lesson_id": enr["lesson_id"].upper(),
        "schema_version": "3.0",
        "lint_profile": "full",
        "provenance": {
            "book_stem": stem,
            "grade": pt.get("grade"),
            "subject": pt.get("subject"),
            "medium": _medium(stem),
            "chapter": f"Ch.{chapter.get('number')} · {chapter.get('title')}",
            "topic": (topic or "").strip() or chapter.get("title") or "",
            "printed_pages": str(page or ""),
            "pdf_pages": str(pt.get("pdf_page_index") or ""),
            "page_offset": (pt.get("pdf_page_index") or 0) - (page or 0),
        },
        "slo": {
            "code": (g.get("slo_refs") or [None])[0],
            "text_verbatim": g.get("slo_statement") or "",
            "source_page": str(page or ""),
            "cognitive_level": BLOOM_TO_LEVEL.get((g.get("bloom") or "").lower(), "U"),
        },
        "lp_type": _lp_type(enr.get("lp_type"), pt.get("subject")),
        "period_minutes": int(g.get("duration_min") or 0),
        "materials": g.get("materials") or [],
        "objectives": _objectives(g),
        "sections": sections,
        "page2": d0_page2.build(g),
        "one_screen": _one_screen(g),
        "notes": {
            "supplied": [f"primary lp_type: {enr.get('lp_type') or 'content'}"],
            "gaps": [n for n in (g.get("notes") or []) if isinstance(n, str)] + dia_gaps,
        },
        "needs_human_review": bool(enr.get("needs_human_review")),
    }
    if day and total_days:
        doc["sequence"] = {
            # bd-vbs5w: `day`/`of` are the rail's own integers. The renderer draws one pip
            # per day and fills the current one, so it needs numbers, not a sentence to
            # re-parse; `this` stays because it is what the renderer prints INSTEAD of the
            # rail when the chapter is too long to draw pips for.
            "day": int(day),
            "of": int(total_days),
            "this": f"Day {day} of {total_days}",
            "previous": (seq or {}).get("previous"),
            # nextTopicPreview prints once, on page2.next_period.
            "next": (seq or {}).get("next"),
            "checkpoint": (seq or {}).get("checkpoint"),
        }
    return doc
