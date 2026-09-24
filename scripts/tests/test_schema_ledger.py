import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))
import schema_ledger as m  # noqa: E402


class ParseVersion(unittest.TestCase):
    def test_reads_the_semver_out_of_a_migration_filename(self):
        self.assertEqual(m.parse_version("V1.2.3__leader_roster_audit.sql"), "1.2.3")

    def test_ignores_rollback_files_and_non_migrations(self):
        self.assertIsNone(m.parse_version("ROLLBACK_V1.4.0__lp612_render_degraded.sql"))
        self.assertIsNone(m.parse_version("README.md"))


class Diff(unittest.TestCase):
    def test_reports_files_missing_from_the_ledger_and_ledger_rows_without_a_file(self):
        files = ["V1.0.0__baseline.sql", "V1.2.3__a.sql", "V1.2.4__b.sql", "V1.10.0__c.sql"]
        applied = ["1.0.0", "1.2.4", "9.9.9"]
        d = m.diff_versions(files, applied)
        self.assertEqual(d["missing_from_ledger"], ["1.2.3", "1.10.0"])   # semver order, not string order
        self.assertEqual(d["unknown_in_ledger"], ["9.9.9"])



# ── what each migration would prove about itself ───────────────────────────────────────

def probes_of(sql):
    return [p for p, _ in m.file_effects(sql)["probes"]]


class FileEffects(unittest.TestCase):
    def test_a_created_table_is_a_probe(self):
        self.assertIn(("table", "teacher_nudges"),
                      probes_of("CREATE TABLE IF NOT EXISTS teacher_nudges (id uuid PRIMARY KEY);"))

    def test_every_added_column_of_one_alter_is_a_probe(self):
        sql = ("ALTER TABLE leader_teachers\n  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,\n"
               "  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);")
        self.assertEqual(probes_of(sql), [("column", "leader_teachers", "deleted_at"),
                                          ("column", "leader_teachers", "deleted_by")])

    def test_indexes_functions_triggers_constraints_and_policies(self):
        sql = """
          CREATE UNIQUE INDEX IF NOT EXISTS k_live ON t (a) WHERE b IS NULL;
          CREATE FUNCTION public.f_new(x int) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
          CREATE TRIGGER t_hist AFTER UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION f_new();
          ALTER TABLE certs ADD CONSTRAINT certs_uniq UNIQUE (user_id, level_id);
          CREATE POLICY svc ON audit USING (true);
        """
        self.assertEqual(probes_of(sql), [("index", "k_live"), ("function", "f_new"),
                                          ("trigger", "t_hist"), ("constraint", "certs_uniq"),
                                          ("policy", "audit", "svc")])

    def test_ddl_inside_a_function_body_is_not_this_migrations_ddl(self):
        sql = """CREATE OR REPLACE FUNCTION mk() RETURNS void LANGUAGE plpgsql AS $fn$
                 BEGIN CREATE TABLE scratch (id int); END; $fn$;"""
        self.assertEqual(probes_of(sql), [("function", "mk")])

    def test_ddl_inside_a_do_block_IS_executed_so_it_counts(self):
        sql = "DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS x int; END $$;"
        self.assertIn(("column", "users", "x"), probes_of(sql))

    def test_a_literal_EXECUTE_inside_a_do_block_is_read_as_the_statement_it_runs(self):
        sql = """DO $$ BEGIN
                   IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'p_read') THEN
                     EXECUTE 'CREATE POLICY p_read ON users FOR SELECT TO app USING (true)';
                   END IF;
                 END $$;"""
        self.assertEqual(probes_of(sql), [("policy", "users", "p_read")])

    def test_comments_never_count(self):
        self.assertEqual(probes_of("-- CREATE TABLE ghost (id int);\n/* CREATE TABLE ghost2 (id int); */"), [])

    def test_the_soft_delete_helper_adds_three_columns_and_an_index(self):
        got = probes_of("SELECT add_soft_delete('users');")
        self.assertEqual(got, [("column", "users", "deleted_at"), ("column", "users", "deleted_reason"),
                               ("column", "users", "deleted_by"), ("index", "idx_users_deleted_at")])

    def test_shape_changes_are_probes_too(self):
        sql = """ALTER TABLE users DROP COLUMN IF EXISTS first_name;
                 ALTER TABLE training_certificates ALTER COLUMN attempt_id DROP NOT NULL;
                 ALTER TABLE users ALTER COLUMN role SET NOT NULL;"""
        self.assertEqual(probes_of(sql), [("column_absent", "users", "first_name"),
                                          ("nullable", "training_certificates", "attempt_id"),
                                          ("not_null", "users", "role")])

    def test_a_column_rename_inside_a_guarded_do_block_is_a_drop_and_a_create(self):
        sql = """DO $$ BEGIN
                   IF EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'bands') THEN
                     ALTER TABLE users RENAME COLUMN bands TO teacher_level;
                   END IF;
                 END $$;"""
        eff = m.file_effects(sql)
        self.assertEqual(eff["creates"], [("column", "users", "teacher_level")])
        self.assertEqual(eff["drops"], [("column", "users", "bands")])
        self.assertEqual(probes_of(sql), [("column", "users", "teacher_level"),
                                          ("column_absent", "users", "bands")])

    def test_a_column_type_change_is_a_probe_with_the_catalog_spelling(self):
        sql = "ALTER TABLE users\n  ALTER COLUMN phone_number TYPE varchar(64);"
        self.assertEqual(probes_of(sql), [("column_type", "users", "phone_number", "character varying(64)")])

    def test_a_data_only_file_has_no_probe(self):
        self.assertEqual(probes_of("UPDATE users SET name = trim(name) WHERE name <> trim(name);"), [])


def strengths(files):
    return {e["filename"]: {m.describe(p["probe"]): p["strength"] for p in e["probes"]}
            for e in m.plan(files)}


class Plan(unittest.TestCase):
    def test_an_object_only_this_file_creates_is_strong_evidence(self):
        s = strengths([("V1.0.1__a.sql", "CREATE TABLE a (id int);")])
        self.assertEqual(s["V1.0.1__a.sql"], {"table a": "strong"})

    def test_an_object_another_file_also_creates_is_weak(self):
        s = strengths([("V1.2.2__x.sql", "CREATE TABLE IF NOT EXISTS audit (id int);"),
                       ("V1.2.3__y.sql", "CREATE TABLE IF NOT EXISTS audit (id int);")])
        self.assertEqual(s["V1.2.2__x.sql"], {"table audit": "weak"})
        self.assertEqual(s["V1.2.3__y.sql"], {"table audit": "weak"})

    def test_create_or_replace_and_drop_then_create_are_weak(self):
        s = strengths([("V1.4.8__t.sql",
                        "CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;"
                        "DROP TRIGGER IF EXISTS h ON users; CREATE TRIGGER h AFTER UPDATE ON users "
                        "FOR EACH ROW EXECUTE FUNCTION f();")])
        self.assertEqual(s["V1.4.8__t.sql"], {"function f": "weak", "trigger h": "weak"})

    def test_an_object_a_later_file_drops_is_superseded(self):
        s = strengths([("V1.4.0__add.sql", "ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name text;"),
                       ("V1.4.4__drop.sql", "ALTER TABLE users DROP COLUMN IF EXISTS first_name;")])
        self.assertEqual(s["V1.4.0__add.sql"], {"users.first_name": "superseded"})
        self.assertEqual(s["V1.4.4__drop.sql"], {"users.first_name absent": "strong"})

    def test_a_column_a_later_file_renames_away_is_superseded(self):
        s = strengths([("V1.1.8__add.sql", "ALTER TABLE users ADD COLUMN IF NOT EXISTS bands text[];"),
                       ("V1.4.5__rename.sql", "ALTER TABLE users RENAME COLUMN bands TO teacher_level;")])
        self.assertEqual(s["V1.1.8__add.sql"], {"users.bands": "superseded"})
        self.assertEqual(s["V1.4.5__rename.sql"], {"users.teacher_level": "strong", "users.bands absent": "strong"})

    def test_an_index_on_a_relation_this_file_dropped_proves_nothing(self):
        # DROP MATERIALIZED VIEW takes its indexes with it; re-creating them only restores what
        # was there before the file ran, so their presence says nothing about this file.
        s = strengths([("V1.4.9__mv.sql",
                        "DROP MATERIALIZED VIEW IF EXISTS mv_x; CREATE MATERIALIZED VIEW mv_x AS SELECT 1 AS id;"
                        "CREATE UNIQUE INDEX idx_mv_x_pk ON mv_x (id);"
                        "ALTER TABLE users ALTER COLUMN phone_number TYPE varchar(64);")])
        self.assertEqual(s["V1.4.9__mv.sql"], {"view mv_x": "weak", "index idx_mv_x_pk": "weak",
                                               "users.phone_number type character varying(64)": "strong"})

    def test_files_are_planned_in_semver_order_and_rollbacks_ignored(self):
        got = [e["version"] for e in m.plan([("V1.10.0__c.sql", ""), ("V1.2.0__b.sql", ""),
                                             ("ROLLBACK_V1.4.0__x.sql", "DROP TABLE a;")])]
        self.assertEqual(got, ["1.2.0", "1.10.0"])

    def test_each_entry_carries_the_sha256_the_runner_records(self):
        import hashlib
        e = m.plan([("V1.0.1__a.sql", "CREATE TABLE a (id int);")])[0]
        self.assertEqual(e["sha256"], hashlib.sha256(b"CREATE TABLE a (id int);").hexdigest())


class Verdict(unittest.TestCase):
    def test_all_present_with_strong_evidence_is_applied(self):
        self.assertEqual(m.verdict([("strong", True), ("weak", True)]), "applied")

    def test_nothing_strong_present_and_something_missing_is_not_applied(self):
        self.assertEqual(m.verdict([("strong", False), ("weak", True)]), "not_applied")

    def test_a_missing_weak_object_still_counts_against(self):
        self.assertEqual(m.verdict([("weak", False)]), "not_applied")

    def test_mixed_strong_evidence_is_partial(self):
        self.assertEqual(m.verdict([("strong", True), ("strong", False)]), "partial")

    def test_only_weak_presence_proves_nothing(self):
        self.assertEqual(m.verdict([("weak", True)]), "unverifiable")

    def test_no_probe_or_only_superseded_is_unverifiable(self):
        self.assertEqual(m.verdict([]), "unverifiable")
        self.assertEqual(m.verdict([("superseded", False)]), "unverifiable")


class Queries(unittest.TestCase):
    def test_identifiers_are_parameters_never_interpolated(self):
        t, c = "zz_table", "zz_col"
        for probe in [("table", t), ("column", t, c), ("column_absent", t, c),
                      ("column_type", t, c, "zz_type"),
                      ("index", "zz_idx"), ("function", "zz_fn"), ("trigger", "zz_trg"),
                      ("constraint", "zz_con"), ("policy", t, "zz_pol"), ("nullable", t, c),
                      ("not_null", t, c), ("view", "zz_view")]:
            sql, params = m.probe_query(probe)
            for ident in probe[1:]:
                self.assertNotIn(ident, sql)
                self.assertIn(ident, params)
            self.assertEqual(sql.count("%s"), len(params))

    def test_backfill_row_matches_what_the_runner_writes(self):
        e = {"version": "1.5.2", "filename": "V1.5.2__lp_asset_sources.sql", "sha256": "ab" * 32}
        self.assertEqual(
            m.backfill_sql(e),
            "INSERT INTO schema_versions (version, description) VALUES ('1.5.2', "
            "'V1.5.2__lp_asset_sources.sql sha256:" + "ab" * 32 + "') ON CONFLICT (version) DO NOTHING;")


class RealMigrations(unittest.TestCase):
    """The folder this repo ships, planned end to end — the audit's actual input."""

    @classmethod
    def setUpClass(cls):
        root = os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "supabase", "migrations")
        files = []
        for name in sorted(os.listdir(root)):
            with open(os.path.join(root, name), encoding="utf-8") as fh:
                files.append((name, fh.read()))
        cls.plan = {e["filename"]: e for e in m.plan(files)}

    def test_every_versioned_file_is_planned(self):
        root = os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "supabase", "migrations")
        want = sorted(f for f in os.listdir(root) if m.parse_version(f))
        self.assertEqual(sorted(self.plan), want)

    def test_lp_asset_sources_is_proved_by_its_own_table(self):
        got = {m.describe(p["probe"]): p["strength"] for p in self.plan["V1.5.2__lp_asset_sources.sql"]["probes"]}
        self.assertEqual(got.get("table niete_lp_asset_sources"), "strong")

    def test_soft_delete_is_proved_by_the_users_columns(self):
        got = {m.describe(p["probe"]): p["strength"]
               for p in self.plan["V1.4.6__soft_delete_convention.sql"]["probes"]}
        self.assertEqual(got.get("users.deleted_at"), "strong")



class WithEffect(unittest.TestCase):
    """combine(): the catalog verdict, corrected by a file's effect check when it has one."""

    def test_no_effect_check_leaves_the_catalog_verdict(self):
        for v in ("applied", "not_applied", "partial", "unverifiable"):
            self.assertEqual(m.combine(v, None), v)

    def test_a_present_effect_settles_an_unverifiable_file_as_applied(self):
        self.assertEqual(m.combine("unverifiable", True), "applied")
        self.assertEqual(m.combine("applied", True), "applied")

    def test_an_absent_effect_settles_it_as_not_applied(self):
        self.assertEqual(m.combine("unverifiable", False), "not_applied")
        self.assertEqual(m.combine("not_applied", False), "not_applied")

    def test_catalog_and_effect_disagreeing_is_partial_never_a_guess(self):
        self.assertEqual(m.combine("not_applied", True), "partial")
        self.assertEqual(m.combine("applied", False), "partial")
        self.assertEqual(m.combine("partial", True), "partial")


if __name__ == "__main__":
    unittest.main()
