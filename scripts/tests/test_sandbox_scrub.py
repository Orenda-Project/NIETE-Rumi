"""scripts/lib/sandbox_scrub.py: the pure part of scripts/sandbox-pii-purge.py.

The sandbox database is shared with outside developers, so it must hold no real person's phone or name. The purge
rewrites every real phone to a number in Pakistan's unallocated 0399 block and every real name to a marked dummy,
and it must do so CONSISTENTLY (one person -> one fake, in every table and every spelling) so joins, pickers and
dashboards keep working. Everything here is decided without a database and pinned by these tests.

Run: python3 -m unittest scripts/tests/test_sandbox_scrub.py   (or pytest scripts/tests/test_sandbox_scrub.py)

No phone-shaped literal sits in this file (tracked-files-pii): numbers are built from parts at runtime.
"""
import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import sandbox_scrub as ss  # noqa: E402


def nat(tail):
    """A real-looking Pakistani national mobile number: '3' + 9 digits (no country code)."""
    return "3" + str(tail).rjust(9, "0")


N1 = nat(1234567 + 10 ** 8)  # 31xxxxxxxx
N2 = nat(7654321 + 3 * 10 ** 8)  # 33xxxxxxxx
CC = "9" + "2"
M99 = "9" + "9"


class PhoneParsing(unittest.TestCase):
    def test_finds_every_common_spelling_and_its_national_number(self):
        spellings = [CC + N1, "+" + CC + N1, "0" + N1, "+" + CC + " " + N1[:3] + " " + N1[3:],
                     "0" + N1[:3] + "-" + N1[3:], "0" + N1[:3] + " " + N1[3:]]
        for s in spellings:
            found = ss.find_phones(f"call {s} now")
            self.assertEqual([(f.national, f.cls) for f in found], [(N1, "pk")], s)

    def test_the_masked_99_spelling_is_its_own_class(self):
        found = ss.find_phones(M99 + N1)
        self.assertEqual([(f.national, f.cls) for f in found], [(N1, "m99")])

    def test_ignores_digits_inside_longer_runs_ids_and_uuids(self):
        long_run = "1" + CC + N1 + "7"
        uuid_like = "0f1e2d3c-1a2b-4c3d-8e9f-" + CC + N1[:10]
        self.assertEqual(ss.find_phones(long_run), [])
        self.assertEqual(ss.find_phones(uuid_like), [])
        self.assertEqual(ss.find_phones("abc" + CC + N1), [])

    def test_finds_phones_in_urls_and_json(self):
        url = f"https://x.r2.cloudflarestorage.com/rumi-sandbox/audio/{CC}{N1}/169_1.ogg"
        self.assertEqual([f.national for f in ss.find_phones(url)], [N1])
        js = json.dumps({"waiters": [CC + N1, CC + N2]})
        self.assertEqual([f.national for f in ss.find_phones(js)], [N1, N2])

    def test_real_national_excludes_the_unallocated_0399_block(self):
        self.assertTrue(ss.is_real_national(N1))
        self.assertFalse(ss.is_real_national("399" + "7" + "123456"))
        self.assertFalse(ss.is_real_national("399" + "8" + "123456"))
        self.assertFalse(ss.is_real_national("2" + "123456789"))


class CodeMap(unittest.TestCase):
    def test_codes_are_deterministic_unique_six_digits_and_avoid_taken(self):
        nationals = [nat(i * 7919 + 10 ** 8) for i in range(3000)]
        m1 = ss.build_code_map(nationals, salt="s", taken=set())
        m2 = ss.build_code_map(list(reversed(nationals)), salt="s", taken=set())
        self.assertEqual(m1, m2)
        self.assertEqual(len(set(m1.values())), len(nationals))
        self.assertTrue(all(re.fullmatch(r"\d{6}", c) for c in m1.values()))
        taken = {m1[nationals[0]]}
        m3 = ss.build_code_map(nationals, salt="s", taken=taken)
        self.assertNotIn(m1[nationals[0]], m3.values())

    def test_a_different_salt_gives_a_different_map(self):
        nationals = [nat(i + 10 ** 8) for i in range(50)]
        self.assertNotEqual(ss.build_code_map(nationals, salt="a", taken=set()),
                            ss.build_code_map(nationals, salt="b", taken=set()))


class Rewriting(unittest.TestCase):
    def setUp(self):
        self.codes = {N1: "000417", N2: "123456"}

    def scrub(self, text, keep=frozenset()):
        return ss.scrub_phones(text, self.codes, keep)

    def test_pk_spellings_keep_their_shape_and_land_in_the_3998_block(self):
        self.assertEqual(self.scrub(CC + N1), (CC + "3998000417", 1))
        self.assertEqual(self.scrub("+" + CC + N1), ("+" + CC + "3998000417", 1))
        self.assertEqual(self.scrub("0" + N1), ("0" + "3998000417", 1))
        self.assertEqual(self.scrub("+" + CC + " " + N1[:3] + " " + N1[3:]), ("+" + CC + " 399 8000417", 1))
        self.assertEqual(self.scrub("0" + N1[:3] + "-" + N1[3:]), ("0" + "399-" + "8000417", 1))

    def test_the_masked_99_spelling_becomes_a_pk_number_in_the_3999_block(self):
        self.assertEqual(self.scrub(M99 + N1), (CC + "3999000417", 1))

    def test_one_person_gets_one_fake_in_every_spelling(self):
        a, _ = self.scrub(CC + N1)
        b, _ = self.scrub("0" + N1)
        self.assertEqual(a[-10:], b[-10:])

    def test_keep_list_nationals_and_fake_numbers_are_left_alone(self):
        self.assertEqual(self.scrub(CC + N1, keep={N1}), (CC + N1, 0))
        fake = CC + "3997" + "000001"
        self.assertEqual(self.scrub(fake), (fake, 0))

    def test_a_masked_copy_of_a_keep_list_number_is_still_scrubbed(self):
        self.assertEqual(self.scrub(M99 + N1, keep={N1}), (CC + "3999000417", 1))

    def test_urls_and_json_are_rewritten_in_place(self):
        url = f"https://h/rumi-sandbox/audio/{CC}{N1}/1_2.ogg"
        out, n = self.scrub(url)
        self.assertEqual((out, n), (f"https://h/rumi-sandbox/audio/{CC}3998000417/1_2.ogg", 1))
        js = json.dumps({"a": CC + N1, "b": ["0" + N2]})
        out, n = self.scrub(js)
        self.assertEqual(json.loads(out), {"a": CC + "3998000417", "b": ["0" + "3998123456"]})
        self.assertEqual(n, 2)

    def test_an_unmapped_real_number_raises_rather_than_leaking(self):
        with self.assertRaises(KeyError):
            ss.scrub_phones(CC + nat(5 + 3 * 10 ** 8), self.codes, frozenset())

    def test_fake_phone_for_a_national(self):
        self.assertEqual(ss.fake_e164(N1, self.codes), CC + "3998000417")
        self.assertEqual(ss.fake_e164(N1, self.codes, cls="m99"), CC + "3999000417")


class Names(unittest.TestCase):
    def test_fake_names_are_deterministic_marked_and_varied(self):
        a = ss.fake_name("seed-1", salt="s")
        self.assertEqual(a, ss.fake_name("seed-1", salt="s"))
        self.assertTrue(ss.is_fake_name(a), a)
        names = {ss.fake_name(f"seed-{i}", salt="s") for i in range(500)}
        self.assertGreater(len(names), 490)

    def test_urdu_fake_names_are_marked_too(self):
        u = ss.fake_name_ur("seed-1", salt="s")
        self.assertTrue(ss.is_fake_name(u), u)
        self.assertRegex(u, r"[؀-ۿ]")

    def test_kind_prefixes(self):
        self.assertTrue(ss.fake_name("x", salt="s", kind="student").startswith("Student "))
        self.assertTrue(ss.is_fake_name(ss.fake_name("x", salt="s", kind="student")))

    def test_real_looking_names_are_not_fake(self):
        for n in ("Ayesha Khan", "Testwala Teacher", "", None):
            self.assertFalse(ss.is_fake_name(n), n)

    def test_replace_name_in_prose_whole_words_only(self):
        txt = "Ms. Saima Batool asked questions. Saima smiled. Saimaa is someone else."
        out = ss.replace_names(txt, {"Saima Batool": "Hina Dummy 0042", "Saima": "Hina"})
        self.assertEqual(out, "Ms. Hina Dummy 0042 asked questions. Hina smiled. Saimaa is someone else.")


class Guards(unittest.TestCase):
    def test_only_the_sandbox_project_is_accepted(self):
        ss.refuse_unless_sandbox("postgresql://postgres.olvritwoqujtjvwfulbh:x@h:5432/postgres")
        for ref in ("ihzciabopbttygxxgrkm", "rpqkekcfvumypldbejhp", "someotherref"):
            with self.assertRaises(SystemExit):
                ss.refuse_unless_sandbox(f"postgresql://postgres.{ref}:x@h:5432/postgres")

    def test_only_the_sandbox_bucket_may_lose_objects(self):
        ss.refuse_unless_sandbox_bucket("rumi-sandbox")
        for b in ("digital-coach-audio", "niete-prod", ""):
            with self.assertRaises(SystemExit):
                ss.refuse_unless_sandbox_bucket(b)

    def test_r2_key_from_a_url(self):
        u = "https://acct.r2.cloudflarestorage.com/rumi-sandbox/classroom_audio/a/b.ogg?X-Amz=1"
        self.assertEqual(ss.r2_bucket_key(u), ("rumi-sandbox", "classroom_audio/a/b.ogg"))
        self.assertEqual(ss.r2_bucket_key("classroom_audio/a/b.ogg"), (None, "classroom_audio/a/b.ogg"))
        self.assertEqual(ss.r2_bucket_key("https://pub-x.r2.dev/k/v.png"), ("pub", "k/v.png"))
        self.assertEqual(ss.r2_bucket_key(None), (None, None))


IMPORTERS = ("migrate-users.py", "migrate-coaching-observations.py", "migrate-teacher-training.py",
             "migrate-training-attempts.py", "migrate-training-history.py", "sync-training-from-fde.py",
             "backfill-training-certificates.py", "backfill-progress-from-passes.py")


class RealDataNeverReturns(unittest.TestCase):
    """The sandbox got its real people from importers run against it in July 2026. They now refuse that target."""

    def test_the_guard_refuses_the_sandbox_and_lets_other_targets_through(self):
        with self.assertRaises(SystemExit):
            ss.refuse_real_data_into_sandbox("https://olvritwoqujtjvwfulbh.supabase.co")
        with self.assertRaises(SystemExit):
            ss.refuse_real_data_into_sandbox("postgresql://postgres.olvritwoqujtjvwfulbh:x@h:5432/postgres")
        ss.refuse_real_data_into_sandbox("https://ihzciabopbttygxxgrkm.supabase.co")
        ss.refuse_real_data_into_sandbox("https://rpqkekcfvumypldbejhp.supabase.co")

    def test_every_real_data_importer_calls_the_guard(self):
        here = os.path.join(os.path.dirname(__file__), "..")
        for f in IMPORTERS:
            src = open(os.path.join(here, f)).read()
            self.assertIn("refuse_real_data_into_sandbox(", src, f)

    def test_the_gb_migration_refuses_a_sandbox_write_but_still_dry_runs(self):
        import gb_migration as gb
        self.assertIsNotNone(gb.run_refusal("sandbox", fake=True, commit=True))
        self.assertIsNone(gb.run_refusal("sandbox", fake=True, commit=False))
        self.assertIsNone(gb.run_refusal("staging", fake=True, commit=True))


if __name__ == "__main__":
    unittest.main()
