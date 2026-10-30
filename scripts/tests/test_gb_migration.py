"""bd-97daxo.7 — scripts/lib/gb_migration.py: the pure part of migrate-gb-from-rumi.py.

Every rule of the Gilgit-Baltistan move from main Rumi into NIETE that can be decided without a database lives in
the lib and is pinned here: ids, fake phones, the role/organization/language mapping, school matching for leader
rows, the coaching-session column contract, phone and EMIS collisions, and the env/ref guards.

Run: python3 -m unittest scripts/tests/test_gb_migration.py   (or pytest scripts/tests/test_gb_migration.py)

No phone-shaped literal sits in this file (phone-shaped-fixtures / tracked-files-pii): numbers are built from parts.
"""
import json
import os
import re
import sys
import unittest
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import gb_migration as gb  # noqa: E402


def ph(tail):
    """A real-looking Pakistani mobile, built at runtime: '92' + '3' + 9 digits."""
    return "92" + "3" + str(tail).rjust(9, "0")


PK_MOBILE = re.compile(r"^923\d{9}$")

# ── source fixtures (main Rumi shapes) ────────────────────────────────────────────────────────────────
S_HARP = {"id": "10000000-0000-4000-8000-000000000001", "name": "MF Community School Harpandas", "emis": "91516",
          "ext_id": "91516", "region": "gilgit_baltistan", "source": "moawin_gb_pilot"}
S_SUN = {"id": "10000000-0000-4000-8000-000000000002", "name": "Sun Valley Middle Kanday - MF community",
         "emis": "63027", "ext_id": "63027", "region": "gilgit_baltistan", "source": "moawin_gb_pilot"}
S_DEOSAI = {"id": "10000000-0000-4000-8000-000000000003", "name": "Deosai Community school Dapa Kharmang",
            "emis": None, "ext_id": "gb-deosai-community-school-dapa-kharmang", "region": "gilgit_baltistan",
            "source": "moawin_gb_pilot"}
S_USMAN = {"id": "10000000-0000-4000-8000-000000000004", "name": "MF Community school Usmanabad Jaglote",
           "emis": "12527", "ext_id": "12527", "region": "gilgit_baltistan", "source": "moawin_gb_pilot"}
SCHOOLS = [S_HARP, S_SUN, S_DEOSAI, S_USMAN]


def person(n, role="teacher", org="moawin", school=None, region="gilgit_baltistan", **kw):
    p = {"id": f"20000000-0000-4000-8000-{n:012d}", "phone_number": ph(100000 + n), "name": f"Person {n}",
         "first_name": None, "last_name": None, "role": role, "organization": org, "region": region,
         "school_id": school["id"] if school else None, "school_name": school["name"] if school else None,
         "preferred_language": "ur", "language_locked": False, "grades_taught": ["grade_1", "grade_3"],
         "subjects_taught": ["maths", "urdu"], "registration_completed": True,
         "registration_completed_at": "2026-09-01T10:00:00", "created_at": "2026-08-01T10:00:00"}
    p.update(kw)
    return p


def session(n, user, observer=None, fw="hots", status="completed", **kw):
    s = {"id": f"30000000-0000-4000-8000-{n:012d}", "user_id": user["id"],
         "observer_user_id": observer["id"] if observer else None, "status": status,
         "observation_type": "leader_observation" if observer else None,
         "analysis_data": {"framework": fw, "scores": {"total": 12}}, "transcript_text": "t",
         "audio_url": f"https://acct.r2.cloudflarestorage.com/digital-coach-audio/classroom_audio/{n}.ogg",
         "report_pdf_url": None, "classroom_photos": [], "session_id": "40000000-0000-4000-8000-000000000001",
         "conversation_state": {"step": "done"}, "linked_lesson_plan_id": "50000000-0000-4000-8000-000000000001",
         "lesson_plan_link_method": "auto", "photo_analysis": "x", "agency_response": "y", "source": "whatsapp",
         "resume_outcome": None, "duplicate_of_session_id": None, "created_at": "2026-10-01T09:00:00+00:00"}
    s.update(kw)
    return s


def source(people, leader_schools=(), leader_teachers=(), sessions=()):
    return {"people": list(people), "schools": list(SCHOOLS), "leader_schools": list(leader_schools),
            "leader_teachers": list(leader_teachers), "sessions": list(sessions)}


def target(phones=None, emis=None, canon=None, user_ids=(), school_ids=(), session_ids=()):
    return {"phones": dict(phones or {}), "emis": dict(emis or {}), "canon_name_region": dict(canon or {}),
            "user_ids": set(user_ids), "school_ids": set(school_ids), "session_ids": set(session_ids)}


# ── ids ───────────────────────────────────────────────────────────────────────────────────────────────
class Ids(unittest.TestCase):
    def test_deterministic_version5_and_never_the_source_id(self):
        a = gb.niete_id("users", S_HARP["id"])
        self.assertEqual(a, gb.niete_id("users", S_HARP["id"]))
        self.assertEqual(uuid.UUID(a).version, 5)  # gen_random_uuid()/uuid_generate_v4() are v4: no collision
        self.assertNotEqual(a, S_HARP["id"])

    def test_kinds_do_not_share_ids(self):
        self.assertNotEqual(gb.niete_id("users", S_HARP["id"]), gb.niete_id("schools", S_HARP["id"]))


# ── fake phones ───────────────────────────────────────────────────────────────────────────────────────
class FakePhones(unittest.TestCase):
    def test_shape_block_and_determinism(self):
        p = gb.fake_phone("abc")
        self.assertRegex(p, PK_MOBILE)          # what every phone validator in the repo accepts
        self.assertTrue(p.startswith(gb.FAKE_PHONE_PREFIX))
        self.assertTrue(gb.FAKE_PHONE_PREFIX.startswith("92399"))  # 0399: no Pakistani operator's code
        self.assertEqual(p, gb.fake_phone("abc"))
        self.assertTrue(gb.is_fake_phone(p))
        self.assertFalse(gb.is_fake_phone(ph(1234567)))

    def test_a_taken_number_is_skipped(self):
        first = gb.fake_phone("abc")
        other = gb.fake_phone("abc", taken={first})
        self.assertNotEqual(first, other)
        self.assertRegex(other, PK_MOBILE)

    def test_assignment_is_unique_order_free_and_avoids_taken(self):
        ids = [f"id-{i}" for i in range(400)]
        taken = {gb.fake_phone("id-7")}
        a = gb.assign_fake_phones(ids, taken=set(taken))
        b = gb.assign_fake_phones(list(reversed(ids)), taken=set(taken))
        self.assertEqual(a, b)
        self.assertEqual(len(set(a.values())), len(ids))
        self.assertFalse(set(a.values()) & taken)


# ── mapping ───────────────────────────────────────────────────────────────────────────────────────────
class Mapping(unittest.TestCase):
    def test_roles_land_in_niete_users_role_check(self):
        expect = {"teacher": "teacher", "principal": "principal", "school_leader": "principal",
                  "fmo": "coach", "supervisor": "coach"}
        for src, want in expect.items():
            self.assertEqual(gb.map_role(src), want, src)
        self.assertEqual(gb.map_role("FMO "), "coach")
        self.assertEqual(gb.map_role("wizard"), "unregistered")
        self.assertEqual(gb.map_role(None), "unregistered")
        for src in list(expect) + ["wizard", None]:
            self.assertIn(gb.map_role(src), gb.NIETE_ROLES)

    def test_organization(self):
        self.assertEqual(gb.map_organization("moawin"), "moawin")
        self.assertEqual(gb.map_organization(" Moawin"), "moawin")
        self.assertEqual(gb.map_organization("SED GB"), "SED GB")
        self.assertIsNone(gb.map_organization("none"))
        self.assertIsNone(gb.map_organization(""))
        self.assertIsNone(gb.map_organization(None))

    def test_language_is_clamped_to_nietes_offer(self):
        self.assertEqual(gb.clamp_language("ur", False), ("ur", False))
        self.assertEqual(gb.clamp_language("EN", True), ("en", True))
        self.assertEqual(gb.clamp_language("pa-PK", True), ("ur", False))  # not offered → default, not locked
        self.assertEqual(gb.clamp_language(None, None), ("ur", False))

    def test_slug(self):
        self.assertEqual(gb.slug("Akbarya Middle School Shigar - MF community"),
                         "akbarya-middle-school-shigar-mf-community")


# ── schools ───────────────────────────────────────────────────────────────────────────────────────────
class Schools(unittest.TestCase):
    def test_transform(self):
        r = gb.transform_school(S_HARP)
        self.assertEqual(r["id"], gb.niete_id("schools", S_HARP["id"]))
        self.assertEqual(r["region"], "Gilgit-Baltistan")
        self.assertEqual(r["emis"], "91516")
        self.assertEqual(r["source_system"], "main_rumi")
        self.assertIsNone(r["source_school_id"])     # bigint: a main-Rumi uuid does not fit; the map file has it
        self.assertFalse(r["is_probable_test"])
        self.assertEqual(r["_ext_key"], "niete:91516")  # NIETE keys a coach's school as 'niete:' || emis

    def test_no_emis_stays_null(self):
        r = gb.transform_school(S_DEOSAI)
        self.assertIsNone(r["emis"])
        self.assertEqual(r["_ext_key"], "niete:gb-deosai-community-school-dapa-kharmang")

    def test_leader_row_resolution_school_id_then_slug_then_emis(self):
        by_id = {s["id"]: s for s in SCHOOLS}
        self.assertEqual(gb.resolve_leader_school({"school_id": S_HARP["id"], "school_ext_id": "x", "emis": None},
                                                  by_id), S_HARP["id"])
        # main Rumi's Deosai FMO row carries Sun Valley's EMIS: the slug wins over it
        self.assertEqual(gb.resolve_leader_school({"school_id": None, "emis": "63027",
                                                   "school_ext_id": "sch:gb:deosai-community-school-dapa-kharmang"},
                                                  by_id), S_DEOSAI["id"])
        # a shortened slug falls back to the EMIS
        self.assertEqual(gb.resolve_leader_school({"school_id": None, "emis": "12527",
                                                   "school_ext_id": "sch:gb:mf-community-school-usmanabad"},
                                                  by_id), S_USMAN["id"])
        self.assertIsNone(gb.resolve_leader_school({"school_id": None, "emis": "1", "school_ext_id": "sch:gb:nope"},
                                                   by_id))


# ── users ─────────────────────────────────────────────────────────────────────────────────────────────
class Users(unittest.TestCase):
    def test_transform(self):
        src = person(1, school=S_HARP, region="", preferred_language="pa-PK", language_locked=True,
                     grades_taught=["grade_1", "kg_bogus"], subjects_taught=["maths", "astrology"])
        school = gb.transform_school(S_HARP)
        r = gb.transform_user(src, school=school, phone="P", fake=True, migrated_at="2026-10-29T00:00:00Z")
        self.assertEqual(r["id"], gb.niete_id("users", src["id"]))
        self.assertEqual(r["phone_number"], "P")
        self.assertEqual(r["region"], "Gilgit-Baltistan")       # even when main Rumi only had it on the school
        self.assertEqual(r["organization"], "moawin")
        self.assertEqual(r["role"], "teacher")
        self.assertEqual(r["school_id"], school["id"])
        self.assertEqual(r["school_name"], S_HARP["name"])
        self.assertEqual((r["preferred_language"], r["language_locked"]), ("ur", False))
        self.assertEqual(json.loads(r["grades_taught"]), ["grade_1"])
        self.assertEqual(r["subjects_taught"], ["maths"])
        self.assertFalse(r["is_test_user"])
        self.assertEqual(r["registration_state"], "completed")
        mr = r["preferences"]["main_rumi"]
        self.assertEqual(mr["user_id"], src["id"])
        self.assertTrue(mr["fake_phone"])
        self.assertEqual(mr["role"], "teacher")
        self.assertNotIn(src["phone_number"], json.dumps(r["preferences"]))

    def test_name_from_parts_and_no_school(self):
        src = person(2, name=None, first_name="Amina", last_name="Bano", org="SED GB")
        r = gb.transform_user(src, school=None, phone=src["phone_number"], fake=False, migrated_at="t")
        self.assertEqual(r["name"], "Amina Bano")
        self.assertIsNone(r["school_id"])
        self.assertEqual(r["organization"], "SED GB")


# ── coaching sessions ─────────────────────────────────────────────────────────────────────────────────
class Sessions(unittest.TestCase):
    def setUp(self):
        self.t = person(1, school=S_HARP)
        self.fmo = person(2, role="fmo")
        self.ids = {self.t["id"]: gb.niete_id("users", self.t["id"]), self.fmo["id"]: gb.niete_id("users", self.fmo["id"])}

    def test_remapped_to_niete_ids_with_framework(self):
        s = session(1, self.t, observer=self.fmo, status="observer_review_complete")
        r = gb.transform_session(s, self.ids, set())
        self.assertEqual(r["id"], gb.niete_id("coaching_sessions", s["id"]))
        self.assertEqual(r["user_id"], self.ids[self.t["id"]])
        self.assertEqual(r["observer_user_id"], self.ids[self.fmo["id"]])
        self.assertEqual(r["framework"], "hots")
        self.assertEqual(r["status"], "observer_review_complete")
        self.assertFalse(r["can_resume"])
        self.assertEqual(r["analysis_data"], s["analysis_data"])

    def test_main_rumi_only_links_are_dropped_and_columns_are_niete_ones(self):
        r = gb.transform_session(session(2, self.t, fw="oecd"), self.ids, set())
        self.assertEqual(r["framework"], "oecd")
        for col in ("session_id", "conversation_state", "linked_lesson_plan_id", "lesson_plan_link_method"):
            self.assertIsNone(r[col], col)
        for col in ("photo_analysis", "agency_response", "source", "resume_outcome", "resume_offered_at"):
            self.assertNotIn(col, r)
        self.assertTrue(set(r) <= set(gb.SESSION_COLUMNS))

    def test_teacher_not_migrated_drops_the_session_observer_not_migrated_drops_the_link(self):
        self.assertIsNone(gb.transform_session(session(3, person(9)), self.ids, set()))
        r = gb.transform_session(session(4, self.t, observer=person(8)), self.ids, set())
        self.assertIsNone(r["observer_user_id"])

    def test_duplicate_link_kept_only_inside_the_migrated_set(self):
        dup = "30000000-0000-4000-8000-000000000099"
        r = gb.transform_session(session(5, self.t, duplicate_of_session_id=dup), self.ids, {dup})
        self.assertEqual(r["duplicate_of_session_id"], gb.niete_id("coaching_sessions", dup))
        r = gb.transform_session(session(6, self.t, duplicate_of_session_id=dup), self.ids, set())
        self.assertIsNone(r["duplicate_of_session_id"])


# ── the whole plan ────────────────────────────────────────────────────────────────────────────────────
class Plan(unittest.TestCase):
    def setUp(self):
        self.t1 = person(1, school=S_HARP)
        self.t2 = person(2, school=None)                  # school only through her leader's roster
        self.t3 = person(3, school=S_SUN, org="taleemabad")
        self.p1 = person(4, role="principal", school=S_HARP)
        self.fmo = person(5, role="fmo")
        self.people = [self.t1, self.t2, self.t3, self.p1, self.fmo]
        self.ls = [
            {"leader_user_id": self.fmo["id"], "school_id": None, "emis": "91516",
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "school_name": "x"},
            {"leader_user_id": self.fmo["id"], "school_id": S_HARP["id"], "emis": "91516",
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "school_name": "x"},   # same school twice
            {"leader_user_id": self.p1["id"], "school_id": S_HARP["id"], "emis": "91516",
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "school_name": "x"},
            {"leader_user_id": "20000000-0000-4000-8000-999999999999", "school_id": S_HARP["id"], "emis": "91516",
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "school_name": "x"},   # leader not in scope
        ]
        self.lt = [
            {"leader_user_id": self.fmo["id"], "teacher_user_id": self.t1["id"], "school_id": None,
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "emis": None},
            {"leader_user_id": self.fmo["id"], "teacher_user_id": self.t2["id"], "school_id": None,
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "emis": None},
            {"leader_user_id": self.fmo["id"], "teacher_user_id": self.t3["id"], "school_id": None,
             "school_ext_id": "sch:gb:mf-community-school-harpandas", "emis": None},          # t3 is at Sun Valley
        ]
        self.sessions = [session(1, self.t1), session(2, self.t2, observer=self.fmo, status="observer_review_complete")]

    def run_plan(self, tgt=None, fake=True, people=None):
        return gb.plan(source(people or self.people, self.ls, self.lt, self.sessions), tgt or target(), fake=fake)

    def test_counts_and_targets(self):
        p = self.run_plan()
        self.assertEqual(len(p["schools"]), 4)
        self.assertEqual(len(p["users"]), 5)
        by_src = {u["preferences"]["main_rumi"]["user_id"]: u for u in p["users"]}
        self.assertEqual({u["region"] for u in p["users"]}, {"Gilgit-Baltistan"})
        self.assertEqual(by_src[self.t3["id"]]["organization"], "taleemabad")
        self.assertEqual(by_src[self.fmo["id"]]["role"], "coach")
        self.assertEqual(len(p["coaching_sessions"]), 2)
        self.assertEqual(p["guards"], {})

    def test_a_teacher_with_no_school_takes_her_leaders_roster_school(self):
        p = self.run_plan()
        t2 = next(u for u in p["users"] if u["preferences"]["main_rumi"]["user_id"] == self.t2["id"])
        self.assertEqual(t2["school_id"], gb.niete_id("schools", S_HARP["id"]))
        self.assertEqual(p["report"]["school_inferred_from_roster"], 1)

    def test_leader_schools_in_niete_keys_deduped_out_of_scope_leaders_skipped(self):
        p = self.run_plan()
        rows = p["leader_schools"]
        self.assertEqual(len(rows), 2)  # fmo→Harpandas once, principal→Harpandas
        for r in rows:
            self.assertEqual(r["source"], "niete_ict")          # NIETE's CHECK allows only this value
            self.assertEqual(r["school_ext_id"], "niete:91516")
            self.assertEqual(r["school_id"], gb.niete_id("schools", S_HARP["id"]))
        self.assertEqual(p["report"]["leader_schools_skipped_leader_not_migrated"], 1)

    def test_principal_is_set_on_her_school(self):
        p = self.run_plan()
        self.assertEqual(p["school_principals"], {gb.niete_id("schools", S_HARP["id"]): gb.niete_id("users", self.p1["id"])})

    def test_patch_coverage_names_the_roster_links_niete_will_not_derive(self):
        p = self.run_plan()
        cov = p["report"]["patch_coverage"]
        self.assertEqual(cov["covered"], 2)       # t1 and t2 are at Harpandas, which the FMO holds
        self.assertEqual(cov["not_covered"], 1)   # t3 is at Sun Valley, which the FMO does not hold

    def test_fake_phones_are_fake_unique_and_never_a_source_or_target_number(self):
        taken = {gb.fake_phone(self.t1["id"]): "some-other-user"}
        p = self.run_plan(tgt=target(phones=taken))
        phones = [u["phone_number"] for u in p["users"]]
        self.assertTrue(all(gb.is_fake_phone(x) and PK_MOBILE.match(x) for x in phones))
        self.assertEqual(len(set(phones)), len(phones))
        self.assertFalse(set(phones) & {x["phone_number"] for x in self.people})
        self.assertFalse(set(phones) & set(taken))

    def test_real_phones_only_without_fake(self):
        p = self.run_plan(fake=False)
        self.assertEqual(sorted(u["phone_number"] for u in p["users"]), sorted(x["phone_number"] for x in self.people))

    def test_a_real_phone_already_in_niete_is_listed_not_written(self):
        existing = {self.t1["phone_number"]: "60000000-0000-4000-8000-000000000001"}
        for fake in (True, False):
            p = self.run_plan(tgt=target(phones=existing), fake=fake)
            srcs = {u["preferences"]["main_rumi"]["user_id"] for u in p["users"]}
            self.assertNotIn(self.t1["id"], srcs)
            self.assertEqual([c["main_rumi_user_id"] for c in p["collisions"]], [self.t1["id"]])
            self.assertEqual(p["collisions"][0]["niete_user_id"], existing[self.t1["phone_number"]])
            self.assertNotIn(self.t1["phone_number"], json.dumps(p["collisions"]))   # masked, never the number
            self.assertEqual(len(p["coaching_sessions"]), 1)                         # her session is not written

    def test_our_own_row_from_an_earlier_run_is_not_a_collision(self):
        mine = gb.niete_id("users", self.t1["id"])
        p = self.run_plan(tgt=target(phones={self.t1["phone_number"]: mine}, user_ids={mine}), fake=False)
        self.assertEqual(p["collisions"], [])
        self.assertEqual(p["report"]["users_existing"], 1)

    def test_an_emis_held_by_another_school_is_a_guard(self):
        p = self.run_plan(tgt=target(emis={"91516": "70000000-0000-4000-8000-000000000001"}))
        self.assertIn("emis_taken_by_other_school", p["guards"])
        self.assertIn("91516", json.dumps(p["guards"]))

    def test_same_input_same_plan(self):
        self.assertEqual(json.dumps(self.run_plan(), sort_keys=True, default=str),
                         json.dumps(self.run_plan(), sort_keys=True, default=str))

    def test_mapping_covers_every_written_row(self):
        p = self.run_plan()
        m = p["mapping"]
        self.assertEqual(set(m["users"].values()), {u["id"] for u in p["users"]})
        self.assertEqual(set(m["schools"].values()), {s["id"] for s in p["schools"]})
        self.assertEqual(set(m["coaching_sessions"].values()), {s["id"] for s in p["coaching_sessions"]})
        self.assertEqual(set(m["fake_phones"]), {x["id"] for x in self.people})


# ── guards around the run ─────────────────────────────────────────────────────────────────────────────
class RunGuards(unittest.TestCase):
    def test_fake_phones_required_off_prod_and_refused_on_prod(self):
        self.assertIsNotNone(gb.run_refusal("sandbox", fake=False, commit=False))
        self.assertIsNotNone(gb.run_refusal("staging", fake=False, commit=True))
        self.assertIsNone(gb.run_refusal("staging", fake=True, commit=True))
        self.assertIsNotNone(gb.run_refusal("prod", fake=True, commit=False))
        self.assertIsNone(gb.run_refusal("prod", fake=False, commit=False))

    def test_a_prod_write_needs_the_typed_ref_and_the_go(self):
        self.assertIsNotNone(gb.run_refusal("prod", fake=False, commit=True))
        self.assertIsNotNone(gb.run_refusal("prod", fake=False, commit=True, confirm_ref=gb.TARGET_REFS["prod"]))
        self.assertIsNone(gb.run_refusal("prod", fake=False, commit=True, confirm_ref=gb.TARGET_REFS["prod"], go="yes"))

    def test_target_ref_is_checked_from_the_env_file(self):
        good = {"DATABASE_URL": "postgresql://postgres.%s:pw@host:5432/postgres" % gb.TARGET_REFS["sandbox"]}
        self.assertEqual(gb.assert_target("sandbox", good), gb.TARGET_REFS["sandbox"])
        with self.assertRaises(SystemExit):
            gb.assert_target("staging", good)
        with self.assertRaises(SystemExit):
            gb.assert_target("sandbox", {"SUPABASE_URL": "https://%s.supabase.co" % gb.TARGET_REFS["prod"]})

    def test_source_must_be_main_rumi_never_a_niete_db(self):
        ok = "postgresql://analyst.%s:pw@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres" % gb.SOURCE_REF
        self.assertEqual(gb.assert_source(ok), gb.SOURCE_REF)
        for ref in gb.TARGET_REFS.values():
            with self.assertRaises(SystemExit):
                gb.assert_source("postgresql://postgres.%s:pw@h:5432/postgres" % ref)
        with self.assertRaises(SystemExit):
            gb.assert_source("")


# ── files ─────────────────────────────────────────────────────────────────────────────────────────────
class Files(unittest.TestCase):
    URL = "https://acct.r2.cloudflarestorage.com/digital-coach-audio/classroom_audio/u/2026-10/a.ogg"

    def test_bucket_and_key(self):
        self.assertEqual(gb.bucket_and_key(self.URL), ("digital-coach-audio", "classroom_audio/u/2026-10/a.ogg"))
        self.assertIsNone(gb.bucket_and_key("not a url"))

    def test_rehost_keeps_the_key_in_the_target_bucket(self):
        self.assertEqual(gb.rehost_url(self.URL, "https://acct.r2.cloudflarestorage.com", "rumi-sandbox"),
                         "https://acct.r2.cloudflarestorage.com/rumi-sandbox/classroom_audio/u/2026-10/a.ogg")

    def test_session_files_lists_every_url(self):
        s = session(1, person(1), report_pdf_url=self.URL.replace("a.ogg", "r.png"),
                    classroom_photos=[{"url": self.URL.replace("a.ogg", "p.jpg"), "uploaded_at": "t"}])
        self.assertEqual(len(gb.session_files(s)), 3)


if __name__ == "__main__":
    unittest.main()
