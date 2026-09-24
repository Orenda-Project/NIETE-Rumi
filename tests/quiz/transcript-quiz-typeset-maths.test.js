'use strict';
/**
 * Maths in a class quiz is TYPESET on the pictures and never reaches a phone as
 * TeX source (bd-mg9c7.159.19, part A).
 *
 * Operator, 2026-09-23: "there seem to be no images in these quizzes? … I'd
 * expect maths sums / fractions etc to be written in latex in image". On sandbox
 * c3b07bbc a fractions item read "2/9, 1/6 and 2/3" as plain text on the card,
 * in the teacher's PDF and in the child's buttons: nothing in the quiz could
 * typeset, NOTATION_RE had no trigger for a fraction, so a fraction question was
 * never even drawn as a card.
 *
 * The contract now: the author writes an expression as inline TeX, `$\frac{2}{9}$`.
 *   - that question is a CARD, and the card typesets it (KaTeX via the 6-12 LP
 *     renderer's rich());
 *   - the teacher's PDF typesets it the same way;
 *   - every WhatsApp TEXT — the message body, button and list titles, the verdict
 *     after an answer, the multi-select Flow — carries the Unicode a phone shows
 *     ("2/9", "×"), never `$` or `\frac`, and inside Urdu each expression is a
 *     left-to-right isolate so "3 × 4 = 12" is not painted "12 = 4 × 3";
 *   - the validator measures what the child SEES (lengths, duplicates, the figure
 *     gates) and rejects malformed maths as a per-question MATH_TEX fault the
 *     existing retry/rewrite repairs.
 *
 * KaTeX in THIS suite is the root stub (tests/jest.config.js maps `katex` to
 * tests/__mocks__/katex.js: it emits `<span class="katex">` around the flattened
 * source and never throws). So these tests prove the WIRING — which surface
 * typesets, which flattens, which rejects. The real typesetting (an `mfrac` in
 * the card, KaTeX's own woff2 faces inlined, a KaTeX parse error caught by the
 * validator) is proven against the real package in
 * bot/tests/quiz/quiz-typeset-maths-katex.test.js.
 *
 * Mocked at the boundary only: the LLM client, supabase, WhatsApp, the queue,
 * R2, the Playwright renderers (their HTML is captured and asserted) and the
 * per-recipient throttle.
 */

jest.mock('../../bot/shared/services/quiz/transcript-quiz-llm', () => ({ completeJson: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendDocument: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendImageFromUrl: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../bot/shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue('mid') }));
jest.mock('../../bot/shared/services/quiz/video-quiz-share.service', () => ({
  mintCode: jest.fn().mockResolvedValue({ id: 'sc-1', code: 'ABC234', teacherName: 'Rifat Noor', topic: 'Fractions' }),
  botNumber: jest.fn().mockReturnValue('923000000000'),
}));
jest.mock('../../bot/shared/services/quiz/video-quiz-rate-limiter.service', () => ({
  throttle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({
  htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')),
  htmlToImage: jest.fn().mockResolvedValue(Buffer.from('png-bytes')),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: jest.fn(), downloadFromR2: jest.fn(),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { completeJson } = require('../../bot/shared/services/quiz/transcript-quiz-llm');
const supabase = require('../../bot/shared/config/supabase');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { htmlToImage, htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
const { uploadBuffer } = require('../../bot/shared/storage/r2');
const { installFrom } = require('./helpers/supabase-chain');
const Card = require('../../bot/shared/services/quiz/transcript-quiz-card');
const { needsQuestionCard } = require('../../bot/shared/services/quiz/quiz-notation');
const render = require('../../bot/shared/services/quiz/video-quiz-render.service');
const sender = require('../../bot/shared/services/quiz/video-quiz-sender.service');
const Multi = require('../../bot/shared/services/quiz/transcript-quiz-multi');
const renderTeacherHtml = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const { validate, OPTION_MAX, STEM_MAX } = require('../../bot/shared/services/quiz/transcript-quiz-validator');
const Contract = require('../../bot/shared/services/quiz/transcript-quiz-contract');
const { buildAuthorPrompt } = require('../../bot/shared/services/quiz/transcript-quiz-author.service');
const Rewrite = require('../../bot/shared/services/quiz/transcript-quiz-rewrite');
const Report = require('../../bot/shared/services/quiz/video-quiz-report.service');
const Rows = require('../../bot/shared/services/quiz/transcript-quiz-rows');
const Handoff = require('../../bot/shared/services/quiz/transcript-quiz-handoff.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
// The grade 1-5 maths picture repair is not this suite's subject (see the helper).
const { installNoPictureRepair } = require('./helpers/no-picture-repair');

const LRI = '⁦';
const PDI = '⁩';
/** TeX source anywhere in a string a phone would show. */
const TEX_LEAK = /\$|\\[a-zA-Z]+|\\[{}]/;

// ── the live shape: "which is largest: 2/9, 1/6 or 2/3" ─────────────────────
const STEM = 'Which fraction is the largest: $\\frac{2}{9}$, $\\frac{1}{6}$ or $\\frac{2}{3}$?';
const OPTS = ['$\\frac{2}{9}$', '$\\frac{1}{6}$', '$\\frac{2}{3}$'];
const UR_STEM = 'ان میں سے سب سے بڑی کسر کون سی ہے: $\\frac{2}{9}$، $\\frac{1}{6}$ یا $\\frac{2}{3}$؟';

/** The body of a rendered page — everything after <body>, so the inlined stylesheet cannot satisfy an assertion. */
const bodyOf = (html) => html.slice(html.indexOf('<body'));

function row(over = {}) {
  return {
    id: 'q-1',
    external_id: 'tq:quiz-1:S1:1',
    question_text: STEM,
    option_a: OPTS[0], option_b: OPTS[1], option_c: OPTS[2],
    correct_option: 'C',
    explanation: '$\\frac{2}{3}$ is more than half, and $\\frac{2}{9}$ and $\\frac{1}{6}$ are both less than half.',
    option_feedback: {
      correct: 'Yes! $\\frac{2}{3}$ is the largest: two of three equal parts.',
      wrong: {
        0: '$\\frac{2}{9}$ has more parts, but each part is smaller, so $\\frac{2}{9} < \\frac{2}{3}$.',
        1: '$\\frac{1}{6}$ is one small part of six; $\\frac{2}{3}$ is much more.',
      },
    },
    media: { display_order: [1, 2, 0], language: 'en' },
    ...over,
  };
}

/** Every string a list of send instructions would put on a phone. */
function visibleStrings(msgs) {
  const out = [];
  msgs.forEach((m) => {
    ['body', 'caption', 'stem', 'cue'].forEach((k) => { if (typeof m[k] === 'string') out.push(m[k]); });
    (m.options || []).forEach((o) => out.push(String(o)));
  });
  return out;
}

/** Every string argument handed to the mocked WhatsApp service. */
function sentStrings() {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  Object.values(WhatsAppService).forEach((fn) => (fn.mock ? fn.mock.calls : []).forEach((c) => walk(c.slice(1))));
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  uploadBuffer.mockImplementation(async (buf, key) => `https://acct.r2.cloudflarestorage.com/bucket/${key}`);
  htmlToImage.mockResolvedValue(Buffer.from('png-bytes'));
  htmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
});

// ── 1. a typeset question is a CARD, and the card typesets it ───────────────

describe('the card', () => {
  test('a fraction written as TeX makes the question a card — in the stem or only in an option', () => {
    expect(needsQuestionCard({ question: STEM, options: OPTS })).toBe(true);
    expect(needsQuestionCard({ question: 'Which of these is the largest?', options: OPTS })).toBe(true);
    // the stored row's shape, read the same way
    expect(needsQuestionCard(row())).toBe(true);
    expect(Card.needsQuestionCard({ question_text: 'What is $3 \\times 4$?', option_a: '12', option_b: '7', option_c: '1' })).toBe(true);
    // one "$" is not maths, and plain prose is still not a card
    expect(needsQuestionCard({ question: 'A pencil costs Rs 5. What do two cost?', options: ['10', '7', '5'] })).toBe(false);
  });

  test('the card typesets the stem and every option through KaTeX and shows no TeX source', () => {
    const html = Card.renderQuestionCardHtml({ stem: STEM, options: OPTS, displayOrder: [1, 2, 0], language: 'en', questionNumber: 3, total: 8 });
    const body = bodyOf(html);
    const stem = body.slice(body.indexOf('class="stem"'), body.indexOf('class="opt"'));
    expect((stem.match(/class="katex"/g) || [])).toHaveLength(3);
    const opts = body.split('class="opt"').slice(1);
    expect(opts).toHaveLength(3);
    opts.forEach((o) => expect(o).toMatch(/class="katex/));
    expect(body).not.toMatch(/\\frac|\$/);
    // KaTeX's stylesheet rides in the card, so the fonts are there when Chrome paints
    expect(html.slice(0, html.indexOf('<body'))).toMatch(/\.katex\{/);
  });

  test('a card with no maths does not carry the KaTeX stylesheet at all', () => {
    const html = Card.renderQuestionCardHtml({ stem: 'Which is water?', options: ['H2O', 'CO2', 'NaCl'], displayOrder: [0, 1, 2], language: 'en' });
    expect(html).not.toMatch(/\.katex\{|KaTeX_/);
  });

  test('an Urdu card keeps the Urdu prose right-to-left and each expression a left-to-right isolate', () => {
    const html = Card.renderQuestionCardHtml({ stem: UR_STEM, options: OPTS, displayOrder: [0, 1, 2], language: 'ur' });
    const body = bodyOf(html);
    const stem = body.slice(body.indexOf('<div class="stem"'), body.indexOf('class="opt"'));
    expect(stem).toMatch(/dir="rtl"/);
    // the Urdu comes first in reading order, then the three typeset fractions
    expect(stem.indexOf('ان میں سے')).toBeLessThan(stem.indexOf('class="katex'));
    expect((stem.match(/class="qm"/g) || [])).toHaveLength(3);
    expect(html).toMatch(/\.qm[^{]*\{[^}]*direction:ltr[^}]*unicode-bidi:isolate/);
    expect(stem).not.toMatch(/\\frac|\$/);
  });

  test('on an Urdu card a maths-only option sits beside its letter, not stranded at the far edge', () => {
    // Rendered and read at phone width: with dir="auto", an option that has no
    // letter of any script resolves LEFT-to-right, so on a right-to-left card
    // "2/9" printed ~850 px from its "A". It takes the card's direction; an
    // option with words still decides its own.
    const html = Card.renderQuestionCardHtml({ stem: UR_STEM, options: [...OPTS.slice(0, 2), 'نصف'], displayOrder: [0, 1, 2], language: 'ur' });
    const dirs = [...bodyOf(html).matchAll(/class="opt-text" dir="([a-z]+)"/g)].map((m) => m[1]);
    expect(dirs).toEqual(['rtl', 'rtl', 'auto']);
    // an English card is untouched
    const en = Card.renderQuestionCardHtml({ stem: STEM, options: OPTS, displayOrder: [0, 1, 2], language: 'en' });
    expect([...bodyOf(en).matchAll(/class="opt-text" dir="([a-z]+)"/g)].map((m) => m[1])).toEqual(['auto', 'auto', 'auto']);
  });
});

// ── 2. the teacher's PDF typesets the same maths ────────────────────────────

describe('the teacher PDF', () => {
  const DIGEST = { slos: [{ id: 'S1', statement: 'compare fractions', taught_level: 'understand' }] };

  test('the stem and the options are typeset, and the page carries no TeX source', () => {
    const html = renderTeacherHtml({ topic: 'Fractions', language: 'en', digest: DIGEST, questions: [row()] });
    const body = bodyOf(html);
    const stem = body.slice(body.indexOf('class="stem content"'), body.indexOf('class="opts"'));
    expect((stem.match(/class="katex"/g) || [])).toHaveLength(3);
    expect((body.match(/class="otext"><span class="qm"><span class="katex/g) || [])).toHaveLength(3);
    expect(body).not.toMatch(/\\frac|\$/);
    expect(html.slice(0, html.indexOf('<body'))).toMatch(/\.katex\{/);
  });

  test('a sheet with no maths is exactly as light as before — no KaTeX stylesheet', () => {
    const plain = row({ question_text: 'Which is water?', option_a: 'H2O', option_b: 'CO2', option_c: 'NaCl', correct_option: 'A' });
    const html = renderTeacherHtml({ topic: 'Water', language: 'en', digest: DIGEST, questions: [plain] });
    expect(html).not.toMatch(/\.katex\{|KaTeX_/);
  });

  test('on the Urdu sheet the Latin isolate never reaches inside the typeset maths', () => {
    const html = renderTeacherHtml({ topic: 'کسریں', language: 'ur', contentLanguage: 'ur', digest: DIGEST, questions: [row({ question_text: UR_STEM })] });
    const body = bodyOf(html);
    expect(body).toMatch(/class="stem content" dir="rtl"/);
    expect((body.match(/<span class="qm"><span class="katex/g) || []).length).toBeGreaterThanOrEqual(6);
    // wrapLatin() isolates Latin runs in Urdu prose; a typeset expression is already an isolate and its markup is not prose
    expect(body).not.toMatch(/class="katex[^"]*"><span class="katex-html"[^>]*><span class="ltr">/);
    expect(body).not.toMatch(/\\frac|\$/);
  });
});

// ── 3. every WhatsApp text flattens TeX to what a phone can show ────────────

describe('what the child reads in WhatsApp text', () => {
  test('a TeX question with no card (legacy row, or a card that never rendered) still sends "2/9", never "$\\frac{2}{9}$"', () => {
    const msgs = render.build(row(), { questionNumber: 1, totalQuestions: 8 });
    const ask = msgs.find((m) => m.role === 'ask');
    expect(ask.kind).toBe('buttons');
    expect(ask.options).toEqual(['1/6', '2/3', '2/9']);   // display order [1, 2, 0]
    expect(ask.body).toBe('Which fraction is the largest: 2/9, 1/6 or 2/3?');
    visibleStrings(msgs).forEach((s) => expect(s).not.toMatch(TEX_LEAK));
    const right = msgs.find((m) => m.role === 'feedback_correct');
    expect(right.body).toContain('2/3 is the largest');
    const wrong = msgs.find((m) => m.role === 'feedback_incorrect' && m.optionIndex === 0);
    expect(wrong.body).toContain('2/9 < 2/3');
  });

  test('a card question: letters on the buttons, the card as the header, and every text on the wire is flat', async () => {
    const card = row({ media: { display_order: [1, 2, 0], language: 'en', question_card: 'https://r2/card1.png' } });
    const msgs = render.build(card, { questionNumber: 1, totalQuestions: 8 });
    const ask = msgs.find((m) => m.role === 'ask');
    expect(ask).toMatchObject({ kind: 'buttons', letterTitles: true, headerImage: 'https://r2/card1.png' });
    await sender.sendPhase('923001234567', msgs, 'interaction', { questionId: 'q-1', language: 'en' });
    await sender.sendPhase('923001234567', msgs, 'answer', { questionId: 'q-1', isCorrect: false, selectedIndex: 0, language: 'en' });
    const [, header, body, buttons] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(header).toBe('https://r2/card1.png');
    expect(buttons.map((b) => b.title)).toEqual(['A', 'B', 'C']);
    expect(body).not.toMatch(TEX_LEAK);
    const verdict = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(verdict).toContain('2/9 < 2/3');
    sentStrings().forEach((s) => expect(s).not.toMatch(TEX_LEAK));
  }, 20000);

  test('a four-option card puts each option in its list-row description — flat, never TeX', async () => {
    const four = row({
      option_d: '$\\frac{1}{2}$', correct_option: 'C',
      media: { display_order: [0, 1, 2, 3], language: 'en', question_card: 'https://r2/card1.png' },
    });
    const msgs = render.build(four, {});
    await sender.sendPhase('923001234567', msgs, 'interaction', { questionId: 'q-1', language: 'en' });
    const payload = WhatsAppService.sendInteractiveMessage.mock.calls[0][1];
    const rows = payload.action.sections[0].rows;
    expect(rows.map((r) => r.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(rows.map((r) => r.description)).toEqual(['2/9', '1/6', '2/3', '1/2']);
    sentStrings().forEach((s) => expect(s).not.toMatch(TEX_LEAK));
  }, 20000);

  test('a mixed number reads "2 1/3", never "21/3"', () => {
    const mixed = row({ question_text: 'What is $2\\frac{1}{3}$ as an improper fraction?', option_a: '$\\frac{7}{3}$', option_b: '$\\frac{5}{3}$', option_c: '$\\frac{6}{3}$', correct_option: 'A' });
    const ask = render.build(mixed, {}).find((m) => m.role === 'ask');
    expect(ask.body).toMatch(/What is 2\s1\/3 as an improper fraction\?/);
    expect(ask.body).not.toContain('21/3');
  });

  test('in an Urdu verdict each expression is a left-to-right isolate, so "2/9 < 2/3" is not painted backwards', () => {
    const ur = row({
      question_text: UR_STEM,
      option_feedback: {
        correct: 'جی ہاں! $\\frac{2}{3}$ سب سے بڑی ہے کیونکہ $\\frac{2}{3} > \\frac{1}{6}$ ہے۔',
        wrong: { 0: 'نہیں، $\\frac{2}{9} < \\frac{2}{3}$ ہے۔', 1: 'نہیں، $\\frac{1}{6}$ چھوٹی ہے۔' },
      },
      explanation: 'دو تہائی آدھے سے زیادہ ہے۔',
      media: { display_order: [0, 1, 2], language: 'ur' },
    });
    const msgs = render.build(ur, {});
    const right = msgs.find((m) => m.role === 'feedback_correct').body;
    expect(right).toContain(`${LRI}2/3 > 1/6${PDI}`);
    expect(msgs.find((m) => m.role === 'feedback_incorrect' && m.optionIndex === 0).body).toContain(`${LRI}2/9 < 2/3${PDI}`);
    visibleStrings(msgs).forEach((s) => expect(s).not.toMatch(TEX_LEAK));
    // the Urdu stem itself, when it is sent as text, is flat too
    expect(msgs.find((m) => m.role === 'ask').body).toContain('2/9');
  });

  test('a "select all that apply" question: the Flow heading, its checkbox titles and the verdict are flat', () => {
    const multi = row({
      option_d: '$\\frac{1}{2}$', correct_option: 'C,D',
      media: { display_order: [0, 1, 2, 3], language: 'en', answer_mode: 'multi', question_card: 'https://r2/card1.png' },
    });
    const [m] = render.build(multi, {});
    expect(m.kind).toBe('multiflow');
    const payload = Multi.flowPayload(m, { language: 'en', sessionId: 's', questionId: 'q-1' });
    [payload.body, payload.screenData.question, ...payload.screenData.options.map((o) => o.title)]
      .forEach((s) => expect(s).not.toMatch(TEX_LEAK));
    expect(payload.screenData.options.map((o) => o.title)).toEqual(['2/9', '1/6', '2/3', '1/2']);
    const v = Multi.verdictText(multi, { selectedIndices: [0, 2], labels: render.optionLabels(multi), language: 'en' });
    expect(v.text).not.toMatch(TEX_LEAK);
  });

  test('the class report\'s "reteach these" lines and the /quiz rows carry flat maths', () => {
    expect(Rows.normaliseTopic('Comparing $\\frac{1}{2}$ and $\\frac{1}{3}$')).toBe('Comparing 1/2 and 1/3');
    const forward = Gen.studentMessage({ teacherName: 'Rifat Noor', topic: 'Halves: $\\frac{1}{2}$', date: '23 Sep', link: 'https://wa.me/x', language: 'en' });
    expect(forward).not.toMatch(TEX_LEAK);
    expect(forward).toContain('1/2');
    const prompt = Report.buildGuidancePrompt({
      topic: 'Fractions', grade: '4', average: 50, finished: 10, started: 12, language: 'en',
      hardest: [{ question_text: STEM, wrong: 6, total: 10, top_wrong_text: '$\\frac{2}{9}$', correct_text: '$\\frac{2}{3}$' }],
    });
    // what the model reads is what the class saw; it then writes the same
    expect(prompt).toContain('Which fraction is the largest: 2/9, 1/6 or 2/3?');
    expect(prompt).toContain('"2/9"');
  });

  test('the class report reads the hardest questions flat at the source, so its chat lines, its prompt and its PDF all agree', async () => {
    installFrom(supabase.from, ({
      quiz_answers: {
        data: [
          { question_id: 'q-1', is_correct: false, selected_option: 'A' },
          { question_id: 'q-1', is_correct: false, selected_option: 'A' },
          { question_id: 'q-1', is_correct: true, selected_option: 'C' },
        ],
      },
      quiz_questions: { data: [row()] },
    }));
    const hardest = await Report.hardestQuestions('sc-1', 3, ['s-1', 's-2', 's-3']);
    expect(hardest).toHaveLength(1);
    expect(hardest[0].question_text).toBe('Which fraction is the largest: 2/9, 1/6 or 2/3?');
    expect(hardest[0].top_wrong_text).toBe('2/9');
    expect(hardest[0].correct_text).toBe('2/3');
    Object.values(hardest[0]).filter((v) => typeof v === 'string').forEach((s) => expect(s).not.toMatch(TEX_LEAK));
  });
});

// ── 4. the validator measures what the child SEES, and rejects broken maths ──

describe('the validator', () => {
  const DIGEST = {
    subject: 'maths',
    slos: [{ id: 'S1', statement: 'compare fractions', taught_level: 'understand' }],
  };
  function q(i, over = {}) {
    return {
      slo_id: 'S1', level: 'understand',
      question: `Question ${i}: which of these is the largest fraction?`,
      options: [`$\\frac{2}{${9 + i}}$`, `$\\frac{1}{${6 + i}}$`, `$\\frac{2}{3}$`],
      correct_index: 2,
      explanation: 'Two thirds is more than half; the others are less than half.',
      selected_because: 'the class compared fractions on the board',
      option_feedback: {
        correct: 'Yes — two of three equal parts is the most.',
        wrong: { 0: 'Those parts are smaller, so it is less.', 1: 'One small part is less than two big ones.' },
      },
      ...over,
    };
  }
  const six = (over = {}) => [0, 1, 2, 3, 4, 5].map((i) => q(i, i === 0 ? over : {}));
  const ctx = { language: 'en', subject: 'maths', digest: DIGEST };

  test('a well-formed TeX quiz passes', () => {
    const v = validate(six(), ctx);
    expect(v.errors).toEqual([]);
    // the stored text keeps the TeX: the card and the PDF typeset from it
    expect(v.questions[0].options[0]).toBe('$\\frac{2}{9}$');
  });

  test('an unmatched "$" is a MATH_TEX fault on THAT question, which the targeted rewrite can take', () => {
    const v = validate(six({ question: 'Question 0: what is $\\frac{2}{9} + \\frac{1}{9}?' }), ctx);
    const faults = v.errors.filter((e) => /^q0: MATH_TEX\b/.test(e));
    expect(faults.length).toBeGreaterThanOrEqual(1);
    expect(faults[0]).toMatch(/unmatched "\$"/);
    expect(v.errors.every((e) => /^q0: /.test(e))).toBe(true);
  });

  test('words, Urdu, chemistry or $$…$$ inside the dollars are MATH_TEX faults too', () => {
    const bad = (question) => validate(six({ question }), ctx).errors.filter((e) => /^q0: MATH_TEX\b/.test(e));
    expect(bad('Question 0: $two thirds$ is how much?')[0]).toMatch(/the word "two" is inside the dollars/);
    expect(bad('Question 0: $$\\frac{2}{3}$$ is how much?')[0]).toMatch(/\$\$/);
    expect(bad('Question 0: what is $\\ce{H2O}$ made of?')[0]).toMatch(/chemistry is written plain/);
    expect(bad('Question 0: what is \\frac{2}{3} of 9?')[0]).toMatch(/outside the dollars/);
  });

  test('an option is measured as the child SEES it, not as its TeX source', () => {
    const long = '$\\frac{1}{2} + \\frac{1}{4} + \\frac{1}{8} + \\frac{1}{16} + \\frac{1}{32} + \\frac{1}{64}$';
    expect([...long].length).toBeGreaterThan(OPTION_MAX);
    const v = validate(six({ options: [long, '$\\frac{1}{6}$', '$\\frac{2}{3}$'] }), ctx);
    expect(v.errors.filter((e) => /option >/.test(e))).toEqual([]);
    // and a stem the same way
    const stem = `Question 0: ${'$\\frac{1}{2} + \\frac{1}{4}$ and '.repeat(7)}which is largest?`;
    expect([...stem].length).toBeGreaterThan(STEM_MAX);
    expect(validate(six({ question: stem }), ctx).errors.filter((e) => /stem >/.test(e))).toEqual([]);
  });

  test('two options that READ the same on the phone are duplicates, however differently they are typed', () => {
    const v = validate(six({ options: ['$\\frac{2}{9}$', '2/9', '$\\frac{2}{3}$'] }), ctx);
    expect(v.errors).toContain('q0: duplicate options');
  });

  test('the figure gates read the rendered answer: a TeX key the bar cannot show is still FIGURE_MISMATCH', () => {
    const figured = six({
      question: 'Question 0: what fraction of the bar is shaded?',
      options: ['$\\frac{1}{4}$', '$\\frac{3}{4}$', '$\\frac{2}{5}$'], correct_index: 2,
      figure: { type: 'fraction_bar', bars: [{ parts: 4, shaded: 3 }] },
      figure_role: 'read_off',
    });
    const v = validate(figured, ctx);
    expect(v.errors.some((e) => /^q0: FIGURE_MISMATCH/.test(e))).toBe(true);
  });
});

// ── 5. the author and the rewrite are told the notation contract ────────────

describe('the prompt contract', () => {
  test('the shared question contract states the TeX rule — and bans TeX inside a figure spec', () => {
    const c = Contract.questionContract({ gradeBand: '3-5' });
    expect(c).toMatch(/\$\\frac\{2\}\{9\}\$/);
    expect(c).toMatch(/mixed number \$2\\frac\{1\}\{3\}\$/);
    expect(c).toMatch(/NEVER TeX inside a "figure"/);
    expect(c).toMatch(/never \$12\$/);
  });

  test('the author prompt carries it, and its worked fraction example is written the same way', () => {
    const p = buildAuthorPrompt({ digest: { subject: 'maths', slos: [] }, excerpts: 'x', language: 'ur', n: 8, gradeBand: '3-5' });
    expect(p).toMatch(/MATHS NOTATION/);
    expect(p).toMatch(/options \["\$\\\\frac\{3\}\{4\}\$"/);
  });

  test('a question rejected ONLY for its maths may keep the same question in the rewrite', () => {
    const qs = [0, 1, 2, 3, 4, 5].map((i) => ({ slo_id: 'S1', level: 'understand', question: `Q${i} $\\frac{2}{9}`, options: ['a', 'b', 'c'], correct_index: 0 }));
    const targets = Rewrite.rewriteTargets(['q0: MATH_TEX — stem: has an unmatched "$"']);
    expect(targets.indices).toEqual([0]);
    const p = Rewrite.buildRewritePrompt({
      questions: qs, targets, digest: { subject: 'maths', slos: [] }, language: 'en',
    });
    expect(p).toMatch(/MATHS NOTATION/);
    expect(p).toMatch(/rejected ONLY for MATH_TEX/);
  });
});

// ── 6. end to end: authored → validated → carded → stored → PDF → phone ─────

describe('generate — a fractions quiz reaches the child as typeset cards', () => {
  const QID = '99999999-9999-4999-8999-999999999999';
  const SID = '88888888-8888-4888-8888-888888888888';
  const DIGEST = {
    topic: 'Comparing fractions', topic_as_taught: 'Comparing fractions', subject: 'maths', grade_band: '4',
    language_of_instruction: 'en', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'compare fractions with a picture of equal parts', taught_level: 'understand' }],
    key_terms: [], examples_used: [], misconceptions_surfaced: [],
  };
  const QUIZ = {
    id: QID, teacher_id: 'u-1', coaching_session_id: SID, topic: 'Comparing fractions', subject: 'maths',
    language: 'en', status: 'generating', meta: { digest: DIGEST, grade: '4', step: 'author' },
  };
  const SESSION = {
    id: SID, user_id: 'u-1', transcript_text: 'x'.repeat(3000), transcript_language: 'en',
    created_at: '2026-09-23T05:00:00Z', analysis_data: { topic: 'Comparing fractions', subject: 'Maths' },
    users: { phone_number: '923001234567', preferred_language: 'en', name: 'Rifat Noor' },
  };
  const AUTHORED = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
    slo_id: 'S1', level: 'understand',
    question: i < 6
      ? `Question ${i + 1}: which is the largest: $\\frac{2}{${9 + i}}$, $\\frac{1}{${6 + i}}$ or $\\frac{2}{3}$?`
      : `Question ${i + 1}: which word names the number under the line in a fraction?`,
    options: i < 6
      ? [`$\\frac{2}{${9 + i}}$`, `$\\frac{1}{${6 + i}}$`, '$\\frac{2}{3}$']
      : [`numerator ${i}`, `denominator ${i}`, `fraction bar ${i}`],
    correct_index: i < 6 ? 2 : 1,
    explanation: i < 6 ? '$\\frac{2}{3}$ is more than half; the others are less than half.' : 'The denominator is the number of equal parts.',
    selected_because: `question ${i + 1} came from the fraction strips on the board`,
    distractor_misconceptions: { 0: 'reads a bigger bottom number as bigger', 1: 'counts parts, not their size' },
    option_feedback: {
      correct: i < 6 ? 'Yes! $\\frac{2}{3}$ is two of three big parts.' : 'Yes — the denominator names the equal parts.',
      wrong: { 0: 'A bigger bottom number means smaller parts.', 1: 'One small part is less than two big ones.' },
    },
  }));

  function wire() {
    installFrom(supabase.from, ({
      quizzes: (calls) => (calls.some((c) => c[0] === 'update') ? { data: [{ id: QID }] } : { data: [QUIZ] }),
      coaching_sessions: { data: [SESSION] },
      quiz_questions: (calls) => (calls.some((c) => c[0] === 'insert') ? { data: null, error: null } : { data: [] }),
      users: { data: [SESSION.users] },
    }));
  }
  const insertedRows = () => supabase.from.callsFor('quiz_questions').flat().filter((c) => c[0] === 'insert')[0][1];

  beforeEach(() => {
    jest.spyOn(Gen, 'sleep').mockResolvedValue(undefined);
    jest.spyOn(Handoff, 'sleep').mockResolvedValue(undefined);
    installNoPictureRepair(Gen);
    completeJson.mockImplementation(async ({ label }) => {
      if (label === 'transcript_quiz.author') {
        return {
          json: {
            lesson_summary: 'You compared fractions with paper strips, folding each strip into equal parts and shading them.',
            lesson_summary_short: 'You compared fractions with folded paper strips.',
            checks_summary: 'This quiz checks whether the class can compare two fractions.',
            questions: AUTHORED,
          },
          model: 'am', costUsd: 0.01, latencyMs: 50,
        };
      }
      throw new Error(`unexpected LLM call: ${label}`);
    });
  });

  test('every TeX question is stored with a typeset card; the text questions are not', async () => {
    wire();
    const r = await Gen.process(QID, {});
    expect(r.ok).toBe(true);

    const cards = htmlToImage.mock.calls.map(([html]) => html);
    expect(cards).toHaveLength(6);
    cards.forEach((html) => {
      expect(bodyOf(html)).toMatch(/class="katex/);
      expect(bodyOf(html)).not.toMatch(/\\frac|\$/);
    });

    const rows = insertedRows();
    expect(rows.filter((x) => x.media && x.media.question_card)).toHaveLength(6);
    // the source is what is stored — the card and the PDF typeset from it
    expect(rows[0].question_text).toContain('$\\frac{2}{9}$');
    expect(rows.slice(6).every((x) => !x.media.question_card)).toBe(true);

    // the teacher's PDF typesets the same six questions
    const pdf = bodyOf(htmlToPdf.mock.calls[0][0]);
    expect((pdf.match(/class="stem content"[^>]*>[^]*?<\/div>/g) || []).filter((s) => /class="katex/.test(s))).toHaveLength(6);
    expect(pdf).not.toMatch(/\\frac|\$/);

    // nothing the teacher was sent carries TeX
    sentStrings().forEach((s) => expect(s).not.toMatch(TEX_LEAK));
  });

  test('then, on the child\'s phone: the card is the header, the buttons are letters, no text is TeX', async () => {
    wire();
    await Gen.process(QID, {});
    const rows = insertedRows().map((x, i) => ({ ...x, id: `row-${i}` }));
    rows.forEach((x) => {
      const msgs = render.build(x, { questionNumber: 1, totalQuestions: rows.length });
      visibleStrings(msgs).forEach((s) => expect(s).not.toMatch(TEX_LEAK));
    });
    WhatsAppService.sendImageWithButtons.mockClear();
    const msgs = render.build(rows[0], { questionNumber: 1, totalQuestions: rows.length });
    await sender.sendPhase('923009999999', msgs, 'interaction', { questionId: rows[0].id, language: 'en' });
    const [, header, , buttons] = WhatsAppService.sendImageWithButtons.mock.calls[0];
    expect(header).toBe(rows[0].media.question_card);
    expect(buttons.map((b) => b.title)).toEqual(['A', 'B', 'C']);
  }, 20000);
});
