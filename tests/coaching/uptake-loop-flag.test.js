/** The loop is inert unless UPTAKE_LOOP_ENABLED is set. Read at call time. RED FIRST. */
const { isUptakeLoopEnabled } = require('../../bot/shared/config/uptake-loop-flags');
describe('UPTAKE_LOOP_ENABLED', () => {
  const saved = process.env.UPTAKE_LOOP_ENABLED;
  afterEach(() => { if (saved === undefined) delete process.env.UPTAKE_LOOP_ENABLED; else process.env.UPTAKE_LOOP_ENABLED = saved; });
  test('unset, empty, false, junk → off', () => {
    delete process.env.UPTAKE_LOOP_ENABLED; expect(isUptakeLoopEnabled()).toBe(false);
    for (const v of ['', 'false', '0', 'no', 'TRUE ']) { process.env.UPTAKE_LOOP_ENABLED = v; expect(isUptakeLoopEnabled()).toBe(v.trim().toLowerCase() === 'true'); }
  });
  test('true / 1 → on, read at call time (a worker outlives any env snapshot)', () => {
    process.env.UPTAKE_LOOP_ENABLED = 'true'; expect(isUptakeLoopEnabled()).toBe(true);
    process.env.UPTAKE_LOOP_ENABLED = '1'; expect(isUptakeLoopEnabled()).toBe(true);
    process.env.UPTAKE_LOOP_ENABLED = 'false'; expect(isUptakeLoopEnabled()).toBe(false);
  });
});
