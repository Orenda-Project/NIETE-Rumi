/**
 * bd-43482 — level ordering and module ordering are INDEPENDENT axes.
 *
 * bd-43477 bound both to the single `unlock_logic` column, so relaxing the
 * level ladder for Beacon House also unlocked every module inside a level.
 * That lost a real teaching sequence: BH subjects run "What is AI?" before
 * "Prompt Like A Pro", vocabulary before creative writing; Oxbridge is
 * literally SESSION#1..SESSION#7.
 *
 * The corrected model (operator, 20 Aug 2026):
 *
 *   vendor        levels ordered?   modules ordered?
 *   TALEEMABAD    yes  (chain)      yes  (chain)
 *   OXBRIDGE      yes  (chain)      yes  (chain)
 *   BEACONHOUSE   NO   (parallel)   yes  (chain)
 *
 * `unlock_logic` keeps CERTIFICATION semantics only (capstone vs grand quiz)
 * and must not be consulted for either ordering question.
 */

jest.mock('../../shared/config/supabase', () => ({
  from: () => { throw new Error('pure helpers must not touch the DB'); },
}));

const {
  annotateModuleLocks,
  isLevelChainLocked,
} = require('../../shared/routes/teacher-training-endpoint');

const mods = (doneFlags) =>
  doneFlags.map((done, i) => ({
    id: i + 1, title: `Module ${i + 1}`, course_title: 'Course A', done,
  }));
const locks = (rows) => rows.map((r) => r.lock);

describe('module axis — annotateModuleLocks(rows, moduleUnlockLogic)', () => {
  it('sequences modules for a chain vendor', () => {
    expect(locks(annotateModuleLocks(mods([false, false, false]), 'chain')))
      .toEqual(['next', 'locked', 'locked']);
  });

  it('sequences modules for Beacon House — parallel LEVELS, ordered MODULES', () => {
    // The regression bd-43477 introduced: BH modules must NOT all open.
    expect(locks(annotateModuleLocks(mods([false, false, false]), 'chain')))
      .toEqual(['next', 'locked', 'locked']);
  });

  it('opens everything only when the module axis explicitly says all_modules', () => {
    expect(locks(annotateModuleLocks(mods([false, false, false]), 'all_modules')))
      .toEqual(['next', 'next', 'next']);
  });

  it('defaults to chain when the module axis is missing (fail closed)', () => {
    expect(locks(annotateModuleLocks(mods([false, false, false]))))
      .toEqual(['next', 'locked', 'locked']);
  });

  it('defaults to chain for an unrecognised value (fail closed)', () => {
    expect(locks(annotateModuleLocks(mods([false, false, false]), 'parallel')))
      .toEqual(['next', 'locked', 'locked']);
  });

  it('keeps passed modules open for review', () => {
    expect(locks(annotateModuleLocks(mods([true, true, false, false]), 'chain')))
      .toEqual(['passed', 'passed', 'next', 'locked']);
  });
});

describe('level axis — isLevelChainLocked(vendor)', () => {
  it('chains NIETE levels', () => {
    expect(isLevelChainLocked({ level_unlock_logic: 'chain' })).toBe(true);
  });

  it('chains Oxbridge levels', () => {
    expect(isLevelChainLocked({ level_unlock_logic: 'chain' })).toBe(true);
  });

  it('does NOT chain Beacon House levels — subjects are parallel', () => {
    expect(isLevelChainLocked({ level_unlock_logic: 'parallel' })).toBe(false);
  });

  it('defaults to chained when the level axis is missing (fail closed)', () => {
    expect(isLevelChainLocked({})).toBe(true);
    expect(isLevelChainLocked(null)).toBe(true);
  });

  it('defaults to chained for an unrecognised value (fail closed)', () => {
    expect(isLevelChainLocked({ level_unlock_logic: 'nonsense' })).toBe(true);
  });

  it('ignores unlock_logic — that column is certification-only now', () => {
    // A Beacon House-shaped row: all_modules certification, parallel levels.
    expect(isLevelChainLocked({ unlock_logic: 'all_modules', level_unlock_logic: 'parallel' }))
      .toBe(false);
    // An Oxbridge-shaped row: all_modules certification, but CHAINED levels.
    // Under bd-43477 this would have been unchained by unlock_logic alone.
    expect(isLevelChainLocked({ unlock_logic: 'all_modules', level_unlock_logic: 'chain' }))
      .toBe(true);
  });
});

describe('display labels stay on unlock_logic — deliberately NOT the level axis', () => {
  // bd-2137 chose plain subject names for all_modules vendors because a ladder
  // label leaks the global order_index ("Level 4 · Professional Training…").
  // Oxbridge is level_unlock_logic='chain' but must KEEP the plain label, so
  // levelDisplayTitle must not be switched to the level axis.
  const { levelDisplayTitle } = require('../../shared/routes/teacher-training-endpoint');

  it('labels a NIETE level with its ladder number', () => {
    expect(levelDisplayTitle({
      name: 'Skilled Practitioner', order_index: 2, state: 'not_started',
      unlock_logic: 'chain', level_unlock_logic: 'chain',
    })).toContain('Level 2');
  });

  it('labels an Oxbridge level plainly despite its levels being chained', () => {
    expect(levelDisplayTitle({
      name: 'Professional Training in Game-Based Teaching', order_index: 4,
      state: 'not_started', unlock_logic: 'all_modules', level_unlock_logic: 'chain',
    })).not.toContain('Level 4');
  });

  it('labels a Beacon House subject plainly', () => {
    expect(levelDisplayTitle({
      name: 'Mathematics', order_index: 2, state: 'not_started',
      unlock_logic: 'all_modules', level_unlock_logic: 'parallel',
    })).not.toContain('Level 2');
  });
});

describe('the axes do not leak into each other', () => {
  it('a parallel-level vendor still sequences its modules', () => {
    const vendor = { unlock_logic: 'all_modules', level_unlock_logic: 'parallel',
                     module_unlock_logic: 'chain' };
    expect(isLevelChainLocked(vendor)).toBe(false);
    expect(locks(annotateModuleLocks(mods([false, false]), vendor.module_unlock_logic)))
      .toEqual(['next', 'locked']);
  });
});
