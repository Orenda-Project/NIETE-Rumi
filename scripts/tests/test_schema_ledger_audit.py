"""schema-ledger-audit.py end to end against a stand-in connection: what it reports, and
that it can only READ — every statement it sends is a SELECT, and it ends by rolling back."""
import contextlib
import importlib.util
import io
import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import schema_ledger as ledger  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "schema_ledger_audit", os.path.join(HERE, "..", "schema-ledger-audit.py"))
audit_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit_mod)


class FakeCursor:
    def __init__(self, recorded, present):
        self.recorded, self.present, self.sent, self._row = recorded, present, [], None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        self.sent.append(sql)
        if sql.strip() == "SELECT version FROM schema_versions":
            self._rows = [{"version": v} for v in self.recorded]
            return
        # A probe: present iff every identifier it names is in the "database".
        self._row = {"v": all(p in self.present for p in params if p not in ("YES", "NO"))} if params \
            else {"v": True}

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._row


class FakeConn:
    def __init__(self, cur):
        self.cur, self.rolled_back, self.committed = cur, False, False

    def cursor(self):
        return self.cur

    def rollback(self):
        self.rolled_back = True

    def commit(self):  # pragma: no cover - must never be called
        self.committed = True


FILES = [
    ("V1.0.1__a.sql", "CREATE TABLE IF NOT EXISTS aa_table (id int);"),   # there, unrecorded
    ("V1.0.2__b.sql", "CREATE TABLE IF NOT EXISTS bb_table (id int);"),   # missing, recorded
    ("V1.0.3__c.sql", "UPDATE users SET name = trim(name);"),              # data-only, unrecorded
]


def run(recorded, present):
    cur = FakeCursor(recorded, present)
    conn = FakeConn(cur)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        audit_mod.audit(conn, "sandbox", ledger.plan(FILES))
    return out.getvalue(), cur, conn


class Audit(unittest.TestCase):
    def test_reads_only_and_rolls_back(self):
        _, cur, conn = run(recorded={"1.0.2"}, present={"aa_table"})
        self.assertTrue(cur.sent)
        for sql in cur.sent:
            # SELECTs, and the savepoints that fence each probe — nothing that can write.
            self.assertRegex(sql.strip(), r"^(SELECT|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b")
        self.assertTrue(conn.rolled_back)
        self.assertFalse(conn.committed)

    def test_a_file_whose_objects_exist_but_has_no_row_gets_its_backfill_row(self):
        text, _, _ = run(recorded={"1.0.2"}, present={"aa_table"})
        e = ledger.plan(FILES)[0]
        self.assertIn(ledger.backfill_sql(e), text)
        self.assertRegex(text, r"1\.0\.1\s+NO\s+applied\s+V1\.0\.1__a\.sql")

    def test_a_recorded_file_whose_objects_are_missing_is_called_out(self):
        text, _, _ = run(recorded={"1.0.2"}, present={"aa_table"})
        self.assertRegex(text, r"1\.0\.2\s+yes\s+not_applied\s+V1\.0\.2__b\.sql")
        self.assertIn("missing: table bb_table", text)
        section = text.split("RECORDED BUT NOT APPLIED")[1].split("PARTIAL")[0]
        self.assertIn("V1.0.2__b.sql", section)

    def test_a_data_only_file_is_left_to_a_human_not_backfilled(self):
        text, _, _ = run(recorded=set(), present=set())
        section = text.split("UNVERIFIABLE AND UNRECORDED")[1].split("APPLIED BUT NOT RECORDED")[0]
        self.assertIn("V1.0.3__c.sql", section)
        self.assertNotIn("'1.0.3'", text)



class Psycopg2StyleCursor(FakeCursor):
    """psycopg2's parameter rules, without a server.

    params is None  -> the SQL goes to the server untouched, so a `%s` left in it is sent raw
                       (a syntax error on the server);
    params given    -> `%`-interpolated client-side, EVEN WHEN EMPTY: a literal `%` (a LIKE
                       pattern) raises, and so does a placeholder count that does not match.
    That second rule is the live crash: the markers ran `ILIKE 'DEPRECATED%'` with params=()
    and psycopg2 raised `IndexError: tuple index out of range` before reaching the server.
    """

    def execute(self, sql, params=None):
        if params is None:
            if "%s" in sql:
                raise AssertionError("placeholder sent raw (params=None): " + sql)
        else:
            sql % tuple("'?'" for _ in params)   # raises on a stray % or an arity mismatch
        return super().execute(sql, params if params is not None else ())


def run_psycopg2_style(recorded, present):
    cur = Psycopg2StyleCursor(recorded, present)
    conn = FakeConn(cur)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        audit_mod.audit(conn, "sandbox", ledger.plan(FILES))
    return out.getvalue(), cur, conn


class ParameterRules(unittest.TestCase):
    """Every statement the audit sends must survive psycopg2's `%` handling."""

    def test_the_whole_audit_runs_under_psycopg2_parameter_rules(self):
        text, _, conn = run_psycopg2_style(recorded={"1.0.2"}, present={"aa_table"})
        self.assertIn("live markers", text)
        self.assertIn("APPLIED BUT NOT RECORDED", text)   # the summary after the markers is reached
        self.assertTrue(conn.rolled_back)

    def test_every_marker_is_safe_as_declared(self):
        cur = Psycopg2StyleCursor(set(), set())
        for label, sql, params in audit_mod.MARKERS:
            with self.subTest(marker=label):
                cur.execute(sql, params)
                self.assertNotIn("%", sql.replace("%s", ""), "literal % belongs in params")

    def test_scalar_sends_None_not_an_empty_tuple_when_there_are_no_params(self):
        sent = []

        class Spy(FakeCursor):
            def execute(self, sql, params=None):
                sent.append(params)
                return super().execute(sql, params or ())

        audit_mod.scalar(Spy(set(), set()), "SELECT 1")
        self.assertEqual(sent, [None])

    def test_every_probe_query_is_safe_with_its_params(self):
        cur = Psycopg2StyleCursor(set(), set())
        for e in ledger.plan(FILES + [("V1.0.9__all.sql", """
                CREATE TABLE zz (id int); ALTER TABLE zz ADD COLUMN c int;
                CREATE INDEX zz_i ON zz (c); CREATE FUNCTION zz_f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
                CREATE TRIGGER zz_t AFTER UPDATE ON zz FOR EACH ROW EXECUTE FUNCTION zz_f();
                ALTER TABLE zz ADD CONSTRAINT zz_k UNIQUE (c); CREATE POLICY zz_p ON zz USING (true);
                ALTER TABLE zz ALTER COLUMN c DROP NOT NULL; ALTER TABLE zz DROP COLUMN IF EXISTS d;
                CREATE VIEW zz_v AS SELECT 1;""")]):
            for p in e["probes"]:
                sql, params = ledger.probe_query(p["probe"])
                with self.subTest(probe=p["probe"]):
                    cur.execute(sql, params)



class EffectChecks(unittest.TestCase):
    """Files the catalog cannot prove (data-only, CREATE OR REPLACE, drop-then-create) are
    decided by one read-only check of the effect they leave behind."""

    DATA_FILE = ("V1.0.4__d.sql", "UPDATE users SET name = trim(name);")

    class EffectCursor(FakeCursor):
        def __init__(self, recorded, present, effect):
            super().__init__(recorded, present)
            self.effect = effect

        def execute(self, sql, params=None):
            super().execute(sql, params if params is not None else ())
            if "zz_effect" in sql:
                self._row = {"v": self.effect}

    def run_with_effect(self, effect, recorded=frozenset()):
        cur = self.EffectCursor(set(recorded), {"aa_table"}, effect)
        conn = FakeConn(cur)
        saved = audit_mod.EFFECT_CHECKS
        audit_mod.EFFECT_CHECKS = {"V1.0.4__d.sql": ("names are trimmed", "SELECT 'zz_effect'", None)}
        try:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                audit_mod.audit(conn, "sandbox", ledger.plan(FILES + [self.DATA_FILE]))
            return out.getvalue()
        finally:
            audit_mod.EFFECT_CHECKS = saved

    def test_a_present_effect_makes_a_data_only_file_applied_with_its_backfill_row(self):
        text = self.run_with_effect(True)
        self.assertRegex(text, r"1\.0\.4\s+NO\s+applied\s+V1\.0\.4__d\.sql")
        self.assertIn("effect: names are trimmed — yes", text)
        self.assertIn("VALUES ('1.0.4'", text)

    def test_an_absent_effect_makes_it_not_applied_and_writes_no_row(self):
        text = self.run_with_effect(False)
        self.assertRegex(text, r"1\.0\.4\s+NO\s+not_applied\s+V1\.0\.4__d\.sql")
        self.assertIn("effect: names are trimmed — NO", text)
        self.assertNotIn("VALUES ('1.0.4'", text)

    # Files that live on the promotion branches (staging, main) and not yet here. Their
    # checks are needed to audit a staging or production database against its own folder.
    PROMOTION_ONLY = {"V1.4.5__one_teacher_level_column.sql", "V1.4.7__roster_audit_edit_actions.sql",
                      "V1.4.9__phone_number_fits_merge_tombstone.sql"}

    def test_every_real_effect_check_names_a_real_file_and_obeys_psycopg2_rules(self):
        root = os.path.join(HERE, "..", "..", "infrastructure", "supabase", "migrations")
        names = set(os.listdir(root)) | self.PROMOTION_ONLY
        cur = Psycopg2StyleCursor(set(), set())
        self.assertTrue(audit_mod.EFFECT_CHECKS)
        # Unprovable from the catalog: V1.4.7/V1.4.9 because a later file drops and re-adds what
        # they touch, V1.1.8 because V1.4.5 renames its column away on the promotion branches.
        for name in ("V1.1.8__users_training_bands.sql", "V1.4.7__roster_audit_edit_actions.sql",
                     "V1.4.9__phone_number_fits_merge_tombstone.sql"):
            self.assertIn(name, audit_mod.EFFECT_CHECKS)
        for name, (label, sql, params) in audit_mod.EFFECT_CHECKS.items():
            with self.subTest(file=name):
                self.assertIn(name, names)
                cur.execute(sql, params)
                self.assertNotIn("%", sql.replace("%s", ""), "literal % belongs in params")


class ProbeErrors(unittest.TestCase):
    """One probe that errors must not take the report — or the transaction — down with it."""

    class Exploding(FakeCursor):
        def execute(self, sql, params=None):
            if params and "bb_table" in params:
                raise RuntimeError("relation lookup failed")
            return super().execute(sql, params if params is not None else ())

    def test_an_erroring_probe_is_reported_and_the_audit_finishes(self):
        cur = self.Exploding({"1.0.2"}, {"aa_table"})
        conn = FakeConn(cur)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            audit_mod.audit(conn, "sandbox", ledger.plan(FILES))
        text = out.getvalue()
        self.assertIn("error: relation lookup failed", text)
        self.assertIn("PROBE ERRORS (1)", text)
        self.assertIn("APPLIED BUT NOT RECORDED", text)
        # the failed statement is rolled back to its own savepoint, so the rest can run
        self.assertIn("ROLLBACK TO SAVEPOINT probe", cur.sent)
        self.assertTrue(conn.rolled_back)



class MigrationsDir(unittest.TestCase):
    """An environment is audited against the folder of the BRANCH that deploys to it — a
    staging database against staging's migrations, not sandbox's."""

    def test_reads_versioned_files_from_the_directory_it_is_given(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            for name, text in [("V9.9.1__x.sql", "CREATE TABLE x (id int);"), ("README.md", "#")]:
                with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                    fh.write(text)
            got = audit_mod.migration_files(d)
        self.assertEqual(got, [("V9.9.1__x.sql", "CREATE TABLE x (id int);")])

    def test_defaults_to_this_checkouts_folder(self):
        names = [n for n, _ in audit_mod.migration_files()]
        self.assertIn("V1.5.2__lp_asset_sources.sql", names)


if __name__ == "__main__":
    unittest.main()
