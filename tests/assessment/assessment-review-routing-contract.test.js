/**
 * Every screen the endpoint returns must be one the CLIENT will move to.
 *
 * On a phone (sandbox, 30 Sep 2026) "＋ Add question" on LIST_MORE returned
 * ADD_TYPE and the teacher got "Something went wrong". Meta's interactive
 * preview names the rule it applied:
 *
 *   "Can't perform a transition from [LIST_MORE] to [ADD_TYPE], because it
 *    doesn't satisfy provided routing_model."
 *
 * while LIST_MORE → EDIT_STANDARD, equally undeclared, worked. Measured in the
 * preview against the live endpoint: a runtime move A → B is accepted when
 * routing_model declares A → B, OR declares B → A (the client treats it as a
 * step back), OR B is A (a refresh). Anything else is refused. Declaring the
 * reverse of a declared route is itself refused by the validator ("Backward
 * route … is not allowed"), which is why LIST_MORE cannot simply list EDIT_*.
 *
 * So this suite drives the REAL handlers through every action a review screen
 * can send and checks each (from → to) against that rule and the published
 * JSON — the pairing that no screen-by-screen test ever looked at.
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

const fs = require('fs');
const path = require('path');
const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');

const FLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/flows/assessment-review-flow.json'), 'utf8'));
const RM = FLOW.routing_model;
const allowed = (from, to) => from === to || (RM[from] || []).includes(to) || (RM[to] || []).includes(from);

const U = 'user-1';
const TOKEN = `${U}:assessment-review:v1`;
// One question of every shape, plus a removed one — so every edit screen is reachable.
const TREE = {
  seen: {
    objective: {
      MCQs: [{ question: 'پانی کس حالت میں؟', options: ['A) a', 'B) b'], answer: 'A) a', marks: 1 }],
      'Match the Column': [{ question: 'Match.', column_a: ['x'], column_b: ['y'], marks: 2 }],
      'Word Meanings': [{ question: 'Meanings.', words: ['arid'], marks: 1 }],
      'True/False': [{ question: 'Removed one.', answer: 'True', marks: 1, removed: true }],
    },
    subjective: {
      'Short Questions': [{ question: 'Why?', answer: 'Because.', marks: 2, lines: 4 }],
      Listening: [{ section: 'Listening', passage: 'Birds fly.', marks: 2 }],
      Comprehension: [{ passage: 'Ali went.', questions: [{ question: 'Who?', marks: 1 }], marks: 1 }],
    },
  },
};

function seed() {
  mockStore.clear();
  mockDb = makeFakeDb({
    assessment_requests: [{ id: 'r1', user_id: U, grade_code: 'grade_4', subject_code: 'english', output_format: 'pdf', has_answer_lines: true }],
    assessment_papers: [{ id: 'v1', request_id: 'r1', attempt: 1, status: 'ready', edited_from: null, exam_json: TREE, created_at: '2026-09-30T09:00:00.000Z' }],
    users: [{ id: U, preferred_language: 'en' }],
    app_settings: [{ key: 'assessment_versions_enabled', value: true }, { key: 'assessment_editing_enabled', value: true }],
  });
}

const seen = [];
async function go(from, data) {
  const res = await Endpoint.handleAssessmentGenDataExchange(U, from, data, TOKEN);
  seen.push([from, res.screen]);
  return res;
}
const row = (res, pred) => res.data.rows.find(pred);
const Selection = require('../../bot/shared/services/assessment/assessment-selection');
const IDS = Selection.indexQuestions(TREE).map((q) => q.id);
const open = (res, id) => row(res, (r) => r['on-click-action'].payload.question_id === id)['on-click-action'].payload;
const SLOTS = { slot_0: 'A) a', slot_1: 'B) b', slot_2: '', slot_3: '', slot_4: '', slot_5: '' };

beforeAll(async () => {
  seed();
  const list = await Endpoint.handleAssessmentGenInit(U, TOKEN);
  seen.push(['INIT', list.screen]);
  // From BOTH list screens: every row kind.
  for (const L of ['LIST', 'LIST_MORE']) {
    for (const id of IDS) {
      const payload = open(list, id);
      const screen = await go(L, payload);
      // every edit screen's own actions
      if (screen.screen === 'EDIT_OPTIONS') {
        await go('EDIT_OPTIONS', { _action: 'save', correct: '9', ...SLOTS }); // refusal → same screen
        await go('EDIT_OPTIONS', { _action: 'save', correct: '0', ...SLOTS });
      } else if (screen.screen === 'EDIT_COMPREHENSION') {
        const sub = screen.data.subs[0]['on-click-action'].payload;
        await go('EDIT_COMPREHENSION', sub);
        await go('EDIT_SUB', { _action: 'save', question: '', marks: '1', ...SLOTS }); // refusal
        await go('EDIT_SUB', { _action: 'save', question: 'Who went?', marks: '1', ...SLOTS });
        await go(L, open(list, payload.question_id));
        await go('EDIT_COMPREHENSION', { _action: 'back' });
        await go(L, open(list, payload.question_id));
        await go('EDIT_COMPREHENSION', { _action: 'remove', question_id: payload.question_id });
      } else if (screen.screen === 'REMOVED') {
        await go('REMOVED', { _action: 'back' });
        await go(L, payload);
        await go('REMOVED', { _action: 'restore' });
      } else if (screen.screen.startsWith('EDIT_')) {
        await go(screen.screen, { _action: 'save', marks: '0' }); // refusal
        await go(screen.screen, { _action: 'save', marks: '2' });
      }
    }
    // add: a bad kind, then short and mcq, each refused once and then saved
    await go(L, { _action: 'add' });
    await go('ADD_TYPE', { _action: 'add_type', kind: '' });
    await go('ADD_TYPE', { _action: 'add_type', kind: 'short' });
    await go('EDIT_STANDARD', { _action: 'save', question: 'New?', answer: '' });
    await go('EDIT_STANDARD', { _action: 'save', question: 'New?', answer: 'Yes.' });
    await go(L, { _action: 'add' });
    await go('ADD_TYPE', { _action: 'add_type', kind: 'mcq' });
    await go('EDIT_OPTIONS', { _action: 'save', question: 'Q?', correct: 'none', ...SLOTS });
    await go('EDIT_OPTIONS', { _action: 'save', question: 'Q?', correct: '1', ...SLOTS });
    await go(L, { _action: 'page', page: '0' });
    await go(L, { _action: 'done' });
  }
});

test('the drive reached every review screen (else this suite proves nothing)', () => {
  const reached = new Set(seen.map(([, to]) => to));
  for (const s of FLOW.screens.map((x) => x.id)) expect([s, reached.has(s)]).toEqual([s, true]);
});

test('INIT opens only on the Flow\'s first screen', () => {
  expect(seen.filter(([f]) => f === 'INIT').map(([, t]) => t)).toEqual([FLOW.screens[0].id]);
});

test('every (from → to) the endpoint returns is one the client accepts', () => {
  const refused = [...new Set(seen.filter(([f]) => f !== 'INIT').filter(([f, t]) => !allowed(f, t)).map(([f, t]) => `${f}→${t}`))];
  expect(refused).toEqual([]);
});
