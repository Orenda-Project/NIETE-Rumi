/**
 * The coach reads her own language on the debrief SUCCESS path too.
 *
 * #1007 fixed the two surfaces the E2E asserted (the lesson-plan skip ack and
 * the draft form wrapper). The QA rerun found the same root cause still standing
 * on the success path, where ONE resolved value drives five surfaces:
 * processDebriefRecording computes `lang = observeLang(session.users)` — the
 * `users` join rides `user_id`, which is the observed TEACHER on a bound
 * observation — and hands the resulting strings pack to _deliverCoachFeedback,
 * which sends the praise line, renders the coach card IMAGE in that language,
 * captions it, falls back to the text card in it, and builds the send prompt and
 * its buttons («رپورٹ بھیجیں» / «بعد میں») from it.
 *
 * Net effect for an English coach observing an Urdu teacher: Urdu send prompt →
 * English "Got it" → Urdu preview caption → English confirm.
 *
 * observe-language.js already owns the answer: languageFor('coach', session)
 * reads observer_user_id. The mirror-image bug is just as real, so the teacher's
 * own artefacts must keep languageFor('teacher', session) — asserted below.
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

describe('the debrief success path', () => {
  let sent; let cardCalls; let promptLangs;

  function load(session) {
    jest.resetModules();
    sent = []; cardCalls = []; promptLangs = [];
    jest.doMock('../../shared/config/supabase', () => db(session, USERS));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
      sendImageFromBuffer: jest.fn(async (to, buf, caption) => { sent.push({ kind: 'image', to, caption }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, p }); return true; }),
      downloadMedia: jest.fn(async () => Buffer.from('fake audio data')),
    }));
    jest.doMock('../../shared/services/observe/observe-coach-card', () => ({
      renderCoachCard: jest.fn(async (fb, opts) => { cardCalls.push(opts); return Buffer.from('png'); }),
    }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => null), setState: jest.fn(async () => true), clearState: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-completion', () => ({
      maybeCompleteObservation: jest.fn(async () => true),
    }));
    // Capture the language the coach-feedback prompt is built in.
    const realFeedback = jest.requireActual('../../shared/services/observe/observe-coach-feedback');
    jest.doMock('../../shared/services/observe/observe-coach-feedback', () => ({
      ...realFeedback,
      buildCoachFeedbackPromptI18n: jest.fn((t, o, lang) => { promptLangs.push(lang); return 'PROMPT'; }),
    }));
    return require('../../shared/services/observe/observe-debrief.service');
  }

  test('an English coach observing an Urdu teacher gets every success surface in English', async () => {
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_EN }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });

    const en = observeStrings('en');
    // the praise line and the card
    expect(sent[0]).toMatchObject({ kind: 'text', to: COACH_EN.phone_number });
    expect(sent[0].text).toBe(FEEDBACK().praise_line);
    const image = sent.find((s) => s.kind === 'image');
    expect(image.caption).toBe(en.coach_card_closing);
    expect(cardCalls[0]).toMatchObject({ lang: 'en' });
    // the send prompt and its buttons — the mixed-language step QA reported
    const buttons = sent.find((s) => s.kind === 'buttons');
    expect(buttons.p.body).toBe(en.send_choice_body);
    expect(buttons.p.buttons.map((b) => b.title)).toEqual([en.btn_send_report, en.btn_send_later]);
  });

  test('an Urdu coach observing an English teacher still gets Urdu (the mirror case)', async () => {
    const Debrief = load(row({ teacher: TEACHER_EN, coach: COACH_UR }));
    await Debrief.processDebriefRecording(SID, { from: COACH_UR.phone_number });

    const ur = observeStrings('ur');
    expect(sent.find((s) => s.kind === 'image').caption).toBe(ur.coach_card_closing);
    expect(cardCalls[0]).toMatchObject({ lang: 'ur' });
    expect(sent.find((s) => s.kind === 'buttons').p.buttons[0].title).toBe(ur.btn_send_report);
  });

  test('the coach-feedback prompt is built in the COACH\'s language', async () => {
    const Debrief = load(row({ teacher: TEACHER_UR, coach: COACH_EN, feedback: null, transcript: 'a'.repeat(400) }));
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn(async () => ({ result: FEEDBACK() })) }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });

    expect(promptLangs).toContain('en');
    expect(promptLangs).not.toContain('ur');
  });

  test('the failure notice is in the COACH\'s language', async () => {
    const session = row({ teacher: TEACHER_UR, coach: COACH_EN, feedback: null, transcript: 'a'.repeat(400) });
    const Debrief = load(session);
    jest.doMock('../../shared/services/gpt5-mini.service', () => ({
      completeJson: jest.fn(async () => { throw new Error('llm down'); }),
    }));
    await Debrief.processDebriefRecording(SID, { from: COACH_EN.phone_number });

    expect(sent.map((s) => s.text)).toContain(observeStrings('en').debrief_feedback_failed);
  });
});

describe('the preview line for a teacher with no name on file', () => {
  // QA saw "Got it —  (+9933…)" — two spaces. `_person` turns an empty name into
  // null, startSendFlow passes `boundTeacher.name || ''`, and the template's
  // "{name} ({phone})" then leaves the gap where the name would have been.
  const UUID = 'd2163959-2942-4667-abb8-ab89c8cf7408';
  const NAMELESS = { id: 'teacher-nameless', name: '', phone_number: '993330000201', preferred_language: 'ur' };
  let sent;

  function load(coach) {
    jest.resetModules();
    sent = [];
    const session = {
      id: UUID,
      status: 'observer_review_complete',
      user_id: NAMELESS.id,
      observer_user_id: coach.id,
      observation_type: 'leader_observation',
      analysis_data: { framework: 'fico' },
      users: { name: NAMELESS.name, phone_number: NAMELESS.phone_number, preferred_language: NAMELESS.preferred_language },
    };
    jest.doMock('../../shared/config/supabase', () => db(session, [...USERS, NAMELESS]));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, text) => { sent.push({ to, text }); return true; }),
      sendInteractiveButtons: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      setState: jest.fn(async () => true), getState: jest.fn(async () => null), clearState: jest.fn(async () => true),
    }));
    jest.doMock('../../shared/services/observe/observe-roster', () => ({
      upsertTeacher: jest.fn(async () => true), getRoster: jest.fn(async () => []),
    }));
    jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({
      queueObserveTeacherReport: jest.fn(async () => true),
    }));
    return require('../../shared/services/observe/observe-send.service');
  }

  test('the line has no doubled space where the name would be', async () => {
    const Send = load(COACH_EN);
    await Send.startSendFlow(UUID, COACH_EN.phone_number, COACH_EN);

    const preview = sent.find((m) => /\+993330000201/.test(m.text));
    expect(preview).toBeDefined();
    expect(preview.text).not.toMatch(/ {2}/);
    expect(preview.text).not.toMatch(/—\s{2,}\(/);
  });

  test('a named teacher still reads normally, in every language (the fence)', async () => {
    const { fillPreviewComing } = require('../../shared/services/observe/observe-send.service');
    ['en', 'ur', 'sw'].forEach((code) => {
      const S = observeStrings(code);
      const named = fillPreviewComing(S, 'Ayesha Khan', '993330000201');
      expect(named).toContain('Ayesha Khan');
      expect(named).not.toMatch(/ {2}/);
      const nameless = fillPreviewComing(S, '', '993330000201');
      expect(nameless).not.toMatch(/ {2}/);
      expect(nameless).toContain('+993330000201');
    });
  });
});
