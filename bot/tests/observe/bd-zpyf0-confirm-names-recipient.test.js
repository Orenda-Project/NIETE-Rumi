/**
 * bd-zpyf0 — HITL row 190: the confirm step names who the report is going to.
 *
 * WHAT WAS WRONG
 * --------------
 * After the coach picks (or the session carries) a teacher, the bot says
 * "Got it — {name} ({phone}). I'm preparing the report…", then 1–2 minutes
 * later sends the report image + companion text, and only THEN asks
 * "Above is the exact report the teacher will receive… Send it now?".
 * The recipient's name is three messages and a full-screen image above the
 * decision, so the Send button is pressed without seeing who it goes to — the
 * wrong-teacher risk the HITL tester reported.
 *
 * The confirm body now names the recipient (name + number) right above the
 * buttons: Send now (yes) / Someone else (no — back to the teacher pick) /
 * Cancel. Coach's language, WhatsApp body cap respected.
 */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';   // NIETE: offers ur/en, defaults en

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageFromBuffer: jest.fn().mockResolvedValue(true),
  sendTemplate: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn().mockResolvedValue(null),
  setState: jest.fn().mockResolvedValue(true),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/gpt5-mini.service', () => ({ completeJson: jest.fn() }));
jest.mock('../../shared/services/coaching/report-v2/hero-report.service', () => ({
  generateHeroReport: jest.fn().mockResolvedValue({ png: Buffer.from('png'), caption: 'cap' }),
}));
jest.mock('../../shared/storage/r2', () => ({
  uploadImageBuffer: jest.fn().mockResolvedValue('https://r2/x.png'),
  downloadFromR2: jest.fn().mockResolvedValue(Buffer.from('png')),
}));
jest.mock('../../shared/services/quiz/quiz-delivery.service', () => ({
  _hasOpenMessageWindow: jest.fn().mockResolvedValue(true),
}));

const COACH_ID = 'coach-1';
const TEACHER_ID = 'teacher-1';
const COACH_PHONE = '923200000001';
const TEACHER_PHONE = '923001112222';

// A users table plus one coaching_sessions row. `users` answers .maybeSingle()
// keyed on the column the caller filtered by, so a test can prove WHICH person
// was looked up rather than merely which language came back.
const db = { session: null, usersById: {}, usersByPhone: {} };

jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'users') {
      let col = null; let val = null;
      const chain = {
        select: () => chain,
        eq: (c, v) => { col = c; val = v; return chain; },
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          const row = col === 'id' ? db.usersById[val] : db.usersByPhone[val];
          if (!row) return { data: null, error: null };
          // The identity resolver reads name + phone off the same row, so the
          // double answers WHO as well as which language.
          const id = col === 'id' ? val : (val === TEACHER_PHONE ? TEACHER_ID : COACH_ID);
          const phone = id === TEACHER_ID ? TEACHER_PHONE : COACH_PHONE;
          const name = id === TEACHER_ID ? 'Najma Kousar' : 'Misbah Iqbal';
          return { data: { id, name, phone_number: phone, preferred_language: row }, error: null };
        },
        single: async () => ({ data: null, error: { message: 'not found' } }),
      };
      return chain;
    }
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      single: async () => (db.session
        ? { data: db.session, error: null }
        : { data: null, error: { message: 'not found' } }),
      update: (patch) => {
        if (db.session) db.session = { ...db.session, ...patch };
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  }),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const { generateHeroReport } = require('../../shared/services/coaching/report-v2/hero-report.service');
const ObserveSend = require('../../shared/services/observe/observe-send.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const SID = 'sess-zpyf0';

/** A BOUND observation: user_id is the teacher, observer_user_id is the coach. */
function boundSession() {
  return {
    id: SID,
    user_id: TEACHER_ID,
    observer_user_id: COACH_ID,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'done',
    users: { phone_number: COACH_PHONE, first_name: 'Riffat', preferred_language: 'ur' },
    analysis_data: {
      framework: 'fico',
      teacher_delivery: { teacher_name: 'Kamran Afzal', teacher_phone: TEACHER_PHONE, status: 'previewing' },
    },
  };
}

const cp = (s) => [...String(s)].length;

beforeEach(() => {
  jest.clearAllMocks();
  db.session = null; db.usersById = {}; db.usersByPhone = {};
  GPT5MiniService.completeJson.mockResolvedValue({ result: null });
});

describe('bd-zpyf0 — the send confirm names the recipient', () => {
  it.each(['en', 'ur'])('the confirm body in %s names the teacher and her number', async (coachLang) => {
    db.session = boundSession();
    db.usersById = { [COACH_ID]: coachLang, [TEACHER_ID]: 'ur' };
    db.usersByPhone = { [TEACHER_PHONE]: 'ur' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });

    const [to, payload] = WhatsAppService.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(COACH_PHONE);
    expect(payload.body).toContain('Kamran Afzal');
    expect(payload.body).toContain(`+${TEACHER_PHONE}`);
    expect(payload.body).not.toMatch(/\{name\}|\{phone\}/);
    expect(cp(payload.body)).toBeLessThanOrEqual(1024);
    // yes / no-pick-another / cancel — ids unchanged so live taps still route
    expect(payload.buttons.map((b) => b.id)).toEqual([
      `observe_send_confirm_${SID}`, `observe_send_other_${SID}`, `observe_send_cancel_${SID}`,
    ]);
    payload.buttons.forEach((b) => expect(cp(b.title)).toBeLessThanOrEqual(20));
  });

  it.each(['en', 'ur', 'sw'])('every %s confirm template carries both placeholders', (lang) => {
    const S = observeStrings(lang);
    expect(S.send_confirm_body).toContain('{name}');
    expect(S.send_confirm_body).toContain('{phone}');
  });

  it('a nameless roster row leaves no dangling gap before the number', () => {
    const S = observeStrings('en');
    const { body } = ObserveSend.buildSendConfirmButtons(SID, S, { name: '', phone: TEACHER_PHONE });
    expect(body).toContain(`+${TEACHER_PHONE}`);
    expect(body).not.toMatch(/ {2,}/);
    expect(body).not.toMatch(/\{name\}|\{phone\}/);
  });
});
