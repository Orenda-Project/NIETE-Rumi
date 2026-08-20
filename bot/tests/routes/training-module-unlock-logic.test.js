/**
 * bd-43477 — module sequencing must respect the vendor's unlock_logic.
 *
 * `unlock_logic` was honoured at LEVEL scope (loadVisibleLevelsWithProgress:
 * `chainLocked = vendor?.unlock_logic === 'chain'`) but ignored one layer
 * down: annotateModuleLocks marked exactly one unpassed module `next` and
 * everything after it `locked` for EVERY vendor.
 *
 * For an `all_modules` vendor that is wrong, because its "levels" are
 * SUBJECTS, not a ladder (isLadderVendor already says so). Beacon House ships
 * English/Mathematics/General Science/Computer Science; the sequential module
 * gate made a Maths teacher grind 55 English modules in fixed order before
 * anything else opened, and "Take quiz" never unlocked. Reported by NIETE QA
 * against 923455495431 (Usman Ghani, IMCB HUMAK), 0/55 modules done.
 *
 * The rule: `chain` vendors keep strict one-at-a-time sequencing. Anything
 * else opens every module. Missing/unknown unlock_logic defaults to `chain`,
 * matching the fail-closed default used everywhere else in this file.
 */

// annotateModuleLocks is pure, but the module it lives in boots a Supabase
// client at require-time. Stub the client so the unit under test can load.
jest.mock('../../shared/config/supabase', () => ({
  from: () => { throw new Error('annotateModuleLocks must not touch the DB'); },
}));

const {
  annotateModuleLocks,
} = require('../../shared/routes/teacher-training-endpoint');

/** Five modules in level order; `done` flags mirror teacher_training_progress. */
const mods = (doneFlags) =>
  doneFlags.map((done, i) => ({
    id: i + 1,
    title: `Module ${i + 1}`,
    course_title: 'Course A',
    done,
  }));

const locks = (rows) => rows.map((r) => r.lock);

describe('annotateModuleLocks — vendor unlock_logic', () => {
  describe("chain vendors (NIETE) — unchanged, strict sequencing", () => {
    it('opens exactly one unpassed module and locks the rest', () => {
      expect(locks(annotateModuleLocks(mods([false, false, false]), 'chain')))
        .toEqual(['next', 'locked', 'locked']);
    });

    it('keeps passed modules open for review and advances "next"', () => {
      expect(locks(annotateModuleLocks(mods([true, true, false, false]), 'chain')))
        .toEqual(['passed', 'passed', 'next', 'locked']);
    });

    it('defaults to chain when unlock_logic is missing (fail closed)', () => {
      expect(locks(annotateModuleLocks(mods([false, false, false]))))
        .toEqual(['next', 'locked', 'locked']);
    });

    it('defaults to chain for an unrecognised unlock_logic', () => {
      expect(locks(annotateModuleLocks(mods([false, false, false]), 'nonsense')))
        .toEqual(['next', 'locked', 'locked']);
    });
  });

  describe("all_modules vendors (Beacon House, Oxbridge) — no sequencing", () => {
    it('never locks a module', () => {
      const rows = annotateModuleLocks(mods([false, false, false, false, false]), 'all_modules');
      expect(rows.some((r) => r.lock === 'locked')).toBe(false);
    });

    it('opens every unpassed module, not just the first', () => {
      expect(locks(annotateModuleLocks(mods([false, false, false]), 'all_modules')))
        .toEqual(['next', 'next', 'next']);
    });

    it('still marks completed modules as passed', () => {
      expect(locks(annotateModuleLocks(mods([true, false, true, false]), 'all_modules')))
        .toEqual(['passed', 'next', 'passed', 'next']);
    });

    it('opens a deep module — the reported bug: module 55 of 55, none done', () => {
      const many = mods(Array(55).fill(false));
      const rows = annotateModuleLocks(many, 'all_modules');
      expect(rows[54].lock).not.toBe('locked');
    });
  });

  it('does not mutate the caller\'s rows', () => {
    const input = mods([false, false]);
    annotateModuleLocks(input, 'all_modules');
    expect(input.every((m) => !('lock' in m))).toBe(true);
  });
});
