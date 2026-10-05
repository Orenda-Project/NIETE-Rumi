'use strict';

/**
 * A NAMED CHARACTER KEEPS THEIR PRONOUN — behind app_settings quiz_author_gates_v2.
 *
 * The red team's blind re-score (5 Oct 2026) found "Ahmed was writing their
 * letter" and "Zainab cleaned their room" in a grade 4 English quiz, in both
 * arms. The cause is upstream of every gate: the lesson plan says "Ahmed WAS
 * WRITING his letter", and the step that strips the TEACHER's gender from the
 * plan (lp-quiz-digest degender) rewrote every his/her in it, so the author was
 * handed "their letter" and copied it. Then the gendered-teacher check reads
 * "his" beside "Ahmed" as the teacher (found by W33b).
 *
 * The gender-neutral rule is for the teacher and the child being addressed,
 * never for a NAMED character in the content. Flag on: a pronoun whose sentence
 * names a person before it is kept, in the plan text the author reads and by
 * the gendered-teacher check; the teacher's own prose ("She says…", "ask her")
 * is still neutralised and still flagged. Flag off: exactly today's text.
 */
jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
// The render boundary: the PDF, and the PNG of a question card (the live item's
// options are longer than a reply button, so it is drawn as a card).
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://r2/x'), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));


const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const supabase = require('../../bot/shared/config/supabase');
const { installFrom } = require('./helpers/supabase-chain');
const F = require('./helpers/lp-key-check-fixture');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const { validate } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const GatesV2 = require('../../bot/shared/services/quiz/quiz-author-gates-v2');
const { installAgreeingSolver } = require('./helpers/key-verify-agree');

const SCRIPT = JSON.parse(JSON.stringify(F.SLIDE_SCRIPT));
SCRIPT.iDo = { ...SCRIPT.iDo, keyFact: 'She says a past action that was going on uses was + -ing.', worked: { problem: 'Zainab CLEANED her room. Ahmed WAS WRITING his letter, the phone rang.', work: ['ask her class which action was going on'], answer: 'was writing' } };

afterEach(() => GatesV2.setEnabled(false));

describe('the lesson text the author reads', () => {
  test('flag on: a named character keeps their pronoun; the teacher prose is still neutral', () => {
    const t = LpDigest.lessonExcerpts(SCRIPT, { authorGates: true });
    expect(t).toContain('Zainab CLEANED her room.');
    expect(t).toContain('Ahmed WAS WRITING his letter');
    expect(t).toContain('The teacher says a past action');
    expect(t).toContain('ask their class');
  });
  test('flag off: today\'s text, every pronoun neutralised', () => {
    const t = LpDigest.lessonExcerpts(SCRIPT);
    expect(t).toContain('Zainab CLEANED their room.');
    expect(t).toContain('Ahmed WAS WRITING their letter');
  });
});

describe('the gendered-teacher check', () => {
  const q = (question) => ({
    slo_id: 'S1', level: 'understand', question, options: ['was writing', 'wrote', 'writes'], correct_index: 0,
    explanation: 'The action was going on when something else happened.', selected_because: 'past continuous',
    distractor_misconceptions: { 1: 'simple past', 2: 'present' },
    option_feedback: { correct: 'Yes.', wrong: { 1: 'That is finished.', 2: 'That is now.' } },
  });
  const named = () => [q('Ahmed was writing his letter when the phone rang. Which words show the action going on?')];
  const teacher = () => [q('She then wrote a letter on the board. Which words show the action going on?')];
  const gendered = (qs, authorGates) => validate(qs, { language: 'en', subject: 'english', authorGates }).errors.filter((e) => /GENDERED_TEACHER/.test(e));
  test('flag on: "Ahmed … his letter" is not the teacher', () => {
    expect(gendered(named(), true)).toEqual([]);
  });
  test('flag on: a pronoun with no named person before it is still the teacher', () => {
    expect(gendered(teacher(), true)).toEqual([expect.stringMatching(/^q0: PEDAGOGY_GENDERED_TEACHER/)]);
  });
  test('flag off: today\'s check, "his" flagged', () => {
    expect(gendered(named(), false)).toEqual([expect.stringMatching(/^q0: PEDAGOGY_GENDERED_TEACHER/)]);
  });
});

describe('on the generate path (a lesson-plan quiz), flag on', () => {
  test('the AUTHOR is handed the plan with the named character\'s pronoun kept', async () => {
    jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
    installAgreeingSolver(Gen);
    const QID = '77777777-7777-4777-8777-777777777777';
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [{
        id: QID, teacher_id: 'u-1', quiz_source: 'lp_v8', topic: 'Past tense', subject: 'english', language: 'en', status: 'generating', grade: '4',
        meta: { step: 'digest', source: 'list', lessons: [{ lesson_id: F.LESSON_ID, version_stamp: 'v8', content_hash: 'h-1' }] },
      }] }),
      niete_lp_asset_sources: { data: [{ asset_id: 'a-1', lesson_id: F.LESSON_ID, version_stamp: 'v8', content_hash: 'h-1', slide_script: SCRIPT, source_url: null, verified: 'upload' }] },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [{ id: 'u-1', name: 'T', phone_number: '923001234567', preferred_language: 'en' }] },
      app_settings: (calls) => {
        const eq = calls.find((c) => c[0] === 'eq' && c[1] === 'key');
        const inn = calls.find((c) => c[0] === 'in' && c[1] === 'key');
        const keys = eq ? [eq[2]] : (inn ? inn[2] : []);
        return { data: [{ key: 'quiz_author_gates_v2', value: true }].filter((r) => keys.includes(r.key)) };
      },
    }));
    const authorPrompts = [];
    completeJson.mockImplementation(async ({ label, prompt }) => {
      if (label === 'lp_quiz.digest') return { json: F.MODEL_DIGEST, model: 'dm', costUsd: 0.001, latencyMs: 5 };
      if (label === 'transcript_quiz.author') { authorPrompts.push(prompt); throw new Error('stop after the author prompt'); }
      throw new Error(`unexpected LLM call: ${label}`);
    });
    await Gen.process(QID, {}).catch(() => null);
    expect(authorPrompts.length).toBeGreaterThan(0);
    expect(authorPrompts[0]).toContain('Ahmed WAS WRITING his letter');
    expect(authorPrompts[0]).not.toContain('Ahmed WAS WRITING their letter');
  });
});
