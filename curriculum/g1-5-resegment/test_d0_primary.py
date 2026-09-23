"""Stage D0 primary transform — unit tests.

Run: python3 -m pytest test_d0_primary.py -q     (or: python3 test_d0_primary.py)
"""

import json

import d0_primary as d0

ENR = {
    "lesson_id": "grade_4_english_ch9_seg1",
    "lp_type": "content",
    "gate_pass": True,
    "needs_human_review": False,
    "generated": {
        "slo_refs": ["E-04-VO-01", "E-04-RD-01"],
        "slo_statement": "Students will guess the meaning of new words.",
        "bloom": "understand",
        "duration_min": 30,
        "materials": ["chalk", "board"],
        # bd-c5miz / bd-t4iur. This read "Turn to a partner." -- a BANNED move, and the
        # shared fixture is the next author's example. OPERATOR: *"teachers dont let
        # students talk to each other, that too when the class begins"*. It now carries
        # the method she named herself, which is also what d0_warmscript seats.
        "warmUp": {"minutes": 4,
                   "script": ("Write the word in your copy. When I clap, the whole class "
                              "says it together and you tick or fix your own."),
                   "items": [{"class_check": "whole-class", "prompt": "Recall one word.",
                              "expected_answer": "Varies."}]},
        "hookStory": "Show textbook p.102.",
        "hookCharacters": [
            {"name": "Pinky", "role": "speaking", "position": "p.102",
             "speechBubble": "Can you show what these words mean?"},
            {"name": "girl avatar", "role": "illustrative", "position": "p.102",
             "speechBubble": None},
        ],
        "keyWords": [{"term": "sway", "urdu_gloss": "ہلنا", "syllables": "sway",
                      "student_definition": "to move slowly from side to side"}],
        "boardWork": {"instruction": "Draw four labelled boxes. Add arrows.",
                      "content": "sway -> side to side"},
        "steps": [
            {"phase": "I-Do", "minutes": 6, "action": "Model two words.", "say": "I read the title."},
            {"phase": "We-Do", "minutes": 9, "action": "Try together.", "say": "Say it with me."},
            {"phase": "You-Do", "minutes": 8, "action": "On your own.", "say": ""},
        ],
        "workedExample": "word: crescendo\n1. Read the definition.",
        "partnerActivity": {"structure": "Pairs rehearse.", "dialogueFrameA": "Our word is __.",
                            "dialogueFrameB": "I agree because __.", "teacher_role": "Circulate."},
        "problems": [{"prompt": "Show 'sway'.", "status": "solved", "solution": "Move side to side."}],
        "weakLearnerSupport": "See-Say-Show.",
        "challengeExtension": "Make two linked explanations.",
        "exitTicket": {"task": "Which word fits the dance in the poem?",
                       "success_criteria": "Correct if the student writes crescendo and says why.",
                       "self_prediction": "Draw a face."},
        "homework": "Read the four words aloud.",
        "keyFact": "Use title, picture and action to guess a word.",
        "cfuExplain": "Ask for the clue, not the word.",
        "coachingReflection": "Check they used evidence.",
        "nextTopicPreview": "Next: begin the poem.",
        "notes": ["gap: prior lesson not supplied"],
    },
}

PT = {"book_stem": "grade_4_english", "grade": 4, "subject": "English",
      "printed_page_number": 102, "pdf_page_index": 106,
      "chapter": {"number": 9, "title": "The Dancing Poem"}}


TOPIC = "Chapter Vocabulary + Dance Moves (Memory Lane)"


def build():
    return d0.to_lp_doc(ENR, PT, day=1, total_days=10, topic=TOPIC)


def test_section_ids_are_the_closed_enum_in_order():
    doc = build()
    assert [s["id"] for s in doc["sections"]] == [
        "introduction", "development", "activity", "conclusion", "homework"]


def test_the_first_two_sections_are_named_by_the_lesson_phase():
    """Operator: *"Warm Up and Hook should come under opening header / Explanation header
    with an I Do tag on the extreme right to understand the moves"*.

    The band names the PHASE -- OPENING, then EXPLANATION -- because the warm-up and the
    hook are both contents of the one opening box (SYNC 3.22 made it one box), and "I Do"
    is a MOVE, not a phase: it is what the teacher does inside the explanation.
    """
    doc = build()
    assert doc["sections"][0]["title"] == "Opening"
    assert doc["sections"][1]["title"] == "Explanation"


def test_the_move_rides_the_section_as_its_own_field():
    """So the renderer can put it where she asked -- the extreme right of the bar -- rather
    than folding it into the name. Additive, and only where there is a move to name:
    a section without one carries no key, which is also why G6-12 is untouched.
    """
    doc = build()
    assert doc["sections"][1]["move"] == "I DO"
    assert [s["id"] for s in doc["sections"] if "move" in s] == ["development"]


def test_the_move_is_named_once_on_the_page():
    """ONE HOME PER SOURCE FIELD. The bar says I DO; the amber box says what the box is
    for. Printing "I DO" twice within four centimetres of page is exactly the duplication
    this profile exists to remove.
    """
    ido = [b for b in _blocks(build(), 1) if b.get("id") == "i-do"][0]
    assert ido["title"] == "Teacher models"




def test_minutes_sum_within_the_period():
    doc = build()
    total = sum(s["minutes"] for s in doc["sections"])
    assert total <= doc["period_minutes"], f"{total} > {doc['period_minutes']}"


def test_exactly_one_exit_ticket():
    """spec/01-format.md: one exit ticket, not three."""
    assert len(build()["sections"][3]["exit_ticket"]) == 1



def test_urdu_medium_detected_from_book_stem():
    pt = dict(PT, book_stem="grade_4_urdu")
    assert d0.to_lp_doc(ENR, pt)["provenance"]["medium"] == "ur"
    assert build()["provenance"]["medium"] == "en"


def test_progress_rail_carries_day_of_total():
    assert build()["sequence"]["this"] == "Day 1 of 10"


def test_the_rail_also_carries_the_two_numbers_it_draws_from():
    """bd-vbs5w. The G1-5 renderer draws a numbered pip per day and fills the
    current one, which needs the integers, not the sentence -- re-parsing
    "Day 1 of 10" in the renderer would put a second reading of one fact in a
    second language. `this` stays, because it is the fallback the renderer
    prints when the rail cannot be drawn (a chapter too long to draw pips for).
    """
    sq = build()["sequence"]
    assert sq["day"] == 1 and sq["of"] == 10
    assert all(isinstance(sq[k], int) for k in ("day", "of"))


def test_no_day_and_no_total_means_no_sequence_at_all():
    """The numbers are additive: a caller that supplies neither gets the
    document it got before, with no sequence key to render."""
    assert "sequence" not in d0.to_lp_doc(ENR, PT)



def test_required_top_level_keys_present():
    doc = build()
    for k in ["lesson_id", "schema_version", "provenance", "slo", "lp_type",
              "period_minutes", "materials", "objectives", "sections",
              "page2", "one_screen"]:
        assert k in doc, k


def _blocks(doc, idx):
    return doc["sections"][idx]["blocks"]


def test_move_phases_map_to_their_own_block_types():
    """I Do -> worked_example, We Do -> faded_example, You Do -> practice.

    Applied in code, never by a model. We Do is the schema's faded_example, which
    carries `steps`; mapping it onto `practice` forced the teacher's script into
    `items` and printed a fabricated answer beside each line.
    """
    kinds = [b["type"] for b in _blocks(build(), 2)]
    assert kinds[0] == "faded_example"
    prac = [b for b in _blocks(build(), 2) if b["type"] == "practice"][0]
    assert prac["mode"] == "independent"
    assert "guided" not in json.dumps(build(), ensure_ascii=False)


def test_i_do_is_a_worked_example_carrying_its_own_minutes():
    """The move badge is a real number from steps[].minutes, not an author guess."""
    ido = [b for b in _blocks(build(), 1) if b.get("id") == "i-do"][0]
    assert ido["type"] == "worked_example"
    assert ido["minutes"] == 6


def test_i_do_stays_out_of_activity():
    doc = build()
    dev = json.dumps(doc["sections"][1])
    act = json.dumps(doc["sections"][2])
    assert "Model two words." in dev and "Model two words." not in act


def test_the_slo_sentence_prints_once_as_the_citation():
    """`slo.text_verbatim` is the SLO's one home. The objectives slot is dark
    because primary Stage-C authors no lesson objectives."""
    doc = build()
    stmt = ENR["generated"]["slo_statement"]
    assert doc["slo"]["text_verbatim"] == stmt
    assert doc["objectives"]["items"][0]["text"] == d0.B.DESIGN_PENDING
    assert doc["objectives"]["items"][0]["slo_code"] == "E-04-VO-01"


def test_the_textbook_character_line_is_carried(): 
    """`hookCharacters` is primary-only page content and had no home at all."""
    intro = _blocks(build(), 0)
    say = [b for b in intro if b.get("id") == "hook-characters"]
    assert say, "the speaking character's line was dropped"
    assert "Pinky" in say[0]["items"][0]
    assert not any("girl avatar" in i for i in say[0]["items"]), \
        "illustrative characters have no line to read"


def test_the_header_is_a_topic_name_not_the_slo_sentence():
    """provenance.topic prints 4x (header, continuation strip, page2, browser
    title). It takes the curriculum matrix's own topic for the row."""
    assert build()["provenance"]["topic"] == TOPIC


def test_the_key_fact_is_the_outcome_and_lives_only_there():
    doc = build()
    assert doc["objectives"]["outcome"] == ENR["generated"]["keyFact"]
    assert doc["objectives"]["items"][0]["text"] != ENR["generated"]["slo_statement"]
    assert len(doc["objectives"]["items"]) == 1, "one objective, not one per SLO code"


def test_g6_12_only_surfaces_are_not_forced_onto_primary():
    """spec: primary gets ONE exit ticket, has no board exam, and its finished
    board belongs on the support page — not printed twice."""
    concl = build()["sections"][3]
    assert "checkpoint" not in concl, "v9's checkpoint duplicates primary's exit ticket"
    assert build()["page2"]["exam_bank"] == {}
    assert not [b for b in _blocks(build(), 1) if b["type"] == "board"]
    assert not [b for b in _blocks(build(), 2) if b["type"] == "support_extension"]


def test_every_question_carries_its_answer():
    doc = build()
    for b in _blocks(doc, 2):
        if b.get("type") == "practice":
            assert all(i["q"] and i["a"] for i in b["items"])
    assert all(m["ref"] and m["answer"] for m in doc["page2"]["model_answers"])


def test_gaps_are_surfaced_not_dropped():
    """Dark stages stay dark — an absent source prints DESIGN_PENDING, never a proxy."""
    import d0_blocks
    bare = {**ENR, "generated": {**ENR["generated"], "subject_elements": {}}}
    doc = d0.to_lp_doc(bare, PT)
    assert doc["page2"]["mistakes"][0]["pupil_says"] == d0_blocks.DESIGN_PENDING
    assert build()["notes"]["gaps"] == ["gap: prior lesson not supplied"]


def test_warmup_items_may_be_bare_strings():
    """Corpus variation: some enrichment records write items as plain strings."""
    enr = {**ENR, "generated": {**ENR["generated"],
           "warmUp": {"minutes": 4, "items": ["Recall one word.", "Say it aloud."]}}}
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10)
    assert doc["sections"][0]["warmup"]["items"][0]["q"] == "Recall one word."


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  ok   {name}")
            except Exception as e:
                fails += 1
                print(f"  FAIL {name}: {type(e).__name__}: {e}")
    print("FAILED" if fails else "all passed")
    raise SystemExit(1 if fails else 0)


def test_period_printed_is_the_timetabled_period_not_the_budget():
    """bd-nddr1. The header prints the PERIOD; the steps are budgeted to less.

    Every enrichment record in the corpus states `duration_min: 30` and no
    `content_min` -- the field named after the period is in fact carrying the
    budget. Trusting it printed "30 min" on a 40-minute lesson, which is the
    one number on the page a teacher checks against her own timetable.

    `cbriefbasics.minutes()` already resolves this pair for the author and,
    since bd-jfkl0, for the gate. D0 must ask the same question of the same
    resolver, or the plan is briefed against one period and printed with
    another.
    """
    doc = build()
    assert doc["period_minutes"] == 40, doc["period_minutes"]
    total = sum(s["minutes"] for s in doc["sections"])
    assert total <= 30, f"steps fill {total} of the 30-minute budget"


def test_a_row_that_states_both_is_taken_at_its_word():
    """A record that has learned both words keeps its own period."""
    enr = json.loads(json.dumps(ENR))
    enr["generated"]["duration_min"] = 35
    enr["generated"]["content_min"] = 25
    assert d0.to_lp_doc(enr, PT)["period_minutes"] == 35
