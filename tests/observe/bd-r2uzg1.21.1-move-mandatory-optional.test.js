'use strict';
/**
 * bd-r2uzg1.21.1 — Section B of the coach's FICO review says, for each lesson-plan move, whether the plan makes it
 * mandatory or optional.
 *
 * Each move line already names the move (number, phase, the plan's own text) and the grader's reason. What a coach
 * could not see is which moves count: the scorer puts every must_happen move (and an applicable group step,
 * adaptive_set) in the denominator and leaves every optional_extension move (homework, "if time permits") out of
 * it whatever its rating. So a coach re-rating an optional move to "Not done" changed nothing and could not know why.
 *
 * The mark is one short line under the move, in the coach's language (observe-strings.js, en + ur). The line is the
 * `mv_k` data string the published Flow already declares (a TextBody), and the portal's Feedback Form prints the same
 * string, so this needs no Flow JSON change and no Meta republish.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    __store: store,
    setexWithCeiling: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    setNX: jest.fn(() => Promise.resolve(true)),
    get: jest.fn((k) => {
      const v = store.get(k);
      if (!v) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(v)); } catch { return Promise.resolve(v); }
    }),
    delete: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
  };
});

let mockSessionRow = null;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      not: jest.fn(() => chain),
      then: (res, rej) => Promise.resolve({ data: [{ id: 'sess-b' }], error: null }).then(res, rej),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      single: jest.fn(() => Promise.resolve({ data: { ...mockSessionRow, users: { name: 'C', phone_number: '1' } }, error: null })),
      update: jest.fn(() => chain),
    };
    return chain;
  }),
}));

let mockCoachLang = 'en';
jest.mock('../../bot/shared/services/observe/observe-language', () => ({ languageFor: jest.fn(async () => mockCoachLang) }));

const fs = require('fs');
const path = require('path');
const draft = require('../../bot/shared/services/observe/observe-draft.service');
const { composeEditableFidelity, buildScreenPrefill } = draft;
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const { handleObserveMewakaRequest } = require('../../bot/shared/routes/observe-mewaka-endpoint');

const EN = observeStrings('en');
const UR = observeStrings('ur');
const URDU = /[؀-ۿ]/;

// The scorer's row shape (fidelity-scorer.js): bucket from the plan, counted from the scorer.
const LP = {
  status: 'ok', fidelity_pct: 50, band: 'partial', prescribed_count: 3,
  moves: [
    { move_id: 'm1', phase: 'warm_up', bucket: 'must_happen', selection: 'none', text: 'Count to twenty in a chain',
      verdict: 'executed', counted: true, credit: 1, evidence: '[01:10] The class counts aloud.', rationale: 'Heard the whole chain.' },
    { move_id: 'm2', phase: 'guided_practice', bucket: 'adaptive_set', selection: 'per_group', text: 'Beginner group: sort the number cards',
      verdict: 'partial', counted: true, credit: 0.5, evidence: '', rationale: 'Only half the cards were sorted.' },
    { move_id: 'm3', phase: 'assessment', bucket: 'must_happen', selection: 'choose_one', text: 'Exit check: two counting questions',
      verdict: 'not_done', counted: true, credit: 0, evidence: '', rationale: 'No exit check before the bell.' },
    { move_id: 'm4', phase: 'homework', bucket: 'optional_extension', selection: 'none', text: 'Count the windows at home',
      verdict: 'not_done', counted: false, credit: null, evidence: '', rationale: 'Homework was not set aloud.' },
  ],
};

const linesOf = (s) => String(s).split('\n');

describe('the three marks exist in both languages the coach form serves', () => {
  test.each(['fid_move_mandatory', 'fid_move_group', 'fid_move_optional'])('%s: en and ur, ur in Urdu script', (key) => {
    expect(typeof EN[key]).toBe('string');
    expect(EN[key].length).toBeGreaterThan(0);
    expect(typeof UR[key]).toBe('string');
    expect(UR[key]).not.toBe(EN[key]);
    expect(URDU.test(UR[key])).toBe(true);
  });

  test('the optional mark says it is not counted; the two mandatory marks differ', () => {
    expect(EN.fid_move_optional).toMatch(/optional/i);
    expect(EN.fid_move_optional).toMatch(/not counted/i);
    expect(EN.fid_move_mandatory).toMatch(/mandatory/i);
    expect(EN.fid_move_group).toMatch(/mandatory/i);
    expect(EN.fid_move_group).toMatch(/group/i);
    expect(EN.fid_move_group).not.toBe(EN.fid_move_mandatory);
  });
});

describe('composeEditableFidelity — each move line carries its mark', () => {
  test('the move line still names the move; the mark is the line under it; Why comes after', () => {
    const { slots } = composeEditableFidelity(LP);
    const first = linesOf(slots[0].plan);
    expect(first[0]).toBe('1/4 · Warm-up — Count to twenty in a chain');
    expect(first[1]).toBe(EN.fid_move_mandatory);
    expect(first[2]).toBe('Why: Heard the whole chain.');
  });

  test('must_happen → mandatory, adaptive_set → mandatory for its group, optional_extension → optional, not counted', () => {
    const { slots } = composeEditableFidelity(LP);
    expect(linesOf(slots[0].plan)[1]).toBe(EN.fid_move_mandatory);
    expect(linesOf(slots[1].plan)[1]).toBe(EN.fid_move_group);
    expect(linesOf(slots[2].plan)[1]).toBe(EN.fid_move_mandatory);
    expect(linesOf(slots[3].plan)[1]).toBe(EN.fid_move_optional);
  });

  test('a move with no bucket is mandatory, as the scorer counts it', () => {
    const lp = { ...LP, moves: [{ ...LP.moves[0], bucket: undefined }] };
    expect(linesOf(composeEditableFidelity(lp).slots[0].plan)[1]).toBe(EN.fid_move_mandatory);
  });

  test('a move with no reason still gets its mark, and no empty Why', () => {
    const lp = { ...LP, moves: [{ ...LP.moves[3], rationale: '' }] };
    const plan = composeEditableFidelity(lp).slots[0].plan;
    expect(linesOf(plan)).toEqual(['1/1 · Homework — Count the windows at home', EN.fid_move_optional]);
  });

  test("an Urdu coach gets the Urdu mark (the move's own words are unchanged)", () => {
    const { slots } = composeEditableFidelity(LP, 'ur');
    expect(linesOf(slots[0].plan)[0]).toBe('1/4 · Warm-up — Count to twenty in a chain');
    expect(linesOf(slots[0].plan)[1]).toBe(UR.fid_move_mandatory);
    expect(linesOf(slots[1].plan)[1]).toBe(UR.fid_move_group);
    expect(linesOf(slots[3].plan)[1]).toBe(UR.fid_move_optional);
  });

  test('verdicts and evidence prefill are unchanged by the mark', () => {
    const { slots } = composeEditableFidelity(LP);
    expect(slots.map((s) => s.verdict)).toEqual(['executed', 'partial', 'not_done', 'not_done']);
    expect(slots[0].evidence).toBe('[01:10] The class counts aloud.');
    expect(slots[1].evidence).toBe('Only half the cards were sorted.');
  });
});

describe('what the Flow and the portal read (buildScreenPrefill mv_k)', () => {
  const analysis = { framework: 'fico17_v6', rubric: 'fico17_v6', lp_fidelity: LP, domains: {} };

  test('mv_k carries the mark in the language passed in; no language → English', () => {
    const en = buildScreenPrefill(analysis, 'lesson_plan_fidelity');
    expect(linesOf(en.mv_4)[1]).toBe(EN.fid_move_optional);
    const ur = buildScreenPrefill(analysis, 'lesson_plan_fidelity', 'ur');
    expect(linesOf(ur.mv_4)[1]).toBe(UR.fid_move_optional);
    expect(linesOf(ur.mv_1)[1]).toBe(UR.fid_move_mandatory);
  });
});

describe('the WhatsApp Flow endpoint on a v6 visit serves Section B with the coach\'s language', () => {
  function v6Analysis() {
    const levels = {};
    v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: `Heard ${c}`, evidence: [] }; });
    const domains = {};
    Object.values(v6.SECTIONS).forEach((s) => {
      domains[s.domain] = { indicators: s.codes.map((c) => ({ id: c, score: v6.isDc(c) ? 2 : null, result: v6.isDc(c) ? 2 : null })) };
    });
    return { framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234', levels, domains, lp_fidelity: LP };
  }

  beforeEach(() => {
    require('../../bot/shared/services/cache/railway-redis.service').__store.clear();
    mockSessionRow = {
      id: 'sess-b', user_id: 't-1', observer_user_id: 'co-1', status: 'awaiting_observer_review',
      observation_type: 'leader_observation', framework: 'fico17_v6', analysis_data: v6Analysis(),
    };
  });

  test('an Urdu coach: INIT (screen B) has the Urdu marks', async () => {
    mockCoachLang = 'ur';
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: 'co-1:sess-b' });
    expect(res.screen).toBe('DOMAIN_B');
    expect(linesOf(res.data.mv_1)[1]).toBe(UR.fid_move_mandatory);
    expect(linesOf(res.data.mv_4)[1]).toBe(UR.fid_move_optional);
  });

  test('an English coach: INIT (screen B) has the English marks', async () => {
    mockCoachLang = 'en';
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: 'co-1:sess-b' });
    expect(res.screen).toBe('DOMAIN_B');
    expect(linesOf(res.data.mv_2)[1]).toBe(EN.fid_move_group);
    expect(linesOf(res.data.mv_4)[1]).toBe(EN.fid_move_optional);
  });
});

describe('no Flow change: mv_k stays a data string the published assets already declare', () => {
  test.each(['observe-fico17_v6-flow.json', 'observe-fico-flow.json'])('%s: Section B shows mv_1 as a TextBody of a declared string', (file) => {
    const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bot/docs/flows', file), 'utf8'));
    const b = flow.screens.find((s) => s.id === 'DOMAIN_B');
    expect(b.data.mv_1.type).toBe('string');
    const kids = b.layout.children[0].children;
    expect(kids.some((c) => c.type === 'TextBody' && c.text === '${data.mv_1}')).toBe(true);
  });
});
