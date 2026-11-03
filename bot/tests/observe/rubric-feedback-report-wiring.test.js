/**
 * bd-rlxkkt.3 — the rubric Feedback Report on the live debrief path (processDebriefRecording, everything but the
 * network mocked): the ur/en judge must score rehearsal (a card without it gets the one guided repair), and the card
 * image's caption carries the next focus's Coach Training module link (an image cannot).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const { observeStrings } = require('../../shared/services/observe/observe-strings');

const SID = 'obs-success-1';
const COACH_EN = { id: 'coach-en', phone_number: '923000000001', preferred_language: 'en' };
const COACH_UR = { id: 'coach-ur', phone_number: '923000000002', preferred_language: 'ur' };
const TEACHER_UR = { id: 'teacher-ur', phone_number: '923000000009', preferred_language: 'ur' };
const TEACHER_EN = { id: 'teacher-en', phone_number: '923000000008', preferred_language: 'en' };

/** A valid, non-harmful coach-feedback blob (the shape validateCoachFeedback accepts). */
const FEEDBACK = () => ({
  rubric: { opened_with_specific_praise: true, anchored_in_real_moment: true, asked_and_waited: true, one_improvement_only: true, moves_not_teacher: true, elicited_if_then: true, righting_reflex_held: true, rehearsed_the_step: false, disparaged_teacher: false },
  focus: 'rehearsed_the_step',
  praise_line: 'You opened with a real moment from her lesson.',
  wins: [{ behaviour: 'Named a specific moment', evidence: 'the cake example' }],
  try: { move: 'Ask before telling', evidence: 'you gave the rule at minute nine', instead: 'Wait three seconds.' },
  reflection_question: 'What would you notice first next time?',
});

function row({ teacher, coach, feedback = FEEDBACK(), transcript = undefined }) {
  return {
    id: SID,
    status: 'observer_review_complete',
    user_id: teacher.id,
    observer_user_id: coach.id,
    observation_type: 'leader_observation',
    debrief_status: 'pending',
    analysis_data: {
      framework: 'fico',
      observer_debrief: { audio_id: 'media-1', feedback, transcript, guide_snapshot: { intro: 'x' } },
    },
    users: { name: 'Teacher Row', phone_number: teacher.phone_number, preferred_language: teacher.preferred_language },
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

const USERS = [COACH_EN, COACH_UR, TEACHER_UR, TEACHER_EN];

const TWO_WINS = (fb) => ({ ...fb, wins: [...fb.wins, { behaviour: 'Waited', evidence: 'you waited' }] });

describe('the rubric Feedback Report, end to end', () => {
  let sent; let calls;

  function load(session, completeJson) {
    jest.resetModules();
    sent = []; calls = [];
    jest.doMock('../../shared/config/supabase', () => db(session, USERS));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
      sendImageFromBuffer: jest.fn(async (to, buf, caption) => { sent.push({ kind: 'image', to, caption }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, p }); return true; }),
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
    if (completeJson) {
      jest.doMock('../../shared/services/gpt5-mini.service', () => ({
        completeJson: jest.fn(async (prompt) => { calls.push(prompt); return { result: completeJson(calls.length) }; }),
      }));
    }
    return require('../../shared/services/observe/observe-debrief.service');
  }

  test('the card image carries the next focus\'s module link in its caption (English coach)', async () => {
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_EN, feedback: TWO_WINS(FEEDBACK()) }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });
    const en = observeStrings('en');
    const caption = sent.find((s) => s.kind === 'image').caption;
    expect(caption.startsWith(FEEDBACK().praise_line)).toBe(true);
    expect(caption).toContain('Module 8: Rehearse it aloud');
    expect(caption).toContain('https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C');
    expect(caption.endsWith(en.coach_card_closing)).toBe(true);
  });

  test('ur/en: a card without rehearsal gets the one guided repair; the repaired card is delivered', async () => {
    const missing = () => { const fb = TWO_WINS(FEEDBACK()); delete fb.rubric.rehearsed_the_step; return fb; };
    const Debrief = load(row({ teacher: TEACHER_EN, coach: COACH_UR, feedback: null, transcript: 'a'.repeat(400) }),
      (n) => (n === 1 ? missing() : TWO_WINS(FEEDBACK())));
    await Debrief.processDebriefRecording(SID, { from: COACH_UR.phone_number });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/rehearsed_the_step/);
    expect(sent.find((s) => s.kind === 'image').caption).toContain('https://claude.ai/artifact/MGVm5YMAdQhRCrWRWWg65C');
  });
});
