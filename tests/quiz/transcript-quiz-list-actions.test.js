'use strict';
/**
 * bd-mg9c7.63 (TQ-R5 lane F) — what a tap on a SENT lesson does, and the three
 * things the round-5 render of the list showed were still wrong.
 *
 * The operator, on tapping one of his lessons:
 *   "it should be within that flow that it asks me on the next screen whether
 *    a) I'd like to regenerate the report or b) resend the link — if I pick the
 *    latter, the same flow should happen where it sends me the pre-send PDF and
 *    then the quiz link (as it happens when I do it after my coaching flow —
 *    right now it just gives me the link to forward)."
 *   "The link, as agreed, should be the same one that was originally used."
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-report.service', () => ({ generate: jest.fn().mockResolvedValue(true) }));
jest.mock('../../bot/shared/services/quiz/transcript-quiz-handoff.service', () => ({
  sendHandoff: jest.fn().mockResolvedValue({ ok: true, code: 'ABC123', pdfSent: true, reused: true }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const { installFrom } = require('./helpers/supabase-chain');
const List = require('../../bot/shared/services/quiz/transcript-quiz-list.service');
const Rows = require('../../bot/shared/services/quiz/transcript-quiz-rows');

const cp = (s) => [...String(s)].length;
const PHONE = '923001234567';
const USER = { id: 'u-1', preferred_language: 'en' };
const QUIZ = {
  id: 'q-1', teacher_id: 'u-1', status: 'sent', language: 'en',
  topic: 'Fractions and Their Types', subject: 'maths', coaching_session_id: 'sess-1',
  meta: { share_code: 'ABC123', share_code_id: 'sc-1', link: 'https://wa.me/1?text=QUIZ-ABC123', student_message: 'forward me', pdf_key: 'k.pdf' },
};
const SESSION = {
  id: 'sess-1', user_id: 'u-1', created_at: '2026-09-04T05:00:00Z', transcript_text: 'x'.repeat(3000),
  transcript_language: 'ur', analysis_data: { topic: 'Fractions and Their Types', subject: 'Maths' },
};

beforeEach(() => { jest.clearAllMocks(); process.env.TRANSCRIPT_QUIZ_ENABLED = 'true'; });

describe('the screen a sent lesson opens', () => {
  beforeEach(() => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [SESSION] },
      quizzes: { data: [QUIZ] },
      quiz_sessions: { data: [{ quiz_id: 'q-1', status: 'completed' }, { quiz_id: 'q-1', status: 'in_progress' }] },
      users: { data: [{ phone_number: PHONE, preferred_language: 'en' }] },
    });
  });

  test('offers Resend link, Regenerate report AND a way back to the lessons', async () => {
    expect(await List.handleListPick('tq_pick_sess-1', PHONE, USER)).toBe(true);
    const payload = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    const titles = payload.buttons.map((b) => b.title);
    expect(titles).toEqual(['Resend link', 'Regenerate report', 'Back to lessons']);
    payload.buttons.forEach((b) => expect(cp(b.title)).toBeLessThanOrEqual(20));
    expect(payload.buttons.map((b) => b.id)).toEqual(['tq_link_q-1', 'tq_report_q-1', 'tq_back_q-1']);
  });

  test('the body names the lesson AND its date, not just the topic', async () => {
    await List.handleListPick('tq_pick_sess-1', PHONE, USER);
    const body = WhatsAppService.sendInteractiveButtons.mock.calls[0][1].body;
    expect(body).toMatch(/Fractions and Their Types/);
    expect(body).toMatch(/4 Sep/);            // the lesson she is choosing between
    expect(body).toMatch(/2 started/);        // one completed + one still going
    expect(body).toMatch(/1 finished/);
  });

  test('every button title fits the 20-code-point cap in Urdu too', async () => {
    await List.handleListPick('tq_pick_sess-1', PHONE, { id: 'u-1', preferred_language: 'ur' });
    WhatsAppService.sendInteractiveButtons.mock.calls[0][1].buttons
      .forEach((b) => expect(cp(b.title)).toBeLessThanOrEqual(20));
  });
});

describe('Resend link runs the whole hand-off, not just the link', () => {
  beforeEach(() => {
    installFrom(supabase.from, {
      quizzes: { data: [QUIZ] },
      users: { data: [{ phone_number: PHONE, preferred_language: 'en' }] },
    });
  });

  test('it calls sendHandoff — the PDF then the SAME message — and never mints', async () => {
    expect(await List.handleActionButton('tq_link_q-1', PHONE)).toBe(true);
    expect(Handoff.sendHandoff).toHaveBeenCalledTimes(1);
    expect(Handoff.sendHandoff).toHaveBeenCalledWith('q-1', PHONE, { firstSend: false });
    // The old path sent tqForwardThis + the raw stored message and no document.
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(texts).not.toContain('forward me');
  });

  test('a quiz that has not been sent yet is told so instead of minting a second code', async () => {
    installFrom(supabase.from, {
      quizzes: { data: [{ ...QUIZ, status: 'generating', meta: { step: 'digest' } }] },
      users: { data: [{ phone_number: PHONE, preferred_language: 'en' }] },
    });
    expect(await List.handleActionButton('tq_link_q-1', PHONE)).toBe(true);
    expect(Handoff.sendHandoff).not.toHaveBeenCalled();
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/still being made/i);
  });
});

describe('Back to lessons', () => {
  test('re-opens the lesson list', async () => {
    installFrom(supabase.from, {
      quizzes: { data: [QUIZ] },
      users: { data: [{ phone_number: PHONE, preferred_language: 'en' }] },
      coaching_sessions: { data: [SESSION] },
      quiz_sessions: { data: [] },
    });
    expect(await List.handleActionButton('tq_back_q-1', PHONE)).toBe(true);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    const rows = WhatsAppService.sendInteractiveMessage.mock.calls[0][1].action.sections[0].rows;
    expect(rows[0].id).toBe('tq_pick_sess-1');
  });
});

describe('Regenerate report says it is recomputing', () => {
  test('the acknowledgement names the refetch, and force:true reaches the report', async () => {
    installFrom(supabase.from, {
      quizzes: { data: [QUIZ] },
      users: { data: [{ phone_number: PHONE, preferred_language: 'en' }] },
    });
    const Report = require('../../bot/shared/services/quiz/video-quiz-report.service');
    await List.handleActionButton('tq_report_q-1', PHONE);
    expect(Report.generate).toHaveBeenCalledWith('sc-1', { reason: 'requested', force: true });
    const ack = WhatsAppService.sendMessage.mock.calls[0][1];
    // "Preparing the report now…" did not say that a child who finished since
    // the last report is counted — which is the whole point of the button.
    expect(ack).toMatch(/again|recount|recomput|since/i);
  });
});

describe('what the round-5 render showed', () => {
  test('a lowercase Latin topic is sentence-cased so the menu is not half title-case', () => {
    // The quiz row re-derives its own topic and stores it lowercased
    // ("electric circuit"), while analysis_data keeps "Electric Circuit" —
    // so two rows of the same menu were cased differently.
    expect(Rows.normaliseTopic('electric circuit')).toBe('Electric circuit');
    expect(Rows.normaliseTopic('Electric Circuit')).toBe('Electric Circuit');
    expect(Rows.normaliseTopic('pH and acids')).toBe('pH and acids');   // already has a capital
    expect(Rows.normaliseTopic('اسم، فعل، اور حروف جار')).toBe('اسم، فعل، اور حروف جار');
  });

  test('an Urdu topic inside an English row is bidi-isolated so the separator stays put', () => {
    const d = Rows.composeDescription({ topic: 'اسم، فعل، اور حروف جار', status: 'No quiz yet' }, 72, { language: 'en' });
    expect(d).toMatch(/⁨اسم، فعل، اور حروف جار⁩/);
    expect(cp(d)).toBeLessThanOrEqual(72);
  });

  test('an English topic inside an Urdu row is isolated the same way', () => {
    const d = Rows.composeDescription({ topic: 'How Chocolate is Made', status: 'ابھی quiz نہیں' }, 72, { language: 'ur' });
    expect(d).toMatch(/⁨How Chocolate is Made⁩/);
    expect(cp(d)).toBeLessThanOrEqual(72);
  });

  test('a same-script topic is NOT isolated — no invisible characters spent for nothing', () => {
    const d = Rows.composeDescription({ topic: 'Types of Maps', status: 'No quiz yet' }, 72, { language: 'en' });
    expect(d).toBe('Types of Maps · No quiz yet');
  });

  test('a sent quiz still says it was SENT, even at 0 started', () => {
    // "0 started · 0 done" gave the row no word for its state at all.
    expect(List.statusLine({ status: 'sent', meta: { started: 0, finished: 0 } }, 'en')).toMatch(/^Sent/);
    expect(cp(List.statusLine({ status: 'sent', meta: { started: 12, finished: 8 } }, 'en'))).toBeLessThanOrEqual(28);
    expect(cp(List.statusLine({ status: 'sent', meta: { started: 12, finished: 8 } }, 'ur'))).toBeLessThanOrEqual(28);
  });

  test('a page beyond the end falls back to page 1 rather than "no lessons yet"', async () => {
    installFrom(supabase.from, {
      coaching_sessions: { data: [SESSION] },
      quizzes: { data: [] },
      quiz_sessions: { data: [] },
    });
    expect(await List.handleListPick('tq_page_9', PHONE, USER)).toBe(true);
    expect(WhatsAppService.sendInteractiveMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    const rows = WhatsAppService.sendInteractiveMessage.mock.calls[0][1].action.sections[0].rows;
    expect(rows[0].id).toBe('tq_pick_sess-1');
  });
});

/**
 * bd-mg9c7.63 — the Nastaliq digit-adjacency hazard, seen in
 * `renders/round5/F/quiz_actions_ur.png`: "· 1 نے شروع" rendered as
 * "۱۰ نے شروع", so a teacher whose quiz one child had started read ten. The
 * middot sits high in Noto Nastaliq and merges with the digit beside it.
 * lp612-catalog.service.js keeps words on both sides of its dot (bd-t8mbl);
 * these strings cannot, because the counts ARE the content — so no Urdu
 * string may put a middot next to a number at all.
 */
describe('no Urdu string puts a middot next to a number', () => {
  const { resolveUx } = require('../../bot/shared/config/ux-strings');
  const CASES = [
    ['tqRowSent', { started: 1, finished: 1 }],
    ['tqRowReportSent', { finished: 1 }],
    ['tqQuizStatus', { topic: 'کسریں', date: '12 اگست', started: 1, finished: 1 }],
    ['tqRowOlderDesc', {}],
    ['tqListHeader', { from: 10, to: 18 }],
  ];
  test.each(CASES)('%s', (key, params) => {
    const ur = resolveUx(key, { language: 'ur', params });
    expect(ur).not.toMatch(/·\s*\d|\d\s*·/);
  });
});
