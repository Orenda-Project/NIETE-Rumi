"""The judge is the last unmet check, and the run that supplies it must not
answer the question by changing it.

Three ways that could happen, and each is pinned below.

The rubric asks whether the lesson is ALIGNED WITH TEXTBOOK CONTENT (1D), whether
its references are PLAUSIBLE (7A), and whether it USES THE BOOK'S MATERIAL (8C).
A judge shown no book cannot answer any of the three, and a judge shown the wrong
pages answers them confidently and wrongly — which is the failure partners reject
most. So the excerpt comes from `pageres`, resolved by both keys against the
segment's own chapter, and where nothing resolves the run says it had no book
rather than sending the rubric in blind.

The v3 rubric is a LESSON rubric. Seven of its checks — a hook, an explanation, a
conclusion, modelling, gradual release, section timings, an exit ticket — are
things a student-facing worksheet does not have and never will. Scored naively
those become ratings of 1, and a single 1 fails the gate: the same category error
that made `qa_checks` produce six impossible hard failures on the same artefact.
The rubric already carries the seam the multigrade path uses, `scope_note`, and
this uses it to say what the artefact IS — not to drop a check, not to soften a
bar. A check the judge then marks not-assessable leaves the denominator, which is
the rubric's own arithmetic, not ours.

And one judge per batch. The bias correction in `production_gate` is per-model —
sonnet faces 94 where opus faces 92 — so a batch judged by two models is a batch
whose scores cannot be compared to each other.
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

import asmtrubric
import gate4
import judgerun


def page(pdf, printed, chapter, text="", title="", **kw):
    """The fields a REAL Stage-A page-truth file carries.

    The first version of this fixture invented a `page_text` key. The corpus
    has no such key — its text is in `text_verbatim` — so `book_excerpt` read
    nothing, every test passed, and the excerpt handed to the judge was a
    labelled heading with a blank line under it. A fixture has to be spelled
    the way the corpus is spelled or it only tests itself.
    """
    d = {"pdf_page_index": pdf, "printed_page_number": printed,
         "chapter": {"number": chapter, "title": title},
         "text_verbatim": text}
    d.update(kw)
    return d


def seg(i=1, chapter=1, printed=(2,), lp_type="content", skill="writing"):
    return {"segment_index": i, "chapter_number": chapter,
            "pages_printed": list(printed), "lp_type": lp_type,
            "skill_type": skill, "topic": "All About Me"}


def review(rating=4, checks=("0A", "1A", "2A")):
    return {"evaluation": [{"criterion_id": "C0", "checks": [
        {"id": c, "rating": rating} for c in checks]}]}


class TheBookTheJudgeIsShown(unittest.TestCase):
    """1D, 7A and 8C are unanswerable without it, and wrong with the wrong pages."""

    PAGES = [page(4, 1, 1, "Cover of the chapter"),
             page(5, 2, 1, "My name is Pinky. I am six."),
             page(6, 3, 1, "Meet Pinky and her family."),
             page(20, 2, 4, "A different chapter that also prints page 2")]

    def idx(self):
        return judgerun.pageres.index(self.PAGES)

    def test_the_excerpt_carries_the_text_of_the_pages_the_segment_names(self):
        r = judgerun.pageres.resolve(seg(printed=(2,)), self.idx())
        self.assertIn("My name is Pinky", judgerun.book_excerpt(r.pages))

    def test_it_does_not_carry_a_page_the_segment_did_not_ask_for(self):
        r = judgerun.pageres.resolve(seg(printed=(2,)), self.idx())
        self.assertNotIn("Meet Pinky and her family",
                         judgerun.book_excerpt(r.pages))

    def test_the_chapter_decides_when_two_pages_print_the_same_number(self):
        # printed 2 exists in chapter 1 AND chapter 4. Resolving by the number
        # alone is how thirteen days of Grade 5 Urdu nearly shipped wrong.
        r = judgerun.pageres.resolve(seg(printed=(2,)), self.idx())
        self.assertNotIn("A different chapter", judgerun.book_excerpt(r.pages))

    def test_each_page_is_labelled_so_the_judge_can_cite_it(self):
        r = judgerun.pageres.resolve(seg(printed=(2, 3)), self.idx())
        self.assertIn("page 2", judgerun.book_excerpt(r.pages))
        self.assertIn("page 3", judgerun.book_excerpt(r.pages))

    def test_no_resolved_page_means_no_excerpt_rather_than_an_empty_heading(self):
        self.assertEqual(judgerun.book_excerpt([]), "")

    def test_the_context_token_is_claimed_only_when_there_is_a_book(self):
        self.assertEqual(judgerun.context_of("some book text"), {"book_content"})
        self.assertEqual(judgerun.context_of(""), set())

    def test_the_page_truth_on_disk_spells_its_text_field_this_way(self):
        # The assertion that would have caught the empty excerpt. Measured
        # against the live corpus: `text_verbatim`, not `page_text`.
        d = os.path.join(os.path.dirname(os.path.abspath(judgerun.__file__)),
                         "corpus-local", "pagetruth", "grade_1_english")
        if not os.path.isdir(d):
            self.skipTest("restricted corpus not on this machine")
        with open(os.path.join(d, sorted(
                f for f in os.listdir(d) if f.startswith("pg_"))[1])) as fh:
            real = json.load(fh)
        self.assertIn("text_verbatim", real)
        self.assertNotIn("page_text", real)
        self.assertTrue(judgerun.book_excerpt([real]).strip().splitlines()[1:])


class WhatIsOnThePage(unittest.TestCase):
    """A page is not only its running text, and 8C asks about the rest of it.

    Stage A describes each page as verbatim text, headings, exercises with
    their instructions and items, illustrations with what is countable in
    them, and tables. A judge shown only the prose is asked whether a lesson
    matches the page's activities while being shown none of them.
    """

    PAGE = {"pdf_page_index": 5, "printed_page_number": 2,
            "chapter": {"number": 1, "title": "Hello World!"},
            "headings": ["Memory Lane"],
            "text_verbatim": "How old are you?",
            "exercises": [{"label": "Activity 1: Trace the Words!",
                           "instruction_verbatim": "Trace over each new word.",
                           "items": ["hello", "name"]}],
            "illustrations": [{"description": "Pinky waving, five balloons.",
                               "objects": ["balloon"] * 5}],
            "tables": [{"caption": "Days of the week"}]}

    def excerpt(self):
        return judgerun.book_excerpt([self.PAGE])

    def test_the_chapter_title_is_named_so_a_misgrounded_page_is_visible(self):
        self.assertIn("Hello World!", self.excerpt())

    def test_the_headings_are_carried(self):
        self.assertIn("Memory Lane", self.excerpt())

    def test_the_verbatim_text_is_carried(self):
        self.assertIn("How old are you?", self.excerpt())

    def test_an_exercise_carries_its_label_and_its_instruction(self):
        self.assertIn("Activity 1: Trace the Words!", self.excerpt())
        self.assertIn("Trace over each new word.", self.excerpt())

    def test_an_exercises_items_are_carried(self):
        # 8C asks whether the lesson uses the book's own material. It cannot
        # be answered if the page's own words are not shown.
        self.assertIn("hello", self.excerpt())

    def test_an_illustration_is_described_because_grade_1_pages_are_pictures(self):
        self.assertIn("Pinky waving", self.excerpt())

    def test_a_table_is_mentioned(self):
        self.assertIn("Days of the week", self.excerpt())

    def test_a_page_missing_every_optional_field_still_renders(self):
        thin = {"printed_page_number": 9, "chapter": None}
        self.assertIn("page 9", judgerun.book_excerpt([thin]))

    def test_a_blank_page_does_not_claim_the_book_context_token(self):
        blank = {"printed_page_number": 9, "chapter": None}
        self.assertEqual(
            judgerun.context_of(judgerun.book_excerpt([blank])), set())



class TheGroundingHandedToTheGate(unittest.TestCase):
    """G1 must be measured, not reported as never looked at."""

    PAGES = [page(5, 2, 1, "My name is Pinky.")]

    def test_a_resolved_segment_grounds(self):
        g = judgerun.grounding_of(seg(), judgerun.pageres.index(self.PAGES))
        self.assertTrue(g["resolved"])
        self.assertEqual(g["flags"], [])

    def test_an_unresolved_segment_carries_its_reason_in_the_shape_gate4_reads(self):
        g = judgerun.grounding_of(seg(printed=(99,)),
                                  judgerun.pageres.index(self.PAGES))
        self.assertFalse(g["resolved"])
        self.assertEqual([f["reason"] for f in g["flags"]], ["not-in-book"])


class TellingTheJudgeWhatTheArtefactIs(unittest.TestCase):
    """The worksheet's seven impossible checks, handled the rubric's own way."""

    def test_a_lesson_gets_no_scope_note(self):
        self.assertIsNone(judgerun.scope_note(seg()))

    def test_a_worksheet_gets_one(self):
        note = judgerun.scope_note(seg(i=995, lp_type="assessment",
                                       skill="assessment"))
        self.assertIsNotNone(note)

    def test_the_note_says_what_the_artefact_is(self):
        note = judgerun.scope_note(seg(i=995, lp_type="assessment",
                                       skill="assessment"))
        self.assertIn("worksheet", note.lower())

    def test_the_note_routes_an_inapplicable_check_to_not_assessable(self):
        # The rubric's own mechanism. A check marked not-assessable leaves the
        # denominator; it is never scored as a defect and never quietly passed.
        note = judgerun.scope_note(seg(i=995, lp_type="assessment",
                                       skill="assessment"))
        self.assertIn("notAssessable", note)

    def test_the_note_does_not_lower_a_bar_or_drop_a_criterion(self):
        note = judgerun.scope_note(seg(i=995, lp_type="assessment",
                                       skill="assessment")).lower()
        for word in ("lenient", "ignore", "skip", "do not score", "bonus"):
            self.assertNotIn(word, note)


class ReadingTheJudgeBack(unittest.TestCase):

    def test_a_clean_json_object_parses(self):
        self.assertEqual(judgerun.review_of(json.dumps(review()))["evaluation"]
                         [0]["criterion_id"], "C0")

    def test_json_wrapped_in_prose_still_parses(self):
        raw = "Here is my review:\n" + json.dumps(review()) + "\nThanks!"
        self.assertIn("evaluation", judgerun.review_of(raw))

    def test_a_reply_with_no_json_at_all_is_an_error_not_an_empty_review(self):
        # An empty review tallies to a denominator of zero, which `gate4` reads
        # as "never rated" — indistinguishable from not having run. Loud.
        with self.assertRaises(ValueError):
            judgerun.review_of("I could not review this lesson.")


class TheJudgesKeysAreNotTheTallysKeys(unittest.TestCase):
    """The defect this runner was one paid call away from shipping.

    `build_reviewer_prompt` tells the judge to answer with `evaluation[]`, and
    each criterion carries `criterionId` and `subCriteria`. `score_lp.tally`
    reads `review["criteria"]` or `review["scores"]` — NEITHER of which the
    contract ever asks for. So a real reply tallies to a denominator of zero,
    `gate4` turns that into `judge_pct = None`, and `compose` reports
    `not-judged`: a lesson that was judged, paid for, and recorded as never
    rated. Nothing would have said so.

    The prior Stage-C corpus proves the shape `tally` expects is real and was
    produced by something — `corpus-local/prior/g1e/*.score.json` carries
    `review.criteria[].checks[].rating` and scored 90.8. That normalisation
    was never in this tree. It is here now.
    """

    def raw(self):
        """The judge's own contract, as `_render_output_contract` writes it."""
        return {"grandTotal": "18 / 24", "percentage": 75.0,
                "evaluation": [{"criterion": "Structural Completeness",
                                "criterionId": "C0",
                                "subCriteria": [{"id": "0A", "rating": 4},
                                                {"id": "0B", "rating": 2}]}]}

    def test_the_contract_key_is_evaluation_not_criteria(self):
        # If this ever fails the prompt changed, and the mapping below is
        # what has to change with it.
        sys.path.insert(0, judgerun.REVIEWER)
        from reviewer_prompt_v3 import build_reviewer_prompt
        prompt = build_reviewer_prompt("English")
        self.assertIn('"evaluation"', prompt)
        self.assertIn('"subCriteria"', prompt)

    def test_the_raw_reply_tallies_to_nothing_before_normalising(self):
        sys.path.insert(0, judgerun.REVIEWER)
        from score_lp import tally
        self.assertEqual(tally(self.raw(), "English")[:2], (0, 0))

    def test_normalising_gives_the_tally_the_criteria_it_reads(self):
        sys.path.insert(0, judgerun.REVIEWER)
        from score_lp import tally
        self.assertEqual(tally(judgerun.normalise(self.raw()), "English")[:2],
                         (6, 8))

    def test_the_criterion_keeps_its_id(self):
        self.assertEqual(judgerun.normalise(self.raw())["criteria"][0]["id"],
                         "C0")

    def test_a_not_assessable_check_survives_normalising(self):
        # It must reach `tally` to shrink the denominator. Dropping it here
        # would silently score a worksheet's impossible checks as absent.
        raw = {"evaluation": [{"criterionId": "C0", "subCriteria": [
            {"id": "0A", "rating": 4},
            {"id": "0B", "rating": None, "notAssessable": True,
             "contextMissing": "a worksheet has no hook"}]}]}
        sys.path.insert(0, judgerun.REVIEWER)
        from score_lp import tally
        total, denom, flags = tally(judgerun.normalise(raw), "English")
        self.assertEqual((total, denom), (4, 4))
        self.assertTrue(any("not-assessable" in f for f in flags))

    def test_a_rating_the_judge_sent_as_a_string_still_counts(self):
        # The contract's own skeleton shows `"rating": "<1-4 or null>"`, and a
        # model that echoes the placeholder shape sends "4". An int() at the
        # tally would raise; a silent skip would shrink the denominator and
        # inflate the score.
        raw = {"evaluation": [{"criterionId": "C0",
                               "subCriteria": [{"id": "0A", "rating": "4"}]}]}
        sys.path.insert(0, judgerun.REVIEWER)
        from score_lp import tally
        self.assertEqual(tally(judgerun.normalise(raw), "English")[:2], (4, 4))

    def test_an_already_normalised_review_passes_through_unharmed(self):
        # The prior corpus is in this shape, and re-gating it must not need a
        # second paid call.
        prior = {"criteria": [{"id": "C0", "checks": [{"id": "0A",
                                                       "rating": 3}]}]}
        self.assertEqual(judgerun.normalise(prior), prior)


class RunningOne(unittest.TestCase):
    """The whole path, with the paid call injected."""

    PAGES = [page(5, 2, 1, "My name is Pinky. I am six.")]

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.lp = os.path.join(self.root, "grade_1_english_ch1_seg1.json")
        with open(self.lp, "w") as fh:
            json.dump(_lesson(), fh)
        self.calls = []

    def tearDown(self):
        shutil.rmtree(self.root)

    def call(self, system, user, model):
        self.calls.append({"system": system, "user": user, "model": model})
        return json.dumps(_full_review(4)), {"prompt_tokens": 10,
                                             "completion_tokens": 2}

    def run_one(self, **kw):
        kw.setdefault("call", self.call)
        kw.setdefault("model", "anthropic/claude-opus-5")
        return judgerun.run_one(self.lp, seg(), judgerun.pageres.index(self.PAGES),
                                subject="English", grade=1, **kw)

    def test_the_lesson_and_the_book_both_reach_the_judge(self):
        self.run_one()
        user = self.calls[0]["user"]
        self.assertIn("My name is Pinky", user)
        self.assertIn("hookStory", user)

    def test_the_grade_and_subject_are_stated(self):
        self.run_one()
        self.assertIn("GRADE: 1", self.calls[0]["user"])
        self.assertIn("SUBJECT: English", self.calls[0]["user"])

    def test_the_judge_score_reaches_the_gate(self):
        res = self.run_one()
        self.assertEqual(res["score"]["judge_pct"], 100.0)
        self.assertEqual(res["score"]["judge"], "anthropic/claude-opus-5")

    def test_the_composite_forms_once_there_is_a_judge_score(self):
        self.assertIsNotNone(self.run_one()["score"]["composite_pct"])

    def test_grounding_is_measured_so_G1_is_not_reported_unchecked(self):
        self.assertNotIn("G1", self.run_one()["score"]["not_checked"])

    def test_the_score_file_lands_beside_the_artefact(self):
        res = self.run_one()
        self.assertTrue(os.path.exists(res["path"]))
        self.assertEqual(os.path.dirname(res["path"]), self.root)
        self.assertEqual(json.load(open(res["path"]))["judge"],
                         "anthropic/claude-opus-5")

    def test_the_saved_score_carries_the_review_the_gate_read(self):
        # Without it the file cannot be re-gated, and a re-run costs money.
        res = self.run_one()
        self.assertIn("evaluation", json.load(open(res["path"]))["review"])

    def test_the_usage_is_recorded_because_the_call_costs_money(self):
        self.assertEqual(self.run_one()["usage"]["completion_tokens"], 2)

    def test_a_lesson_is_not_sent_with_a_worksheet_scope_note(self):
        self.run_one()
        self.assertNotIn("worksheet", self.calls[0]["system"].lower())


class RunningTheBatch(unittest.TestCase):

    def test_one_judge_is_pinned_across_every_artefact(self):
        # The gate's bar is per-model (sonnet 94, opus 92). Two judges in one
        # batch is a batch whose scores cannot be compared to each other.
        seen = []

        def call(system, user, model):
            seen.append(model)
            return json.dumps(_full_review(4)), {}

        root = tempfile.mkdtemp()
        try:
            paths = []
            for i in (1, 2):
                p = os.path.join(root, "grade_1_english_ch1_seg%d.json" % i)
                with open(p, "w") as fh:
                    json.dump(_lesson(), fh)
                paths.append((p, seg(i=i)))
            idx = judgerun.pageres.index([page(5, 2, 1, "Pinky.")])
            judgerun.run_batch(paths, idx, subject="English", grade=1,
                               model="anthropic/claude-opus-5", call=call)
        finally:
            shutil.rmtree(root)
        self.assertEqual(set(seen), {"anthropic/claude-opus-5"})

    def test_the_line_names_the_artefact_its_verdict_and_why(self):
        line = judgerun.line("grade_1_english_ch1_seg1",
                             {"judge_pct": 80.0, "soft_pct": 90.0,
                              "composite_pct": 85.0},
                             {"pass": False, "reasons": ["composite 85.0 < 92.0"]})
        self.assertIn("seg1", line)
        self.assertIn("FAIL", line)
        self.assertIn("composite 85.0", line)


def _lesson():
    return {"lesson_id": "grade_1_english_ch1_seg1", "lp_type": "content",
            "generated": {"hookStory": "Pinky waves hello.",
                          "warmUp": {"minutes": 4, "script": "Say your name.",
                                     "items": ["name"]},
                          "steps": [], "exitTicket": "Write your name."}}


def _full_review(rating):
    """A review shaped like the judge's, rating every check the same."""
    import sys
    sys.path.insert(0, judgerun.REVIEWER)
    from reviewer_rubric_v3 import get_active_rubric
    return {"evaluation": [
        {"criterion_id": c["criterion_id"],
         "checks": [{"id": chk.get("id"), "rating": rating}
                    for chk in c["checks"]]}
        for c in get_active_rubric("English")]}


if __name__ == "__main__":
    unittest.main()


class FindingTheKey(unittest.TestCase):
    """The name the skill documents is not the name this machine has.

    `score_lp.py` and the skill's header both say `OPENROUTER_ICT_ENRICH_KEY`,
    from the root `.env`. Neither `.env` on this machine holds that name — what
    is actually there is `OPENROUTER_API_KEY`, in `NIETE-Rumi/.env`. Failing on
    the documented name alone would stop a run that has a perfectly good key
    two directories up, so both are accepted and the documented one wins.
    """

    def setUp(self):
        self.saved = {k: os.environ.pop(k, None)
                      for k in ("OPENROUTER_ICT_ENRICH_KEY",
                                "OPENROUTER_API_KEY")}

    def tearDown(self):
        for k, v in self.saved.items():
            os.environ.pop(k, None)
            if v is not None:
                os.environ[k] = v

    def test_the_documented_name_is_used(self):
        os.environ["OPENROUTER_ICT_ENRICH_KEY"] = "sk-doc"
        self.assertEqual(judgerun.api_key(), "sk-doc")

    def test_the_name_this_machine_actually_has_also_works(self):
        os.environ["OPENROUTER_API_KEY"] = "sk-machine"
        self.assertEqual(judgerun.api_key(), "sk-machine")

    def test_the_documented_name_wins_when_both_are_set(self):
        os.environ["OPENROUTER_ICT_ENRICH_KEY"] = "sk-doc"
        os.environ["OPENROUTER_API_KEY"] = "sk-machine"
        self.assertEqual(judgerun.api_key(), "sk-doc")

    def test_no_key_at_all_names_both_rather_than_one(self):
        with self.assertRaises(RuntimeError) as e:
            judgerun.api_key()
        self.assertIn("OPENROUTER_ICT_ENRICH_KEY", str(e.exception))
        self.assertIn("OPENROUTER_API_KEY", str(e.exception))

    def test_an_empty_string_is_not_a_key(self):
        os.environ["OPENROUTER_ICT_ENRICH_KEY"] = ""
        os.environ["OPENROUTER_API_KEY"] = "sk-machine"
        self.assertEqual(judgerun.api_key(), "sk-machine")


class WhichInstrumentTheArtefactIsScoredOn(unittest.TestCase):
    """A worksheet is scored on the worksheet rubric, a lesson on the lesson one.

    The scope note alone was the stopgap and it was not enough. Measured
    19 Sep 2026 on the first paid batch: with the note in place, the chapter
    assessment still lost EIGHTEEN checks to `notAssessable`, its denominator
    collapsed from 220 to 148 where its six sibling lessons sat at 204-216,
    and it failed the gate at 90.55 with zero 1-ratings and zero 2-ratings.
    The note told the judge what the artefact was; it could not stop a lesson
    rubric asking lesson questions, and the lesson FRAME was meanwhile naming
    "a full-chapter assessment" as a 0F red flag and telling the judge not to
    reward it.
    """

    def build(self, segment):
        return judgerun.prompt_for(
            {"title": "x"}, segment, "", "English", 1)[0]

    def test_a_worksheet_is_not_asked_the_lesson_only_checks(self):
        prompt = self.build(seg(i=995, lp_type="assessment", skill="assessment"))
        for name in ("Opening Hook Relevant to SLO", "Prior Knowledge Activation",
                     "Single-Lesson Scope (One Class Period)"):
            self.assertNotIn(name, prompt, name)

    def test_a_worksheet_is_asked_the_assessment_checks(self):
        prompt = self.build(seg(i=995, lp_type="assessment", skill="assessment"))
        self.assertIn(asmtrubric.ASSESSMENT_CRITERION, prompt)
        self.assertIn("AS1", prompt)

    def test_the_worksheet_frame_replaces_the_lesson_one(self):
        # The clause this removes: the default frame lists "a chapter overview
        # or full-chapter assessment" among the unit-plan red flags, calls it a
        # 0F failure and says to NOT reward the quality of what is inside it.
        prompt = self.build(seg(i=995, lp_type="assessment", skill="assessment"))
        self.assertNotIn("full-chapter assessment", prompt)
        self.assertIn("STUDENT WORKSHEET", prompt)

    def test_a_lesson_still_gets_the_lesson_rubric_and_the_lesson_frame(self):
        prompt = self.build(seg())
        self.assertIn("Opening Hook Relevant to SLO", prompt)
        self.assertNotIn(asmtrubric.ASSESSMENT_CRITERION, prompt)
        self.assertNotIn("STUDENT WORKSHEET", prompt)

    def test_a_worksheet_keeps_its_scope_note(self):
        # Still load-bearing after the rubric swap. Only English's C8 was
        # measured; Urdu, Maths and Science keep theirs whole, so their
        # inapplicable subject checks still need the notAssessable path rather
        # than a rating of 1.
        prompt = self.build(seg(i=995, lp_type="assessment", skill="assessment"))
        self.assertIn(judgerun.WORKSHEET_SCOPE.splitlines()[0], prompt)

    def test_the_user_message_does_not_call_a_worksheet_a_lesson_plan(self):
        _, user = judgerun.prompt_for(
            {"title": "x"}, seg(i=995, lp_type="assessment", skill="assessment"),
            "", "English", 1)
        self.assertNotIn("LESSON PLAN TO REVIEW", user)
        self.assertIn("WORKSHEET TO REVIEW", user)

    def test_the_route_decides_it_not_the_segment_index(self):
        # 995 is a convention, not a contract. `d0_route` reads skill_type and
        # lp_type, and Maths/Urdu/Science segments carry no lp_type at all.
        prompt = self.build(seg(i=7, lp_type=None, skill="jaiza"))
        self.assertIn(asmtrubric.ASSESSMENT_CRITERION, prompt)


class TheGateCanSeeTheRatings(unittest.TestCase):
    """A rating the gate cannot read is a gate condition that does not exist.

    `production_gate._low_checks` counts a check only when its rating
    `isinstance(r, (int, float))`. The judge answers with strings, so on every
    artefact this build has scored the walk returned [] and conditions (b) —
    no check rated 1, at most MAX_TWOS rated 2 — never fired. Hard-QA and the
    composite were the whole gate and nothing said so.

    Measured on the first paid batch (19 Sep 2026): seg5 carried five
    non-strict 2s, seg6 four, seg995 six, and all seven artefacts were
    reported as clean of them. The prior Stage-C corpus carries `rating` as
    int, which is why this never showed up there.

    `score_lp.tally` coerces internally, so composites were and are correct.
    Only the gate was blind.
    """

    def gate(self, review):
        return gate4.reviewer("production_gate").gate(
            {"qa_hard_pass": True, "composite_pct": 99.0,
             "review": judgerun.normalise(review)})

    def raw(self, *ratings):
        return {"evaluation": [{"criterionId": "C1", "subCriteria": [
            {"id": "1%s" % chr(66 + i), "rating": r}
            for i, r in enumerate(ratings)]}]}

    def test_a_string_two_is_counted_against_the_tolerance(self):
        g = self.gate(self.raw("2", "2", "2"))
        self.assertFalse(g["pass"])
        self.assertTrue(any("rated 2" in r for r in g["reasons"]), g["reasons"])

    def test_a_string_one_fails_outright(self):
        g = self.gate(self.raw("1"))
        self.assertFalse(g["pass"])
        self.assertTrue(any("rated 1" in r for r in g["reasons"]), g["reasons"])

    def test_two_string_twos_are_still_tolerated(self):
        # The tolerance is the operator's, not an accident of the type.
        self.assertTrue(self.gate(self.raw("2", "2", "4"))["pass"])

    def test_the_judge_strict_check_is_still_excluded(self):
        # 1A is excluded by measurement, whatever type carries it.
        raw = {"evaluation": [{"criterionId": "C1", "subCriteria": [
            {"id": "1A", "rating": "2"}, {"id": "1B", "rating": "2"},
            {"id": "1C", "rating": "2"}]}]}
        self.assertTrue(self.gate(raw)["pass"])

    def test_an_int_rating_is_unchanged(self):
        self.assertFalse(self.gate(self.raw(2, 2, 2))["pass"])

    def test_a_not_assessable_check_is_not_turned_into_a_zero(self):
        # Coercing None would score every impossible check as a failure and
        # undo the whole denominator mechanism the worksheet rubric needs.
        raw = {"evaluation": [{"criterionId": "C1", "subCriteria": [
            {"id": "1B", "rating": None, "notAssessable": True}]}]}
        check = judgerun.normalise(raw)["criteria"][0]["checks"][0]
        self.assertIsNone(check["rating"])
        self.assertTrue(self.gate(raw)["pass"])

    def test_a_rating_that_is_not_a_number_at_all_is_left_alone(self):
        # "N/A" is not a 0. Leave it unreadable rather than invent a score.
        check = judgerun.normalise(
            self.raw("N/A"))["criteria"][0]["checks"][0]
        self.assertEqual(check["rating"], "N/A")
