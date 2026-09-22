/**
 * A vendor may run its unit quizzes as PURE FORMATIVE. bd-60163.
 *
 * I-SAPS's Sept 2026 guide removed the pass requirement on end-of-unit
 * quizzes: answer, see the correct answer, move on. Those items are the 25%
 * formative component of a level-wide composite, so gating each one
 * individually double-counts the work and blocks a teacher on an item the
 * level rule would have forgiven.
 *
 * THE TRAP THIS FILE EXISTS TO HOLD SHUT: it cannot be expressed as
 * `module_passing_pct = 0`. The pass-bar lookup treats a non-positive value as
 * a broken row and falls back to 100 — the STRICTEST bar — so zero demands a
 * PERFECT score, the exact opposite of the intent. Anyone "simplifying" this
 * flag back into the percentage column reintroduces that inversion, and the
 * only thing standing in the way is the last test here.
 */

const MODULE = '../../bot/shared/services/training/quiz-delivery.service';

/** Rows keyed by table, walked module -> course -> level -> vendor. */
function fakeSupabase({ ungated = undefined, moduleBar = 50 } = {}) {
  const tables = {
    training_modules: [{ id: 10, course_id: 1 }],
    training_courses: [{ id: 1, level_id: 27 }],
    training_levels: [{ id: 27, vendor_id: 'v-isaps' }],
    training_vendors: [{
      id: 'v-isaps',
      module_passing_pct: moduleBar,
      ...(ungated === undefined ? {} : { module_quiz_ungated: ungated }),
    }],
  };
  return {
    from(table) {
      let rows = (tables[table] || []).slice();
      const api = {
        select() { return api; },
        eq(col, val) { rows = rows.filter(r => r[col] === val); return api; },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }); },
        then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
      };
      return api;
    },
  };
}

function load(supabase) {
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => supabase);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  return require(MODULE);
}

describe('bd-60163 — ungated unit quizzes', () => {
  afterEach(() => jest.resetModules());

  test('an ungated vendor passes a teacher who scored below the bar', async () => {
    const { decideModuleQuizPass } = load(fakeSupabase({ ungated: true, moduleBar: 50 }));
    const v = await decideModuleQuizPass(10, 1, 4);     // 25%, bar 50
    expect(v.is_passed).toBe(true);
    expect(v.achieved_pct).toBe(25);                    // still reported honestly
  });

  test('an ungated vendor still fails an EMPTY quiz — no questions, no pass', async () => {
    const { decideModuleQuizPass } = load(fakeSupabase({ ungated: true }));
    const v = await decideModuleQuizPass(10, 0, 0);
    expect(v.is_passed).toBe(false);
  });

  test('a gated vendor is untouched: below the bar still fails', async () => {
    const { decideModuleQuizPass } = load(fakeSupabase({ ungated: false, moduleBar: 70 }));
    const v = await decideModuleQuizPass(10, 1, 4);
    expect(v.is_passed).toBe(false);
  });

  test('a vendor row with no flag at all keeps its gate', async () => {
    const { decideModuleQuizPass } = load(fakeSupabase({ ungated: undefined, moduleBar: 70 }));
    const v = await decideModuleQuizPass(10, 1, 4);
    expect(v.is_passed).toBe(false);
  });

  test('a lookup failure keeps the gate rather than removing a pass requirement', async () => {
    const broken = { from() { throw new Error('db down'); } };
    const { vendorUngatesModuleQuiz } = load(broken);
    await expect(vendorUngatesModuleQuiz(10)).resolves.toBe(false);
  });

  test('THE INVERSION: module_passing_pct = 0 does NOT ungate — it demands 100%', async () => {
    // The whole reason the flag is its own column. If someone "simplifies"
    // this away, a zero bar silently becomes the strictest bar.
    const { decideModuleQuizPass } = load(fakeSupabase({ ungated: false, moduleBar: 0 }));
    const nearPerfect = await decideModuleQuizPass(10, 3, 4);   // 75%
    expect(nearPerfect.is_passed).toBe(false);
    expect(nearPerfect.pass_pct).toBe(100);
  });
});
