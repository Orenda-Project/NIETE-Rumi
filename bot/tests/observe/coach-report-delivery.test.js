/**
 * Coach reports in the app — what the debrief job sends on WhatsApp for a coach with app_settings.coach_reports_app on.
 *
 * Her report is a page in the coach app now, so on a debrief recorded on WhatsApp the job sends ONE link to it
 * (coach-report-whatsapp.service sendReportLinkNow) in place of the report picture and its caption:
 *   'sent'         the link went: no picture, no praise caption; the "Send the report?" buttons follow as today
 *   'not_claimed'  already opened / closed / messaged (a redelivery): no picture either
 *   'failed'       Meta refused the link: today's TEXT card goes, so she still has her feedback
 *   'off' / 'no_link'  the switch is off for her (or no link here): exactly today's picture
 * A debrief recorded in the portal sends nothing here (the sweep decides); the job never asks.
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
  rubric: { disparaged_teacher: false, moves_not_teacher: true, opened_with_specific_praise: true },
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

describe('the debrief job, coach reports in the app', () => {
  let sent; let linkCalls; let linkAnswer;

  function load(session) {
    jest.resetModules();
    sent = []; linkCalls = [];
    jest.doMock('../../shared/config/supabase', () => db(session, USERS));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
      sendImageFromBuffer: jest.fn(async (to, buf, caption) => { sent.push({ kind: 'image', to, caption }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, p }); return true; }),
      downloadMedia: jest.fn(async () => Buffer.from('fake audio data')),
    }));
    jest.doMock('../../shared/services/observe/observe-coach-card', () => ({ renderCoachCard: jest.fn(async () => Buffer.from('png')) }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => null), setState: jest.fn(async () => true), clearState: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-completion', () => ({ maybeCompleteObservation: jest.fn(async () => true) }));
    // No LLM runs here: the feedback is already stored (the deliver-only path), and the client is not loaded.
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
    jest.doMock('../../shared/services/observe/coach-report-whatsapp.service', () => ({
      sendReportLinkNow: jest.fn(async (args) => { linkCalls.push(args); return linkAnswer; }),
    }));
    return require('../../shared/services/observe/observe-debrief.service');
  }

  test('link sent: no picture and no praise caption; the send-report buttons still follow', async () => {
    linkAnswer = 'sent';
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_EN }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });
    expect(linkCalls).toEqual([{ sessionId: SID, coachId: COACH_EN.id, phone: COACH_EN.phone_number, lang: 'en' }]);
    expect(sent.filter((s) => s.kind === 'image')).toEqual([]);
    expect(sent.filter((s) => s.kind === 'text')).toEqual([]);
    expect(sent.find((s) => s.kind === 'buttons').p.body).toBe(observeStrings('en').send_choice_body);
  });

  test('already handled (a redelivery): no picture either', async () => {
    linkAnswer = 'not_claimed';
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_UR }));
    await Debrief.processDebriefRecording(SID, { from: COACH_UR.phone_number });
    expect(sent.filter((s) => s.kind === 'image' || s.kind === 'text')).toEqual([]);
  });

  test('Meta refused the link: today\'s text card goes instead (never a silent report)', async () => {
    linkAnswer = 'failed';
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_EN }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });
    expect(sent.filter((s) => s.kind === 'image')).toEqual([]);
    expect(sent.filter((s) => s.kind === 'text').length).toBeGreaterThanOrEqual(1);
  });

  test('switch off for her: exactly today\'s picture', async () => {
    linkAnswer = 'off';
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_EN }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });
    expect(sent[0]).toMatchObject({ kind: 'image', to: COACH_EN.phone_number });
  });

  test('a debrief recorded in the portal never asks for the link here (the sweep owns it)', async () => {
    linkAnswer = 'sent';
    const session = row({ teacher: TEACHER_UR, coach: COACH_EN });
    session.analysis_data.observer_debrief = { audio_r2_key: 'observer_debrief/x.webm', feedback: FEEDBACK(), guide_snapshot: { intro: 'x' } };
    const Debrief = load(session);
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });
    expect(linkCalls).toEqual([]);
    expect(sent.filter((s) => s.kind === 'image' || s.kind === 'text')).toEqual([]);
  });
});
