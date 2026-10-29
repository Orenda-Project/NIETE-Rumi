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


def test_the_urdu_medium_electives_are_urdu_medium():
    """bd-6640j.1. GK, Social Studies and Islamiat are printed in Urdu (bd-6s6m3)."""
    for stem in ("grade_1_general_knowledge", "grade_5_social_studies", "grade_3_islamiat"):
        assert d0.to_lp_doc(ENR, dict(PT, book_stem=stem))["provenance"]["medium"] == "ur", stem
    for stem in ("grade_4_science", "grade_2_english", "grade_3_mathematics"):
        assert d0.to_lp_doc(ENR, dict(PT, book_stem=stem))["provenance"]["medium"] == "en", stem


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


# --- the Opening's one-strategy filter, wired at the d0_primary call site -----
# bd-7k14f. OPERATOR: *"it should be just 1 not multiple strategies since opening is a
# whole provocation on its own"* and *"teachers dont let students talk to each other,
# that too when the class begins"*. d0_warmitems.one_strategy is unit-tested on its own;
# these two assert it is actually CALLED here -- the defect that shipped the peer-talk
# gate tested-but-never-invoked was exactly a missing call site, not a broken check.

def _opening_warmup(doc):
    for sec in doc["sections"]:
        if "opening" in str(sec.get("title") or "").lower():
            return (sec.get("warmup") or {}).get("items") or []
    raise AssertionError("no Opening section in the built doc")


def _with_warmup_items(items):
    enr = json.loads(json.dumps(ENR))
    enr["generated"]["warmUp"]["items"] = items
    return enr


def test_opening_warmup_peer_talk_is_filtered_at_this_call_site():
    """The wiring test, not a re-test of the filter.

    NOTE ON THE CONTRACT: one_strategy() does NOT cap the item list at one. An
    earlier draft of this test assumed it did and failed against correct code --
    the measured effect over all 335 corpus docs is 996 -> 938 items, a 6% trim,
    because what it removes is BANNED PEER TALK, not surplus. The "one strategy"
    in the name is the warm-up's named method, which d0_warmscript seats; the
    item list is retrieval and stays as long as it is legal.
    """
    enr = _with_warmup_items([
        {"class_check": "pairs",
         "prompt": "Tell your partner one word you remember from yesterday.",
         "expected_answer": "Varies."},
        {"class_check": "whole-class", "prompt": "Recall one word.",
         "expected_answer": "Varies."},
    ])
    kept = _opening_warmup(d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC))
    joined = " ".join(i["q"] for i in kept)
    assert "your partner" not in joined.lower(), kept
    assert "Recall one word." in joined, kept


def test_guided_practice_talk_is_untouched_by_the_opening_filter():
    """OPERATOR: *"Guided practice should stay as is, I only asked talking to be
    removed from opening"*. The filter takes `sections` and must find the Opening
    by title -- if it ever walked the whole document it would strip 1,103 authored
    strings she has decided to keep."""
    doc = d0.to_lp_doc(ENR, PT, day=1, total_days=10, topic=TOPIC)
    gp = [s for s in doc["sections"] if s["id"] == "activity"][0]
    assert "warmup" not in gp
    assert json.dumps(gp, ensure_ascii=False)  # present and non-empty


def test_a_dropped_warmup_item_says_so_in_notes_gaps():
    """A silent drop is how content goes missing."""
    enr = _with_warmup_items([
        {"class_check": "pairs",
         "prompt": "Tell your partner one word you remember from yesterday.",
         "expected_answer": "Varies."},
        {"class_check": "whole-class", "prompt": "Recall one word.",
         "expected_answer": "Varies."},
    ])
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)
    assert any("partner" in g.lower() or "warm" in g.lower() or "item" in g.lower()
               for g in doc["notes"]["gaps"]), doc["notes"]["gaps"]


# --- the Opening's peer-talk filter on BLOCKS, wired at the d0_primary call site ----
# bd-y7hst. The warm-up half of the Opening is cleaned upstream by d0_warmitems; the
# hook half is not. Opening blocks are AUTHORED SOURCE PASSTHROUGH -- the string arrives
# verbatim from enrichment via d0_hook.hook_blocks(), so there is no template to fix and
# the only place to catch it is a pass-through filter at this call site. These two tests
# assert the call exists and that its scope stops at the Opening.

# Verbatim from work/g1_ch8/enr/English_seg5_grade_1_english_ch8_seg5.json. A real
# corpus string, not a constructed one: the banned clause sits mid-sentence inside a
# quoted Say: span, which is exactly the shape a naive sentence-level filter breaks.
_REAL_HOOK = (
    "Show page 103. Say: “Pinky wants to plan her bike rides for the WHOLE year "
    "— one ride every month! Look — she only found box 1, ‘January’. "
    "Turn to your partner: which month do you think comes right after January? "
    "Tell them your guess and why, then we will check.”")


def _opening_blocks_text(doc):
    """The Opening's printable text, with any array-form field re-joined first.

    bd-qeady made `ask.question` `str|string[]`. Dumping the blocks raw would put JSON
    punctuation (`", "`) between two halves of one authored sentence and break a
    substring assertion about text that is still, on the page, one sentence -- the
    renderer re-joins it with a bare " ". So the join happens here too.
    """
    def rejoin(node):
        if isinstance(node, list) and node and all(isinstance(x, str) for x in node):
            return " ".join(node)
        if isinstance(node, list):
            return [rejoin(x) for x in node]
        if isinstance(node, dict):
            return {k: rejoin(v) for k, v in node.items()}
        return node

    for sec in doc["sections"]:
        if "opening" in str(sec.get("title") or "").lower():
            return json.dumps(rejoin(sec.get("blocks") or []), ensure_ascii=False)
    raise AssertionError("no Opening section in the built doc")


def test_opening_hook_peer_talk_is_filtered_at_this_call_site():
    """The wiring test for d0_openingpeer, not a re-test of the filter.

    OPERATOR: *"teachers dont let students talk to each other, that too when the class
    begins"*. Measured over all 335 corpus docs, this call takes gate-10e Opening
    defects from 190 to 5, and every one of the 5 survivors is a string that QUOTES or
    REPORTS the textbook page, which is deliberately never rewritten.

    The assertion is removal-first: the banned clause goes, both legal sides stay. A
    filter that dropped the whole sentence would take "which month comes right after
    January?" with it -- the provocation the lesson is built on.
    """
    enr = json.loads(json.dumps(ENR))
    enr["generated"]["hookStory"] = _REAL_HOOK
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)
    opening = _opening_blocks_text(doc)
    assert "Turn to your partner" not in opening, opening
    # Capital W: the filter re-cases the surviving clause when the excision makes it the
    # start of the sentence. A teacher reading "which month..." mid-page would see a typo.
    assert "Which month do you think comes right after January" in opening, opening
    assert any("peer-talk" in g or "partner" in g.lower() for g in doc["notes"]["gaps"]), \
        doc["notes"]["gaps"]


def test_the_block_filter_stops_at_the_opening():
    """OPERATOR: *"Guided practice should stay as is, I only asked talking to be removed
    from opening"*. The same banned string authored into the partner activity must
    survive untouched -- the filter is scoped by section title, and a filter that walked
    the whole document would strip 1,103 authored strings she has decided to keep.
    """
    enr = json.loads(json.dumps(ENR))
    enr["generated"]["partnerActivity"]["structure"] = "Turn to your partner and compare."
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)
    gp = [s for s in doc["sections"] if s["id"] == "activity"][0]
    assert "Turn to your partner" in json.dumps(gp, ensure_ascii=False), gp


def test_a_double_escaped_worked_example_is_split_into_real_steps():
    """g4_ch9/Science_seg1 and g5_ch9/Science_seg4 (bd-obv6l): the source trace
    escaped its newlines twice, so `workedExample` never split and the whole
    example printed as one run-on carrying a literal backslash-n across the
    teacher's page. The authored numbering comes off separately -- see
    test_authored_step_numbers_are_dropped_so_the_renderer_numbers_once."""
    import copy
    enr = copy.deepcopy(ENR)
    enr["generated"]["workedExample"] = ("Textbook p. 218 pulse-rate example:\\n"
                            "1. Count pulse beats for 30 seconds.\\n"
                            "2. The recorded count is 48 beats.")
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)
    worked = [b for b in _blocks(doc, 1) if b.get("id") == "worked"][0]
    assert worked["steps"] == ["Textbook p. 218 pulse-rate example:",
                               "Count pulse beats for 30 seconds.",
                               "The recorded count is 48 beats."]
    # a real newline json-dumps AS backslash-n, so the check has to be on the
    # printed strings themselves, not on the serialised doc.
    assert not any("\\n" in st for st in worked["steps"])


def test_authored_step_numbers_are_dropped_so_the_renderer_numbers_once():
    """75 lessons / 539 steps printed 'A. B. Predict...' on the teacher's page:
    the trace numbers the worked example itself AND the renderer numbers the list,
    so every step landed with two numbers. The renderer owns the numbering, so the
    authored one comes off here. Only a leading '<digits>. ' goes -- a step that
    merely opens with a quantity ('3 kg of flour') keeps every character."""
    import copy
    enr = copy.deepcopy(ENR)
    enr["generated"]["workedExample"] = ("Worked LED model example from pp. 219-220:\n"
                                         "1. Predict: the LED can work.\n"
                                         "2. Observe the LED: it has two legs.\n"
                                         "3 kg of wire is not a step number.")
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)
    worked = [b for b in _blocks(doc, 1) if b.get("id") == "worked"][0]
    assert worked["steps"] == ["Worked LED model example from pp. 219-220:",
                               "Predict: the LED can work.",
                               "Observe the LED: it has two legs.",
                               "3 kg of wire is not a step number."]


def test_worked_example_step_labels_survive_the_line_splitter_bd_nuvtm():
    """g4_ch9/English_seg7 (bd-nuvtm): 7 authored STEP N labels printed as 9 rows,
    because `d0_lines.split_items` cut two of them again at their own clause
    marks -- STEP 2 at its em-dash, the HIGHLIGHTING check at its arrow -- and the
    renderer numbers the list by POSITION, not by the label still sitting inside
    the text. So the page read 'STEP 2' next to printed number 2, then 'STEP 3'
    next to printed number 4."""
    import copy
    enr = copy.deepcopy(ENR)
    enr["generated"]["workedExample"] = (
        "STEP 1 (Title): Choose one word — 'Lewa'.\n"
        "STEP 2 (Two describing words): From the passage, 'graceful' is given — "
        "add one more, e.g. 'flowing' → 'Graceful, flowing' (count: 1 Graceful, "
        "2 flowing check).\n"
        "STEP 3 (Three action words): 'Swaying, turning, gliding' (count: "
        "1 Swaying, 2 turning, 3 gliding check).\n"
        "STEP 4 (Four-word feeling/sentence): 'Balochistan sings through movement' "
        "(count: 1 Balochistan, 2 sings, 3 through, 4 movement check).\n"
        "STEP 5 (One summary word): 'Heritage' (1 word check).\n"
        "Finished cinquain:\n"
        "HIGHLIGHTING worked check on the passage: 'They carry the stories and "
        "rhythms passed down through generations.' → underline 'stories and "
        "rhythms passed down through generations' because it tells us WHY the "
        "dances matter (they preserve history), which is more important than "
        "just 'They carry'."
    )
    doc = d0.to_lp_doc(enr, PT, day=1, total_days=10, topic=TOPIC)
    worked = [b for b in _blocks(doc, 1) if b.get("id") == "worked"][0]
    assert len(worked["steps"]) == 7, worked["steps"]
    for n, step in enumerate(worked["steps"][:5], 1):
        assert step.startswith(f"STEP {n} "), worked["steps"]
