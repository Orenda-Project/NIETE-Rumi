/**
 * The ✓/✗ list — versioned editing inside the review Flow.
 *
 * Her whole paper as one list: ＋ add and ✅ make at the top, every question
 * marked ✓ (on the paper) or ✗ (removed), 16 per page. Every edit, removal,
 * add-back and new question goes into a DRAFT held in the Flow session;
 * nothing is written to the database until "Make my paper" — so a save here
 * must never reach revision.createVersion or the old in-place saveEdit.
 *
 * Real endpoint, real revision reads, real flags; the database is an in-memory
 * PostgREST and Redis is an in-memory map.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));

const mockStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: async (k) => (mockStore.has(k) ? JSON.parse(mockStore.get(k)) : null),
  set: async (k, v) => { mockStore.set(k, JSON.stringify(v)); return true; },
  setNX: async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, JSON.stringify(v)); return true; },
  delete: async (k) => { mockStore.delete(k); return true; },
}));
const { makeFakeDb } = require('./helpers/fake-postgrest');
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (t) => mockDb.client.from(t) }));

const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');
const Revision = require('../../bot/shared/services/assessment/assessment-revision.service');
const Selection = require('../../bot/shared/services/assessment/assessment-selection');

const { handleAssessmentGenInit: init, handleAssessmentGenDataExchange: exchange, handleAssessmentGenBack: back } = Endpoint;
const U = 'user-1';
const TOKEN = `${U}:assessment-review:v1`;
const cp = (s) => [...String(s)].length;

// 50 questions: 20 MCQs, 20 short, 10 fill — the prod p90 / max.
function bigTree() {
  return {
    seen: {
      objective: {
        MCQs: Array.from({ length: 20 }, (_, i) => ({
          question: `Which planet is number ${i + 1} in this long list of questions?`,
          options: ['A) Mars', 'B) Venus', 'C) Earth', 'D) Jupiter'], answer: 'C) Earth', marks: 1, lines: 0,
        })),
        'Fill in the Blanks': Array.from({ length: 10 }, (_, i) => ({ question: `Blank ${i + 1} ____.`, answer: 'x', marks: 1 })),
      },
      subjective: {
        'Short Questions': Array.from({ length: 20 }, (_, i) => ({ question: `Why does rain ${i + 1} fall?`, answer: 'Gravity.', marks: 2, lines: 4 })),
      },
    },
  };
}
const URDU_TREE = {
  unseen: { objective: { MCQs: [
    { question: 'قائداعظم محمد علی جناح کس شہر میں پیدا ہوئے تھے؟ درست جواب منتخب کریں', options: ['الف) کراچی', 'ب) لاہور'], answer: 'الف) کراچی', marks: 1 },
    { question: 'پاکستان کا قومی پھول کون سا ہے؟', options: ['الف) چنبیلی', 'ب) گلاب'], answer: 'الف) چنبیلی', marks: 1 },
  ] } },
};

function seed({ tree = bigTree(), lang = 'en', subject = 'science', versions = true } = {}) {
  mockStore.clear();
  mockDb = makeFakeDb({
    assessment_requests: [{ id: 'r1', user_id: U, grade_code: 'grade_4', subject_code: subject, chapter_number: null,
      page_ranges: '4-9', output_format: 'pdf', has_answer_lines: true, textbook_id: 't1' }],
    assessment_papers: [{ id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: tree,
      created_at: '2026-09-30T09:00:00.000Z', file_r2_key: 'exams/u/v1/p.pdf', answer_key_r2_key: 'exams/u/v1/k.pdf' }],
    users: [{ id: U, preferred_language: lang, phone_number: '923000000000' }],
    app_settings: [
      { key: 'assessment_versions_enabled', value: versions },
      { key: 'assessment_editing_enabled', value: true },
    ],
  });
}

let createSpy;
let saveEditSpy;
beforeEach(() => {
  seed();
  createSpy = jest.spyOn(Revision, 'createVersion').mockResolvedValue({ status: 'ready' });
  saveEditSpy = jest.spyOn(Revision, 'saveEdit');
});
afterEach(() => jest.restoreAllMocks());

const rowIds = (res) => res.data.rows.map((r) => r.id);
const rowFor = (res, text) => res.data.rows.find((r) => r['main-content'].title.includes(text));
const tap = (screenId, row) => exchange(U, screenId, row['on-click-action'].payload, TOKEN);
const paperWrites = () => mockDb.writes.filter((w) => w.table === 'assessment_papers');

describe('INIT opens the list', () => {
  // Operator copy, 30 Sep (final order): question rows → "➕ Add a question" →
  // "⬅️ Previous" → "More questions ➡️" → "📄 Make my paper" LAST. The status
  // emoji rides at the END of a question row ("1. Amna is Happy - ✅").
  test('a 50-question paper: 16 questions, add, next, make — 19 rows, make last', async () => {
    const res = await init(U, TOKEN);
    expect(res.screen).toBe('LIST');
    expect(rowIds(res)).toEqual([...Array.from({ length: 16 }, (_, i) => `q${i}`), 'add', 'next', 'done']);
    expect(res.data.rows[18]['main-content']).toMatchObject({ title: '📄 Make my paper', description: '50 Qs · 70 marks' });
    expect(res.data.rows[16]['main-content'].title).toBe('➕ Add a question');
    expect(res.data.rows[17]['main-content'].title).toBe('More questions ➡️');
    expect(res.data.rows[0]['main-content'].title).toMatch(/^1\. Which planet.* - ✅$/);
  });

  test('a middle page: questions, add, previous, next, make', async () => {
    let res = await init(U, TOKEN);
    res = await tap('LIST', res.data.rows.find((r) => r.id === 'next'));
    expect(rowIds(res)).toEqual([...Array.from({ length: 16 }, (_, i) => `q${16 + i}`), 'add', 'prev', 'next', 'done']);
    expect(res.data.rows.find((r) => r.id === 'prev')['main-content'].title).toBe('⬅️ Previous');
  });

  test('a long question is cut at a word — the " - ✅" / " - ❌" never is', async () => {
    const res = await init(U, TOKEN);
    for (const r of res.data.rows.filter((x) => /^q\d+$/.test(x.id))) {
      const t = r['main-content'].title;
      expect(t.endsWith(' - ✅') || t.endsWith(' - ❌')).toBe(true);
      expect(cp(t)).toBeLessThanOrEqual(20);
      const body = t.replace(/^\S+\s/, '').replace(/ - [✅❌]$/, '');
      expect(body.length).toBeGreaterThan(0);
      expect(body.endsWith(' ')).toBe(false);
      const words = body.split(' ');
      const source = /^Which/.test(body) ? r : null;
      if (source) expect('Which planet is number 1 in this long list of questions?'.split(' ')).toEqual(expect.arrayContaining(words));
    }
  });

  test('every title and description fits 20 code points — English and Urdu', async () => {
    for (const [tree, lang, subject] of [[bigTree(), 'en', 'science'], [URDU_TREE, 'ur', 'urdu']]) {
      seed({ tree, lang, subject });
      const res = await init(U, TOKEN);
      for (const r of res.data.rows) {
        expect(cp(r['main-content'].title)).toBeLessThanOrEqual(20);
        expect(cp(r['main-content'].description)).toBeLessThanOrEqual(20);
        expect(cp(r['main-content'].title.replace(/^[✓✗]\s*\d*\.?\s*/, ''))).toBeGreaterThan(2);
      }
    }
    const res = await init(U, TOKEN);
    expect(res.data.rows.some((r) => /[؀-ۿ]/.test(r['main-content'].title))).toBe(true);
    // the Urdu question rows keep their suffix too
    for (const r of res.data.rows.filter((x) => /^q\d+$/.test(x.id))) expect(r['main-content'].title).toMatch(/ - ✅$/);
  });

  test('pages through all 50 questions, 16 at a time, with previous and next', async () => {
    let res = await init(U, TOKEN);
    const seen = [];
    for (let p = 0; p < 4; p += 1) {
      seen.push(...res.data.rows.filter((r) => /^q\d+$/.test(r.id)).map((r) => r['main-content'].title));
      if (p > 0) expect(rowIds(res)).toContain('prev');
      const next = res.data.rows.find((r) => r.id === 'next');
      if (p < 3) res = await tap('LIST', next);
      else expect(next).toBeUndefined();
    }
    expect(seen).toHaveLength(50);
    expect(res.screen).toBe('LIST');
  });

  test('someone else\'s paper does not open', async () => {
    const res = await init('intruder', 'intruder:assessment-review:v1');
    expect(res.screen).toBe('LIST');
    expect(rowIds(res)).toEqual(['msg']);
  });

  test('with the versions flag OFF the old KEEP screen opens', async () => {
    seed({ versions: false });
    const res = await init(U, TOKEN);
    expect(res.screen).toBe('KEEP');
  });
});

describe('editing a question', () => {
  test('✓ opens its shape\'s screen pre-filled with the answer and the correct option', async () => {
    const list = await init(U, TOKEN);
    const edit = await tap('LIST', rowFor(list, '1. Which planet'));
    expect(edit.screen).toBe('EDIT_OPTIONS');
    expect(edit.data.correct).toBe('2');
    expect(edit.data.show_correct).toBe(true);
    expect(edit.data.show_remove).toBe(true);
  });

  test('a written question carries its answer and lines', async () => {
    let list = await init(U, TOKEN);
    list = await tap('LIST', list.data.rows.find((r) => r.id === 'next'));
    const row = list.data.rows.find((r) => /Short Questions/.test(r['on-click-action'].payload.question_id || ''));
    const edit = await tap('LIST', row);
    expect(edit.screen).toBe('EDIT_STANDARD');
    expect(edit.data).toMatchObject({ answer: 'Gravity.', lines: '4', show_lines: true });
  });

  test('save writes the SESSION only — no version, no in-place edit, no row touched', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, '1. Which planet'));
    const after = await exchange(U, 'EDIT_OPTIONS', {
      _action: 'save', question: 'Which planet is ours?', marks: '3', correct: '2',
      slot_0: 'A) Mars', slot_1: 'B) Venus', slot_2: 'C) Earth', slot_3: 'D) Jupiter', slot_4: '', slot_5: '', answer: '', remove: false,
    }, TOKEN);
    expect(after.screen).toBe('LIST_MORE');
    expect(after.data.rows[0]['main-content'].description).toMatch(/^3 marks/);
    expect(createSpy).not.toHaveBeenCalled();
    expect(saveEditSpy).not.toHaveBeenCalled();
    expect(paperWrites()).toEqual([]);
    // the hidden answer box of an MCQ is not read as "clear the answer"
    const state = [...mockStore.values()].map((v) => JSON.parse(v)).find((s) => s.kind === 'versions');
    expect(state.draft.seen.objective.MCQs[0].answer).toBe('C) Earth');
  });

  test('a second and third edit in one opening, from LIST_MORE', async () => {
    let list = await init(U, TOKEN);
    for (const n of ['1.', '2.', '3.']) {
      const row = list.data.rows.find((r) => r['main-content'].title.startsWith(`${n} `));
      const edit = await tap(list.screen, row);
      expect(edit.screen).toBe('EDIT_OPTIONS');
      list = await exchange(U, 'EDIT_OPTIONS', { _action: 'save', marks: '2', correct: '2',
        slot_0: 'A) Mars', slot_1: 'B) Venus', slot_2: 'C) Earth', slot_3: 'D) Jupiter', slot_4: '', slot_5: '' }, TOKEN);
      expect(list.screen).toBe('LIST_MORE');
    }
    expect(list.data.rows.find((r) => r.id === 'done')['main-content'].description).toBe('50 Qs · 73 marks');
  });

  test('the remove box takes it off: the row shows ✗, and tapping it opens REMOVED', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, '1. Which planet'));
    const after = await exchange(U, 'EDIT_OPTIONS', { _action: 'save', remove: true, correct: '2',
      slot_0: 'A) Mars', slot_1: 'B) Venus', slot_2: 'C) Earth', slot_3: 'D) Jupiter', slot_4: '', slot_5: '' }, TOKEN);
    const x = after.data.rows.find((r) => r['main-content'].title.endsWith(' - ❌'));
    expect(x['main-content'].title).toMatch(/^–\. /);
    expect(x['main-content'].description).toMatch(/^removed/);
    expect(after.data.rows.find((r) => r.id === 'done')['main-content'].description).toBe('49 Qs · 69 marks');
    const removed = await tap('LIST_MORE', x);
    expect(removed.screen).toBe('REMOVED');
    const restored = await exchange(U, 'REMOVED', { _action: 'restore' }, TOKEN);
    expect(restored.screen).toBe('LIST_MORE');
    expect(restored.data.rows[0]['main-content'].title).toMatch(/^1\. .* - ✅$/);
  });

  test('a refused edit comes back to the same screen with her typing and the reason', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, '1. Which planet'));
    const res = await exchange(U, 'EDIT_OPTIONS', { _action: 'save', correct: '5',
      slot_0: 'A) Mars', slot_1: 'B) Venus', slot_2: 'C) Earth', slot_3: 'D) Jupiter', slot_4: '', slot_5: '' }, TOKEN);
    expect(res.screen).toBe('EDIT_OPTIONS');
    expect(res.data.error).toBe('The option you marked correct is empty.');
    expect(res.data.has_error).toBe(true);
  });
});

describe('adding a question', () => {
  test('an MCQ without a correct option is refused; with one it joins the list', async () => {
    const list = await init(U, TOKEN);
    const types = await tap('LIST', list.data.rows.find((r) => r.id === 'add'));
    expect(types.screen).toBe('ADD_TYPE');
    const form = await exchange(U, 'ADD_TYPE', { _action: 'add_type', kind: 'mcq' }, TOKEN);
    expect(form.screen).toBe('EDIT_OPTIONS');
    expect(form.data.show_remove).toBe(false);
    const MCQ = { _action: 'save', question: 'Closest star?', marks: '', slot_0: 'A) Sun', slot_1: 'B) Moon', slot_2: '', slot_3: '', slot_4: '', slot_5: '' };
    const refused = await exchange(U, 'EDIT_OPTIONS', { ...MCQ, correct: 'none' }, TOKEN);
    expect(refused.screen).toBe('EDIT_OPTIONS');
    expect(refused.data.has_error).toBe(true);
    const ok = await exchange(U, 'EDIT_OPTIONS', { ...MCQ, correct: '0' }, TOKEN);
    expect(ok.screen).toBe('LIST_MORE');
    expect(ok.data.rows.find((r) => r.id === 'done')['main-content'].description).toBe('51 Qs · 71 marks');
    // An added MCQ joins the paper's MCQs, so it prints (and lists) as 21.
    expect(ok.data.rows.some((r) => /^21\. Closest - ✅$/.test(r['main-content'].title))).toBe(true);
    expect(ok.data.rows).toHaveLength(20); // a middle page: 16 + add + previous + next + make
    expect(paperWrites()).toEqual([]);
  });

  test('an unknown kind stays on ADD_TYPE with a reason', async () => {
    await init(U, TOKEN);
    const res = await exchange(U, 'ADD_TYPE', { _action: 'add_type', kind: '' }, TOKEN);
    expect(res.screen).toBe('ADD_TYPE');
    expect(res.data.has_error).toBe(true);
  });
});

describe('DONE — the real button', () => {
  test('summarises the changes and carries the completion payload', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, '1. Which planet'));
    const after = await exchange(U, 'EDIT_OPTIONS', { _action: 'save', remove: true, correct: '2',
      slot_0: 'A) Mars', slot_1: 'B) Venus', slot_2: 'C) Earth', slot_3: 'D) Jupiter', slot_4: '', slot_5: '' }, TOKEN);
    const done = await tap('LIST_MORE', after.data.rows.find((r) => r.id === 'done'));
    expect(done.screen).toBe('DONE');
    expect(done.data).toMatchObject({ summary: '49 questions · 69 marks', changes: '1 removed', can_make: true });
    expect(done.data.note).toMatch(/version 1/);
    // No object-valued data on DONE: reached from a NavigationList row, Meta's
    // client refused it with "Data Validation Error: Required
    // [key=data.extension_message_response]" (preview, 30 Sep). The completion
    // is routed by the flow token, which Meta always returns.
    expect('extension_message_response' in done.data).toBe(false);
  });

  test('with 0 questions left the button is disabled and says why', async () => {
    const tiny = { seen: { objective: { MCQs: [{ question: 'Only one?', options: ['A) y', 'B) n'], answer: 'A) y', marks: 1 }] } } };
    seed({ tree: tiny });
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, 'Only one'));
    const after = await exchange(U, 'EDIT_OPTIONS', { _action: 'save', remove: true, correct: '0', slot_0: 'A) y', slot_1: 'B) n', slot_2: '', slot_3: '', slot_4: '', slot_5: '' }, TOKEN);
    const done = await tap('LIST_MORE', after.data.rows.find((r) => r.id === 'done'));
    expect(done.data.can_make).toBe(false);
    expect(done.data.has_error).toBe(true);
  });
});

describe('the session', () => {
  test('closing and reopening within the session resumes her draft', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, '1. Which planet'));
    await exchange(U, 'EDIT_OPTIONS', { _action: 'save', marks: '9', correct: '2',
      slot_0: 'A) Mars', slot_1: 'B) Venus', slot_2: 'C) Earth', slot_3: 'D) Jupiter', slot_4: '', slot_5: '' }, TOKEN);
    const again = await init(U, TOKEN);
    expect(again.screen).toBe('LIST');
    expect(again.data.rows[0]['main-content'].description).toMatch(/^9 marks/);
  });

  test('back from an edit screen refreshes the list she came from', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', rowFor(list, '1. Which planet'));
    const res = await back(U, 'EDIT_OPTIONS', TOKEN);
    expect(res.screen).toBe('LIST');
    expect(rowIds(res)).toContain('done');
  });

  test('back from DONE returns to the list', async () => {
    const list = await init(U, TOKEN);
    await tap('LIST', list.data.rows.find((r) => r.id === 'done'));
    const res = await back(U, 'DONE', TOKEN);
    expect(res.screen).toBe('LIST');
  });
});
