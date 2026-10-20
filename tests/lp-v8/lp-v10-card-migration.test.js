/**
 * v10 coaching test (bd-v0toag.50.1): migration V1.6.6 lets niete_lp_assets hold a 'card' row.
 *
 * Static checks on the SQL: the kind CHECK allows lesson, answer_key and card; it is dropped and
 * re-added by whatever name it has, so a re-run is a no-op; nothing else in the table changes; the
 * schema mirror says the same; and a rollback exists that removes card rows before narrowing again.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'infrastructure', 'supabase');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UP = 'migrations/V1.6.6__niete_lp_assets_card_kind.sql';
const DOWN = 'migrations/ROLLBACK_V1.6.6__niete_lp_assets_card_kind.sql';
const code = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('V1.6.6 niete_lp_assets card kind', () => {
  test('adds a CHECK allowing lesson, answer_key and card', () => {
    expect(code(read(UP))).toMatch(
      /ADD CONSTRAINT niete_lp_assets_asset_kind_check\s+CHECK \(asset_kind IN \('lesson', 'answer_key', 'card'\)\)/,
    );
  });

  test('re-runnable: drops the old kind CHECK by lookup and the new one IF EXISTS', () => {
    const up = code(read(UP));
    expect(up).toMatch(/pg_constraint/);
    expect(up).toMatch(/DROP CONSTRAINT IF EXISTS niete_lp_assets_asset_kind_check/);
  });

  test('additive: no table, column, index or row is dropped or rewritten', () => {
    const up = code(read(UP));
    expect(up).not.toMatch(/DROP (TABLE|COLUMN|INDEX)|DELETE FROM|UPDATE niete_lp_assets|TRUNCATE/i);
  });

  test('the schema mirror allows card', () => {
    expect(read('00_complete-schema.sql')).toMatch(/CHECK \(asset_kind IN \('lesson', 'answer_key', 'card'\)\)/);
  });

  test('rollback removes card rows, then narrows the CHECK back', () => {
    const down = code(read(DOWN));
    const del = down.search(/DELETE FROM niete_lp_assets WHERE asset_kind = 'card'/);
    const narrow = down.search(/CHECK \(asset_kind IN \('lesson', 'answer_key'\)\)/);
    expect(del).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(del);
  });
});
