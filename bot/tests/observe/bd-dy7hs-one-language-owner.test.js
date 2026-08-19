/**
 * bd-dy7hs — the teacher report moves onto the resolver, and the language
 * toggle goes away. TDD, red-first.
 *
 * WHAT WAS WRONG
 * --------------
 * `processTeacherReport` derived BOTH languages from `session.users` — the FK
 * join on `coaching_sessions.user_id`. On a bound observation that row is the
 * TEACHER, so the coach's own acks came back in the teacher's language; on a
 * bare capture it is the coach, so the same line of code meant the opposite
 * thing. `resolveTeacherLang` then papered over the gap by falling back to the
 * coach's language, which is how a teacher who never chose one ended up reading
 * her feedback in English.
 *
 * bd-2673 answered that with a third button on the confirm step: the coach
 * flips the report's language by hand. It was the right fix for the wrong
 * layer — it asked a human to correct a resolution bug, once per report, and it
 * cost a full re-render (bd-rkofm: the re-render was then silently dropped by
 * SQS dedup, and the report never arrived at all).
 *
 * With `languageFor` owning the question, the button has nothing left to fix.
 * The teacher's own preference decides; the coach's never leaks in; a teacher
 * with no account gets the MARKET default, not whatever the coach speaks.
 *
 * `lang_override` values already written to analysis_data stay in the database
 * and simply stop being read — the record of what a coach chose survives, and
 * there is no migration.
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
          return { data: row ? { preferred_language: row } : null, error: null };
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

const SID = 'sess-dy7hs';

/** A BOUND observation: user_id is the teacher, observer_user_id is the coach. */
function boundSession(delivery = {}) {
  return {
    id: SID,
    user_id: TEACHER_ID,
    observer_user_id: COACH_ID,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'done',
    // The trap: this join is the TEACHER on a bound session.
    users: { phone_number: COACH_PHONE, first_name: 'Riffat', preferred_language: 'ur' },
    analysis_data: {
      framework: 'fico',
      teacher_delivery: {
        teacher_name: 'Kamran Afzal', teacher_phone: TEACHER_PHONE, status: 'previewing', ...delivery,
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.session = null; db.usersById = {}; db.usersByPhone = {};
  GPT5MiniService.completeJson.mockResolvedValue({ result: null });
});

describe('bd-dy7hs — the teacher\'s own language decides her report', () => {
  it('renders the report in the TEACHER\'s language while the coach keeps hers', async () => {
    db.session = boundSession();
    db.usersById = { [COACH_ID]: 'en', [TEACHER_ID]: 'ur' };
    db.usersByPhone = { [TEACHER_PHONE]: 'ur' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });

    expect(generateHeroReport).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ language: 'ur' }));
    // …and the coach's own confirm chrome is English, not the teacher's Urdu.
    const buttons = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    expect(buttons.body).toBe(observeStrings('en').send_confirm_body);
  });

  it('never leaks the coach\'s language into a teacher who has no account', async () => {
    // The coach reads Urdu. A teacher with no row must get the MARKET default
    // (en on fico) — not the language of the person standing next to her.
    db.session = boundSession();
    db.usersById = { [COACH_ID]: 'ur' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });

    expect(generateHeroReport).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ language: 'en' }));
  });

  it('treats a stale lang_override as absent — the row survives, nothing reads it', async () => {
    db.session = boundSession({ lang_override: 'ur' });
    db.usersById = { [COACH_ID]: 'en', [TEACHER_ID]: 'en' };
    db.usersByPhone = { [TEACHER_PHONE]: 'en' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });

    expect(generateHeroReport).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.objectContaining({ language: 'en' }));
    // and it is still on the record
    expect(db.session.analysis_data.teacher_delivery.lang_override).toBe('ur');
  });
});

describe('bd-dy7hs — the toggle is gone, not merely hidden', () => {
  it('offers send and cancel only — even when a caller still passes a language', () => {
    const S = observeStrings('en');
    for (const legacyArg of [undefined, 'en', 'ur']) {
      const p = ObserveSend.buildSendConfirmButtons(SID, S, legacyArg);
      expect(p.buttons.map((b) => b.id)).toEqual([
        `observe_send_confirm_${SID}`, `observe_send_cancel_${SID}`,
      ]);
    }
  });

  it('no longer exports the toggle or its helpers', () => {
    expect(ObserveSend.handleSendLangToggle).toBeUndefined();
    expect(ObserveSend.otherLang).toBeUndefined();
    expect(ObserveSend.resolveTeacherLang).toBeUndefined();
  });

  it('does not parse a language button id any more', () => {
    expect(ObserveSend.parseSendButtonId(`observe_send_lang_${SID}`)).toBeNull();
    // the surviving buttons still parse
    expect(ObserveSend.parseSendButtonId(`observe_send_confirm_${SID}`))
      .toEqual({ action: 'confirm', sessionId: SID });
  });

  it('has no dispatch left in the webhook entry point', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../whatsapp-bot.js'), 'utf8');
    expect(src).not.toMatch(/handleSendLangToggle/);
  });

  it('drops the toggle copy from every string pack', () => {
    for (const l of ['en', 'ur', 'sw']) {
      const S = observeStrings(l);
      expect(S.send_lang_switching).toBeUndefined();
      expect(S.btn_send_in_ur).toBeUndefined();
      expect(S.btn_send_in_en).toBeUndefined();
    }
  });
});

describe('bd-dy7hs — the coach\'s own acks stay in HER language', () => {
  it('nudges an untapped teacher in the coach\'s language, not the observed teacher\'s', async () => {
    // Same defect, same file: processUntappedDelivery also read session.users.
    db.session = boundSession({
      status: 'awaiting_teacher_tap',
      template_sent_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
      report_key: 'k', nudge_count: 0,
    });
    db.usersById = { [COACH_ID]: 'en', [TEACHER_ID]: 'ur' };
    db.usersByPhone = { [TEACHER_PHONE]: 'ur' };

    const decision = await ObserveSend.processUntappedDelivery(SID);
    expect(decision.action).toBe('nudge');

    const coachLines = WhatsAppService.sendMessage.mock.calls
      .filter((c) => c[0] === COACH_PHONE).map((c) => c[1]).join('\n');
    // English pack, because the COACH reads English — even though the session
    // row's `users` join (the observed teacher) says Urdu.
    expect(coachLines).toContain(observeStrings('en').send_nudged_fo.split('{name}')[1].trim());
  });
});
