'use strict';
/**
 * bd-2472 — a friend a child invites is not that child's teacher's student.
 *
 * resolveInvite() (video-quiz-share.service.js) deliberately maps every invite
 * code back to the PARENT teacher's share_code_id, so the friend's session
 * carries the teacher's share_code_id even though the teacher never taught
 * them. Before this fix, video-quiz-report.service.js's two queries —
 * generate()'s roster fetch and hardestQuestions()'s session lookup — read by
 * share_code_id alone, so an invited friend's session silently inflated the
 * teacher's started/finished counts, roster, and "worth reteaching" tally.
 *
 * Real example this was caught against: Razia's share code DCQ3RJ had 14
 * quiz_sessions rows; one (Anum shazadi, invited by a classmate) is not
 * Razia's student. The fix: both queries must also filter
 * invited_by_student_id IS NULL.
 *
 * This file uses its own filtering stub (not the shared one in
 * video-quiz-report.test.js, which resolves every list query to the full
 * fixture regardless of which .eq()/.is() calls were made — it can't tell red
 * from green on a missing filter). This stub actually applies the requested
 * predicates so the test fails against the pre-fix query and passes after.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({
  queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
// sendAsPdf() requires these two lazily by relative path from
// video-quiz-report.service.js — mock them so the roster/hardest args it
// receives are directly inspectable, instead of asserting on rendered PDF
// bytes (which can't be inspected here) or letting a real Playwright render
// run inside a unit test.
const mockRenderHtml = jest.fn().mockReturnValue('<html></html>');
jest.mock('../../shared/templates/video-quiz-report.template', () => mockRenderHtml);
jest.mock('../../shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('fs', () => ({
  writeFileSync: jest.fn(), existsSync: jest.fn().mockReturnValue(false), unlinkSync: jest.fn(),
}));

const supabase = require('../../shared/config/supabase');
const WhatsAppService = require('../../shared/services/whatsapp.service');
const report = require('../../shared/services/quiz/video-quiz-report.service');

const SHARE_CODE_ID = 'sc-1';

const DIRECT_SESSION = {
  id: 's-direct', share_code_id: SHARE_CODE_ID, student_name: 'Ali furqan', student_class: '5',
  status: 'completed', total_questions_answered: 10, correct_answers: 7,
  mastery_percentage: 70, invited_by_student_id: null,
};
const INVITED_SESSION = {
  id: 's-invited', share_code_id: SHARE_CODE_ID, student_name: 'Anum shazadi', student_class: '5',
  status: 'completed', total_questions_answered: 10, correct_answers: 9,
  mastery_percentage: 90, invited_by_student_id: 'friend-uuid',
};

/**
 * A minimal fake Postgrest that actually applies .eq()/.is() predicates to
 * an in-memory row set, so a missing WHERE clause changes the result.
 */
function makeFilterableTable(rows) {
  const state = { predicates: [] };
  const chain = {
    select: () => chain,
    eq: (col, val) => { state.predicates.push((r) => r[col] === val); return chain; },
    is: (col, val) => { state.predicates.push((r) => r[col] === val); return chain; },
    in: (col, vals) => { state.predicates.push((r) => vals.includes(r[col])); return chain; },
    maybeSingle: async () => ({ data: rows.find((r) => state.predicates.every((p) => p(r))) || null }),
    then: (resolve) => resolve({ data: rows.filter((r) => state.predicates.every((p) => p(r))) }),
  };
  return chain;
}

function stubSupabase({ sessions, answers = [], shareCode, teacher }) {
  supabase.from.mockImplementation((table) => {
    if (table === 'quiz_sessions') return makeFilterableTable(sessions);
    if (table === 'quiz_answers') return makeFilterableTable(answers);
    if (table === 'quiz_share_codes') {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: shareCode }),
        update: () => ({ eq: async () => ({ data: null }) }),
      };
      return chain;
    }
    if (table === 'users') {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: teacher }) };
      return chain;
    }
    if (table === 'quiz_questions') {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: null }),
        then: (resolve) => resolve({ data: [] }),
      };
      return chain;
    }
    return makeFilterableTable([]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('bd-2472 — invited-friend sessions never reach the teacher report', () => {
  const shareCode = {
    id: SHARE_CODE_ID, code: 'DCQ3RJ', quiz_id: 'q1', teacher_user_id: 'u1',
    teacher_name: 'Razia', topic: 'Classification of Animals', language: 'en',
    created_at: new Date().toISOString(), report_sent_at: null,
  };
  const teacher = { phone_number: '923001234567', preferred_language: 'en' };

  test('generate() excludes the invited session from the roster and counts', async () => {
    stubSupabase({ sessions: [DIRECT_SESSION, INVITED_SESSION], shareCode, teacher });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(mockRenderHtml).toHaveBeenCalledTimes(1);
    const vm = mockRenderHtml.mock.calls[0][0];
    expect(vm.started).toBe(1);
    expect(vm.finished).toBe(1);
    expect(vm.students.map((s) => s.student_name)).toEqual(['Ali furqan']);
    expect(vm.students.map((s) => s.student_name)).not.toContain('Anum shazadi');
  });

  test('a share code with ONLY an invited session reports "no one has opened it yet"', async () => {
    stubSupabase({ sessions: [INVITED_SESSION], shareCode, teacher });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    expect(mockRenderHtml).not.toHaveBeenCalled();
    const sendMsgCalls = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]).join('\n');
    expect(sendMsgCalls).toMatch(/No one has opened your quiz/);
    expect(sendMsgCalls).not.toMatch(/Anum/);
  });

  test('a share code with only direct sessions is unaffected (no-op regression check)', async () => {
    stubSupabase({ sessions: [DIRECT_SESSION], shareCode, teacher });

    await report.generate(SHARE_CODE_ID, { reason: 'scheduled' });

    const vm = mockRenderHtml.mock.calls[0][0];
    expect(vm.started).toBe(1);
    expect(vm.finished).toBe(1);
    expect(vm.students.map((s) => s.student_name)).toEqual(['Ali furqan']);
  });
});
