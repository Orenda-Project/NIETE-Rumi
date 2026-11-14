/**
 * bd-ra8xu.58 — P0, Rifat on prod 14 Nov 19:33 (video in the bd-ra8xu.50 work folder, rifat-stuck-video-20261114/).
 * FICO17 v6 coach form, screen D2: her reason ("Huyggfhdhxhcjik", 15 characters) was under the 20-character rule, so
 * every Next served the same screen; the refusal showed only as a block at the TOP of a long screen while she was at
 * the button; and Back then Next served the screens again WITHOUT her earlier answers (the forward serve passed no
 * edits), so the reason she had typed was gone. Prod: 8 D2 refusals 19:32-19:34, 6 at 19:04, 4 on C5.
 *
 * Contract (bugs, not design; the 20-character rule stays):
 *   1. a refusal is shown under the field it is about (the Form's error-messages), and the rule is in the reason
 *      box's helper text before she types;
 *   2. every answer she has given is pre-filled on every screen served: the next screen, a refused screen, Back
 *      (refresh), and a reopened form (INIT), including Section B's move verdicts.
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
const mockUpdates = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => {
    const chain = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      not: jest.fn(() => chain),
      then: (res, rej) => Promise.resolve({ data: [{ id: 'sess-6' }], error: null }).then(res, rej),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      single: jest.fn(() => Promise.resolve({ data: { ...mockSessionRow, users: { name: 'C', phone_number: '1' } }, error: null })),
      update: jest.fn((patch) => { mockUpdates.push(patch); return chain; }),
    };
    return chain;
  }),
}));

let mockLang = 'en';
jest.mock('../../bot/shared/services/observe/observe-language', () => ({ languageFor: jest.fn(async () => mockLang) }));

const redis = require('../../bot/shared/services/cache/railway-redis.service');
const ObserveDraft = require('../../bot/shared/services/observe/observe-draft.service');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const { handleObserveMewakaRequest } = require('../../bot/shared/routes/observe-mewaka-endpoint');
const FLOW = require('../../bot/docs/flows/observe-fico17_v6-flow.json');
const UR = require('../../bot/shared/services/coaching/frameworks/fico17-v6/fico17_v6.ur.json');

const TOKEN = 'co-1:sess-6';
const cp = (s) => Array.from(String(s)).length;
const NAMES = ['Not Observed', 'Developing', 'Proficient', 'Highly Effective'];

function v6Analysis() {
  const levels = {};
  v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: `Rumi heard ${c}`, evidence: [{ time: '03:10', quote: 'Why is that?' }] }; });
  levels.C2 = { result: 'NA', because: 'No wrong answer was heard.' };
  levels.D5 = { result: 'IE', because: 'Student lines were garbled.' };
  const domains = {};
  Object.values(v6.SECTIONS).forEach((s) => {
    domains[s.domain] = { indicators: s.codes.map((c) => ({ id: c, score: v6.isDc(c) ? 2 : null, result: v6.isDc(c) ? (levels[c] || {}).result : null })) };
  });
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234', levels, domains,
    combined_evidence: { C3: { result: null, items: [{ time: '05:10', quote: 'Ali, what do you think?', kind: 'name_called' }] }, D3: { result: 'NA', items: [] }, D2: { student_turns_first_half: 30, student_turns_second_half: 12 } },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  redis.__store.clear();
  mockUpdates.length = 0;
  mockLang = 'en';
  mockSessionRow = {
    id: 'sess-6', user_id: 't-1', observer_user_id: 'co-1', status: 'awaiting_observer_review',
    observation_type: 'leader_observation', framework: 'fico17_v6', analysis_data: v6Analysis(),
  };
});

const post = (data) => handleObserveMewakaRequest({ action: 'data_exchange', flow_token: TOKEN, data });


const SCREEN = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));
const declared = (id) => Object.keys(SCREEN[id].data).sort();
const IND = FLOW.screens.filter((s) => /^IND_/.test(s.id));
const SHORT = 'Huyggfhdhxhcjik'; // what she typed, 15 characters
const REASON = 'Six children spoke, and two quiet ones answered late.';
const formOf = (id) => SCREEN[id].layout.children[0];

describe('1 · the refusal is under the reason box, and the rule is said before she types', () => {
  test('every indicator screen binds the Form\'s error-messages and declares them', () => {
    for (const s of IND) {
      expect(formOf(s.id)['error-messages']).toBe('${data.error_messages}');
      expect(s.data.error_messages).toMatchObject({ type: 'object' });
    }
  });

  test.each(['en', 'ur'])('D2 (%s): a 15-character reason is refused under why_D2, with what she typed kept', async (lang) => {
    mockLang = lang;
    const res = await post({ _screen: 'IND_D_TWO', r_D2: '3', why_D2: SHORT });
    expect(res.screen).toBe('IND_D_TWO');
    expect(res.data.error_messages.why_D2).toMatch(lang === 'en' ? /at least 20 characters/ : /۲۰|20/);
    expect(res.data.init.why_D2).toBe(SHORT);
    expect(res.data.init.r_D2).toBe('3');
    expect(Object.keys(res.data).sort()).toEqual(declared('IND_D_TWO'));
  });

  test('a screen served without a refusal carries an empty error map (declared, so Meta accepts it)', async () => {
    const res = await post({ _screen: 'IND_D_ONE', r_D1: '2', ev_D1: '', imp_D1: '', chg_D1: '' });
    expect(res.screen).toBe('IND_D_TWO');
    expect(res.data.error_messages).toEqual({});
    expect(Object.keys(res.data).sort()).toEqual(declared('IND_D_TWO'));
  });

  test.each(['en', 'ur'])('the rule is in the helper text before she types (%s)', async (lang) => {
    mockLang = lang;
    const res = await post({ _screen: 'IND_D_ONE', r_D1: '2', ev_D1: '', imp_D1: '', chg_D1: '' });
    expect(res.data.help_why).toMatch(lang === 'en' ? /At least 20 characters/ : /۲۰/);
  });
});

describe('2 · every answer she gave is pre-filled on every screen served', () => {
  test('Back to D1 then Next: D2 comes back with her level and her reason (her 19:33 loss)', async () => {
    await post({ _screen: 'IND_D_ONE', r_D1: '2', ev_D1: '', imp_D1: '', chg_D1: '' });
    const toD3 = await post({ _screen: 'IND_D_TWO', r_D2: '4', why_D2: REASON });
    expect(toD3.screen).toBe('IND_D_THREE');
    // the header arrow takes her back to D1 (the phone keeps D1); Next posts D1 again
    const again = await post({ _screen: 'IND_D_ONE', r_D1: '2', ev_D1: '', imp_D1: '', chg_D1: '' });
    expect(again.screen).toBe('IND_D_TWO');
    expect(again.data.init.why_D2).toBe(REASON);
    expect(again.data.init.r_D2).toBe('4');
  });

  test('a refused D2, then a fixed one, then Back and Next: the fixed reason is what comes back', async () => {
    await post({ _screen: 'IND_D_TWO', r_D2: '3', why_D2: SHORT });
    await post({ _screen: 'IND_D_TWO', r_D2: '3', why_D2: REASON });
    const again = await post({ _screen: 'IND_D_ONE', r_D1: '2', ev_D1: '', imp_D1: '', chg_D1: '' });
    expect(again.data.init.why_D2).toBe(REASON);
  });

  test('a DC indicator she edited keeps her edits too (C1 evidence, improvement, change reason)', async () => {
    await post({ _screen: 'IND_C_ONE', r_C1: '3', ev_C1: 'My own evidence line.', imp_C1: 'Ask why twice.', chg_C1: 'I saw more open questions than Rumi heard.' });
    const back = await handleObserveMewakaRequest({ action: 'BACK', flow_token: TOKEN, screen: 'IND_C_ONE', data: {} });
    expect(back.data.init).toMatchObject({ r_C1: '3', ev_C1: 'My own evidence line.', imp_C1: 'Ask why twice.', chg_C1: 'I saw more open questions than Rumi heard.' });
  });

  test('BACK (refresh) on D2 serves her saved reason', async () => {
    await post({ _screen: 'IND_D_TWO', r_D2: '4', why_D2: REASON });
    const back = await handleObserveMewakaRequest({ action: 'BACK', flow_token: TOKEN, screen: 'IND_D_TWO', data: {} });
    expect(back.screen).toBe('IND_D_TWO');
    expect(back.data.init.why_D2).toBe(REASON);
    expect(Object.keys(back.data).sort()).toEqual(declared('IND_D_TWO'));
  });

  test('a reopened form (INIT) keeps Section B\'s move verdicts and notes', async () => {
    const first = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN, data: {} });
    expect(first.screen).toBe('DOMAIN_B');
    const scale = (first.data.fid_scale || []).map((o) => o.id);
    const other = scale.find((id) => id !== first.data.fr_1) || scale[0];
    await post({ _screen: 'DOMAIN_B', fid_r_1: other, fid_e_1: 'Her own note on move 1.' });
    const reopened = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN, data: {} });
    expect(reopened.data.fr_1).toBe(other);
    expect(reopened.data.fe_1).toBe('Her own note on move 1.');
  });

  test('a V3 visit is served exactly as before (nothing here touches it)', async () => {
    mockSessionRow = { ...mockSessionRow, framework: null };
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN, data: {} });
    expect(res.data.error_messages).toBeUndefined();
  });
});
