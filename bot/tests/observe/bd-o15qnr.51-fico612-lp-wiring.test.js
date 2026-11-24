/**
 * bd-o15qnr.51 (queue #255) — the operator, 24 Nov ~11:15: "lesson plan moves/fideltiy step to be removed from the fico
 * 6-12." On the live debrief path (processDebriefRecording and the notes builder, everything but the network mocked): a
 * FICO 6-12 (FICO-S) visit gets no lesson plan check and no model call for it, even when its stored notes carry one
 * (written before this change: production b4f6f109, 24 Nov). A FICO17 v6 (grades 1-5) visit is exactly as before.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const SID = 'obs-lp-612';
const COACH = { id: 'coach-en', phone_number: '+92300FIXTURE1', preferred_language: 'en', name: 'Coach' };
const TEACHER = { id: 'teacher-en', phone_number: '+92300FIXTURE8', preferred_language: 'en' };
const TRANSCRIPT = "Coach: Let's look at the We Do step of today's plan. What made partner practice hard to do today? Teacher: The class was big. ".repeat(4);

const FEEDBACK = () => ({
  rubric: { opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true, elicited_if_then: false, righting_reflex_held: true, rehearsed_the_step: false, disparaged_teacher: false },
  focus: 'rehearsed_the_step',
  praise_line: 'You opened with a real moment from the lesson.',
  wins: [{ behaviour: 'Named a specific moment', evidence: 'the cake example' }, { behaviour: 'Waited', evidence: 'you waited' }],
  try: { move: 'Ask before telling', evidence: 'you gave the rule at minute nine', instead: 'Wait three seconds.' },
  reflection_question: 'What would you notice first next time?',
});

const LP_CHECK = {
  v: 1, state: 'ok', done: 1, total: 2,
  steps: [{ key: 'we_do', name: 'We Do', done: 1, total: 2, moves: [
    { id: 'm1', mark: 'done', label: 'Children answer together' },
    { id: 'm2', mark: 'missed', label: 'Partner practice', what: 'Children answered the teacher.' },
  ] }],
  lines: ['a', 'b', 'c', 'd', 'e'],
};

const PARTS = {
  parts: [
    { part: 'name_step', covered: true, quote: "Let's look at the We Do step of today's plan." },
    { part: 'as_planned', covered: false, quote: '', what_happened: 'You did not name a step done as planned.' },
    { part: 'gap', covered: false, quote: '', what_happened: 'You did not name the missed move.' },
    { part: 'ask', covered: true, quote: 'What made partner practice hard to do today?' },
    { part: 'next_step', covered: false, quote: '', what_happened: 'The teacher never named a next step.' },
  ],
};

function row(guideSnapshot, stamp = {}) {
  return {
    id: SID, ...stamp, status: 'observer_review_complete', user_id: TEACHER.id, observer_user_id: COACH.id,
    observation_type: 'leader_observation', debrief_status: 'pending',
    analysis_data: { framework: 'fico', ...(stamp.analysis || {}), observer_debrief: { audio_id: 'media-1', transcript: TRANSCRIPT, guide_snapshot: guideSnapshot } },
    users: { name: 'Teacher Row', phone_number: TEACHER.phone_number, preferred_language: 'en' },
  };
}

function db(session, users) {
  const calls = { updates: [], tables: [] };
  return {
    calls,
    from(table) {
      calls.tables.push(table);
      const b = { filters: {} };
      ['select', 'order', 'limit', 'in', 'not', 'or', 'is'].forEach((m) => { b[m] = () => b; });
      b.eq = (c, v) => { b.filters[c] = v; return b; };
      b.update = (f) => { calls.updates.push(f); return b; };
      const rows = () => {
        if (table === 'coaching_sessions') return { data: session, error: null };
        if (table === 'users') {
          const [[c, v] = []] = Object.entries(b.filters);
          return { data: users.find((u) => u[c] === v) || null, error: null };
        }
        return { data: null, error: null };
      };
      b.single = async () => rows();
      b.maybeSingle = async () => rows();
      b.then = (ok, ko) => Promise.resolve(rows()).then(ok, ko);
      return b;
    },
  };
}

const FICO_S = { framework: 'fico_s_v1_2', framework_selection_reason: 'fico_s_dc', analysis: { framework: 'fico_s_v1_2', obs612: { tool: 'ficos', rubric_id: 'fico_s_v1_2', grade: 7 } } };
const V6 = { framework: 'fico17_v6', framework_selection_reason: 'coach_rubric_switch', analysis: { framework: 'fico17_v6' } };

function load(session, answer) {
  jest.resetModules();
  const calls = [];
  const database = db(session, [COACH, TEACHER]);
  jest.doMock('../../shared/config/supabase', () => database);
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async () => true),
    sendImageFromBuffer: jest.fn(async () => true),
    sendInteractiveButtons: jest.fn(async () => true),
    downloadMedia: jest.fn(async () => Buffer.from('fake audio data')),
  }));
  jest.doMock('../../shared/services/observe/observe-coach-card', () => ({
    ...jest.requireActual('../../shared/services/observe/observe-coach-card'),
    renderCoachCard: jest.fn(async () => Buffer.from('png')),
  }));
  jest.doMock('../../shared/services/observe/observe-state.service', () => ({
    getState: jest.fn(async () => null), setState: jest.fn(async () => true), clearState: jest.fn(async () => true),
  }));
  jest.doMock('../../shared/services/observe/observe-completion', () => ({ maybeCompleteObservation: jest.fn(async () => true) }));
  jest.doMock('../../shared/services/gpt5-mini.service', () => ({
    completeJson: jest.fn(async (prompt, opts) => { calls.push({ prompt, label: opts && opts.label }); return { result: answer(calls.length, opts) }; }),
  }));
  return { Debrief: require('../../shared/services/observe/observe-debrief.service'), calls, database };
}

const storedFeedback = (database) => {
  const writes = database.calls.updates.map((u) => u.analysis_data && u.analysis_data.observer_debrief).filter((od) => od && od.feedback);
  return writes.length ? writes[writes.length - 1].feedback : null;
};

describe('the debrief of a 6-12 visit: no five-part judge', () => {
  test('6-12 whose stored notes carry a check: one call (the 8 behaviours), no lp_discussion, the behaviours as judged', async () => {
    const { Debrief, calls, database } = load(row({ intro: 'x', lp_check: LP_CHECK }, FICO_S), (n, opts) => (opts.label === 'observeLpDiscussion' ? PARTS : FEEDBACK()));
    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });
    expect(calls.map((c) => c.label)).toEqual(['observeCoachFeedback']);
    const fb = storedFeedback(database);
    expect(fb.rubric).toEqual(FEEDBACK().rubric);
    expect(fb).not.toHaveProperty('lp_discussion');
  });

  test('1-5 with the same notes is unchanged: the second, separate call, lp_discussion kept', async () => {
    const { Debrief, calls, database } = load(row({ intro: 'x', lp_check: LP_CHECK }, V6), (n, opts) => (opts.label === 'observeLpDiscussion' ? PARTS : FEEDBACK()));
    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });
    expect(calls.map((c) => c.label)).toEqual(['observeCoachFeedback', 'observeLpDiscussion']);
    expect(storedFeedback(database).lp_discussion).toEqual(expect.objectContaining({ state: 'ok', covered: 2, total: 5 }));
  });
});

describe('the notes of a 6-12 visit: no lesson plan check written', () => {
  test('a FICO 6-12 Digital Coach visit with a graded plan: no lp_check, no words call, the switch never read', async () => {
    const graded = { status: 'ok', moderators: { note: '' }, moves: [
      { move_id: 'm1', phase: 'explain', bucket: 'must_happen', text: 'Explain', verdict: 'executed', evidence: '[01:00] x' },
      { move_id: 'm2', phase: 'guided', bucket: 'must_happen', text: 'Pairs', verdict: 'not_done', evidence: '' },
    ] };
    const session = {
      id: SID, observer_user_id: COACH.id, user_id: TEACHER.id, framework: 'fico_s_v1_2', framework_selection_reason: 'fico_s_dc',
      analysis_data: { framework: 'fico_s_v1_2', lp_fidelity: graded, obs612: { tool: 'ficos', rubric_id: 'fico_s_v1_2', answers: { A1: '3' }, evidence: {}, feedback: {} } },
    };
    const { Debrief, calls, database } = load(row({}, FICO_S), () => { throw new Error('no model'); });
    const guide = await Debrief.buildDebriefGuide(session, 'en');
    expect(guide).toBeTruthy();
    expect(guide).not.toHaveProperty('lp_check');
    expect(calls.map((c) => c.label)).not.toContain('observeLpCheck');
    expect(database.calls.tables).not.toContain('app_settings');
  });
});
