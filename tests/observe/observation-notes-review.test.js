'use strict';
/**
 * bd-ra8xu.60 — Observation Notes on the v6 review (WhatsApp review Flow, its endpoint, the review submit).
 *
 * 1. The coach's notes sit at the top of every section intro (INTRO_C / D / F), word for word. Meta refuses screen
 *    data a published Flow does not declare, so the notes keys are served ONLY to a Flow that says it declares them:
 *    its Section B posts v6n = NOTES_FORM, which the endpoint keeps with the coach's buffered answers. A form opened
 *    on the Flow published before this change gets exactly today's intro data.
 * 2. Opening the review (INIT) stamps analysis_data.observation_notes_review_opened_at once, while the switch is on, so
 *    a note saved after it is flagged typed_before_review false.
 * 3. The review submit replaces analysis_data whole; notes saved while the form was open are carried from a fresh read.
 * Supabase and Redis are mocked at the network boundary; the endpoint, the v6 module and the draft service run for real.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
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
let mockFreshAnalysis = null; // what a later read of analysis_data sees (a write landed in between)
const mockUpdates = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn(() => {
    let cols = '';
    const chain = {
      select: jest.fn((c) => { cols = String(c || ''); return chain; }),
      eq: jest.fn(() => chain),
      is: jest.fn(() => chain),
      in: jest.fn(() => chain),
      not: jest.fn(() => chain),
      then: (res, rej) => Promise.resolve({ data: [{ id: 'sess-6' }], error: null }).then(res, rej),
      maybeSingle: jest.fn(() => Promise.resolve({
        data: cols.startsWith('analysis_data') ? { analysis_data: mockFreshAnalysis || mockSessionRow.analysis_data, updated_at: 'u0' } : null,
        error: null,
      })),
      single: jest.fn(() => Promise.resolve({
        data: cols === 'analysis_data'
          ? { analysis_data: mockFreshAnalysis || mockSessionRow.analysis_data }
          : { ...mockSessionRow, users: { name: 'C', phone_number: '1' } },
        error: null,
      })),
      update: jest.fn((patch) => {
        mockUpdates.push(patch);
        if (patch && patch.analysis_data) mockSessionRow = { ...mockSessionRow, analysis_data: patch.analysis_data };
        return chain;
      }),
    };
    return chain;
  }),
}));

let mockLang = 'en';
jest.mock('../../bot/shared/services/observe/observe-language', () => ({ languageFor: jest.fn(async () => mockLang) }));
let mockSwitchOn = true;
jest.mock('../../bot/shared/services/observe/observation-notes-switch', () => ({ isOn: jest.fn(async () => mockSwitchOn) }));

require('../../bot/shared/services/coaching/frameworks/fico17-v6/late-write').timing.sleep = () => Promise.resolve();

const fs = require('fs');
const path = require('path');
const redis = require('../../bot/shared/services/cache/railway-redis.service');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const ObserveV6 = require('../../bot/shared/services/observe/observe-fico17-v6');
const ObserveDraft = require('../../bot/shared/services/observe/observe-draft.service');
const { handleObserveMewakaRequest } = require('../../bot/shared/routes/observe-mewaka-endpoint');

const TOKEN = 'co-1:sess-6';
const NOTES = [
  { id: 'n1', text: 'Board work: 5 children solved sums with steps', rec_time: '12:40', typed_before_review: true },
  { id: 'n2', text: 'Back two rows silent all lesson', rec_time: null, typed_before_review: true },
];

function v6Analysis(extra = {}) {
  const levels = {};
  v6.DC_CODES.forEach((c) => { levels[c] = { result: 2, because: `Rumi heard ${c}`, evidence: [{ time: '03:10', quote: 'Why is that?' }] }; });
  const domains = {};
  Object.values(v6.SECTIONS).forEach((s) => {
    domains[s.domain] = { indicators: s.codes.map((c) => ({ id: c, score: v6.isDc(c) ? 2 : null, result: v6.isDc(c) ? 2 : null })) };
  });
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234', levels, domains,
    combined_evidence: { C3: { result: null, items: [] }, D2: { student_turns_first_half: 30, student_turns_second_half: 12 } },
    ...extra,
  };
}

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
  jest.clearAllMocks();
  redis.__store.clear();
  mockUpdates.length = 0;
  mockFreshAnalysis = null;
  mockLang = 'en';
  mockSwitchOn = true;
  mockSessionRow = {
    id: 'sess-6', user_id: 't-1', observer_user_id: 'co-1', status: 'awaiting_observer_review',
    observation_type: 'leader_observation', framework: 'fico17_v6', analysis_data: v6Analysis({ observation_notes: NOTES }),
  };
});

describe('the section intro (screenData)', () => {
  test('a Flow that declares the notes gets them, word for word, under a heading', () => {
    const d = ObserveV6.screenData(mockSessionRow.analysis_data, 'INTRO_C', { lang: 'en', edits: { v6n: ObserveV6.NOTES_FORM } });
    expect(d.notes_v).toBe(true);
    expect(d.notes_heading).toBe('📝 Your Observation Notes');
    expect(d.notes).toBe('12:40  Board work: 5 children solved sums with steps\nBack two rows silent all lesson');
    // The rest of the intro is today's.
    expect(d.heading).toMatch(/^Section C/);
  });

  test('the same Flow with no notes: the keys are there (Meta needs every declared key), hidden', () => {
    const d = ObserveV6.screenData(v6Analysis(), 'INTRO_D', { lang: 'en', edits: { v6n: ObserveV6.NOTES_FORM } });
    expect(d).toMatchObject({ notes_v: false, notes: '' });
    expect(typeof d.notes_heading).toBe('string');
  });

  test('a form on the Flow published before this change gets exactly today\'s intro data', () => {
    const before = ObserveV6.screenData(v6Analysis(), 'INTRO_C', { lang: 'en', edits: {} });
    const withNotes = ObserveV6.screenData(mockSessionRow.analysis_data, 'INTRO_C', { lang: 'en', edits: {} });
    expect(withNotes).toEqual(before);
    expect(Object.keys(withNotes)).not.toContain('notes');
  });

  test('in Urdu: the heading in Urdu, the clock in Urdu digits, the note as typed', () => {
    const d = ObserveV6.screenData(mockSessionRow.analysis_data, 'INTRO_F', { lang: 'ur', edits: { v6n: ObserveV6.NOTES_FORM } });
    expect(d.notes_heading).toBe('📝 آپ کے مشاہدے کے نوٹس');
    expect(d.notes.split('\n')[0]).toBe('⁦۱۲:۴۰⁩  Board work: 5 children solved sums with steps');
  });

  test('an indicator screen never carries the notes keys', () => {
    const d = ObserveV6.screenData(mockSessionRow.analysis_data, 'IND_C_ONE', { lang: 'en', edits: { v6n: ObserveV6.NOTES_FORM } });
    expect(d.notes).toBeUndefined();
  });
});

describe('the review endpoint', () => {
  test('Section B of the notes Flow posts v6n: the next intro has the notes, and so does Back to it', async () => {
    const res = await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN, screen: 'DOMAIN_B',
      data: { _screen: 'DOMAIN_B', v6f: ObserveV6.FORM_VERSION, v6n: ObserveV6.NOTES_FORM },
    });
    expect(res.screen).toBe('INTRO_C');
    expect(res.data.notes_v).toBe(true);
    expect(res.data.notes).toContain('Board work');
    const back = await handleObserveMewakaRequest({ action: 'BACK', flow_token: TOKEN, screen: 'INTRO_C', data: {} });
    expect(back.data.notes_v).toBe(true);
  });

  test('Section B of the old Flow (no v6n): the intro is today\'s, no notes keys', async () => {
    const res = await handleObserveMewakaRequest({
      action: 'data_exchange', flow_token: TOKEN, screen: 'DOMAIN_B',
      data: { _screen: 'DOMAIN_B', v6f: ObserveV6.FORM_VERSION },
    });
    expect(res.screen).toBe('INTRO_C');
    expect(Object.keys(res.data)).not.toContain('notes');
    expect(Object.keys(res.data)).not.toContain('notes_v');
  });

  test('INIT stamps the first opening of the review while the switch is on', async () => {
    mockSessionRow.analysis_data = v6Analysis();
    const res = await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN, data: {} });
    expect(res.screen).toBe('DOMAIN_B');
    await flush();
    const stamped = mockUpdates.filter((p) => p.analysis_data && p.analysis_data.observation_notes_review_opened_at);
    expect(stamped).toHaveLength(1);
    // Only that key is added: the rest of the analysis is as it was.
    expect(stamped[0].analysis_data.levels).toEqual(mockSessionRow.analysis_data.levels);
  });

  test('INIT with the switch off writes nothing', async () => {
    mockSwitchOn = false;
    await handleObserveMewakaRequest({ action: 'INIT', flow_token: TOKEN, data: {} });
    await flush();
    expect(mockUpdates).toHaveLength(0);
  });
});

describe('the review submit', () => {
  test('notes saved while the form was open are carried over from a fresh read', async () => {
    mockSessionRow.analysis_data = v6Analysis();
    mockFreshAnalysis = v6Analysis({
      observation_notes: NOTES,
      observation_notes_review_opened_at: '2026-11-20T10:56:00.000Z',
      dc_informed: { status: 'ok', prompt_version: 'fico17-v6-dc-notes-1+abcd' },
    });
    await ObserveDraft.applyObserverEdits('sess-6', {});
    const write = mockUpdates.find((p) => p.status === 'observer_review_complete');
    expect(write).toBeTruthy();
    expect(write.analysis_data.observation_notes).toEqual(NOTES);
    expect(write.analysis_data.observation_notes_review_opened_at).toBe('2026-11-20T10:56:00.000Z');
    expect(write.analysis_data.dc_informed).toEqual({ status: 'ok', prompt_version: 'fico17-v6-dc-notes-1+abcd' });
  });
});

describe('the published review Flow JSON', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bot/docs/flows/observe-fico17_v6-flow.json'), 'utf8'));
  const screen = (id) => flow.screens.find((s) => s.id === id);

  test('every intro declares the notes and shows them only when there are some', () => {
    for (const l of ['C', 'D', 'F']) {
      const s = screen(`INTRO_${l}`);
      expect(Object.keys(s.data)).toEqual(expect.arrayContaining(['notes_v', 'notes_heading', 'notes']));
      const shown = s.layout.children.filter((c) => c.visible === '${data.notes_v}');
      expect(shown.map((c) => c.text)).toEqual(['${data.notes_heading}', '${data.notes}']);
    }
  });

  test('Section B says the Flow declares the notes (v6n)', () => {
    expect(ObserveV6.NOTES_FORM).toBe('1');
    const footer = screen('DOMAIN_B').layout.children.flatMap((c) => (c.children || [c])).find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.v6n).toBe(ObserveV6.NOTES_FORM);
  });
});
