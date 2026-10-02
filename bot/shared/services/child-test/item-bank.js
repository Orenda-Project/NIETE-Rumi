/**
 * Child test item bank accessor (bd-s1oo0.1, CONTRACT §2).
 *
 * Pure, read-only access to bot/shared/data/child-test/item-bank.v1.json: the stories, questions
 * (with answer keys), first sounds, made-up words, fallback rows and maths items for Grades 3 and 5,
 * Forms A (new children) and B (returning children). The bank is loaded once and deep-frozen, so a
 * caller that mutates what it gets back throws instead of corrupting the bank for the next caller.
 */
const BANK = require('../../data/child-test/item-bank.v1.json');

const GRADES = ['3', '5'];
const FORMS = ['A', 'B'];
const BLOCKS = ['urdu', 'english', 'maths'];

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.values(x).forEach(deepFreeze);
    Object.freeze(x);
  }
  return x;
}
deepFreeze(BANK);

// id -> { grade, form, block, kind, item }. Built once; every id in the bank is unique (validator-enforced).
const INDEX = new Map();
for (const grade of GRADES) {
  for (const form of FORMS) {
    for (const block of BLOCKS) {
      for (const [kind, v] of Object.entries(BANK.grades[grade].forms[form][block])) {
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          if (item && typeof item === 'object' && typeof item.id === 'string') {
            INDEX.set(item.id, Object.freeze({ grade, form, block, kind, item }));
          }
        }
      }
    }
  }
}

function normGrade(grade) {
  const g = String(grade);
  if (!GRADES.includes(g)) throw new Error(`child-test item bank: unknown grade "${grade}" (expected 3 or 5)`);
  return g;
}

function normForm(form) {
  const f = String(form || '').toUpperCase();
  if (!FORMS.includes(f)) throw new Error(`child-test item bank: unknown form "${form}" (expected A or B)`);
  return f;
}

/** The whole form: { urdu, english, maths }. */
function getForm(grade, form) {
  return BANK.grades[normGrade(grade)].forms[normForm(form)];
}

/** One block of a form: 'urdu' | 'english' | 'maths'. */
function getBlock(grade, form, block) {
  if (!BLOCKS.includes(block)) throw new Error(`child-test item bank: unknown block "${block}" (expected urdu, english or maths)`);
  return getForm(grade, form)[block];
}

/** Any item by id (e.g. 'u3A-q1', 'e5B-story', 'm3A-qs12') → { grade, form, block, kind, item } or null. */
function getItem(id) {
  return INDEX.get(id) || null;
}

// ------------------------------------------------------------------ quick sums: one setting
// `maths.quick_sums_seconds` in the bank governs the copy, the coach sheet and the scorer's timed
// window. CHILD_TEST_QUICK_SUMS_SECONDS (30 or 60) overrides it on SANDBOX only, so a pilot can time
// both settings without a bank change. Everything that needs the number reads quickSumsSeconds().
const QS_ALLOWED = new Set([30, 60]);
const QS_DEFAULT = 60;

function isSandbox(env = process.env) {
  const names = [env.CHILD_TEST_R2_ENV, env.RAILWAY_ENVIRONMENT, env.RAILWAY_ENVIRONMENT_NAME].map((x) => String(x || '').toLowerCase());
  return names.includes('sandbox') || /-sandbox$/i.test(String(env.DEFAULT_REGION || ''));
}

function sandboxQuickSumsOverride(env = process.env) {
  const raw = env.CHILD_TEST_QUICK_SUMS_SECONDS;
  if (raw == null || raw === '' || !isSandbox(env)) return null;
  const n = Number(raw);
  if (!QS_ALLOWED.has(n)) {
    // logger is required lazily: this module is otherwise pure data access.
    require('../../utils/logger').logError('child_test.quick_sums_override_invalid', { value: String(raw) });
    return null;
  }
  return n;
}

/** Seconds of quick sums for a form (default Grade 3 Form A): sandbox override, else the bank, else 60. */
function quickSumsSeconds(grade = 3, form = 'A') {
  const o = sandboxQuickSumsOverride();
  if (o != null) return o;
  const v = Number(getBlock(grade, form, 'maths').quick_sums_seconds);
  return Number.isFinite(v) && v > 0 ? v : QS_DEFAULT;
}

module.exports = {
  version: BANK.version,
  cue: BANK.cue,
  GRADES,
  FORMS,
  BLOCKS,
  getForm,
  getBlock,
  getItem,
  quickSumsSeconds,
  sandboxQuickSumsOverride,
  isSandbox,
};
