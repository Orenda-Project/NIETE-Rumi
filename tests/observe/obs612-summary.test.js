'use strict';
/**
 * bd-pni007 — what the coach reads in chat the moment an FDE (obs612) form is saved.
 *
 * Pure part (buildCoachSummary): the visit in one message, from the coach's own answers only (no model call):
 * "Saved. <teacher> · Grade N · <Subject>", the tool and FDE's own result (English & Urdu: total / max · % · band;
 * General: Yes on x of 35; Maths & Science: levels only, FDE gives no total), strongest and lowest, a short "For the
 * talk with the teacher" built from what the coach wrote, and the tiny label line "FDE v1". Never a FICO number.
 *
 * Send part (sendCoachSummary): reads the coach's phone + language and the teacher's name from users, sends ONE
 * buttons message whose buttons are the existing send-report ids (observe_send_start_<sid> → ObserveSend.startSendFlow,
 * observe_send_later_<sid> → handleSendLater, both already routed in whatsapp-bot.js). Never throws.
 *
 * Real: frameworks/obs612, the record (fixtures), observe-send's id parser, observe-strings. Mocked at the boundary:
 * WhatsApp, the database, the logger.
 */

const F = require('../fixtures/obs612-visits');

const SID = 'sess-fde-1';
const COACH = { id: F.COACH_ID, name: 'Coach Sana', phone_number: '923000000201', preferred_language: 'en' };
const TEACHER = { id: F.TEACHER_ID, name: 'Ayesha Khan', phone_number: '923000000301', preferred_language: 'ur' };

const cp = (s) => [...String(s)].length;
// The isolates (LRI/FSI … PDI) around FDE's English and the coach's own words are invisible; compare without them.
const plain = (s) => String(s).replace(/[\u2066-\u2069]/g, '');

let mockWa;
let mockLog;
let mockUsers;
let mockSession;
let mockThrow;

function load() {
  jest.resetModules();
  mockLog = [];
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: (msg, meta, level) => mockLog.push({ msg, meta, level }),
  }));
  jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
  jest.doMock('../../bot/shared/config/supabase', () => {
    const { chain } = require('../quiz/helpers/supabase-chain');
    return {
      from: jest.fn((table) => {
        if (mockThrow) throw new Error('db down');
        return chain(() => ({
          data: table === 'users' ? mockUsers : (table === 'coaching_sessions' ? mockSession : null), error: null,
        }));
      }),
    };
  });
  return require('../../bot/shared/services/observe/obs612/summary');
}

beforeEach(() => {
  mockWa = {
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
  };
  mockUsers = [COACH, TEACHER];
  mockSession = F.sessionRow(F.enur());
  mockThrow = false;
});

describe('buildCoachSummary — English & Urdu tool', () => {
  test('saved line, FDE result, strongest and lowest, the talk guide from Section 8, the label', () => {
    const { buildCoachSummary } = load();
    const text = buildCoachSummary(F.enur(), { lang: 'en', teacherName: 'Ayesha Khan' });
    expect(text).toMatch(/^✅ Saved\. Ayesha Khan · Grade 7 · English/);
    expect(text).toContain('English & Urdu tool: 109 / 148 · 79.5 / 108 · Proficient');
    expect(text).toMatch(/Strongest: D\. Interest & Motivation \(8\/8\)/);
    expect(text).toMatch(/Lowest: C\. Reading Skills \(4\/8\)/);
    expect(text).toContain('For the talk with the teacher');
    expect(text).toContain('Clear objectives and a warm tone with every student.');
    expect(text).toContain('Checking reading comprehension during the lesson.');
    expect(text).toContain('Ask two why-questions after each paragraph.');
    expect(text).toContain('Next two weeks');
    expect(text.trim().split('\n').pop()).toBe('_FDE v1_');
    expect(text).not.toMatch(/FICO/);
  });

  test('no teacher named: the saved line names the lesson only', () => {
    const { buildCoachSummary } = load();
    const text = buildCoachSummary(F.enur(), { lang: 'en' });
    expect(text).toMatch(/^✅ Saved\. Grade 7 · English\n/);
  });

  test('the Urdu sheet scores out of 156', () => {
    const { buildCoachSummary } = load();
    const text = buildCoachSummary(F.enur({ sheet: 'ur' }), { lang: 'en' });
    expect(text).toMatch(/English & Urdu tool: \d+ \/ 156 · /);
    expect(text).toMatch(/Grade 7 · Urdu/);
  });
});

describe('buildCoachSummary — General form', () => {
  test('Yes counts only, never a %, the strongest and lowest sections, the coach\'s line', () => {
    const { buildCoachSummary } = load();
    const text = buildCoachSummary(F.gen(), { lang: 'en', teacherName: 'Bilal' });
    expect(text).toMatch(/^✅ Saved\. Bilal · Grade 10 · Social Studies/);
    expect(text).toContain('General form: Yes on 29 of 35');
    expect(text).toMatch(/Lowest: STUDENT ASSESSMENT PROCESS \(0 of 2\)/);
    expect(text).toMatch(/Strongest: CLASSROOM ENVIRONMENT \(6 of 6\)/);
    expect(text).toContain('A good start: add pair work, and check answers at the end.');
    // The talk guide names what to look at together: the "No" items of the lowest section.
    expect(text).toContain('Look at together: Students are assessed during and end of lesson; A variety of assessment strategies are used');
    expect(text).not.toMatch(/%/);
    expect(text).toMatch(/_FDE v1_$/);
  });
});

describe('buildCoachSummary — Maths & Science tool', () => {
  test('levels in short, highest and lowest indicators, the 5-student check, the plan, and no total', () => {
    const { buildCoachSummary } = load();
    const text = plain(buildCoachSummary(F.msci(), { lang: 'en', teacherName: 'Ali' }));
    expect(text).toMatch(/^✅ Saved\. Ali · Grade 7 · Maths/);
    expect(text).toContain('Maths & Science tool: 11 indicators, Level 0-3. FDE gives no total.');
    expect(text).toContain('Levels: 2 at Level 3 · 5 at Level 2 · 3 at Level 1 · 1 at Level 0');
    expect(text).toMatch(/Highest: 3 Command on the content, 4 Communication and delivery \(Level 3\)/);
    expect(text).toMatch(/Lowest: 9 Wrapping up the lesson \(Level 0\)/);
    expect(text).toContain('5 students checked: 3-4 of 5 understood');
    expect(text).toContain('Wrapping up the lesson: Level 0 → Level 1. Close with a two-minute summary and homework on the board.');
    expect(text).not.toMatch(/%|\/\s*33|\btotal of\b/);
    expect(text).toMatch(/_FDE v1_$/);
  });
});

describe('buildCoachSummary — Urdu', () => {
  test('Urdu chrome, Urdu digits in Urdu prose, FDE\'s band kept in English, the label', () => {
    const { buildCoachSummary } = load();
    const text = buildCoachSummary(F.enur(), { lang: 'ur', teacherName: 'Ayesha Khan' });
    expect(text).toMatch(/محفوظ/);
    expect(text).toMatch(/جماعت ۷/);
    expect(text).toContain('Proficient');
    expect(text).toMatch(/۱۰۹ \/ ۱۴۸/);
    expect(text).toMatch(/_FDE v1_$/);
  });
});

describe('buildCoachSummary — not an FDE visit', () => {
  test('a FICO analysis gets null, never a guess', () => {
    const { buildCoachSummary } = load();
    expect(buildCoachSummary({ framework: 'fico', scores: { overall_percentage: 60 } }, { lang: 'en' })).toBeNull();
    expect(buildCoachSummary(null, { lang: 'en' })).toBeNull();
  });
});

describe('sendCoachSummary', () => {
  test('one buttons message to the coach: the existing send-report ids for this session, the teacher named', async () => {
    const S = load();
    const { parseSendButtonId } = require('../../bot/shared/services/observe/observe-send.service');
    const out = await S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis: F.enur() });
    expect(out).toMatchObject({ sent: true });
    expect(mockWa.sendInteractiveButtons).toHaveBeenCalledTimes(1);
    const [to, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(to).toBe(COACH.phone_number);
    expect(payload.body).toMatch(/Saved\. Ayesha Khan · Grade 7 · English/);
    expect(payload.body).toMatch(/Send Ayesha Khan the FDE report\?/);
    expect(cp(payload.body)).toBeLessThanOrEqual(1024);
    const ids = payload.buttons.map((b) => b.id);
    expect(ids).toEqual([`observe_send_start_${SID}`, `observe_send_later_${SID}`]);
    expect(parseSendButtonId(ids[0])).toEqual({ action: 'start', sessionId: SID });
    expect(parseSendButtonId(ids[1])).toEqual({ action: 'later', sessionId: SID });
    for (const b of payload.buttons) expect(cp(b.title)).toBeLessThanOrEqual(20);
    expect(payload.buttons.map((b) => b.title)).toEqual(['Send report', 'Later']);
    expect(mockWa.sendMessage).not.toHaveBeenCalled();
  });

  test('the coach\'s Urdu: Urdu body and Urdu button titles', async () => {
    mockUsers = [{ ...COACH, preferred_language: 'ur' }, TEACHER];
    const S = load();
    await S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis: F.msci() });
    const [, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(payload.body).toMatch(/جماعت ۷/);
    expect(payload.buttons.map((b) => b.title)).toEqual(['رپورٹ بھیجیں', 'بعد میں']);
  });

  test('a summary over the 1,024 body cap goes as text first, then the buttons with the question alone', async () => {
    const long = 'Very long note about the lesson. '.repeat(40);
    const S = load();
    const analysis = F.enur({ over: { fb_strengths: long, fb_areas: long, fb_recommendations: long } });
    await S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis });
    const [, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(cp(payload.body)).toBeLessThanOrEqual(1024);
    expect(payload.buttons[0].id).toBe(`observe_send_start_${SID}`);
    if (mockWa.sendMessage.mock.calls.length) {
      expect(mockWa.sendMessage.mock.calls[0][1]).toMatch(/Saved\./);
      expect(mockWa.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(mockWa.sendInteractiveButtons.mock.invocationCallOrder[0]);
    }
  });

  test('buttons refused: the coach still gets the summary as text, and the refusal is logged at error', async () => {
    mockWa.sendInteractiveButtons.mockResolvedValue(false);
    const S = load();
    const out = await S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis: F.gen() });
    expect(out.sent).toBe(true);
    expect(mockWa.sendMessage).toHaveBeenCalledWith(COACH.phone_number, expect.stringMatching(/Yes on 29 of 35/));
    expect(mockLog.some((l) => l.level === 'error')).toBe(true);
  });

  test('no teacher on the form: the teacher is the session\'s bound user, else nobody', async () => {
    mockSession = F.sessionRow(F.enur({ teacher: false }), { user_id: F.COACH_ID });
    mockUsers = [COACH];
    const S = load();
    await S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis: F.enur({ teacher: false }) });
    const [, payload] = mockWa.sendInteractiveButtons.mock.calls[0];
    expect(payload.body).toMatch(/Saved\. Grade 7 · English/);
    expect(payload.body).toMatch(/Send the teacher the FDE report\?/);
  });

  test('never throws: a database failure is logged and answered { sent: false }', async () => {
    mockThrow = true;
    const S = load();
    await expect(S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis: F.enur() }))
      .resolves.toMatchObject({ sent: false });
    expect(mockLog.some((l) => l.level === 'error')).toBe(true);
    expect(mockWa.sendInteractiveButtons).not.toHaveBeenCalled();
  });

  test('not an FDE analysis: nothing is sent', async () => {
    const S = load();
    const out = await S.sendCoachSummary({ coachUserId: F.COACH_ID, sessionId: SID, analysis: { framework: 'fico' } });
    expect(out).toMatchObject({ sent: false });
    expect(mockWa.sendInteractiveButtons).not.toHaveBeenCalled();
  });
});

describe('the debrief entry on an FDE row (observe-debrief buildDebriefGuide)', () => {
  // An FDE visit is saved with debrief_status 'pending', so it sits in the coach's /observe list under the debriefs
  // and a tap opens the debrief. Its guide is the coach's own talk guide, as written: no model call, never the FICO
  // guide (whose prompt reads FICO domains an FDE visit does not have).
  function loadDebrief() {
    jest.resetModules();
    mockLog = [];
    const llm = { completeJson: jest.fn(async () => { throw new Error('the FICO guide model must not run on an FDE row'); }) };
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: (msg, meta, level) => mockLog.push({ msg, meta, level }) }));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => mockWa);
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => llm);
    jest.doMock('../../bot/shared/config/supabase', () => {
      const { chain } = require('../quiz/helpers/supabase-chain');
      return { from: jest.fn(() => chain(() => ({ data: null, error: null }))) };
    });
    return { Debrief: require('../../bot/shared/services/observe/observe-debrief.service'), llm };
  }

  test.each([['enur', 'en'], ['msci', 'en'], ['gen', 'ur']])('%s (%s): the talk guide, no model call', async (tool, lang) => {
    const { Debrief, llm } = loadDebrief();
    const { buildTalkGuide } = require('../../bot/shared/services/observe/obs612/summary');
    const analysis = F[tool]();
    const guide = await Debrief.buildDebriefGuide(F.sessionRow(analysis), lang);
    expect(llm.completeJson).not.toHaveBeenCalled();
    expect(guide).toMatchObject({ kind: 'obs612_talk' });
    expect(guide.text).toBe(buildTalkGuide(analysis, { lang }));
    const { renderGuideMessage } = require('../../bot/shared/services/observe/observe-debrief-guide');
    expect(renderGuideMessage(guide, {})).toBe(guide.text);
    expect(guide.text).not.toMatch(/FICO/);
  });

  test('a FICO row still gets the FICO guide path (the model is asked)', async () => {
    const { Debrief, llm } = loadDebrief();
    await Debrief.buildDebriefGuide({ id: 's-fico', user_id: 't', analysis_data: { framework: 'fico', domains: {} } }, 'en');
    expect(llm.completeJson).toHaveBeenCalled();
  });
});
