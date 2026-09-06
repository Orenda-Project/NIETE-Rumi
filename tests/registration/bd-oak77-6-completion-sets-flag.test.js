/**
 * bd-oak77.6 — when the registration endpoint says "Your registration is complete",
 * the account must SAY so.
 *
 * PROD EVIDENCE (ihzciabopbttygxxgrkm, read-only, 2026-09-06): of 7,685 users with a
 * first_name, only 440 have registration_completed=true and 7,245 have it false — 0 NULL.
 * It is not only historical debt: of the 30 named users created in the last 7 days,
 * 23 have the flag (76.7%), so a live path still finishes without it.
 *
 * ROOT CAUSE, here: handleRegistrationDataExchange returns screen 'SUCCESS' from TWO
 * places — the PROFESSIONAL_INFO branch (organization != 'other') and the ORG_DETAILS
 * branch — and both send the teacher "Your registration is complete." Neither writes
 * registration_completed. The flag is written ONLY when the terminal Flow payload later
 * reaches flow-response.handler.js. That is the very payload this endpoint's own header
 * documents as unreliable ("the terminal Flow payload arrives with the earlier screens'
 * values empty… verified in niete-logs 2026-09-03"), which is why bd-2480 moved the name
 * write per-screen in the first place. The completion flag was never moved with it.
 *
 * RED-FIRST: both assertions below fail on develop — no SUCCESS path writes the flag.
 */
let mockRegStore = {};
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (key, val) => { mockRegStore[key] = val; }),
  get: jest.fn(async (key) => mockRegStore[key] || null),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.example.com' }));

const updates = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => ({
    update: jest.fn((cols) => ({
      eq: jest.fn(async (col, val) => { updates.push({ table, cols, by: { [col]: val } }); return { data: null, error: null }; }),
    })),
  })),
}));

const { handleRegistrationDataExchange } = require('../../bot/shared/routes/registration-endpoint');
const FLOW_TOKEN = 'user-1:registration:1700000000';

function merged() {
  return Object.assign({}, ...updates.filter((u) => u.table === 'users').map((u) => u.cols));
}

beforeEach(() => { mockRegStore = {}; updates.length = 0; });

describe('bd-oak77.6 — a SUCCESS screen writes registration_completed', () => {
  it('the direct path (organization != "other") reaches SUCCESS and marks the account complete', async () => {
    await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO',
      { full_name: 'Ayesha Bano', country: 'PK' }, FLOW_TOKEN);
    const res = await handleRegistrationDataExchange('user-1', 'PROFESSIONAL_INFO',
      { organization: 'niete', school_name: 'NIETE HQ', grade: 'grade_5', subjects: ['maths'], role: 'teacher' },
      FLOW_TOKEN);

    expect(res.screen).toBe('SUCCESS');
    const w = merged();
    expect(w.registration_completed).toBe(true);
    expect(typeof w.registration_completed_at).toBe('string');
  });

  it('the org="other" path reaches SUCCESS via ORG_DETAILS and marks the account complete', async () => {
    await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO',
      { full_name: 'Sara Coach', country: 'TZ' }, FLOW_TOKEN);
    await handleRegistrationDataExchange('user-1', 'PROFESSIONAL_INFO',
      { organization: 'other', school_name: 'X', grade: ['grade_3'], subjects: ['maths'], role: 'principal' },
      FLOW_TOKEN);
    const res = await handleRegistrationDataExchange('user-1', 'ORG_DETAILS',
      { organization_other: 'Beacon House' }, FLOW_TOKEN);

    expect(res.screen).toBe('SUCCESS');
    const w = merged();
    expect(w.registration_completed).toBe(true);
    expect(typeof w.registration_completed_at).toBe('string');
  });

  it('a screen that is NOT terminal does not claim completion', async () => {
    await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO',
      { full_name: 'Ayesha Bano', country: 'PK' }, FLOW_TOKEN);
    expect(merged().registration_completed).toBeUndefined();
  });
});
