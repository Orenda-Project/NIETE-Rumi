/**
 * bd-c3uq9 — the debrief notes stop reading `session.users`. TDD, red-first.
 *
 * The notes are TEACHER-FACING: an LLM summary of the debrief conversation,
 * wrapped by buildCompanionText and sent to the teacher alongside her report.
 * The coach sees them once, at preview, only to approve them.
 *
 * `_extractNotes` chose their language with `observeLang(session.users)` — the
 * same FK join that is the TEACHER on a bound observation and the COACH on a
 * bare one. So the note attached to a teacher's report was written in whichever
 * person happened to own the row. It follows the teacher, like the rest of what
 * she receives; nothing about it is split (spec §2.1 D2).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

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
      select: () => chain, eq: () => chain, neq: () => chain, order: () => chain,
      limit: async () => ({ data: [], error: null }),
      single: async () => (db.session ? { data: db.session, error: null }
        : { data: null, error: { message: 'not found' } }),
      update: (patch) => {
        if (db.session) db.session = { ...db.session, ...patch };
        return { eq: async () => ({ error: null }) };
      },
    };
    return chain;
  }),
}));

const GPT5MiniService = require('../../shared/services/gpt5-mini.service');
const ObserveSend = require('../../shared/services/observe/observe-send.service');

const SID = 'sess-c3uq9';
const DEBRIEF = 'The officer and the teacher talked about questioning. '.repeat(20);

function session({ debrief = DEBRIEF, rubric = null } = {}) {
  return {
    id: SID,
    user_id: TEACHER_ID,
    observer_user_id: COACH_ID,
    observation_type: 'leader_observation',
    status: 'observer_review_complete',
    debrief_status: 'done',
    // the trap: the join is the observed TEACHER on a bound session
    users: { phone_number: COACH_PHONE, first_name: 'Riffat', preferred_language: 'en' },
    analysis_data: {
      framework: 'fico',
      observer_debrief: { transcript: debrief, ...(rubric ? { feedback: { rubric } } : {}) },
      teacher_delivery: {
        teacher_name: 'Kamran Afzal', teacher_phone: TEACHER_PHONE, status: 'previewing',
      },
    },
  };
}

const notesPrompt = () => {
  const call = GPT5MiniService.completeJson.mock.calls[0];
  return call ? String(call[0]) : '';
};

beforeEach(() => {
  jest.clearAllMocks();
  db.session = null; db.usersById = {}; db.usersByPhone = {};
  GPT5MiniService.completeJson.mockResolvedValue({
    result: { discussed_sw: 'You talked about questioning.', commitment_sw: null },
  });
});

describe('bd-c3uq9 — the note follows the TEACHER', () => {
  it('is written in the teacher\'s language even when the coach reads another', async () => {
    db.session = session();
    db.usersById = { [COACH_ID]: 'en', [TEACHER_ID]: 'ur' };
    db.usersByPhone = { [TEACHER_PHONE]: 'ur' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });

    expect(GPT5MiniService.completeJson).toHaveBeenCalled();
    expect(notesPrompt()).toContain('Urdu');
    expect(notesPrompt()).not.toContain('in English');
  });

  it('is English when the TEACHER is English, whatever the coach reads', async () => {
    db.session = session();
    db.usersById = { [COACH_ID]: 'ur', [TEACHER_ID]: 'en' };
    db.usersByPhone = { [TEACHER_PHONE]: 'en' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });
    expect(notesPrompt()).toContain('English');
    expect(notesPrompt()).not.toContain('Urdu (اردو)');
  });

  it('falls to the market default for a teacher with no account — never the coach\'s Urdu', async () => {
    db.session = session();
    db.usersById = { [COACH_ID]: 'ur' };   // teacher has no row at all

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });
    expect(notesPrompt()).toContain('English');
  });

  it('derives nothing from session.users — the join is not read for language', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/services/observe/observe-send.service.js'), 'utf8');
    // Comments are stripped first: the file explains the old call by name, and
    // an assertion that a FILE never mentions its own history would push the
    // reasoning out of the code to satisfy a test.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/observeLang\(session\.users\)/);
    expect(code).not.toMatch(/clampToMarket\(observeLang\(session/);
  });
});

describe('bd-c3uq9 — the harm gate is untouched (bd-37)', () => {
  it('ships no notes at all for a harmful debrief, in any language', async () => {
    db.session = session({ rubric: { disparaged_teacher: true } });
    db.usersById = { [COACH_ID]: 'en', [TEACHER_ID]: 'ur' };
    db.usersByPhone = { [TEACHER_PHONE]: 'ur' };

    await ObserveSend.processTeacherReport(SID, { phase: 'preview', from: COACH_PHONE });

    expect(GPT5MiniService.completeJson).not.toHaveBeenCalled();
    expect(db.session.analysis_data.teacher_delivery.companion_text).toBeFalsy();
  });
});
