/**
 * bd-2700 — the stale-session coaching thresholds must be env-configurable.
 *
 * Why: the reminder (2h) and auto-complete (12h) thresholds were hardcoded
 * constants, which makes the reflection-timeout path effectively untestable —
 * verifying it end to end on staging meant waiting 12 hours for one data point.
 *
 * Staging needs minutes; production must keep 2h/12h. So the thresholds move to
 * env vars that DEFAULT to the production values, and staging overrides them.
 *
 * Also covered: USER_ACTIVE_THRESHOLD_MS. The sweep skips any session whose user
 * looks "currently active" (5 min). With a 2-minute reminder threshold that skip
 * would swallow every test run — an actively-testing teacher is never idle enough
 * — so it has to be overridable too, or the short thresholds silently never fire.
 */

const PATH = '../../bot/workers/stale-session.worker';

// CI runs the root suite BEFORE `bot/ npm ci`, so bot-only deps must be mocked
// virtually. We are asserting pure threshold arithmetic — nothing here touches
// Supabase, WhatsApp, or the queue.
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) }),
}), { virtual: true });
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
}), { virtual: true });
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }), { virtual: true });
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: async () => {} }), { virtual: true });
jest.mock('../../bot/shared/services/coaching/coaching-job-queue.service', () => ({ queueReport: async () => {} }), { virtual: true });
jest.mock('../../bot/shared/services/soniox-cleanup.service', () => ({ runSonioxCleanup: async () => {} }), { virtual: true });
jest.mock('../../bot/shared/services/coaching/coaching-stale-recovery', () => ({ classifyStuckInitiatedSession: () => ({}) }), { virtual: true });

function loadThresholds(env = {}) {
  jest.resetModules();
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    // eslint-disable-next-line global-require
    return require(PATH).__thresholds;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('bd-2700 stale-session thresholds are env-configurable', () => {
  it('exposes its thresholds so they can be asserted at all', () => {
    const t = loadThresholds({
      COACHING_REMINDER_MINUTES: undefined,
      COACHING_AUTO_COMPLETE_MINUTES: undefined,
      COACHING_USER_ACTIVE_MINUTES: undefined,
    });
    expect(t).toBeDefined();
  });

  it('defaults to the production values (2h reminder / 12h auto-complete / 5m active)', () => {
    const t = loadThresholds({
      COACHING_REMINDER_MINUTES: undefined,
      COACHING_AUTO_COMPLETE_MINUTES: undefined,
      COACHING_USER_ACTIVE_MINUTES: undefined,
    });
    expect(t.reminderMs).toBe(2 * HOUR);
    expect(t.autoCompleteMs).toBe(12 * HOUR);
    expect(t.userActiveMs).toBe(5 * MIN);
  });

  it('honours the staging override (2 min reminder / 5 min auto-complete)', () => {
    const t = loadThresholds({
      COACHING_REMINDER_MINUTES: '2',
      COACHING_AUTO_COMPLETE_MINUTES: '5',
      COACHING_USER_ACTIVE_MINUTES: '0',
    });
    expect(t.reminderMs).toBe(2 * MIN);
    expect(t.autoCompleteMs).toBe(5 * MIN);
    // 0 must be respected, not treated as falsy-and-defaulted — otherwise the
    // active-user skip keeps eating every short-threshold test run.
    expect(t.userActiveMs).toBe(0);
  });

  it('ignores garbage and negative values rather than disabling the sweep', () => {
    const t = loadThresholds({
      COACHING_REMINDER_MINUTES: 'soon',
      COACHING_AUTO_COMPLETE_MINUTES: '-5',
      COACHING_USER_ACTIVE_MINUTES: undefined,
    });
    expect(t.reminderMs).toBe(2 * HOUR);
    expect(t.autoCompleteMs).toBe(12 * HOUR);
  });

  it('keeps the reminder strictly before auto-complete, or the reminder never sends', () => {
    const t = loadThresholds({
      COACHING_REMINDER_MINUTES: '2',
      COACHING_AUTO_COMPLETE_MINUTES: '5',
      COACHING_USER_ACTIVE_MINUTES: '0',
    });
    expect(t.reminderMs).toBeLessThan(t.autoCompleteMs);
  });
});
