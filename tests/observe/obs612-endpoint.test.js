/**
 * bd-pni007 — the FDE (obs612) form's endpoint (POST /api/flows/obs612). Token: <coachUserId>:obs612:<formId>.
 *
 * - INIT opens the visit's own tool (General, Maths & Science, English & Urdu by sheet), pre-filled from the draft.
 * - A form that is not this coach's, not an FDE form, or already submitted is refused (NOTICE, then DONE).
 * - Every screen saves what the coach posted into answers.obs612 BEFORE it checks it, so nothing is lost.
 * - Submit: nothing may be missing; the visit's coaching_sessions row gets the analysis (or one is made and linked);
 *   the form is sealed once; the coach summary goes out once, after the response.
 *
 * Real: endpoint, store, Flow spec, rubric, record. Mocked: the database (in-memory), the logger, the summary sender.
 */
const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('../observe2/helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

// summary.js is written in parallel; mock it whether or not it exists yet.
const SUMMARY = '../../bot/shared/services/observe/obs612/summary';
const mockSendCoachSummary = jest.fn(() => Promise.resolve({ ok: true }));
jest.doMock(SUMMARY, () => ({ sendCoachSummary: mockSendCoachSummary }), {
  virtual: !fs.existsSync(path.join(__dirname, `${SUMMARY}.js`)),
});

const { logToFile } = require('../../bot/shared/utils/logger');
const Endpoint = require('../../bot/shared/routes/obs612-endpoint');
const O = require('../../bot/shared/services/coaching/frameworks/obs612');

const FLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../bot/docs/flows/obs612-flow.json'), 'utf8'));
const SCREEN = Object.fromEntries(FLOW.screens.map((s) => [s.id, s]));

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };
const token = (formId, coach = 'coach-1') => `${coach}:obs612:${formId}`;
const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const sessions = () => mockFake.__tables.coaching_sessions || [];
const writes = (table) => mockFake.__calls.filter((c) => c.table === table && c.action !== 'select');

function components(screenId) {
  const out = [];
  const walk = (list) => (list || []).forEach((c) => { out.push(c); walk(c.children); walk(c.then); walk(c.else); });
  walk(SCREEN[screenId].layout.children);
  return out;
}
const footer = (screenId) => components(screenId).find((c) => c.type === 'Footer');
const postedFields = (screenId) => Object.keys(footer(screenId)['on-click-action'].payload).filter((k) => k !== 'screen');
const componentOf = (screenId, name) => components(screenId).find((c) => c.name === name);

// What the Flow posts for a screen with every field answered; `choose(name)` can steer a value.
function answersFor(screenId, choose = () => undefined) {
  const out = { screen: screenId };
  for (const name of postedFields(screenId)) {
    const c = componentOf(screenId, name);
    const picked = choose(name, c);
    if (picked !== undefined) out[name] = picked;
    else if (c.type === 'RadioButtonsGroup' || c.type === 'Dropdown') {
      const opts = c['data-source'];
      out[name] = c.required ? opts[opts.length > 2 ? 2 : 0].id : '';
    } else if (c['input-type'] === 'number') out[name] = 32;
    else out[name] = c.required ? `Words for ${name}` : '';
  }
  return out;
}

const ex = (formId, screenId, data, coach) => Endpoint.handleObs612DataExchange(token(formId, coach), screenId, data);

// INIT, then every screen answered in turn, until DONE (or a screen that will not move).
async function walkForm(formId, choose) {
  let res = await Endpoint.handleObs612Init(token(formId));
  const seen = [res];
  for (let guard = 0; res.screen !== 'DONE' && guard < 12; guard += 1) {
    res = await ex(formId, res.screen, answersFor(res.screen, choose));
    seen.push(res);
  }
  return seen;
}

const FORMS = [
  { id: 'form-gen', rubric_version: 'obs612-gen-v1', visit_context: { grade: 9, subject: 'islamiat', sheet: null, via: 'observe2' } },
  { id: 'form-msci', rubric_version: 'obs612-msci-v1', visit_context: { grade: 7, subject: 'maths', sheet: null, via: 'observe' }, coaching_session_id: 'sess-1' },
  {
    id: 'form-en', rubric_version: 'obs612-enur-v1',
    visit_context: { grade: 6, subject: 'english', sheet: 'en', via: 'observe2', teacher_name: 'Rabia Bibi', school_name: 'IMCG F-7/2' },
  },
  { id: 'form-ur', rubric_version: 'obs612-enur-v1', visit_context: { grade: 8, subject: 'urdu', sheet: 'ur', via: 'observe2' } },
  { id: 'form-closed', rubric_version: 'obs612-gen-v1', visit_context: { grade: 10, subject: 'other', via: 'observe' }, coaching_session_id: 'sess-2' },
  { id: 'form-fico', rubric_version: 'fico-ict-17-2026-09', visit_context: {} },
];

// A Submit's summary goes out on setImmediate: let it land inside the test that made it.
afterEach(flush);

beforeEach(() => {
  jest.clearAllMocks();
  mockSendCoachSummary.mockImplementation(() => Promise.resolve({ ok: true }));
  mockFake = createFakeSupabase({
    users: [
      { id: 'coach-1', name: 'Coach Amna', phone_number: '923000000001' },
      { id: 'teacher-1', name: 'Rabia', school_name: 'IMSG I-8/1', phone_number: '923000000002' },
    ],
    observation_field_forms: FORMS.map((f) => ({
      observer_user_id: 'coach-1', teacher_user_id: 'teacher-1', coaching_session_id: null, answers: {}, photos: [],
      sealed_at: null, checked_at: null, final_levels: null, ...f,
    })),
    coaching_sessions: [
      { id: 'sess-1', status: 'transcribed', user_id: 'teacher-1', observer_user_id: 'coach-1', analysis_data: { transcript_summary: 'kept' } },
      { id: 'sess-2', status: 'cancelled', user_id: 'teacher-1', observer_user_id: 'coach-1', analysis_data: {} },
    ],
  });
});

describe('INIT opens the visit\'s own tool', () => {
  const declaredKeys = (id) => Object.keys(SCREEN[id].data).sort();

  test.each([
    ['form-gen', 'GEN_ENV'],
    ['form-msci', 'MSCI_BEFORE'],
    ['form-en', 'ENUR_CONTEXT'],
    ['form-ur', 'ENUR_CONTEXT'],
  ])('%s opens on %s, labelled FDE v1, with exactly the data the screen declares', async (formId, screenId) => {
    const res = await Endpoint.handleObs612Init(token(formId));
    expect(res.screen).toBe(screenId);
    expect(res).not.toHaveProperty('version');
    expect(res.data.rubric_label).toBe('FDE v1');
    expect(Object.keys(res.data).sort()).toEqual(declaredKeys(screenId));
  });

  test('English & Urdu: Section 1 shows school, observer, teacher and grade read-only; the subject is pre-picked', async () => {
    const res = await Endpoint.handleObs612Init(token('form-en'));
    expect(res.data.ctx_lines).toBe('School: IMCG F-7/2\nObserver: Coach Amna\nTeacher: Rabia Bibi\nGrade/Class: 6');
    expect(res.data.init_ctx_5).toBe('English');
    const ur = await Endpoint.handleObs612Init(token('form-ur'));
    // No names on the visit: the teacher's own record fills them.
    expect(ur.data.ctx_lines).toBe('School: IMSG I-8/1\nObserver: Coach Amna\nTeacher: Rabia\nGrade/Class: 8');
    expect(ur.data.init_ctx_5).toBe('Urdu');
  });

  test.each([['form-en', 'ENUR_TWO_EN'], ['form-ur', 'ENUR_TWO_UR']])('%s: the sheet picks Section 2\'s screen (%s)', async (formId, next) => {
    const res = await ex(formId, 'ENUR_CONTEXT', answersFor('ENUR_CONTEXT'));
    expect(res.screen).toBe(next);
  });

  test('a reopened form comes back pre-filled from the saved draft', async () => {
    formRow('form-gen').answers = { obs612: { env_1: 'no', env_2: 'yes', comment_env: 'Board was clean' } };
    const res = await Endpoint.handleObs612Init(token('form-gen'));
    expect(res.data.init_env_1).toBe('no');
    expect(res.data.init_env_2).toBe('yes');
    expect(res.data.init_env_3).toBe('');
    expect(res.data.init_comment_env).toBe('Board was clean');
  });
});

describe('refusals', () => {
  test('someone else\'s form: NOTICE, and nothing it posts is saved', async () => {
    const init = await Endpoint.handleObs612Init(token('form-gen', 'coach-2'));
    expect(init.screen).toBe('NOTICE');
    expect(init.data.notice_title).toBe('Not available');
    const res = await ex('form-gen', 'GEN_ENV', answersFor('GEN_ENV'), 'coach-2');
    expect(res.screen).toBe('DONE');
    expect(writes('observation_field_forms')).toEqual([]);
  });

  test('an already submitted form: "Already submitted", and nothing changes', async () => {
    formRow('form-gen').sealed_at = '2026-11-11T05:00:00.000Z';
    const init = await Endpoint.handleObs612Init(token('form-gen'));
    expect(init.screen).toBe('NOTICE');
    expect(init.data.notice_title).toBe('Already submitted');
    const res = await ex('form-gen', 'GEN_ENV', answersFor('GEN_ENV'));
    expect(res.screen).toBe('DONE');
    expect(res.data.outcome).toBe('already');
    expect(writes('observation_field_forms')).toEqual([]);
  });

  test('a form that is not an FDE one, and a token that names no form, are refused', async () => {
    expect((await Endpoint.handleObs612Init(token('form-fico'))).screen).toBe('NOTICE');
    expect((await Endpoint.handleObs612Init(token('form-missing'))).screen).toBe('NOTICE');
    expect((await Endpoint.handleObs612Init('coach-1:observe2-check:form-gen')).screen).toBe('NOTICE');
  });

  test('NOTICE closes on DONE', async () => {
    const res = await ex('form-fico', 'NOTICE', { screen: 'NOTICE' });
    expect(res.screen).toBe('DONE');
    expect(res.data.rubric_label).toBe('FDE v1');
  });
});

describe('every screen saves before it checks', () => {
  test('an unanswered item keeps the coach on the screen, and what was answered is already saved', async () => {
    const data = answersFor('GEN_ENV', (n) => (n === 'env_6' ? '' : n === 'comment_env' ? 'Charts on every wall' : undefined));
    const res = await ex('form-gen', 'GEN_ENV', data);
    expect(res.screen).toBe('GEN_ENV');
    expect(res.data.err_v).toBe(true);
    expect(Object.keys(res.data.error_messages)).toEqual(['env_6']);
    const saved = formRow('form-gen').answers.obs612;
    expect(saved).toMatchObject({ env_1: 'yes', env_5: 'yes', comment_env: 'Charts on every wall' });
    expect(saved).not.toHaveProperty('env_6');
    // What was posted comes back on the screen.
    expect(res.data.init_comment_env).toBe('Charts on every wall');
  });

  test('a later screen adds to what earlier ones saved; a cleared optional box is cleared', async () => {
    formRow('form-gen').answers = { other: 'kept', obs612: { comment_env: 'old note', delivery_1: 'no' } };
    await ex('form-gen', 'GEN_ENV', answersFor('GEN_ENV'));
    const row = formRow('form-gen');
    expect(row.answers.other).toBe('kept');
    expect(row.answers.obs612.delivery_1).toBe('no');
    expect(row.answers.obs612).not.toHaveProperty('comment_env');
    // Every save is guarded: never over a sealed form.
    const save = writes('observation_field_forms')[0];
    expect(save.filters).toContainEqual(['is', 'sealed_at', null]);
  });

  test('a save that fails keeps the coach on the screen with a line saying so, logged as an error', async () => {
    const from = mockFake.from;
    let armed = true;
    mockFake.from = (t) => {
      const b = from(t);
      if (armed && t === 'observation_field_forms') {
        const update = b.update;
        b.update = (v) => { armed = false; update(v); mockFake.__failNext({ message: 'db down' }); return b; };
      }
      return b;
    };
    const res = await ex('form-gen', 'GEN_ENV', answersFor('GEN_ENV'));
    expect(res.screen).toBe('GEN_ENV');
    expect(res.data.err_v).toBe(true);
    expect(res.data.err_note).toMatch(/not saved/i);
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('[obs612]'), expect.anything(), 'error');
  });

  test('Maths & Science: a second plan row needs all three of its fields, or none', async () => {
    const res = await ex('form-msci', 'MSCI_PLAN', answersFor('MSCI_PLAN', (n) => (n === 'dp_area_2' ? 'i4' : undefined)));
    expect(res.screen).toBe('MSCI_PLAN');
    expect(Object.keys(res.data.error_messages).sort()).toEqual(['dp_action_2', 'dp_goal_2']);
  });
});

describe('Submit', () => {
  test('General form, no session yet: one is made and linked, the form sealed once, the summary sent once', async () => {
    const seen = await walkForm('form-gen');
    expect(seen.map((r) => r.screen)).toEqual(['GEN_ENV', 'GEN_DELIVERY', 'GEN_MANAGEMENT', 'GEN_COMMAND', 'GEN_ASSESSMENT', 'GEN_WORK', 'DONE']);
    for (const r of seen) expect(r).not.toHaveProperty('version');
    const done = seen[seen.length - 1];
    expect(done.data).toMatchObject({ outcome: 'submitted', form_id: 'form-gen', rubric_label: 'FDE v1' });

    const made = sessions().filter((s) => !['sess-1', 'sess-2'].includes(s.id));
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      user_id: 'teacher-1', observer_user_id: 'coach-1', observation_type: 'leader_observation', status: 'observer_review_complete',
      debrief_status: 'pending', framework: 'obs612-gen-v1', framework_selection_reason: 'obs612_lesson',
    });
    const a = made[0].analysis_data;
    expect(a.framework).toBe('obs612-gen-v1');
    expect(a.obs612.result).toMatchObject({ yes: 35, of: 35, missing: [] });
    expect(a.obs612.feedback).toEqual({ line: 'Words for fb_line' });

    const row = formRow('form-gen');
    expect(row.coaching_session_id).toBe(made[0].id);
    expect(row.sealed_at).toEqual(expect.any(String));
    expect(row.checked_at).toBe(row.sealed_at);
    expect(row.final_levels).toEqual(a.obs612.result);
    expect(row.answers.obs612.fb_line).toBe('Words for fb_line');

    // The seal is ONE update, guarded so a second Submit finds nothing to seal.
    const seals = writes('observation_field_forms').filter((c) => c.values && c.values.sealed_at);
    expect(seals).toHaveLength(1);
    expect(seals[0].filters).toContainEqual(['is', 'sealed_at', null]);
    expect(Object.keys(seals[0].values).sort()).toEqual(['answers', 'checked_at', 'coaching_session_id', 'final_levels', 'sealed_at']);

    expect(mockSendCoachSummary).not.toHaveBeenCalled(); // not before the response
    await flush();
    expect(mockSendCoachSummary).toHaveBeenCalledTimes(1);
    expect(mockSendCoachSummary).toHaveBeenCalledWith({ coachUserId: 'coach-1', sessionId: made[0].id, analysis: a });
  });

  test('a double Submit does nothing the second time', async () => {
    await walkForm('form-gen');
    const before = sessions().length;
    const again = await ex('form-gen', 'GEN_WORK', answersFor('GEN_WORK'));
    expect(again.screen).toBe('DONE');
    expect(again.data.outcome).toBe('already');
    expect(sessions()).toHaveLength(before);
    await flush();
    expect(mockSendCoachSummary).toHaveBeenCalledTimes(1);
  });

  test('two Submits racing: the loser removes the session it made and seals nothing', async () => {
    await walkForm('form-gen', (n) => (n === 'fb_line' ? '' : undefined)); // stops on GEN_WORK: the line is required
    const from = mockFake.from;
    mockFake.from = (t) => {
      const b = from(t);
      if (t === 'observation_field_forms') {
        const update = b.update;
        b.update = (v) => { if (v && v.sealed_at) formRow('form-gen').sealed_at = '2026-11-11T06:00:00.000Z'; return update(v); };
      }
      return b;
    };
    const res = await ex('form-gen', 'GEN_WORK', answersFor('GEN_WORK'));
    expect(res.data.outcome).toBe('already');
    expect(sessions().map((s) => s.id).sort()).toEqual(['sess-1', 'sess-2']);
    await flush();
    expect(mockSendCoachSummary).not.toHaveBeenCalled();
  });

  test('Maths & Science, linked session: the analysis is merged onto it; the plan starts at the lowest level', async () => {
    let planScreen = null;
    const choose = (n) => (n === 'i5' ? '0' : undefined);
    const seen = await walkForm('form-msci', choose);
    planScreen = seen.find((r) => r.screen === 'MSCI_PLAN');
    expect(seen.map((r) => r.screen)).toEqual(['MSCI_BEFORE', 'MSCI_DURING_ONE', 'MSCI_DURING_TWO', 'MSCI_AFTER', 'MSCI_PLAN', 'DONE']);
    expect(planScreen.data.init_dp_area).toBe('i5');
    expect(planScreen.data.levels_line).toContain('5. Student-centric, activities: Level 0');

    const s = sessions().find((x) => x.id === 'sess-1');
    expect(s.status).toBe('observer_review_complete');
    expect(s.framework).toBe('obs612-msci-v1');
    expect(s.analysis_data.transcript_summary).toBe('kept');
    expect(s.analysis_data.obs612.result.indicators.find((i) => i.key === 'i5').level).toBe(0);
    expect(s.analysis_data.obs612.development_plan[0]).toMatchObject({ area: 'i3', current: 2, goal: 3, action: 'Words for dp_action' });
    const guard = writes('coaching_sessions').find((c) => c.action === 'update');
    expect(guard.filters).toContainEqual(['not_in', 'status', '(cancelled,abandoned)']);
    expect(sessions()).toHaveLength(2); // none made
    expect(formRow('form-msci').coaching_session_id).toBe('sess-1');
    await flush();
    expect(mockSendCoachSummary).toHaveBeenCalledWith(expect.objectContaining({ coachUserId: 'coach-1', sessionId: 'sess-1' }));
  });

  test.each([['form-en', 'ENUR_TWO_EN', 37, 148], ['form-ur', 'ENUR_TWO_UR', 39, 156]])(
    '%s: the score so far is shown before Section 8; the record carries FDE\'s total',
    async (formId, two, items, max) => {
      const seen = await walkForm(formId);
      expect(seen.map((r) => r.screen)).toEqual(['ENUR_CONTEXT', two, 'ENUR_TWO_MORE', 'ENUR_THREE', 'ENUR_FOUR', 'ENUR_FIVE_SIX', 'ENUR_FEEDBACK', 'DONE']);
      const total = items * 3;
      const pct = Math.round((total * 1000) / max) / 10;
      const fb = seen.find((r) => r.screen === 'ENUR_FEEDBACK');
      expect(fb.data.score_line.split('\n')[0]).toBe(`Score so far: ${total} / ${max} (${pct}%)`);
      const made = sessions().find((s) => !['sess-1', 'sess-2'].includes(s.id));
      expect(made.analysis_data.obs612.result).toMatchObject({ total, max, pct, sheet: formId === 'form-ur' ? 'ur' : 'en' });
      expect(Object.keys(made.analysis_data.obs612.feedback).sort()).toEqual(['areas', 'recommendations', 'strengths', 'timeline']);
      expect(made.analysis_data.obs612.context).toMatchObject({ ctx_6: 'Words for ctx_6', ctx_8: '32' });
    },
  );

  test('a missing item blocks Submit: the last screen says what and where, nothing is sealed or made', async () => {
    const draft = {};
    for (const i of O.requiredItems('obs612-gen-v1', null)) draft[i.key] = 'yes';
    delete draft.delivery_3;
    formRow('form-gen').answers = { obs612: draft };
    const res = await ex('form-gen', 'GEN_WORK', answersFor('GEN_WORK'));
    expect(res.screen).toBe('GEN_WORK');
    expect(res.data.err_v).toBe(true);
    expect(res.data.err_note).toContain('LESSON DELIVERY');
    expect(res.data.err_note).toContain('Item 3');
    expect(formRow('form-gen').sealed_at).toBeNull();
    expect(sessions()).toHaveLength(2);
    await flush();
    expect(mockSendCoachSummary).not.toHaveBeenCalled();
  });

  test('a linked session that was cancelled: not submitted, not sealed, and the coach is told', async () => {
    const seen = await walkForm('form-closed');
    const done = seen[seen.length - 1];
    expect(done.screen).toBe('DONE');
    expect(done.data.outcome).toBe('closed');
    expect(formRow('form-closed').sealed_at).toBeNull();
    expect(sessions().find((s) => s.id === 'sess-2').status).toBe('cancelled');
    await flush();
    expect(mockSendCoachSummary).not.toHaveBeenCalled();
  });

  test('a summary that fails is logged and changes nothing the coach sees', async () => {
    mockSendCoachSummary.mockImplementation(() => Promise.reject(new Error('whatsapp down')));
    const seen = await walkForm('form-gen');
    expect(seen[seen.length - 1].data.outcome).toBe('submitted');
    await flush();
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('summary'), expect.objectContaining({ error: 'whatsapp down' }), 'error');
  });
});
