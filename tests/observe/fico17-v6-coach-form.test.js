/**
 * The FICO17 v6 coach form (HITL), operator 13 Nov 12:20-14:35: every choice is the level name with the rubric
 * sheet's level text under it (English, and the Urdu draft for an Urdu coach); no N/A and no "Couldn't tell" for the
 * coach (the Digital Coach keeps both); no D2 count boxes; one indicator per screen on /observe with a no-input intro
 * screen before each section (5 screens -> 22). Old reviews that saved N/A or Couldn't tell still render.
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

describe('coachLevelOptions: the level name, the sheet text under it, nothing else', () => {
  test.each(v6.CODES)('%s (en): four choices, ids 1-4, level names, the rubric text word for word, no N/A or IE', (code) => {
    const opts = v6.coachLevelOptions(code, 'en');
    expect(opts.map((o) => o.id)).toEqual(['1', '2', '3', '4']);
    expect(opts.map((o) => o.title)).toEqual(NAMES);
    opts.forEach((o, i) => expect(o.description).toBe(v6.indicator(code).levels[i].text));
    opts.forEach((o) => { expect(cp(o.title)).toBeLessThanOrEqual(30); expect(cp(o.description)).toBeLessThanOrEqual(300); });
  });

  test.each(v6.CODES)('%s (ur): the Urdu draft, same ids, within the caps', (code) => {
    const opts = v6.coachLevelOptions(code, 'ur');
    expect(opts.map((o) => o.id)).toEqual(['1', '2', '3', '4']);
    expect(opts.map((o) => o.title)).toEqual(['1', '2', '3', '4'].map((n) => UR.level_labels[n]));
    opts.forEach((o, i) => expect(o.description).toBe(UR.indicators[code].levels[i]));
    opts.forEach((o) => { expect(cp(o.title)).toBeLessThanOrEqual(30); expect(cp(o.description)).toBeLessThanOrEqual(300); });
  });

  test('the Urdu draft covers every indicator (name, definition, four levels; coach_adds on the six) in Urdu digits', () => {
    for (const code of v6.CODES) {
      const u = UR.indicators[code];
      expect(u && u.name && u.definition).toBeTruthy();
      expect(u.levels).toHaveLength(4);
      if (v6.isCombined(code)) expect(u.coach_adds).toBeTruthy();
      for (const t of [u.name, u.definition, ...u.levels, u.coach_adds || '']) expect(t).not.toMatch(/[0-9٠-٩]/);
    }
  });

  test('every coach path uses them: optionsFor has no N/A or Couldn\'t tell on any of the 17', () => {
    for (const code of v6.CODES) {
      const ids = O6.optionsFor(code).map((o) => o.id);
      expect(ids).toEqual(['1', '2', '3', '4']);
    }
  });

  test('the DC keeps its own options: levelOptions still offers N/A and Couldn\'t tell', () => {
    expect(v6.levelOptions('C5').map((o) => o.id)).toContain('NA');
    expect(v6.levelOptions('C1', { couldntTell: true }).map((o) => o.id)).toContain('IE');
  });

  test('the coach stamp moves to coach-2, so reviews without N/A can be told apart', () => {
    expect(v6.COACH_PROMPT_VERSION).toMatch(/^fico17-v6-coach-2\+/);
  });
});

describe('the /observe v6 Flow JSON: 22 screens, one indicator each', () => {
  const ids = FLOW.screens.map((s) => s.id);
  const kidsOf = (s) => {
    const top = s.layout.children;
    return top.flatMap((c) => (c.type === 'Form' ? c.children : [c]));
  };

  test('B, then for each section an intro and one screen per indicator, then SUCCESS', () => {
    expect(ids).toHaveLength(22);
    expect(ids[0]).toBe('DOMAIN_B');
    expect(ids[ids.length - 1]).toBe('SUCCESS');
    expect(ids).toEqual(O6.SCREENS.concat('SUCCESS'));
    ids.forEach((id) => expect(id).toMatch(/^[A-Z_]+$/));
  });

  test('routing is a straight line forward', () => {
    for (let i = 0; i < ids.length - 1; i += 1) expect(FLOW.routing_model[ids[i]]).toEqual([ids[i + 1]]);
  });

  test('no screen offers N/A or Couldn\'t tell, and D2 has no count boxes', () => {
    const json = JSON.stringify(FLOW);
    expect(json).not.toMatch(/"id":\s*"(NA|IE)"/);
    expect(json).not.toMatch(/d2_children|d2_quiet_later/);
  });

  test('an indicator screen has exactly one level choice, its options sent by the server', () => {
    for (const code of v6.CODES) {
      const s = FLOW.screens.find((x) => x.id === O6.screenOf(code));
      const radios = kidsOf(s).filter((k) => k.type === 'RadioButtonsGroup');
      expect(radios).toHaveLength(1);
      expect(radios[0].name).toBe(`r_${code}`);
      expect(radios[0]['data-source']).toBe('${data.opts}');
      expect(cp(s.title)).toBeLessThanOrEqual(30);
      expect(kidsOf(s).length).toBeLessThanOrEqual(50);
    }
  });

  test('an intro screen has no input', () => {
    for (const l of ['C', 'D', 'F']) {
      const s = FLOW.screens.find((x) => x.id === `INTRO_${l}`);
      const inputs = kidsOf(s).filter((k) => /RadioButtonsGroup|TextArea|TextInput|Dropdown|CheckboxGroup/.test(k.type));
      expect(inputs).toHaveLength(0);
    }
  });
});

describe('the /observe v6 endpoint walks the 22 screens', () => {
  test('B → the Section C intro (no input), in the coach\'s language', async () => {
    const res = await post({ _screen: 'DOMAIN_B', v6f: O6.FORM_VERSION });
    expect(res.screen).toBe('INTRO_C');
    expect(res.data.heading).toContain('What the teacher does');
    expect(res.data.list).toContain('C1');
    expect(res.version).toBeUndefined();
  });

  test('intro → C1: Rumi\'s level pre-selected, the level names and sheet text as choices', async () => {
    const res = await post({ _screen: 'INTRO_C' });
    expect(res.screen).toBe('IND_C_ONE');
    expect(res.data.opts.map((o) => o.title)).toEqual(NAMES);
    expect(res.data.init.r_C1).toBe('2');
    expect(res.data.rumi_note).toMatch(/Developing/);
    expect(res.data.heading).toMatch(/^C1 · /);
  });

  test('Rumi had N/A (C2): nothing is pre-selected and the note says so', async () => {
    const res = await post({ _screen: 'IND_C_ONE', r_C1: '2' });
    expect(res.screen).toBe('IND_C_TWO');
    expect(res.data.init.r_C2).toBeUndefined();
    expect(res.data.rumi_note).toMatch(/could not set a level/i);
  });

  test('Rumi had Couldn\'t tell (D5): nothing is pre-selected', async () => {
    const res = await post({ _screen: 'IND_D_FOUR', r_D4: '2', why_D4: 'They answered only when they were sure.' });
    expect(res.screen).toBe('IND_D_FIVE');
    expect(res.data.init.r_D5).toBeUndefined();
  });

  test('a room indicator (C3) starts blank; a short reason keeps the coach there with the reason listed', async () => {
    let res = await post({ _screen: 'IND_C_TWO', r_C2: '3' });
    expect(res.screen).toBe('IND_C_THREE');
    expect(res.data.init.r_C3).toBeUndefined();
    expect(res.data.evidence).toContain('05:10');
    expect(res.data.coach_adds).toMatch(/^Coach adds:/);
    res = await post({ _screen: 'IND_C_THREE', r_C3: '3', why_C3: 'too short' });
    expect(res.screen).toBe('IND_C_THREE');
    expect(res.data.err_v).toBe(true);
    expect(res.data.err_note).toContain('Who got to answer');
    expect(res.data.init.r_C3).toBe('3');
    expect(res.data.init.why_C3).toBe('too short');
  });

  test('changing a level Rumi set needs a reason on that screen', async () => {
    let res = await post({ _screen: 'IND_C_ONE', r_C1: '4' });
    expect(res.screen).toBe('IND_C_ONE');
    expect(res.data.err_note).toMatch(/changed a level Rumi set/);
    res = await post({ _screen: 'IND_C_ONE', r_C1: '4', chg_C1: 'She asked why and followed it up.' });
    expect(res.screen).toBe('IND_C_TWO');
  });

  test('picking a level where Rumi had none needs no change reason', async () => {
    const res = await post({ _screen: 'IND_C_TWO', r_C2: '1' });
    expect(res.screen).toBe('IND_C_THREE');
  });

  test('D2: no counts asked; a level and a reason are enough', async () => {
    const res = await post({ _screen: 'IND_D_TWO', r_D2: '3', why_D2: 'Four children answered from the front rows.' });
    expect(res.screen).toBe('IND_D_THREE');
  });

  test('an Urdu coach gets the Urdu draft as screen data', async () => {
    mockLang = 'ur';
    const res = await post({ _screen: 'INTRO_C' });
    expect(res.data.opts.map((o) => o.title)).toEqual(['1', '2', '3', '4'].map((n) => UR.level_labels[n]));
    expect(res.data.definition).toBe(UR.indicators.C1.definition);
    expect(res.data.next_label).not.toBe('Next');
  });

  test('the last screen saves every level: coach-2 stamp, per-indicator change reasons, no D2 counts', async () => {
    const edits = {};
    for (const code of v6.CODES) {
      edits[`r_${code}`] = v6.isCombined(code) ? '3' : '2'; // Rumi's 2 kept
      if (v6.isCombined(code)) edits[`why_${code}`] = `What I saw in the room for ${code}.`;
    }
    edits.r_C1 = '3';
    edits.chg_C1 = 'She asked why and then followed it up.';
    edits.r_C2 = '3'; // Rumi had N/A: no reason needed
    edits.r_D5 = '1'; // Rumi had Couldn't tell
    for (const id of O6.SCREENS.slice(0, -1)) await post({ _screen: id, v6f: O6.FORM_VERSION, ...edits });
    const res = await post({ _screen: 'IND_F_FOUR', ...edits });
    expect(res.screen).toBe('SUCCESS');
    const written = mockUpdates.find((u) => u.analysis_data && u.status === 'observer_review_complete');
    const review = written.analysis_data.fico17_v6_review;
    expect(review.coach_prompt_version).toMatch(/^fico17-v6-coach-2\+/);
    expect(review.levels.C1).toMatchObject({ level: 3, set_by: 'coach', because: 'She asked why and then followed it up.' });
    expect(review.levels.C2).toMatchObject({ level: 3, set_by: 'coach', rumi_level: 'NA' });
    expect(review.levels.C3).toMatchObject({ level: 3, set_by: 'coach', prompt_version: v6.COACH_PROMPT_VERSION });
    expect(review.levels.D5).toMatchObject({ level: 1, set_by: 'coach', rumi_level: 'IE' });
    expect(review.levels.F1).toMatchObject({ level: 2, set_by: 'rumi' });
    expect(review.d2_counts).toBeNull();
    expect(Object.values(review.levels).every((l) => typeof l.level === 'number')).toBe(true);
  });
});

describe('a form opened on the old 5-screen Flow still goes through', () => {
  test('its Section B (no v6f marker) goes on to DOMAIN_C, the screen that Flow has', async () => {
    const res = await post({ _screen: 'DOMAIN_B' });
    expect(res.screen).toBe('DOMAIN_C');
  });

  test('the new Flow\'s Section B carries the marker', () => {
    const b = FLOW.screens.find((x) => x.id === 'DOMAIN_B');
    expect(JSON.stringify(b)).toContain(`"v6f":"${O6.FORM_VERSION}"`);
  });

  test('the old DOMAIN_C screen is still accepted and goes on to DOMAIN_D', async () => {
    const res = await post({
      _screen: 'DOMAIN_C', r_C1: '2', r_C2: '2', r_C4: '2', r_C6: '2', r_C8: '2',
      r_C3: '3', why_C3: 'Named Ali and Sara before asking.', r_C5: '2', why_C5: 'Signal given, took about three minutes.',
      r_C7: 'NA', why_C7: 'No group task in this lesson at all.',
    });
    expect(res.screen).toBe('DOMAIN_D');
  });
});

describe('old reviews with N/A or Couldn\'t tell still render', () => {
  test('a saved N/A keeps its option on the list, so the choice shows', () => {
    const opts = O6.optionsFor('C7', { keep: 'NA' }).map((o) => o.id);
    expect(opts).toEqual(['1', '2', '3', '4', 'NA']);
    const ie = O6.optionsFor('C1', { keep: 'IE' }).map((o) => o.id);
    expect(ie).toEqual(['1', '2', '3', '4', 'IE']);
  });
});

describe('the text the endpoint sends fits Meta\'s caps, in English and Urdu', () => {
  test.each(['en', 'ur'])('%s: labels ≤ 20 (text boxes) / 30 (choice), helpers ≤ 80, button ≤ 35, options ≤ 30 / 300', (lang) => {
    const analysis = v6Analysis();
    for (const id of O6.SCREENS.slice(1)) {
      const d = O6.screenData(analysis, id, { lang });
      expect(cp(d.next_label)).toBeLessThanOrEqual(35);
      if (O6.screenInfo(id).kind !== 'ind') continue;
      expect(cp(d.lbl_level)).toBeLessThanOrEqual(30);
      for (const k of ['lbl_ev', 'lbl_imp', 'lbl_chg', 'lbl_why']) if (d[k] !== undefined) expect(cp(d[k])).toBeLessThanOrEqual(20);
      for (const k of ['help_ev', 'help_imp', 'help_chg', 'help_why']) if (d[k] !== undefined) expect(cp(d[k])).toBeLessThanOrEqual(80);
      d.opts.forEach((o) => { expect(cp(o.title)).toBeLessThanOrEqual(30); expect(cp(o.description)).toBeLessThanOrEqual(300); });
      if (lang === 'ur') expect(d.progress).toMatch(/[۰-۹]/);
    }
  });
});
