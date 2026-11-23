/**
 * The lesson plan check on the live debrief path (processDebriefRecording, everything but the network mocked; the
 * ICT HITL owner's spec, 23 Nov 2026): notes that carry a lesson plan check get the five parts judged by their OWN model
 * call after the 8 behaviours, kept on the feedback as lp_discussion; the 8 behaviours, and so the stars and the score,
 * are exactly what they were. Notes without the check (an observer off the HITL switch) get one call, as before.
 * And the notes builder hands its guide to attachLpCheck, which decides by the switch.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const SID = 'obs-lp-1';
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

function row(guideSnapshot) {
  return {
    id: SID, status: 'observer_review_complete', user_id: TEACHER.id, observer_user_id: COACH.id,
    observation_type: 'leader_observation', debrief_status: 'pending',
    analysis_data: { framework: 'fico', observer_debrief: { audio_id: 'media-1', transcript: TRANSCRIPT, guide_snapshot: guideSnapshot } },
    users: { name: 'Teacher Row', phone_number: TEACHER.phone_number, preferred_language: 'en' },
  };
}

function db(session, users) {
  const calls = { updates: [] };
  return {
    calls,
    from(table) {
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

describe('the five parts on the live debrief path', () => {
  let calls; let database;

  function load(session, answer) {
    jest.resetModules();
    calls = [];
    database = db(session, [COACH, TEACHER]);
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
    return require('../../shared/services/observe/observe-debrief.service');
  }

  const storedFeedback = () => {
    const writes = database.calls.updates.map((u) => u.analysis_data && u.analysis_data.observer_debrief).filter((od) => od && od.feedback);
    return writes.length ? writes[writes.length - 1].feedback : null;
  };

  test('notes with a lesson plan check: a second, separate call; lp_discussion kept; the 8 behaviours untouched', async () => {
    const Debrief = load(row({ intro: 'x', lp_check: LP_CHECK }), (n, opts) => (opts.label === 'observeLpDiscussion' ? PARTS : FEEDBACK()));
    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });
    expect(calls.map((c) => c.label)).toEqual(['observeCoachFeedback', 'observeLpDiscussion']);
    // The 8 behaviours' judge read the same prompt as without the check: nothing about the plan in it.
    expect(calls[0].prompt).not.toMatch(/name_step|lesson plan check/i);
    const fb = storedFeedback();
    expect(fb.rubric).toEqual(FEEDBACK().rubric);
    expect(fb.lp_discussion).toEqual(expect.objectContaining({ state: 'ok', covered: 2, total: 5 }));
  });

  test('notes without the check (switch off when written): one call, no lp_discussion, as before', async () => {
    const Debrief = load(row({ intro: 'x' }), () => FEEDBACK());
    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });
    expect(calls.map((c) => c.label)).toEqual(['observeCoachFeedback']);
    const fb = storedFeedback();
    expect(fb.rubric).toEqual(FEEDBACK().rubric);
    expect(fb).not.toHaveProperty('lp_discussion');
  });

  test('no plan linked: no second call, lp_discussion says so', async () => {
    const Debrief = load(row({ intro: 'x', lp_check: { v: 1, state: 'no_plan' } }), () => FEEDBACK());
    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });
    expect(calls).toHaveLength(1);
    expect(storedFeedback().lp_discussion).toEqual({ v: 1, state: 'no_plan' });
  });

  test('the parts judge fails: the report is written as before, without the block', async () => {
    const Debrief = load(row({ intro: 'x', lp_check: LP_CHECK }), (n, opts) => {
      if (opts.label === 'observeLpDiscussion') throw new Error('timeout');
      return FEEDBACK();
    });
    await Debrief.processDebriefRecording(SID, { from: COACH.phone_number });
    const fb = storedFeedback();
    expect(fb.rubric).toEqual(FEEDBACK().rubric);
    expect(fb).not.toHaveProperty('lp_discussion');
  });
});

describe('the notes builder hands its guide to attachLpCheck', () => {
  test('buildDebriefGuide returns what attachLpCheck makes of the notes', async () => {
    jest.resetModules();
    const attach = jest.fn(async (guide) => ({ ...guide, lp_check: { v: 1, state: 'no_plan' } }));
    jest.doMock('../../shared/services/observe/lp-check', () => ({ ...jest.requireActual('../../shared/services/observe/lp-check'), attachLpCheck: attach }));
    jest.doMock('../../shared/config/supabase', () => db(row({}), [COACH, TEACHER]));
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn(async () => { throw new Error('no model'); }) }));
    const Debrief = require('../../shared/services/observe/observe-debrief.service');
    const session = { id: SID, observer_user_id: COACH.id, user_id: TEACHER.id, analysis_data: { framework: 'fico17_v6' } };
    const guide = await Debrief.buildDebriefGuide(session, 'en');
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0][1]).toBe(session);
    expect(attach.mock.calls[0][2]).toBe('en');
    expect(guide.lp_check).toEqual({ v: 1, state: 'no_plan' });
    expect(Array.isArray(guide.conversation)).toBe(true);
  });
});
