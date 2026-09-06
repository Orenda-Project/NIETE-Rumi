'use strict';
/**
 * bd-mg9c7.63 — "Regenerate report" REFETCHES.
 *
 * The operator: "If the teacher wants a report to be recomputed, then we refetch
 * the data, because some additional kids might have finished the quiz since the
 * last time the report was delivered."
 *
 * The claim under test is not "generate() re-runs" — it is that a child who
 * finished AFTER `report_sent_at` is in the second report, and that the second
 * report re-stamps `report_sent_at` so a later scheduled run does not repeat it.
 * The suppression guard (`report_sent_at && !force`) is the thing that could
 * silently make the second call a no-op, so the un-forced call is asserted too.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// The PDF is the nicer artefact, not the report: forcing the render to fail puts
// every number in the chat message, where the test can read them.
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockRejectedValue(new Error('no chromium in CI')),
}));
// No LLM in a unit test. The guidance box is lane E's subject, not this one.
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: jest.fn().mockRejectedValue(new Error('no key')) } },
})));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { installFrom } = require('./helpers/supabase-chain');
const Report = require('../../bot/shared/services/quiz/video-quiz-report.service');

const SHARE_ID = 'sc-1';
const QUIZ_ID = 'q-1';
const SENT_AT = '2026-09-06T06:00:00Z';

const student = (name, cls, correct, total, mastery, status = 'completed') => ({
  id: `s-${name}`, student_name: name, student_class: cls, status,
  total_questions_answered: total, correct_answers: correct, mastery_percentage: mastery,
});

/**
 * A staging-shaped world. `sessionsRef` is read at query time, so a test can add
 * a child BETWEEN two generate() calls exactly as a real class does.
 */
function world({ sessionsRef, reportSentAt }) {
  const shareUpdates = [];
  installFrom(supabase.from, {
    quiz_share_codes: (calls) => {
      const isUpdate = calls.some((c) => c[0] === 'update');
      if (isUpdate) { shareUpdates.push(calls); return { data: null, error: null }; }
      return {
        data: [{
          id: SHARE_ID, code: 'ABC123', quiz_id: QUIZ_ID, teacher_user_id: 'u-1',
          teacher_name: 'Rifat Noor', topic: 'Fractions and Their Types', language: 'en',
          created_at: '2026-09-05T06:00:00Z', report_sent_at: reportSentAt,
        }],
        error: null,
      };
    },
    users: { data: [{ phone_number: '923001234567', preferred_language: 'en' }], error: null },
    quiz_sessions: () => ({ data: sessionsRef.slice(), error: null }),
    quizzes: { data: [{ quiz_source: 'transcript', meta: {}, language: 'en' }], error: null },
    quiz_questions: { data: [], error: null },
  });
  return { shareUpdates };
}

beforeEach(() => jest.clearAllMocks());

describe('Regenerate report refetches the class', () => {
  test('a child who finished AFTER report_sent_at is in the forced report', async () => {
    const sessions = [student('Ali', '4', 6, 8, 75)];
    world({ sessionsRef: sessions, reportSentAt: SENT_AT });

    const first = await Report.generate(SHARE_ID, { reason: 'requested', force: true });
    expect(first).toBe(true);
    const firstText = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(firstText).toMatch(/1 of 1 students finished/);
    expect(firstText).not.toMatch(/Sana/);

    // The class carries on after the first report went out.
    WhatsAppService.sendMessage.mockClear();
    sessions.push(student('Sana', '4', 8, 8, 100));
    sessions.push(student('Bilal', '4', 0, 3, 0, 'in_progress'));

    const second = await Report.generate(SHARE_ID, { reason: 'requested', force: true });
    expect(second).toBe(true);
    const secondText = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(secondText).toMatch(/2 of 3 students finished/);
    expect(secondText).toMatch(/Sana/);
    expect(secondText).toMatch(/Not finished yet:.*Bilal/);
  });

  test('every forced regenerate re-stamps report_sent_at', async () => {
    const sessions = [student('Ali', '4', 6, 8, 75)];
    const { shareUpdates } = world({ sessionsRef: sessions, reportSentAt: SENT_AT });
    await Report.generate(SHARE_ID, { reason: 'requested', force: true });
    const stamps = shareUpdates.filter((calls) =>
      calls.some((c) => c[0] === 'update' && c[1] && c[1].report_sent_at));
    expect(stamps).toHaveLength(1);
    expect(new Date(stamps[0].find((c) => c[0] === 'update')[1].report_sent_at).getTime())
      .toBeGreaterThan(new Date(SENT_AT).getTime());
  });

  test('WITHOUT force an already-reported share code is still suppressed', async () => {
    // The /quiz button is the only caller allowed past the one-report guard; the
    // morning job must not start double-sending because this path exists.
    world({ sessionsRef: [student('Ali', '4', 6, 8, 75)], reportSentAt: SENT_AT });
    const out = await Report.generate(SHARE_ID, { reason: 'scheduled' });
    expect(out).toBe(false);
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
  });

  test('a share code never reported yet sends without force', async () => {
    world({ sessionsRef: [student('Ali', '4', 6, 8, 75)], reportSentAt: null });
    expect(await Report.generate(SHARE_ID, { reason: 'scheduled' })).toBe(true);
  });
});
