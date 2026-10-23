/**
 * L39 (bd-s1oo0.50.5, CONTRACT §21.2): migration V1.6.1 widens child_test_blocks.block to the v3 task ids.
 * No new table or column. The list in the SQL is tasks.BLOCK_NAMES, character for character; store.js
 * reads the same list, so a task the store accepts is a task the database accepts.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const MIG = path.join(ROOT, 'infrastructure/supabase/migrations');
const read = (f) => fs.readFileSync(path.join(MIG, f), 'utf8');
const T = require('../../../bot/shared/services/child-test/tasks');
const store = require('../../../bot/shared/services/child-test/store');

const sqlList = (names) => names.map((n) => `'${n}'`).join(', ');
const strip = (sql) => sql.replace(/--[^\n]*/g, '');

describe('V1.6.1 child_test_tasks', () => {
  const up = strip(read('V1.6.1__child_test_tasks.sql'));
  const down = strip(read('ROLLBACK_V1.6.1__child_test_tasks.sql'));

  test('drops the V1.5.9 CHECK by its name and adds the named one with every block name', () => {
    expect(up).toMatch(/ALTER TABLE child_test_blocks DROP CONSTRAINT IF EXISTS child_test_blocks_block_check;/);
    const add = up.match(/ADD CONSTRAINT child_test_blocks_block_check\s+CHECK \(block IN \(([^)]*)\)\)/);
    expect(add).not.toBeNull();
    expect(add[1].replace(/\s+/g, ' ').trim()).toBe(sqlList(T.BLOCK_NAMES));
  });

  test('adds no table, no column, and touches no other table', () => {
    expect(up).not.toMatch(/CREATE TABLE|ADD COLUMN|DROP TABLE|DROP COLUMN/i);
    const tables = [...up.matchAll(/ALTER TABLE\s+(\w+)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['child_test_blocks']));
  });

  test('also drops any other CHECK that pins the block list (an unnamed one on a hand-built database)', () => {
    expect(up).toMatch(/pg_constraint/);
    expect(up).toMatch(/contype = 'c'/);
  });

  test('rollback puts back the three v1/v2 names, after refusing while v3 rows exist', () => {
    expect(down).toMatch(/RAISE EXCEPTION/);
    const add = down.match(/ADD CONSTRAINT child_test_blocks_block_check\s+CHECK \(block IN \(([^)]*)\)\)/);
    expect(add[1].replace(/\s+/g, ' ').trim()).toBe("'urdu', 'english', 'maths'");
  });

  test('00_complete-schema.sql carries the widened CHECK', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'infrastructure/supabase/00_complete-schema.sql'), 'utf8');
    expect(schema).toContain(`CONSTRAINT child_test_blocks_block_check CHECK (block IN (${sqlList(T.BLOCK_NAMES)}))`);
    expect(schema).not.toContain("block              text NOT NULL CHECK (block IN ('urdu', 'english', 'maths')),");
  });
});

describe('store.js block names come from tasks.js', () => {
  test('BLOCK_NAMES is the shared list', () => {
    expect(store.BLOCK_NAMES).toBe(T.BLOCK_NAMES);
  });
});
