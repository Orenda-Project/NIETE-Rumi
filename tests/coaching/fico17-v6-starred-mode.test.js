'use strict';
/**
 * Queue #184 — FICO17 v6 starred mode, corrected 19 Nov ~17:00 (operator, asked about C3: "thats wrong. those are not
 * starred"). v6's source marks no indicator starred: its "HITL only" six (C3 C5 C7 D2 D3 D4) are the COMBINED
 * indicators, where the Digital Coach gives evidence only and the coach sets the level (11 Nov). So v6 stars none, and
 * app_settings.fico_v6_starred, on or off, gives today's v6: the same prompt (PART 2 evidence for the six), version,
 * validator and scorer. The mode comes back on its own if the rubric ever marks one starred.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
let mockSettings = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (table) => {
    const q = { _key: null };
    q.select = () => q;
    q.eq = (c, v) => { if (c === 'key') q._keys = [v]; return q; };
    q.in = (c, v) => { if (c === 'key') q._keys = v; return q; };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: table === 'app_settings' ? (q._keys || []).filter((k) => mockSettings[k] !== undefined).map((k) => ({ key: k, value: mockSettings[k] })) : [], error: null }).then(res, rej);
    return q;
  },
}));

const V6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const fw = require('../../bot/shared/services/coaching/frameworks/fico17-v6-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const Switch = require('../../bot/shared/services/coaching/fico-rubric-switch');

const SIX = ['C3', 'C5', 'C7', 'D2', 'D3', 'D4'];
const T = '[00:10] Teacher (en): Ali, what do you think?\n[00:15] Student (en): Five.\n[30:00] Student (en): I agree.';
const reply = () => {
  const levels = {};
  for (const c of V6.DC_CODES) levels[c] = { result: 2, because: 'x', evidence: [{ time: '00:10', quote: 'Ali, what do you think?' }] };
  return { levels };
};

describe('v6 stars none: starred mode is today\'s v6', () => {
  test('the starred variant is the v6 framework itself', () => {
    expect(V6.STARRED_CODES).toEqual([]);
    expect(fw.starredVariant()).toBe(fw);
  });
  test('the prompt still asks evidence for the six (PART 2), as 11 Nov', () => {
    const p = fw.starredVariant().getSystemPrompt();
    expect(p).toContain('PART 2');
    // the five with an evidence block (D2's turn count is not asked in the prompt), as 11 Nov
    for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) expect(p).toContain(`### Evidence: ${c} `);
  });
  test('the stored analysis keeps the six\'s evidence and names nothing starred', () => {
    const r = reply();
    r.combined_evidence = { C3: { result: null, items: [{ time: '00:10', quote: 'Ali, what do you think?' }] } };
    const a = fw.starredVariant().computeScores(r, false, T);
    expect(a.combined_evidence).toBeDefined();
    expect(a.starred).toBeUndefined();
    expect(a.prompt_version).toBe(fw.promptVersion);
  });
  test('the coach\'s review shows no ★ for the six', () => {
    const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
    const a = { ...fw.computeScores(reply(), false, T), framework: 'fico17_v6' };
    for (const c of SIX) expect(O6.recordingText(a, c, 'en', observeStrings('en'))).not.toMatch(/^★ /);
  });
});

describe('the switch: app_settings.fico_v6_starred, on or off, gives today\'s v6', () => {
  beforeEach(() => { Switch._resetCache(); mockSettings = {}; });
  const session = { framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch', observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' };
  test('off (no row)', async () => {
    expect((await O6.v6FrameworkFor(session)).promptVersion).toBe(fw.promptVersion);
  });
  test('on for the observer', async () => {
    mockSettings = { fico_v6_starred: JSON.stringify({ 'user:coach-1': 'on' }) };
    expect((await O6.v6FrameworkFor(session)).promptVersion).toBe(fw.promptVersion);
  });
});
