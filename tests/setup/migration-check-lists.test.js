/**
 * A migration that re-makes a named CHECK list never narrows what a later migration widened it to.
 *
 * Two bot migrations can each make the same named CHECK (`DROP CONSTRAINT IF EXISTS <name>` then
 * `ADD CONSTRAINT <name> CHECK (<column> IN ('a', 'b', …))`). Applied once, in order, the later list wins. Applied
 * again (the stack re-run over rows the later list allowed), the earlier file puts its narrower list back: the ADD
 * fails on those rows, or the CHECK narrows. So, for every constraint name two or more files add, in apply order:
 * an earlier file's list holds every value of every later file's list, OR the earlier add is guarded on the
 * definition (it sits in a DO block that reads pg_constraint for that name first, as
 * web_quiz_challenge_runs_notice_shown.sql and web_quiz_challenge_runs_v2.sql do). Else the gate names both files,
 * the constraint and the values the earlier list lacks.
 *
 * The apply order is the `-- requires:` header chain (bot-migrations-lib.js applyOrder, the order a release applies).
 * The reading (the exact rule is checkListAdds / narrowedCheckLists in test-seam-gates-lib.js) is a tolerant regex
 * over the SQL with comments removed; rollbacks are never read. In scope: `ADD CONSTRAINT <name> CHECK (<column> IN
 * (<quoted list>))`, and a `('<name>', '<column> IN (…)')` row of a VALUES table that an
 * `EXECUTE format('… ADD CONSTRAINT %I CHECK (%s)', …)` loop adds. Any other CHECK shape is skipped and counted.
 * No database is used.
 *
 * migration-check-lists.allowlist.json: { "<constraint>": "narrower:<n>" }, n = how many values the earlier lists
 * lack, for today's cases. It only shrinks: a new case fails (NEW), and so does a listed one that moved (CHANGED);
 * a listed one that is fixed passes with a console.warn `CLEAN:` line, one that lacks fewer values with `LESS:`.
 */
const L = require('./bot-migrations-lib');
const ALLOW = require('./migration-check-lists.allowlist.json');
const { checkListAdds, narrowedCheckLists, checkListStates, copyGapVerdict } = require('./test-seam-gates-lib');

const FILE = 'migration-check-lists.allowlist.json';
const FIX = 'make the earlier list hold every later value, or guard its re-add on the definition (pg_constraint)';
const verdict = (states, allow) => copyGapVerdict(states, allow, { file: FILE, fix: FIX, gone: 'fixed' });

const remake = (name, column, values) => [
  'ALTER TABLE public.t',
  `  DROP CONSTRAINT IF EXISTS ${name},`,
  `  ADD CONSTRAINT ${name}`,
  `    CHECK (${column} IN (${values.map((v) => `'${v}'`).join(', ')}));`,
].join('\n');

const guarded = (name, column, values, needs) => [
  'DO $$',
  'BEGIN',
  `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}'`,
  `                   AND pg_get_constraintdef(oid) LIKE '%${needs}%') THEN`,
  `    ALTER TABLE public.t DROP CONSTRAINT IF EXISTS ${name};`,
  `    ALTER TABLE public.t ADD CONSTRAINT ${name} CHECK (${column} IN (${values.map((v) => `'${v}'`).join(', ')}));`,
  '  END IF;',
  'END $$;',
].join('\n');

const FIVE = ['textbook', 'cc_by', 'cc_by_sa', 'generated', 'published_instrument'];
const SEVEN = [...FIVE, 'partner_instrument', 'public_domain'];

describe('the reader, on in-memory SQL', () => {
  test('an ALTER … ADD CONSTRAINT … CHECK (col IN (…)) is read with its line; a comment is not read', () => {
    const sql = ['BEGIN;', '-- ADD CONSTRAINT x_chk CHECK (k IN (\'z\'))', remake('t_kind_chk', 'kind', ['a', 'b']), 'COMMIT;'].join('\n');
    expect(checkListAdds(sql)).toEqual({
      adds: [{ name: 't_kind_chk', column: 'kind', values: ['a', 'b'], guarded: false, line: 5 }],
      skipped: 0,
    });
  });

  test('a CHECK that is not a quoted IN list is skipped and counted', () => {
    const sql = [
      'ALTER TABLE t ADD CONSTRAINT t_band_chk CHECK (band BETWEEN 1 AND 3);',
      'ALTER TABLE t ADD CONSTRAINT t_two_chk CHECK (a IN (\'x\') OR b IS NULL);',
      'ALTER TABLE t ADD CONSTRAINT t_ok_chk CHECK ((kind IN (\'x\', \'y\')));',
    ].join('\n');
    const r = checkListAdds(sql);
    expect(r.adds.map((a) => a.name)).toEqual(['t_ok_chk']);
    expect(r.skipped).toBe(2);
  });

  test('an add inside a DO block that reads pg_constraint for that name first is guarded', () => {
    expect(checkListAdds(guarded('t_kind_chk', 'kind', ['a', 'b', 'c'], 'c')).adds).toEqual([
      { name: 't_kind_chk', column: 'kind', values: ['a', 'b', 'c'], guarded: true, line: 6 },
    ]);
  });

  test('a VALUES row added by an EXECUTE format loop that checks pg_constraint is read, guarded', () => {
    const sql = [
      'DO $$',
      'DECLARE c record;',
      'BEGIN',
      '  FOR c IN SELECT * FROM (VALUES',
      "    ('t_kind_chk', 'kind IN (''a'',''b'')'),",
      "    ('t_band_chk', 'band BETWEEN 1 AND 3')",
      '  ) AS v(name, expr) LOOP',
      "    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN",
      "      EXECUTE format('ALTER TABLE public.t ADD CONSTRAINT %I CHECK (%s)', c.name, c.expr);",
      '    END IF;',
      '  END LOOP;',
      'END $$;',
    ].join('\n');
    expect(checkListAdds(sql)).toEqual({
      adds: [{ name: 't_kind_chk', column: 'kind', values: ['a', 'b'], guarded: true, line: 5 }],
      skipped: 1,
    });
  });
});

describe('the rule, on in-memory migrations in apply order', () => {
  const mig = (file, sql) => ({ file, sql });

  test('an earlier unguarded list of 5 values against a later list of 7: a violation naming both files and the missing values', () => {
    const r = narrowedCheckLists([
      mig('early.sql', remake('t_licence_chk', 'licence', FIVE)),
      mig('late.sql', remake('t_licence_chk', 'licence', SEVEN)),
    ]);
    expect(r.violations).toEqual([{
      name: 't_licence_chk', earlier: 'early.sql', earlierLine: 3, later: 'late.sql', laterLine: 3,
      missing: ['partner_instrument', 'public_domain'],
    }]);
    expect(checkListStates(r.violations)).toEqual({ t_licence_chk: 'narrower:2' });
  });

  test('the same earlier list, guarded on the definition: no violation', () => {
    const r = narrowedCheckLists([
      mig('early.sql', guarded('t_licence_chk', 'licence', FIVE, 'published_instrument')),
      mig('late.sql', remake('t_licence_chk', 'licence', SEVEN)),
    ]);
    expect(r.violations).toEqual([]);
  });

  test('an earlier list that holds every later value (a superset, any order): no violation', () => {
    const r = narrowedCheckLists([
      mig('early.sql', remake('t_licence_chk', 'licence', [...SEVEN].reverse())),
      mig('late.sql', remake('t_licence_chk', 'licence', FIVE)),
    ]);
    expect(r.violations).toEqual([]);
  });

  test('a constraint only one file adds: no violation, whatever its list', () => {
    const r = narrowedCheckLists([
      mig('early.sql', remake('t_licence_chk', 'licence', ['a'])),
      mig('late.sql', remake('t_other_chk', 'kind', ['a', 'b', 'c'])),
    ]);
    expect(r.violations).toEqual([]);
    expect(r.adds).toHaveLength(2);
  });

  test('every later file is compared: the missing values are the union, counted once in the state', () => {
    const r = narrowedCheckLists([
      mig('a.sql', remake('t_k_chk', 'k', ['x'])),
      mig('b.sql', remake('t_k_chk', 'k', ['x', 'y'])),
      mig('c.sql', remake('t_k_chk', 'k', ['x', 'y', 'z'])),
    ]);
    expect(r.violations.map((v) => `${v.earlier}<${v.later}:${v.missing.join('+')}`)).toEqual(['a.sql<b.sql:y', 'a.sql<c.sql:y+z', 'b.sql<c.sql:z']);
    expect(checkListStates(r.violations)).toEqual({ t_k_chk: 'narrower:2' });
  });
});

describe('the verdict, on a seeded allowlist', () => {
  test('a new case fails; a listed one that is fixed warns CLEAN; one that lacks fewer values warns LESS', () => {
    expect(verdict({ t_k_chk: 'narrower:2' }, {}).failures).toEqual([`NEW: t_k_chk is narrower:2. ${FIX.charAt(0).toUpperCase()}${FIX.slice(1)}.`]);
    expect(verdict({}, { t_k_chk: 'narrower:2' })).toEqual({ failures: [], cleans: [`CLEAN: t_k_chk is fixed. Remove it from ${FILE}.`] });
    expect(verdict({ t_k_chk: 'narrower:1' }, { t_k_chk: 'narrower:2' }).cleans[0]).toMatch(/^LESS: t_k_chk is narrower:1 now/);
    expect(verdict({ t_k_chk: 'narrower:3' }, { t_k_chk: 'narrower:2' }).failures[0]).toMatch(/^CHANGED: t_k_chk is narrower:3/);
    expect(verdict({ t_k_chk: 'narrower:2' }, { t_k_chk: 'narrower:2' })).toEqual({ failures: [], cleans: [] });
  });
});

describe('bot migrations: a re-made CHECK list never narrows a later one', () => {
  const migrations = L.readMigrations();
  const order = L.applyOrder(migrations);
  const byFile = new Map(migrations.map((m) => [m.file, m]));
  const r = narrowedCheckLists(order.map((f) => byFile.get(f)));

  test('the lists are read at all', () => {
    expect(r.adds.length).toBeGreaterThan(5);
    expect(r.adds.some((a) => a.guarded)).toBe(true);
  });

  test('every earlier list holds every later one, or is guarded (today\'s cases aside; a fixed one warns)', () => {
    console.warn(`migration CHECK lists: ${r.adds.length} named IN-list adds read, ${r.skipped} other CHECK shapes skipped (apply order: -- requires: headers)`);
    const { failures, cleans } = verdict(checkListStates(r.violations), ALLOW);
    for (const line of cleans) console.warn(line);
    const detail = (f) => {
      const name = (/^(?:NEW|CHANGED): (\S+)/.exec(f) || [])[1];
      return [f, ...r.violations.filter((v) => v.name === name).map((v) =>
        `  ${v.earlier}:${v.earlierLine} re-adds ${v.name} without ${v.missing.join(', ')}, which ${v.later}:${v.laterLine} allows`)].join('\n');
    };
    expect(failures.map(detail)).toEqual([]);
  });
});
