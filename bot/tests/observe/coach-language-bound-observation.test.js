/**
 * The coach is written to in the TEACHER's language on a bound observation.
 *
 * Staging, 15 Sep 2026, observation 6faab4ec: coach b2d42789 has
 * preferred_language en; the teacher bound through the visit Flow (9c6fb037)
 * has ur. On a bound observation `coaching_sessions.user_id` is the TEACHER and
 * `observer_user_id` is the coach. The coach received
 *   «کوئی بات نہیں! سبق کے منصوبے کے بغیر…»  (lesson-plan skip ack, 22:00Z)
 *   «مشاہدے کا فارم — مسودہ»                (draft form header, 22:03:38Z)
 * because both surfaces resolve language from the `users` join on user_id.
 * observe-language.js already owns "whose language is this?" —
 * languageFor('coach', session) reads observer_user_id — and these two did not
 * call it.
 *
 * Every case executes the service with only the database and WhatsApp mocked.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
// NIETE's market: the observe pack decides which languages exist, and the coach
// language is clamped to it. Without this the default pack is MEWAKA (sw/en).
process.env.OBSERVE_FRAMEWORK = 'fico';

const COACH_EN = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en' };
const COACH_UR = { id: 'coach-2', phone_number: '923000000002', preferred_language: 'ur' };
const TEACHER_UR = { id: 'teacher-1', phone_number: '923000000009', preferred_language: 'ur' };
const TEACHER_EN = { id: 'teacher-2', phone_number: '923000000008', preferred_language: 'en' };

function row({ teacher, coach }) {
  return {
    id: 'obs-1',
    user_id: teacher.id,
    observer_user_id: coach ? coach.id : null,
    observation_type: coach ? 'leader_observation' : null,
    transcript_language: 'ur',
    debrief_status: 'pending',
    analysis_data: {},
    autofill_analysis_data: {},
    users: { name: null, phone_number: teacher.phone_number, preferred_language: teacher.preferred_language },
  };
}

function supabaseMock(session, users) {
  return {
    from: (table) => {
      const b = { filters: {} };
      ['select', 'order', 'limit', 'in', 'not', 'or', 'update', 'insert'].forEach((m) => { b[m] = () => b; });
      b.eq = (c, v) => { b.filters[c] = v; return b; };
      const resolve = () => {
        if (table === 'coaching_sessions') return { data: session, error: null };
        if (table === 'users') {
          const [[c, v] = []] = Object.entries(b.filters);
          return { data: users.find((u) => u[c] === v) || null, error: null };
        }
        return { data: null, error: null };
      };
      b.single = async () => resolve();
      b.maybeSingle = async () => resolve();
      b.then = (ok, ko) => Promise.resolve(resolve()).then(ok, ko);
      return b;
    },
  };
}

const USERS = [COACH_EN, COACH_UR, TEACHER_UR, TEACHER_EN];

describe('lesson-plan skip ack', () => {
  let sent;

  function load(session) {
    jest.resetModules();
    sent = [];
    jest.doMock('../../shared/config/supabase', () => supabaseMock(session, USERS));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push({ to, text }); return true; }),
    }));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({ queueAnalysis: jest.fn(async () => true) }));
    jest.doMock('../../shared/services/coaching/coaching-session.service', () => ({}));
    jest.doMock('../../shared/storage/r2', () => ({ uploadLessonPlanBuffer: jest.fn(), buildR2PublicUrl: jest.fn() }));
    return require('../../shared/services/coaching/lesson-plan-processor.service');
  }

  const { getCoachingMessage } = require('../../shared/config/coaching-messages');

  test('an English coach observing an Urdu teacher gets the English ack', async () => {
    const LPP = load(row({ teacher: TEACHER_UR, coach: COACH_EN }));
    await LPP.handleLessonPlanResponse('obs-1', COACH_EN.phone_number, false);
    expect(sent[0]).toEqual({ to: COACH_EN.phone_number, text: getCoachingMessage('lessonPlan_skip', 'en') });
  });

  test('an Urdu coach observing an English teacher gets the Urdu ack', async () => {
    const LPP = load(row({ teacher: TEACHER_EN, coach: COACH_UR }));
    await LPP.handleLessonPlanResponse('obs-1', COACH_UR.phone_number, false);
    expect(sent[0].text).toBe(getCoachingMessage('lessonPlan_skip', 'ur'));
  });

  test("a teacher's own coaching session still follows the teacher", async () => {
    const LPP = load(row({ teacher: TEACHER_UR, coach: null }));
    await LPP.handleLessonPlanResponse('obs-1', TEACHER_UR.phone_number, false);
    expect(sent[0].text).toBe(getCoachingMessage('lessonPlan_skip', 'ur'));
  });
});

describe('draft FICO form wrapper', () => {
  let flows;

  function load(session) {
    jest.resetModules();
    process.env.OBSERVE_MEWAKA_FLOW_ID = 'flow-1';
    flows = [];
    jest.doMock('../../shared/config/supabase', () => supabaseMock(session, USERS));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendFlow: jest.fn(async (to, f) => { flows.push({ to, f }); return true; }),
      sendMessage: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => null),
      setState: jest.fn(async () => true),
    }));
    return require('../../shared/services/observe/observe-draft.service');
  }

  const { observeStrings } = require('../../shared/services/observe/observe-strings');

  test('an English coach observing an Urdu teacher gets the English header, body and button', async () => {
    const Draft = load(row({ teacher: TEACHER_UR, coach: COACH_EN }));
    await Draft.onAnalysisReady('obs-1', COACH_EN.phone_number);
    const en = observeStrings('en');
    expect(flows[0].to).toBe(COACH_EN.phone_number);
    expect(flows[0].f).toMatchObject({ header: en.flow_header, body: en.flow_body, buttonText: en.flow_button });
  });

  test('an Urdu coach observing an English teacher gets the Urdu wrapper', async () => {
    const Draft = load(row({ teacher: TEACHER_EN, coach: COACH_UR }));
    await Draft.onAnalysisReady('obs-1', COACH_UR.phone_number);
    expect(flows[0].f.header).toBe(observeStrings('ur').flow_header);
  });
});
