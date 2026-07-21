/**
 * FEAT-092 — bd-2246 (grade→subject) + bd-2247 (PICK_TYPES / SET_COUNTS split).
 *
 * Both were asked for repeatedly by Umama and Alishba; the split was asked four
 * times and was a fix we proposed ourselves on 18 July.
 *
 * bd-2247: QUESTION_TYPES carried the checkbox list AND ~34 count inputs (one per
 * possible type), so ticking 3 types left the 3 fields you needed buried among 30
 * you didn't. Now: PICK_TYPES (checkboxes only) → SET_COUNTS (count fields for
 * exactly the picked types, in pick order).
 *
 * bd-2246: the subject dropdown showed every subject for every grade. Grades 1-3
 * and 4-5 teach different sets AND name shared subjects differently.
 */

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

// Mocks mirror the existing assessment-gen-endpoint suite so both run the same way.
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    get: jest.fn(async (k) => store.get(k) || null),
    set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
    delete: jest.fn(async (k) => { store.delete(k); return true; }),
    _reset: () => store.clear(),
  };
});
jest.mock('../../bot/shared/services/assessment-generator-client.service', () => ({
  submitJob: jest.fn(async () => ({ ok: true, jobId: 'job-1' })),
  isConfigured: jest.fn(() => true),
}));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/config/supabase', () => {
  const single = jest.fn(async () => ({ data: { phone_number: '923001234567' }, error: null }));
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { from };
});

const redis = require('../../bot/shared/services/cache/railway-redis.service');
const endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const handle = endpoint.handleAssessmentGenDataExchange;

const TOKEN = 'tok-split-1';
const USER = 'user-1';

async function specSubmit(overrides = {}) {
  return handle(USER, 'SPEC', {
    _action: 'spec_submit',
    generation_type: 'exam',
    grade: '4',
    subject: 'Eng',
    page_ranges: '10-15',
    output_format: 'pdf',
    ...overrides,
  }, TOKEN);
}

beforeEach(() => { redis._reset(); jest.clearAllMocks(); });

describe('bd-2246 — subjects depend on the grade', () => {
  test('Grades 1-3 offer the primary set, with the primary names', async () => {
    const res = await handle(USER, 'SPEC', { _action: 'grade_changed', grade: '2' }, TOKEN);
    expect(res.screen).toBe('SPEC');
    const titles = res.data.subject_options.map((s) => s.title);
    expect(titles).toEqual([
      'English', 'Urdu', 'Maths', 'Islamiyat', 'General Knowledge (Waqfiyat-e-Aama)',
    ]);
    expect(titles).not.toContain('Social Studies');
    expect(titles).not.toContain('General Science');
  });

  test('Grades 4-5 offer the middle set — note "Mathematics", not "Maths"', async () => {
    const res = await handle(USER, 'SPEC', { _action: 'grade_changed', grade: '5' }, TOKEN);
    const titles = res.data.subject_options.map((s) => s.title);
    expect(titles).toEqual([
      'English', 'Mathematics', 'Urdu', 'Islamiyat', 'Social Studies', 'General Science',
    ]);
    expect(titles).not.toContain('General Knowledge (Waqfiyat-e-Aama)');
  });

  test('ids stay stable across grades so generation is unaffected by relabelling', async () => {
    const g2 = await handle(USER, 'SPEC', { _action: 'grade_changed', grade: '2' }, TOKEN);
    const g5 = await handle(USER, 'SPEC', { _action: 'grade_changed', grade: '5' }, TOKEN);
    const maths2 = g2.data.subject_options.find((s) => s.title === 'Maths');
    const maths5 = g5.data.subject_options.find((s) => s.title === 'Mathematics');
    expect(maths2.id).toBe('Maths');
    expect(maths5.id).toBe(maths2.id);
  });

  test('server REJECTS a subject the grade does not teach (not frontend-only)', async () => {
    // Social Studies is grade 4-5 only. Claim grade 2 + SST, as a replayed
    // payload would: we must land back on SPEC, not proceed to SEEN_UNSEEN.
    const res = await specSubmit({ grade: '2', subject: 'SST' });
    expect(res.screen).toBe('SPEC');
    expect(res.data.subject_options.map((s) => s.id)).not.toContain('SST');
  });

  test('a valid grade+subject pair still proceeds', async () => {
    const res = await specSubmit({ grade: '2', subject: 'Urdu' });
    expect(res.screen).toBe('SEEN_UNSEEN');
  });
});

describe('bd-2247 — PICK_TYPES → SET_COUNTS', () => {
  async function reachPickTypes() {
    await specSubmit();
    await handle(USER, 'SEEN_UNSEEN', { _action: 'pick_source', source: 'unseen' }, TOKEN);
    return handle(USER, 'OBJ_SUBJ', { _action: 'pick_category', categories: ['objective'] }, TOKEN);
  }

  test('the picker screen is PICK_TYPES and carries no count fields', async () => {
    const res = await reachPickTypes();
    expect(res.screen).toBe('PICK_TYPES');
    expect(Object.keys(res.data)).not.toContain('default_count');
    expect(res.data.type_options.length).toBeGreaterThan(0);
  });

  test('picking types hands over to SET_COUNTS with a slot per picked type, in pick order', async () => {
    const pick = await reachPickTypes();
    const ids = pick.data.type_options.slice(0, 3).map((t) => t.id);
    const res = await handle(USER, 'PICK_TYPES', { _action: 'pick_types', question_types: ids }, TOKEN);

    expect(res.screen).toBe('SET_COUNTS');
    // Exactly the picked types are shown, labelled and in the order ticked.
    expect(res.data.show_1).toBe(true);
    expect(res.data.show_2).toBe(true);
    expect(res.data.show_3).toBe(true);
    expect(res.data.label_1).toBe(`${ids[0]} — how many?`);
    expect(res.data.label_3).toBe(`${ids[2]} — how many?`);
    // ...and nothing else is. This is the whole complaint: no stack of
    // irrelevant fields to scroll past.
    expect(res.data.show_4).toBe(false);
    expect(res.data.label_4).toBe('');
    expect(res.data.show_10).toBe(false);
  });

  test('counts submit positionally and map back to the right type', async () => {
    const pick = await reachPickTypes();
    const ids = pick.data.type_options.slice(0, 2).map((t) => t.id);
    await handle(USER, 'PICK_TYPES', { _action: 'pick_types', question_types: ids }, TOKEN);
    const res = await handle(USER, 'SET_COUNTS', {
      _action: 'generate', count_1: '7', count_2: '4',
    }, TOKEN);
    expect(res.screen).toBe('SUCCESS');
  });

  test('picking nothing re-renders the picker rather than advancing', async () => {
    await reachPickTypes();
    const res = await handle(USER, 'PICK_TYPES', { _action: 'pick_types', question_types: [] }, TOKEN);
    expect(res.screen).toBe('PICK_TYPES');
  });

  test('picks are capped at the number of count slots that exist', async () => {
    const pick = await reachPickTypes();
    const many = pick.data.type_options.map((t) => t.id);
    if (many.length > 10) {
      const res = await handle(USER, 'PICK_TYPES', { _action: 'pick_types', question_types: many }, TOKEN);
      expect(res.screen).toBe('SET_COUNTS');
      expect(res.data.show_10).toBe(true);
      // no 11th slot exists to overflow into
      expect(res.data.show_11).toBeUndefined();
    }
  });
});
