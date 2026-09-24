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
            self.assertRegex(sql.strip(), r"^SELECT\b")
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


if __name__ == "__main__":
    unittest.main()
