"""
Red-first tests for scripts/lib/legacy_taleemabad_import.py, the decision logic of
scripts/import-legacy-taleemabad.py (bd-s42dye.4).

Why a pure module: the runner owns I/O (read fde_production, read the target, one write
transaction); this module owns every judgement call (which questions survive, how keys are
stored, how courses are ordered, what counts as an insert versus an in-place update), so
the judgement is testable without a database.

Run:  python3 -m unittest scripts/tests/test_legacy_taleemabad_import.py -v
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import legacy_taleemabad_import as m  # noqa: E402

CID = m.COURSE_IDS[0]
CID2 = m.COURSE_IDS[1]


def q(**over):
    base = dict(id=1000, training_id=500, type="mcq", question_statement="2+2?",
                options=["3", "4", "5", "6"], answers=[2], bloom_level="apply", index=1,
                is_active=True, deleted_at=None)
    base.update(over)
    return base


def src_fixture():
    return {
        "levels": [
            {"id": 1, "name": "Aspiring Teacher", "order": 0},
            {"id": 2, "name": "Emerging Practitioner", "order": 1},
            {"id": 3, "name": "Skilled Practitioner", "order": 2},
        ],
        "courses": [
            {"id": CID, "level_id": 1, "title": "Course A", "type": "SUBJECT", "index": 2},
            {"id": CID2, "level_id": 1, "title": "Course B", "type": "GENERAL", "index": 1},
        ],
        "modules": [
            {"id": 500, "course_id": CID, "title": "M1", "content": None, "duration": 0, "index": 1,
             "media_url": "https://asset-manager-approved.s3.ap-south-1.amazonaws.com/a.mp4", "media_type": "video",
             "is_active": True, "deleted_at": None},
            # deactivated in fde: still imported, and imported ACTIVE
            {"id": 501, "course_id": CID2, "title": "M2", "content": None, "duration": 0, "index": 1,
             "media_url": "https://asset-manager-approved.s3.ap-south-1.amazonaws.com/b.pdf", "media_type": "pdf",
             "is_active": False, "deleted_at": "2025-01-01"},
        ],
        "questions": [q(id=1000, training_id=500), q(id=1001, training_id=500, type="msq", answers=[1, 3]),
                      q(id=1002, training_id=501)],
    }


def empty_existing():
    return {"vendor": None, "levels": {}, "courses": {}, "modules": {}, "questions": {}, "foreign": []}


def materialise(plan, existing=None):
    """Pretend the runner applied `plan`: build the `existing` state a second run would read."""
    ex = copy.deepcopy(existing) if existing else empty_existing()
    nid = [10000]

    def nxt():
        nid[0] += 1
        return nid[0]

    if plan["vendor"]["action"] == "insert":
        ex["vendor"] = dict(plan["vendor"]["row"], id="vendor-uuid")
    for kind, key in (("levels", "source_level_id"), ("courses", "source_course_id"),
                      ("modules", "source_module_id"), ("questions", "source_question_id")):
        for row in plan[kind]["insert"]:
            clean = {k: v for k, v in row.items() if not k.startswith("_")}
            clean["id"] = nxt()
            ex[kind][row[key]] = clean
        for upd in plan[kind]["update"]:
            ex[kind][upd["source_id"]].update(upd["patch"])
    return ex


class ScopeIs66Courses(unittest.TestCase):
    def test_course_id_list_is_the_inventory_set(self):
        self.assertEqual(len(m.COURSE_IDS), 66)
        self.assertEqual(len(set(m.COURSE_IDS)), 66)

    def test_beacon_house_duplicates_and_test_courses_are_not_in_scope(self):
        for excluded in (311, 318, 267, 268, 270, 277):
            self.assertNotIn(excluded, m.COURSE_IDS)


class TransformQuestion(unittest.TestCase):
    def test_mcq_key_stays_one_based(self):
        row, why = m.transform_question(q(answers=[2]))
        self.assertIsNone(why)
        self.assertEqual(row["correct_option"], "2")
        self.assertEqual(row["options"], ["3", "4", "5", "6"])
        self.assertEqual(row["source_question_id"], 1000)
        self.assertEqual(row["bloom_level"], "apply")
        self.assertTrue(row["is_active"])

    def test_msq_key_is_comma_joined(self):
        row, _ = m.transform_question(q(type="msq", answers=[1, 3]))
        self.assertEqual(row["correct_option"], "1,3")

    def test_open_ended_and_poll_are_dropped(self):
        self.assertEqual(m.transform_question(q(type="open-ended", options=[], answers=[]))[0], None)
        self.assertEqual(m.transform_question(q(type="poll", answers=[]))[1], "type:poll")

    def test_the_two_broken_key_questions_are_dropped_by_id(self):
        for qid in (5368, 5375):
            row, why = m.transform_question(q(id=qid, answers=[0]))
            self.assertIsNone(row)
            self.assertEqual(why, "excluded_id")

    def test_zero_key_dropped_even_for_other_ids(self):
        self.assertIsNone(m.transform_question(q(id=77, answers=[0]))[0])

    def test_out_of_range_key_and_short_options_dropped(self):
        self.assertIsNone(m.transform_question(q(answers=[9]))[0])
        self.assertIsNone(m.transform_question(q(options=["only"]))[0])

    def test_inactive_or_soft_deleted_dropped(self):
        self.assertEqual(m.transform_question(q(is_active=False))[1], "inactive")
        self.assertEqual(m.transform_question(q(deleted_at="2025-01-01"))[1], "inactive")


class CourseOrdering(unittest.TestCase):
    def test_tie_break_is_index_then_course_id_dense_per_level(self):
        courses = [
            {"id": 30, "level_id": 1, "index": 5}, {"id": 12, "level_id": 1, "index": 5},
            {"id": 99, "level_id": 1, "index": 1}, {"id": 7, "level_id": 2, "index": 9},
        ]
        got = m.course_order(courses)
        self.assertEqual(got, {99: 1, 12: 2, 30: 3, 7: 1})


class VendorRow(unittest.TestCase):
    BASE = {"id": "u", "key": "TALEEMABAD", "name": "NIETE", "passing_pct": 80, "cooldown_hours": 24,
            "has_grand_quiz": True, "has_diagnostic": True, "cert_code_prefix": "NIETE",
            "unlock_logic": "chain", "is_active": True, "created_at": "x", "module_passing_pct": 100,
            "module_quiz_strategy": "one_per_bloom", "exam_question_cap": 20, "shuffle_options": True,
            "level_unlock_logic": "chain", "module_unlock_logic": "chain",
            "capstone_points_per_question": None}

    def test_identity_is_new_and_rules_are_copied(self):
        v = m.vendor_row(self.BASE)
        self.assertEqual((v["key"], v["name"]), ("TALEEMABAD_LEGACY", "Taleemabad"))
        self.assertIs(v["has_grand_quiz"], False)
        self.assertIs(v["has_diagnostic"], False)
        self.assertEqual(v["passing_pct"], 80)
        self.assertEqual(v["module_passing_pct"], 100)
        self.assertEqual(v["module_quiz_strategy"], "one_per_bloom")
        self.assertEqual(v["unlock_logic"], "chain")
        self.assertEqual(v["level_unlock_logic"], "chain")
        self.assertEqual(v["module_unlock_logic"], "chain")

    def test_row_identity_columns_are_not_copied(self):
        v = m.vendor_row(self.BASE)
        self.assertNotIn("id", v)
        self.assertNotIn("created_at", v)
        self.assertNotEqual(v["cert_code_prefix"], "NIETE")

    def test_certificate_levers_stay_off_whatever_the_base_says(self):
        base = dict(self.BASE, unlock_logic="all_modules")
        v = m.vendor_row(base)
        # chain is the lever: maybeIssueQuizScoreCertificate returns issued:false for chain vendors,
        # and with no grand quiz or capstone row there is no other path to a certificate.
        self.assertEqual(v["unlock_logic"], "chain")
        self.assertIs(v["has_grand_quiz"], False)

    def test_columns_the_base_row_lacks_are_not_invented(self):
        # prod lacks module_quiz_ungated; copying must follow the live columns, not a fixed list
        v = m.vendor_row(self.BASE)
        self.assertNotIn("module_quiz_ungated", v)


class BuildPlanFresh(unittest.TestCase):
    def test_everything_is_an_insert_on_an_empty_target(self):
        p = m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE)
        self.assertEqual(p["vendor"]["action"], "insert")
        self.assertEqual(len(p["levels"]["insert"]), 3)
        self.assertEqual(len(p["courses"]["insert"]), 2)
        self.assertEqual(len(p["modules"]["insert"]), 2)
        self.assertEqual(len(p["questions"]["insert"]), 3)
        for k in ("levels", "courses", "modules", "questions"):
            self.assertEqual(p[k]["update"], [])

    def test_levels_are_one_to_three_named_as_in_fde(self):
        p = m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE)
        got = [(r["name"], r["order_index"], r["cpd_level"]) for r in p["levels"]["insert"]]
        self.assertEqual(got, [("Aspiring Teacher", 1, None), ("Emerging Practitioner", 2, None),
                               ("Skilled Practitioner", 3, None)])

    def test_course_order_uses_the_tie_break(self):
        p = m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE)
        by = {r["source_course_id"]: r["order_index"] for r in p["courses"]["insert"]}
        self.assertEqual(by[CID2], 1)
        self.assertEqual(by[CID], 2)

    def test_deactivated_modules_come_in_active_with_media(self):
        p = m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE)
        mods = {r["source_module_id"]: r for r in p["modules"]["insert"]}
        self.assertTrue(mods[501]["is_active"])
        self.assertEqual(mods[500]["video_url"], mods[500]["source_media_url"])
        self.assertTrue(mods[500]["video_url"].endswith("a.mp4"))
        # pdf: source_media_url only, video_url stays NULL (the Beacon House rule)
        self.assertIsNone(mods[501]["video_url"])
        self.assertTrue(mods[501]["source_media_url"].endswith("b.pdf"))
        self.assertIsNone(mods[500]["audio_url"])

    def test_question_order_is_dense_per_module_by_index_then_id(self):
        s = src_fixture()
        s["questions"] = [q(id=9, training_id=500, index=1), q(id=3, training_id=500, index=1),
                          q(id=5, training_id=500, index=1)]
        p = m.build_plan(s, empty_existing(), VendorRow.BASE)
        got = sorted((r["order_index"], r["source_question_id"]) for r in p["questions"]["insert"])
        self.assertEqual(got, [(1, 3), (2, 5), (3, 9)])

    def test_dropped_questions_are_counted_by_reason(self):
        s = src_fixture()
        s["questions"] += [q(id=2000, training_id=500, type="poll", answers=[]),
                           q(id=5368, training_id=500, answers=[0]),
                           q(id=2001, training_id=500, type="open-ended", options=[], answers=[])]
        p = m.build_plan(s, empty_existing(), VendorRow.BASE)
        self.assertEqual(p["skipped"], {"type:poll": 1, "excluded_id": 1, "type:open-ended": 1})
        self.assertEqual(len(p["questions"]["insert"]), 3)

    def test_questions_of_unknown_modules_are_not_imported(self):
        s = src_fixture()
        s["questions"].append(q(id=3000, training_id=99999))
        p = m.build_plan(s, empty_existing(), VendorRow.BASE)
        self.assertEqual(len(p["questions"]["insert"]), 3)


class Idempotency(unittest.TestCase):
    def test_second_run_inserts_nothing_and_updates_nothing(self):
        first = m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE)
        ex = materialise(first)
        second = m.build_plan(src_fixture(), ex, VendorRow.BASE)
        self.assertEqual(second["vendor"]["action"], "unchanged")
        for k in ("levels", "courses", "modules", "questions"):
            self.assertEqual(second[k]["insert"], [], k)
            self.assertEqual(second[k]["update"], [], k)
        self.assertEqual(len(second["questions"]["unchanged"]), 3)

    def test_changed_title_is_an_in_place_update(self):
        ex = materialise(m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE))
        s = src_fixture()
        s["courses"][0]["title"] = "Course A renamed"
        p = m.build_plan(s, ex, VendorRow.BASE)
        self.assertEqual(p["courses"]["insert"], [])
        self.assertEqual(len(p["courses"]["update"]), 1)
        self.assertEqual(p["courses"]["update"][0]["patch"], {"title": "Course A renamed"})

    def test_rehosted_video_url_survives_a_rerun(self):
        ex = materialise(m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE))
        r2 = "https://acct.r2.cloudflarestorage.com/bucket/training/rehosted-legacy/500/asset.mp4"
        ex["modules"][500]["video_url"] = r2
        p = m.build_plan(src_fixture(), ex, VendorRow.BASE)
        self.assertEqual(p["modules"]["update"], [])

    def test_changed_source_media_resets_both_urls(self):
        ex = materialise(m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE))
        ex["modules"][500]["video_url"] = "https://acct.r2.cloudflarestorage.com/b/x.mp4"
        s = src_fixture()
        s["modules"][0]["media_url"] = "https://asset-manager-approved.s3.ap-south-1.amazonaws.com/NEW.mp4"
        p = m.build_plan(s, ex, VendorRow.BASE)
        patch = p["modules"]["update"][0]["patch"]
        self.assertTrue(patch["video_url"].endswith("NEW.mp4"))
        self.assertTrue(patch["source_media_url"].endswith("NEW.mp4"))

    def test_existing_vendor_is_left_alone(self):
        ex = materialise(m.build_plan(src_fixture(), empty_existing(), VendorRow.BASE))
        ex["vendor"]["passing_pct"] = 55  # an operator tuned it by hand: a re-import must not reset it
        p = m.build_plan(src_fixture(), ex, VendorRow.BASE)
        self.assertEqual(p["vendor"]["action"], "unchanged")


class ForeignCollision(unittest.TestCase):
    def test_a_source_id_already_owned_by_another_vendor_aborts(self):
        ex = empty_existing()
        ex["foreign"] = [("training_modules", 500, "TALEEMABAD")]
        with self.assertRaises(m.ImportAbort):
            m.build_plan(src_fixture(), ex, VendorRow.BASE)


class ValidateSource(unittest.TestCase):
    def test_wrong_course_set_aborts(self):
        s = src_fixture()
        s["courses"].append({"id": 311, "level_id": 1, "title": "dup", "type": "x", "index": 1})
        with self.assertRaises(m.ImportAbort):
            m.validate_source(s, expect_full_scope=False)

    def test_full_scope_requires_all_66_courses(self):
        with self.assertRaises(m.ImportAbort):
            m.validate_source(src_fixture(), expect_full_scope=True)


if __name__ == "__main__":
    unittest.main()
