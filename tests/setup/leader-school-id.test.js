/**
 * Phase 1 of giving leader_schools a real school id.
 *
 * A school is currently identified by `school_ext_id`, a string built from an
 * EMIS number typed into the coach roster sheet. Two rows got the wrong number,
 * which is why one school can appear twice for the same coach and why roster
 * inheritance can pool two schools' teachers. The fix is to identify a school by
 * `schools.id` instead.
 *
 * This phase only ADDS the column. Nothing reads it yet, so there is no
 * behaviour change for a live user. The guarantees worth locking down now:
 *
 *   1. The migration is additive. No drop, no delete, no NOT NULL. If this phase
 *      can break a live insert, it is the wrong phase.
 *   2. Fresh installs and migrated databases end up with the SAME shape. The
 *      three tables involved are missing from 00_complete-schema.sql entirely
 *      (that is a separate known bug), so adding a column by migration alone
 *      would leave a clone with neither the tables nor the column.
 *   3. The column stays nullable in this phase. NOT NULL belongs to Phase 4 and
 *      cannot land until the backfill fills every row.
 *
 * See docs/leader-schools-school-id-migration.md.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SCHEMA_PATH = path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql');
const MIGRATION_PATH = path.join(
  ROOT, 'infrastructure/supabase/migrations/V1.2.0__leader_school_id.sql',
);

// The three tables that identify a school by school_ext_id today.
const TABLES = ['leader_schools', 'leader_teachers', 'observation_schedules'];

/** Body of a CREATE TABLE block, from the table name to the closing `);`. */
function createTableBody(sql, table) {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\)\\s*;`,
    'i',
  );
  const m = re.exec(sql);
  return m ? m[1] : null;
}

describe('Phase 1: school_id column', () => {
  describe('the migration', () => {
    let sql;

    beforeAll(() => {
      expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
      sql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    });

    it('adds a nullable school_id to all three tables, keyed to schools(id)', () => {
      for (const table of TABLES) {
        const re = new RegExp(
          `ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+` +
          `school_id\\s+uuid\\s+REFERENCES\\s+(?:public\\.)?schools\\s*\\(\\s*id\\s*\\)`,
          'i',
        );
        expect(sql).toMatch(re);
      }
    });

    it('is additive only: nothing that can destroy or reject live data', () => {
      const forbidden = [
        /\bDROP\s+TABLE\b/i,
        /\bDROP\s+COLUMN\b/i,
        /\bDROP\s+CONSTRAINT\b/i,
        /\bTRUNCATE\b/i,
        /\bDELETE\s+FROM\b/i,
        /\bUPDATE\s+\w+\s+SET\b/i,
        /\bSET\s+NOT\s+NULL\b/i,
        /\bADD\s+CONSTRAINT\b.*\bUNIQUE\b/is,
      ];
      const stripped = sql.replace(/^\s*--.*$/gm, '');
      for (const re of forbidden) {
        expect(stripped).not.toMatch(re);
      }
    });

    it('indexes the new column on the two tables that join on it', () => {
      expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\S*leader_schools\S*\s+ON\s+(?:public\.)?leader_schools\s*\(\s*school_id\s*\)/i);
      expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+\S*leader_teachers\S*\s+ON\s+(?:public\.)?leader_teachers\s*\(\s*school_id\s*\)/i);
    });

    it('tells PostgREST to reload, or the new column stays invisible to the bot', () => {
      expect(sql).toMatch(/NOTIFY\s+pgrst\s*,\s*'reload schema'/i);
    });

    it('carries no transaction control, because exec_sql runs it inside plpgsql', () => {
      // migrate.js posts the whole file to the exec_sql RPC, which is
      //   CREATE FUNCTION exec_sql(query TEXT) ... $$ BEGIN EXECUTE query; END; $$
      // Postgres forbids BEGIN/COMMIT inside plpgsql, so a file carrying them
      // fails to apply. Three older migrations have them and had to be applied by
      // hand; the newest (V1.1.9) does not. The function call is already one
      // transaction, so atomicity is not lost by leaving them out.
      const stripped = sql.replace(/^\s*--.*$/gm, '');
      expect(stripped).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
    });
  });

  describe('the fresh-install schema', () => {
    let sql;

    beforeAll(() => {
      sql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    });

    it('defines all three tables, so a clone is not missing the feature', () => {
      for (const table of TABLES) {
        expect(createTableBody(sql, table)).not.toBeNull();
      }
    });

    it('gives each of them a school_id uuid referencing schools(id)', () => {
      for (const table of TABLES) {
        const body = createTableBody(sql, table);
        expect(body).toMatch(/school_id\s+uuid/i);
        expect(body).toMatch(/school_id\s+uuid\s+REFERENCES\s+(?:public\.)?schools\s*\(\s*id\s*\)/i);
      }
    });

    it('leaves school_id nullable: NOT NULL is Phase 4 and needs the backfill first', () => {
      for (const table of TABLES) {
        const body = createTableBody(sql, table);
        const line = body.split('\n').find((l) => /school_id/i.test(l)) || '';
        expect(line).not.toMatch(/NOT\s+NULL/i);
      }
    });

    it('still defines schools before them, so the reference resolves on a fresh run', () => {
      const schoolsAt = sql.search(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?schools\s*\(/i);
      expect(schoolsAt).toBeGreaterThan(-1);
      for (const table of TABLES) {
        const tableAt = sql.search(
          new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(`, 'i'),
        );
        expect(tableAt).toBeGreaterThan(schoolsAt);
      }
    });
  });

  describe('the two paths agree', () => {
    // The three tables are now declared in TWO places: the original migrations
    // that created them, and the fresh-install schema. That duplication is how a
    // clone and a migrated database drift apart, so pin the whole column set,
    // not just school_id.
    it('the schema block matches the migrations column for column', () => {
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      const MIG = (f) => fs.readFileSync(
        path.join(ROOT, 'infrastructure/supabase/migrations', f), 'utf-8',
      );

      const columnsOf = (body) => new Set(
        body.split('\n')
          .map((l) => (l.match(/^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i) || [])[1])
          .filter(Boolean)
          .map((c) => c.toLowerCase())
          .filter((c) => !['primary', 'foreign', 'unique', 'constraint', 'check', 'references'].includes(c)),
      );

      const cases = [
        ['leader_schools', MIG('V1.0.9__leader_allocations.sql'), ['school_id']],
        // V1.2.2 added the soft-delete pair after V1.0.9 created the table.
        ['leader_teachers', MIG('V1.0.9__leader_allocations.sql'),
          ['school_id', 'deleted_at', 'deleted_by']],
        // V1.1.7 added calendar_event_id after V1.0.10 created the table.
        ['observation_schedules', MIG('V1.0.10__observation_schedules.sql'),
          ['school_id', 'calendar_event_id']],
      ];

      for (const [table, migrationSql, added] of cases) {
        const fromMigration = columnsOf(createTableBody(migrationSql, table));
        const fromSchema = columnsOf(createTableBody(schema, table));
        const expected = new Set([...fromMigration, ...added]);
        expect([...fromSchema].sort()).toEqual([...expected].sort());
      }
    });

    it('a migrated database and a fresh clone end up with the same column', () => {
      const migration = fs.readFileSync(MIGRATION_PATH, 'utf-8');
      const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
      for (const table of TABLES) {
        // both must reference schools(id) for this table
        expect(migration).toMatch(new RegExp(`${table}[\\s\\S]{0,120}?school_id\\s+uuid\\s+REFERENCES`, 'i'));
        expect(createTableBody(schema, table)).toMatch(/school_id\s+uuid\s+REFERENCES/i);
      }
    });
  });
});
