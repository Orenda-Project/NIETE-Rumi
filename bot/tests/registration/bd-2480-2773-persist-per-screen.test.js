/**
 * bd-2480 (name dropped) + bd-2773 (role dropped) — the SAME root cause.
 *
 * Registration keeps each screen's data ONLY in Redis and rebuilds the terminal
 * SUCCESS payload from it. In production the earlier screens' values are gone by
 * the time SUCCESS is built (verified in Axiom niete-logs 2026-09-03 05:35Z: a real
 * teacher's completion params had full_name:"", country:"" while role/school/grade
 * — the LAST screen — survived). So the completion handler writes an empty
 * first_name and, on the org="other" path, a null role.
 *
 * The fix persists each screen's fields to the USER ROW as its data_exchange
 * arrives, so the account is correct regardless of what the terminal payload loses.
 *
 * RED-FIRST: the endpoint touches Supabase nowhere today, so every assertion here
 * fails on develop.
 */
let mockRegStore = {};
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (key, val) => { mockRegStore[key] = val; }),
  get: jest.fn(async (key) => mockRegStore[key] || null),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/config/branding', () => ({ portalUrl: () => 'https://portal.example.com' }));

// Capture every users-row update the endpoint makes.
const updates = [];
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => ({
    update: jest.fn((cols) => ({
      eq: jest.fn(async (col, val) => { updates.push({ table, cols, by: { [col]: val } }); return { data: null, error: null }; }),
    })),
  })),
}));

const { handleRegistrationDataExchange } = require('../../shared/routes/registration-endpoint');
const FLOW_TOKEN = 'user-1:registration:1700000000';

function userUpdates() { return updates.filter(u => u.table === 'users'); }
function merged() { return Object.assign({}, ...userUpdates().map(u => u.cols)); }

beforeEach(() => { mockRegStore = {}; updates.length = 0; });

describe('bd-2480/bd-2773 — registration persists each screen to the user row', () => {
  it('PERSONAL_INFO writes first_name, name and country immediately', async () => {
    await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO',
      { full_name: 'Mahnoor Khan', country: 'PK' }, FLOW_TOKEN);
    const w = merged();
    expect(w.first_name).toBe('Mahnoor');
    expect(w.name).toBe('Mahnoor Khan');
    expect(w.country).toBe('PK');
  });

  it('PROFESSIONAL_INFO writes the selected role immediately (Coach)', async () => {
    await handleRegistrationDataExchange('user-1', 'PROFESSIONAL_INFO',
      { organization: 'niete', school_name: 'NIETE HQ', grade: 'grade_5', subjects: ['maths'], role: 'coach' }, FLOW_TOKEN);
    expect(merged().role).toBe('coach');
  });

  it('the org="other" path still leaves name AND role on the account, even though the terminal payload drops the earlier screens', async () => {
    // Simulate the production failure: Redis loses the PERSONAL_INFO blob before PROFESSIONAL_INFO reads it.
    await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO',
      { full_name: 'Sara Coach', country: 'TZ' }, FLOW_TOKEN);
    mockRegStore = {};   // the store is gone — exactly what prod does
    const prof = await handleRegistrationDataExchange('user-1', 'PROFESSIONAL_INFO',
      { organization: 'other', school_name: 'X', grade: ['grade_3'], subjects: ['maths'], role: 'principal' }, FLOW_TOKEN);
    expect(prof.screen).toBe('ORG_DETAILS');
    await handleRegistrationDataExchange('user-1', 'ORG_DETAILS',
      { organization_other: 'Beacon House' }, FLOW_TOKEN);
    const w = merged();
    expect(w.first_name).toBe('Sara');       // written at PERSONAL_INFO, not lost with Redis
    expect(w.role).toBe('principal');        // written at PROFESSIONAL_INFO, not lost with ORG_DETAILS as the last screen
    // Only REAL users columns — grades_taught/subjects_taught, never grade/subjects. A wrong name
    // makes PostgREST reject the whole update and drops the role (bd-2773 verify 2026-09-03).
    const cols = Object.keys(w);
    expect(cols).toContain('grades_taught');
    expect(cols).toContain('subjects_taught');
    expect(cols).not.toContain('grade');
    expect(cols).not.toContain('subjects');
  });

  it('an empty name is never written (validation still rejects it)', async () => {
    const res = await handleRegistrationDataExchange('user-1', 'PERSONAL_INFO',
      { full_name: '   ', country: 'PK' }, FLOW_TOKEN);
    expect(res.data.error).toBeTruthy();
    expect(userUpdates()).toHaveLength(0);
  });
});
