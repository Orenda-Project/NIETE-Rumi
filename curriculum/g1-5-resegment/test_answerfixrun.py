# -*- coding: utf-8 -*-
"""One lesson, one repair: what happens to each reply the author can send.

bd-eakp8. The call is the only impure part of the pass and it is injected,
so every decision below is tested without a key and without spending
anything -- the same seam `judgerun` uses for the same reason.

The decisions that matter are the ones about NOT writing. A lesson that
needs nothing must not be sent at all (44 calls where 43 were needed is a
small waste; a re-rolled lesson is not). A patch that reaches past an
answer slot is refused, and the refusal is worth one retry because it names
exactly what was wrong and the author can usually fix it. And a body that
still fails `answerslot` after a patch applied cleanly is NOT written:
`apply` succeeding means the patch was legal, not that the lesson is
answered, and a half-repaired body written back would report as repaired
and reach a teacher with the same complaint in it.
"""
import unittest

import answerfixrun


def body(**kw):
    b = {"segment_id": "grade_2_math_ch1_seg1", "steps": [], "problems": []}
    b.update(kw)
    return b


def replier(*replies):
    """An author that answers from a script, and counts what it was asked."""
    calls = []

    def ask(prompt):
        calls.append(prompt)
        return replies[min(len(calls) - 1, len(replies) - 1)]
    ask.calls = calls
    return ask


def boom(*outcomes):
    """An author whose transport fails: an Exception outcome is raised."""
    calls = []

    def ask(prompt):
        calls.append(prompt)
        out = outcomes[min(len(calls) - 1, len(outcomes) - 1)]
        if isinstance(out, BaseException):
            raise out
        return out
    ask.calls = calls
    return ask


ONE = body(steps=[{"say": u"So, how many tens?"}])
GOOD = u'{"asks": [{"ask": "So, how many tens?", "answer": "4 tens."}]}'


class RecoversThePatch(unittest.TestCase):

    def test_a_bare_object_is_read(self):
        self.assertEqual(answerfixrun.patch_of(u'{"a": 1}'), {"a": 1})

    def test_a_fenced_object_is_read(self):
        self.assertEqual(
            answerfixrun.patch_of(u'```json\n{"a": 1}\n```'), {"a": 1})

    def test_an_object_with_prose_around_it_is_read(self):
        self.assertEqual(
            answerfixrun.patch_of(u'Here you go:\n{"a": 1}\nHope that helps.'),
            {"a": 1})

    def test_a_reply_with_no_object_raises_rather_than_returning_nothing(self):
        # An empty patch applies cleanly and changes nothing, so a silent
        # {} would report 44 repairs and make none.
        self.assertRaises(ValueError, answerfixrun.patch_of, u"I cannot.")


class FindsTheSegment(unittest.TestCase):
    """36 of the 44 are FLN basics periods, and they are not in the book.

    A basics period is an out-of-textbook FLN lesson: its row is synthesised
    into its own brief (`corpus-local/briefs/<stem>.json`) and never appears
    in `corpus/seg`, which indexes the printed book. Looking only in the book
    finds a segment for 8 of the 44 and hands the other 36 an empty page list
    -- the repair would then run with no book to answer from, on exactly the
    lessons whose answers are least derivable from a page.
    """

    def test_a_basics_stem_is_answered_from_its_own_brief(self):
        got = answerfixrun.segment_of(
            "grade_2_math_ch1_seg801", "grade_2_math", 1, 801,
            {"grade_2_math_ch1_seg801": {"segment_index": 801, "via": "brief"}},
            {"grade_2_math": {(1, 801): {"via": "book"}}})
        self.assertEqual(got["via"], "brief")

    def test_a_textbook_stem_is_answered_from_the_book(self):
        got = answerfixrun.segment_of(
            "grade_2_math_ch1_seg3", "grade_2_math", 1, 3, {},
            {"grade_2_math": {(1, 3): {"via": "book"}}})
        self.assertEqual(got["via"], "book")

    def test_a_stem_in_neither_is_none_rather_than_an_error(self):
        self.assertIsNone(
            answerfixrun.segment_of("x_ch9_seg9", "x", 9, 9, {}, {}))


class Shards(unittest.TestCase):
    """One call is ~150s, so 44 in one process is an hour and three quarters.

    Sharding is round-robin rather than contiguous so that a shard is never
    one whole book: the page index is built per book, and a contiguous split
    would give one shard every basics period and another every textbook one,
    which makes the shards' runtimes differ by more than the split saves.
    """

    def test_every_item_lands_in_exactly_one_shard(self):
        items = list(range(10))
        got = sum((answerfixrun.shard(items, "%d/3" % i) for i in range(3)), [])
        self.assertEqual(sorted(got), items)

    def test_the_shards_differ_in_size_by_at_most_one(self):
        sizes = [len(answerfixrun.shard(list(range(10)), "%d/4" % i))
                 for i in range(4)]
        self.assertLessEqual(max(sizes) - min(sizes), 1)

    def test_no_shard_spec_is_everything(self):
        self.assertEqual(answerfixrun.shard([1, 2, 3], ""), [1, 2, 3])

    def test_a_malformed_spec_raises_rather_than_silently_running_all(self):
        # A typo that quietly runs all 44 in every one of four processes
        # spends four times over and races four writers onto each file.
        self.assertRaises(ValueError, answerfixrun.shard, [1], "1of4")


class Repairs(unittest.TestCase):

    def test_a_good_patch_is_applied_and_reported_repaired(self):
        out = answerfixrun.repair(ONE, replier(GOOD))
        self.assertEqual(out["status"], "repaired")
        self.assertEqual(out["body"]["asks"][0]["answer"], u"4 tens.")

    def test_a_lesson_that_needs_nothing_is_never_sent(self):
        b = body(steps=[{"cfu": {"question": u"How many tens?",
                                 "pass_signal": u"Says 4."}}])
        ask = replier(GOOD)
        out = answerfixrun.repair(b, ask)
        self.assertEqual(out["status"], "clean")
        self.assertEqual(len(ask.calls), 0)

    def test_a_refused_patch_is_retried_once_with_the_reason(self):
        bad = u'{"steps[].say": {"0": "How many tens altogether?"}}'
        ask = replier(bad, GOOD)
        out = answerfixrun.repair(ONE, ask)
        self.assertEqual(out["status"], "repaired")
        self.assertEqual(len(ask.calls), 2)
        self.assertIn("steps[].say", ask.calls[1])

    def test_a_patch_refused_twice_writes_nothing(self):
        bad = u'{"steps[].say": {"0": "x"}}'
        out = answerfixrun.repair(ONE, replier(bad))
        self.assertEqual(out["status"], "refused")
        self.assertIsNone(out["body"])
        self.assertIn("steps[].say", out["reason"])

    def test_a_placeholder_answer_is_refused_not_written(self):
        ask = replier(u'{"asks": [{"ask": "So, how many tens?",'
                      u' "answer": "Let the children answer."}]}')
        self.assertEqual(answerfixrun.repair(ONE, ask)["status"], "refused")

    def test_a_legal_patch_that_leaves_a_question_dark_is_not_written(self):
        b = body(steps=[{"say": u"How many tens? How many ones?"}])
        half = u'{"asks": [{"ask": "How many tens?", "answer": "4 tens."}]}'
        out = answerfixrun.repair(b, replier(half))
        self.assertEqual(out["status"], "unrepaired")
        self.assertIsNone(out["body"])
        self.assertIn("How many ones?", out["reason"])

    def test_an_unreadable_reply_is_a_refusal_not_a_crash(self):
        out = answerfixrun.repair(ONE, replier(u"I cannot help with that."))
        self.assertEqual(out["status"], "refused")

    def test_the_envelope_is_repaired_in_place_and_keeps_its_wrapper(self):
        # The authored artefacts are {lesson_id, model, gate_pass, generated}
        # and the runner writes the same file back; losing the wrapper would
        # orphan every score file beside it.
        art = {"lesson_id": "x", "gate_pass": True, "generated": dict(ONE)}
        out = answerfixrun.repair(art, replier(GOOD))
        self.assertEqual(out["status"], "repaired")
        self.assertEqual(out["artefact"]["lesson_id"], "x")
        self.assertEqual(out["artefact"]["generated"]["asks"][0]["answer"],
                         u"4 tens.")

    def test_the_repaired_artefact_records_that_it_was_repaired(self):
        # The score file beside it was computed on the pre-repair body, so
        # the artefact has to carry the fact that they no longer agree.
        art = {"lesson_id": "x", "generated": dict(ONE)}
        out = answerfixrun.repair(art, replier(GOOD))
        self.assertEqual(out["artefact"]["answers_repaired"], "bd-eakp8")


if __name__ == "__main__":
    unittest.main()


class SurvivesAFailedCall(unittest.TestCase):
    """A dead call is not a verdict on the lesson.

    The first batch lost two whole shards to this: `claude -p` exited 1 with
    empty stderr on one lesson, the `RuntimeError` escaped `repair`, and the
    five lessons queued behind it were never attempted. A transient failure
    of the transport says nothing about the lesson, so it costs one attempt
    and the loop goes on.
    """

    def test_a_failed_call_is_reported_not_raised(self):
        out = answerfixrun.repair(ONE, boom(RuntimeError("claude -p failed")))
        self.assertEqual(out["status"], "error")
        self.assertIsNone(out["body"])
        self.assertIn("claude -p failed", out["reason"])

    def test_a_transient_failure_is_retried_and_can_still_repair(self):
        ask = boom(RuntimeError("claude -p failed (1): "), GOOD)
        out = answerfixrun.repair(ONE, ask)
        self.assertEqual(out["status"], "repaired")
        self.assertEqual(len(ask.calls), 2)

    def test_the_retry_does_not_tell_the_author_its_reply_was_rejected(self):
        # It never sent one. Pasting a transport error into the prompt as if
        # it were a verdict on the JSON teaches the author to change a lesson
        # that was never looked at.
        ask = boom(RuntimeError("claude -p failed (1): "), GOOD)
        answerfixrun.repair(ONE, ask)
        self.assertNotIn("REJECTED", ask.calls[1])

    def test_a_failed_call_still_writes_nothing(self):
        out = answerfixrun.repair(ONE, boom(RuntimeError("down")))
        self.assertIsNone(out["artefact"])
