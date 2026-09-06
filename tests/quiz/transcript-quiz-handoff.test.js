'use strict';
/**
 * bd-mg9c7.63 (lane F) — sendHandoff: the SAME hand-off (PDF, then the
 * forwardable link alone, then — first send only — the report promise)
 * whether it runs inline from generate()'s process() or standalone from
 * /quiz "resend the link". The share code is minted at most once, ever.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor' }),
  botNumber: jest.fn().mockReturnValue('923222482222'),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const SQS = require('../../bot/shared/services/queue/sqs-queue.service');
const Share = require('../../bot/shared/services/quiz/video-quiz-share.service');
const r2 = require('../../bot/shared/storage/r2');
const { installFrom } = require('./helpers/supabase-chain');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const { resolveUx } = require('../../bot/shared/config/ux-strings');

const QID = '22222222-2222-4222-8222-222222222222';
const SID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = 'u-1';
const DIGEST = {
  topic: 'Fractions', topic_as_taught: 'کسریں', subject: 'maths', grade_band: '3-5', language_of_instruction: 'ur', confidence: 0.9,
  slos: [{ id: 'S1', statement: 'a', taught_level: 'recall' }],
};
const SESSION = { id: SID, created_at: '2026-09-05T05:00:00Z' };
const USER = { preferred_language: 'ur', first_name: 'Rifat', last_name: 'Noor' };
const ROW = {
  external_id: `tq:${QID}:S1:1`, question_text: 'س', option_a: 'a', option_b: 'b', option_c: 'c',
  correct_option: 'A', explanation: null, distractor_misconceptions: null, option_feedback: { correct: 'ok', wrong: {} },
  media: null, render_pattern: 'P1', sort_order: 0,
};

function quizRow(meta = {}) {
  return {
    id: QID, teacher_id: TEACHER_ID, topic: 'کسریں', subject: 'maths', language: 'ur', grade: '4',
    status: meta.share_code_id ? 'sent' : 'ready', coaching_session_id: SID,
    meta: { digest: DIGEST, cost_usd: 0.01, ...meta },
  };
}

/** Wire supabase.from for the NO-`prepared` (i.e. /quiz) path: sendHandoff loads everything itself. */
function wireLoad({ meta = {}, insertError = null } = {}) {
  installFrom(supabase.from, {
    quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }], error: insertError } : { data: [quizRow(meta)] }),
    coaching_sessions: { data: [SESSION] },
    users: { data: [USER] },
    quiz_questions: { data: [ROW] },
  });
}

const SENT_META = {
  step: 'sent', share_code: 'XYZ999', share_code_id: 'sc-old', link: 'https://wa.me/923222482222?text=QUIZ-XYZ999',
  student_message: 'کسریں کا quiz — پرانا لنک', pdf_key: 'transcript_quizzes/u-1/quiz.pdf', pdf_sent: true, sent_at: '2026-09-05T06:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
  jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
});

describe('sendHandoff — the share code is minted at most once', () => {
  test('the same link, twice: mintCode is never called and the message is identical', async () => {
    wireLoad({ meta: SENT_META });
    r2.downloadFromR2.mockResolvedValue(Buffer.from('%PDF-1.4 old'));

    const r1 = await Handoff.sendHandoff(QID, '923001234567');
    const r2msgs = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    jest.clearAllMocks();
    jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
    wireLoad({ meta: SENT_META });
    r2.downloadFromR2.mockResolvedValue(Buffer.from('%PDF-1.4 old'));

    const r2res = await Handoff.sendHandoff(QID, '923001234567');
    const r2msgs2 = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);

    expect(r1.ok).toBe(true);
    expect(r2res.ok).toBe(true);
    expect(r1.code).toBe('XYZ999');
    expect(r2res.code).toBe('XYZ999');
    expect(r2msgs).toContain(SENT_META.student_message);
    expect(r2msgs2).toContain(SENT_META.student_message);
    expect(Share.mintCode).not.toHaveBeenCalled();
  });

  test('a quiz with no code yet and firstSend:true mints exactly once and stores share_code/share_code_id/student_message', async () => {
    const meta = { digest: DIGEST, cost_usd: 0.01 };
    const prepared = {
      quiz: quizRow(meta), session: SESSION, questions: null, qRows: [ROW], digest: DIGEST,
      teacherName: 'Rifat Noor', meta, language: 'ur', teacherLang: 'ur',
    };
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quizRow(meta)] }),
    });

    const r = await Handoff.sendHandoff(QID, '923001234567', { firstSend: true, prepared });
    expect(r.ok).toBe(true);
    expect(Share.mintCode).toHaveBeenCalledTimes(1);

    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
    const sentUpdate = updates.find((u) => u.status === 'sent');
    expect(sentUpdate.meta.share_code).toBe('ABC234');
    expect(sentUpdate.meta.share_code_id).toBe('sc-1');
    expect(sentUpdate.meta.student_message).toMatch(/QUIZ-ABC234/);
  });
});

describe('sendHandoff — the PDF', () => {
  test('comes from R2 by meta.pdf_key when the key is set', async () => {
    wireLoad({ meta: SENT_META });
    r2.downloadFromR2.mockResolvedValue(Buffer.from('%PDF-1.4 stored bytes'));

    const r = await Handoff.sendHandoff(QID, '923001234567');
    expect(r.ok).toBe(true);
    expect(r2.downloadFromR2).toHaveBeenCalledWith(SENT_META.pdf_key);
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
    const filePath = WhatsAppService.sendDocument.mock.calls[0][1];
    const fs = require('fs');
    expect(fs.existsSync(filePath)).toBe(false); // cleaned up after sending
  });

  test('downloadFromR2 throwing falls through to a re-render and she still gets a document', async () => {
    wireLoad({ meta: SENT_META });
    r2.downloadFromR2.mockRejectedValue(new Error('object gone'));
    const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');

    const r = await Handoff.sendHandoff(QID, '923001234567');
    expect(r.ok).toBe(true);
    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendDocument).toHaveBeenCalledTimes(1);
    expect(r2.uploadBuffer).toHaveBeenCalledTimes(1); // re-uploaded so the next resend is cheap
  });

  test('neither a document nor a re-render — she still gets the caption + forward-this + the link, and ok is true', async () => {
    wireLoad({ meta: { ...SENT_META, pdf_key: null } });
    const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
    htmlToPdf.mockRejectedValueOnce(new Error('render timeout'));

    const r = await Handoff.sendHandoff(QID, '923001234567');
    expect(r.ok).toBe(true);
    expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
    const texts = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
    expect(texts[0]).toMatch(/Forward THIS message|forward/i);
    expect(texts).toContain(SENT_META.student_message);
  });
});

describe('sendHandoff — resend vs first send bookkeeping', () => {
  test('a resend writes no status, no sent_at, sends no report promise, schedules no nudge', async () => {
    wireLoad({ meta: SENT_META });
    r2.downloadFromR2.mockResolvedValue(Buffer.from('%PDF-1.4 stored'));

    await Handoff.sendHandoff(QID, '923001234567');

    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
    expect(updates.some((u) => u.status === 'sent')).toBe(false);
    expect(updates.some((u) => u.meta && 'sent_at' in u.meta)).toBe(false);
    const reportPromiseUr = resolveUx('tqReportPromise', { language: 'ur' });
    expect(WhatsAppService.sendMessage.mock.calls.some((c) => c[1] === reportPromiseUr)).toBe(false);
    expect(SQS.queueJob).not.toHaveBeenCalled();
  });

  test('firstSend:true DOES write status/sent_at/meta and schedules the nudge', async () => {
    const meta = { digest: DIGEST, cost_usd: 0.01 };
    const prepared = {
      quiz: quizRow(meta), session: SESSION, questions: null, qRows: [ROW], digest: DIGEST,
      teacherName: 'Rifat Noor', meta, language: 'ur', teacherLang: 'ur',
    };
    installFrom(supabase.from, {
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [quizRow(meta)] }),
    });

    const r = await Handoff.sendHandoff(QID, '923001234567', { firstSend: true, prepared });
    expect(r.ok).toBe(true);

    const updates = supabase.from.callsFor('quizzes').flat().filter((c) => c[0] === 'update').map((u) => u[1]);
    const sentUpdate = updates.find((u) => u.status === 'sent');
    expect(sentUpdate).toBeTruthy();
    expect(sentUpdate.meta.sent_at).toBeTruthy();
    const reportPromiseUr = resolveUx('tqReportPromise', { language: 'ur' });
    expect(WhatsAppService.sendMessage.mock.calls.some((c) => c[1] === reportPromiseUr)).toBe(true);
    expect(SQS.queueJob).toHaveBeenCalledWith(QID, 'quiz_nudge_teacher', expect.any(Object), expect.any(Object));
  });
});

/**
 * bd-mg9c7.63 — a RESEND can never mint. Found by the round-5 language suite,
 * which handed the resend path a quiz carrying `student_message` but no
 * `share_code_id`: sendHandoff fell through to `mintCode` and produced a
 * SECOND share code for the same quiz — a different link for a class that
 * already has one. The operator's rule is explicit ("The link, as agreed,
 * should be the same one that was originally used"), so the guard belongs at
 * the seam, not at each caller: `firstSend: false` has no branch that mints.
 */
describe('a resend never mints, whatever the row looks like', () => {
  test('a student_message with NO share_code_id refuses instead of minting', async () => {
    wireLoad({ meta: { student_message: 'FORWARD ME' } });
    const out = await Handoff.sendHandoff(QID, '923001234567', { firstSend: false });
    expect(Share.mintCode).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: 'no_code_to_reuse' });
    expect(WhatsAppService.sendMessage).not.toHaveBeenCalled();
    expect(WhatsAppService.sendDocument).not.toHaveBeenCalled();
  });

  test('a share_code_id with NO student_message refuses too', async () => {
    wireLoad({ meta: { share_code_id: 'sc-old', share_code: 'XYZ999' } });
    const out = await Handoff.sendHandoff(QID, '923001234567', { firstSend: false });
    expect(Share.mintCode).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: 'no_code_to_reuse' });
  });

  test('the FIRST send is still allowed to mint', async () => {
    wireLoad({ meta: {} });
    const out = await Handoff.sendHandoff(QID, '923001234567', { firstSend: true });
    expect(Share.mintCode).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });
});
