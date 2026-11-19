'use strict';
/**
 * bd-r2uzg1.18.4 — no Devanagari in what a MODEL writes for a coach or a teacher.
 *
 * bd-bfy69 stopped Devanagari in TRANSCRIPTS (on prod, transcripts with Devanagari fell from 34 of 1,204 in August
 * to 3 of 758 in November). The model still writes the odd Hindi-script word into its own Urdu: since 1 Nov,
 * 81 teacher DC sessions and 20 coach observations carry Devanagari in analysis_data — FICO evidence, the report
 * narrative, the focus area, strengths, the reflective corpus — across about 45 different JSON paths. We ship no
 * Devanagari font, so the report image prints those words as boxes, and a coach reads them in the review form.
 *
 * The fix runs the SAME converter as the transcript (devanagari-guard.transliterateToUrdu, no second one) over every
 * string the model hands back, right where the reply is produced. English and Urdu text pass through unchanged.
 *
 * All strings here are made up, shaped like the prod samples (Urdu with one Hindi-script word, a code-switched line).
 */

const {
  hasDevanagari, transliterateToUrdu,
} = require('../../bot/shared/utils/devanagari-guard');

// Shaped like the prod samples: an Urdu sentence with ONE word in Hindi script.
const UR_WITH_HINDI_WORD = 'استاد نے گہرے سوچنے کے मौके محدود کیے';
const UR_PREFIX = 'استاد نے گہرے سوچنے کے ';
const UR_SUFFIX = ' محدود کیے';
// A quote line, code-switched: English, Urdu and Hindi script in one.
const MIXED_QUOTE = 'Teacher: "अच्छा, अब बताइए" — بچوں نے جواب دیا, then wrote it.';
const CLEAN_UR = 'آپ نے بچوں کو سوچنے کا وقت دیا۔';
const CLEAN_EN = 'You waited after asking the question.';

const deepHasDevanagari = (v) => hasDevanagari(JSON.stringify(v));

// ── 1. the deep guard ────────────────────────────────────────────────────────
describe('ensureNoDevanagariDeep — every string in a model reply, at any depth', () => {
  const { ensureNoDevanagariDeep } = require('../../bot/shared/utils/devanagari-guard');

  // The shape of a stored analysis: the paths are the ones prod showed Devanagari in.
  const blob = () => ({
    framework: 'fico',
    has_lesson_plan: true,
    scores: { overall_marks: 41, overall_max_marks: 68, pct: 60.3 },
    domains: {
      lesson_plan_fidelity: {
        domain_score: 6,
        indicators: [
          { id: 'B1', score: 2, evidence: UR_WITH_HINDI_WORD, evidence_summary: CLEAN_UR },
          { id: 'B2', score: null, evidence: CLEAN_EN },
        ],
      },
    },
    focus_area: { rationale: UR_WITH_HINDI_WORD, try_this_tomorrow: CLEAN_UR },
    strengths: [{ title: CLEAN_EN, evidence: MIXED_QUOTE }],
    recommendations: [CLEAN_UR, UR_WITH_HINDI_WORD],
    reflective_corpus: { significant_moments: [{ at: '04:10', what_happened: MIXED_QUOTE }] },
    report_narrative: { identity: UR_WITH_HINDI_WORD, moments: [{ title: CLEAN_UR, quote: MIXED_QUOTE, why: CLEAN_UR }] },
    photo_count_analysed: 0,
    subject_resolution: { subject: 'urdu', subject_unconfirmed: false },
  });

  test('THE BUG SHAPE: no Devanagari survives anywhere in the blob', () => {
    expect(deepHasDevanagari(blob())).toBe(true);
    expect(deepHasDevanagari(ensureNoDevanagariDeep(blob()))).toBe(false);
  });

  test('it is the transcript converter, not a second one: each string comes out as transliterateToUrdu makes it', () => {
    const out = ensureNoDevanagariDeep(blob());
    expect(out.focus_area.rationale).toBe(transliterateToUrdu(UR_WITH_HINDI_WORD));
    expect(out.strengths[0].evidence).toBe(transliterateToUrdu(MIXED_QUOTE));
    expect(out.recommendations[1]).toBe(transliterateToUrdu(UR_WITH_HINDI_WORD));
  });

  test('the Urdu and English around the Hindi-script word are untouched', () => {
    const out = ensureNoDevanagariDeep(blob());
    expect(out.domains.lesson_plan_fidelity.indicators[0].evidence.startsWith(UR_PREFIX)).toBe(true);
    expect(out.domains.lesson_plan_fidelity.indicators[0].evidence.endsWith(UR_SUFFIX)).toBe(true);
    expect(out.strengths[0].evidence.startsWith('Teacher: "')).toBe(true);
    expect(out.strengths[0].evidence.endsWith('بچوں نے جواب دیا, then wrote it.')).toBe(true);
  });

  test('clean strings, numbers, booleans, null and keys come through exactly as they were', () => {
    const before = blob();
    const out = ensureNoDevanagariDeep(before);
    expect(out.scores).toEqual({ overall_marks: 41, overall_max_marks: 68, pct: 60.3 });
    expect(out.has_lesson_plan).toBe(true);
    expect(out.domains.lesson_plan_fidelity.indicators[1]).toEqual({ id: 'B2', score: null, evidence: CLEAN_EN });
    expect(out.domains.lesson_plan_fidelity.indicators[0].evidence_summary).toBe(CLEAN_UR);
    expect(out.focus_area.try_this_tomorrow).toBe(CLEAN_UR);
    expect(out.recommendations[0]).toBe(CLEAN_UR);
    expect(Object.keys(out)).toEqual(Object.keys(before));
    // only the branches that held Devanagari are new objects
    expect(out.scores).toBe(before.scores);
    expect(out.subject_resolution).toBe(before.subject_resolution);
  });

  test('the input is never mutated, and a clean value comes back as the very same reference', () => {
    const before = blob();
    const snapshot = JSON.stringify(before);
    ensureNoDevanagariDeep(before);
    expect(JSON.stringify(before)).toBe(snapshot);

    const clean = { a: CLEAN_UR, b: [CLEAN_EN, 3, null], c: { d: true } };
    expect(ensureNoDevanagariDeep(clean)).toBe(clean);
  });

  test('a bare string, a string array and non-objects work too', () => {
    expect(ensureNoDevanagariDeep(UR_WITH_HINDI_WORD)).toBe(transliterateToUrdu(UR_WITH_HINDI_WORD));
    expect(deepHasDevanagari(ensureNoDevanagariDeep([UR_WITH_HINDI_WORD, MIXED_QUOTE]))).toBe(false);
    for (const v of [null, undefined, 0, 7, false, '', CLEAN_UR]) expect(ensureNoDevanagariDeep(v)).toBe(v);
  });

  test('onDetected fires once per call with the count, the number of strings and where they were; never when clean', () => {
    const onDetected = jest.fn();
    ensureNoDevanagariDeep(blob(), { onDetected });
    expect(onDetected).toHaveBeenCalledTimes(1);
    const info = onDetected.mock.calls[0][0];
    expect(info.strings).toBe(7);
    expect(info.count).toBeGreaterThan(20);
    expect(info.paths).toEqual(expect.arrayContaining([
      'domains.lesson_plan_fidelity.indicators[0].evidence', 'focus_area.rationale', 'recommendations[1]',
      'report_narrative.identity', 'report_narrative.moments[0].quote',
    ]));
    expect(hasDevanagari(info.sample)).toBe(true);
    expect(info.sample.length).toBeLessThanOrEqual(12);

    const quiet = jest.fn();
    ensureNoDevanagariDeep({ a: CLEAN_UR }, { onDetected: quiet });
    expect(quiet).not.toHaveBeenCalled();
  });

  test('a throwing onDetected never costs the caller its converted text', () => {
    const out = ensureNoDevanagariDeep({ a: UR_WITH_HINDI_WORD }, { onDetected: () => { throw new Error('log down'); } });
    expect(hasDevanagari(out.a)).toBe(false);
  });
});

// ── 1b. the converter keeps its own promise: never Devanagari, whatever arrives ──────────────────────────────────
describe('transliterateToUrdu — no Devanagari code point survives', () => {
  // Prod since 1 Aug: one stored transcript string kept a U+090E after conversion. Code points are written as escapes
  // so no editor can normalise them away (the precomposed nukta letters are Unicode composition exclusions).
  const BLOCKS = [[0x0900, 0x097F], [0xA8E0, 0xA8FF], [0x1CD0, 0x1CFF]];

  test('every code point of the Devanagari, Devanagari Extended and Vedic blocks, alone and inside a word', () => {
    const left = [];
    for (const [lo, hi] of BLOCKS) {
      for (let c = lo; c <= hi; c++) {
        const ch = String.fromCodePoint(c);
        for (const s of [ch, `\u0915${ch}\u093E \u0915${ch}`]) {
          if (hasDevanagari(transliterateToUrdu(s))) left.push(`U+${c.toString(16)}`);
        }
      }
    }
    expect(left).toEqual([]);
  });

  test('a precomposed nukta letter reads the same as base + nukta (U+095B and U+091C U+093C both give ز)', () => {
    const pairs = [[0x0958, 0x0915], [0x0959, 0x0916], [0x095A, 0x0917], [0x095B, 0x091C], [0x095C, 0x0921], [0x095D, 0x0922], [0x095E, 0x092B]];
    for (const [pre, base] of pairs) {
      const word = (first) => `${String.fromCodePoint(first)}\u093E`;
      expect(transliterateToUrdu(word(pre))).toBe(transliterateToUrdu(`${String.fromCodePoint(base)}\u093C\u093E`));
    }
  });

  test('short e and o (the vowels the old map missed) read as Urdu, not as a stripped gap', () => {
    expect(transliterateToUrdu('\u090E\u0915')).toBe('اےک');
    expect(transliterateToUrdu('\u0915\u094A')).toBe('کو');
  });
});

// ── 2. GPT5MiniService: the JSON helper, the reflective question, the topic and subject ──────────────────────────
describe('GPT5MiniService — model replies leave with no Devanagari', () => {
  let GPT5MiniService;
  let create;
  let logToFile;
  let callReflective;

  beforeEach(() => {
    jest.resetModules();
    create = jest.fn();
    callReflective = jest.fn();
    logToFile = jest.fn();
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile, logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
    jest.doMock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
    jest.doMock('../../bot/shared/services/coaching/reflective-questions/llm-router.service', () => ({ callReflective }));
    // The model boundary, as voice-debrief-says-score.test.js mocks it: the real methods run on a stubbed client.
    jest.doMock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create } } }) }));
    GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
  });

  const reply = (content) => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });

  test('completeJson (the coach debrief guide, feedback card, observe notes): the parsed result is clean', async () => {
    create.mockResolvedValueOnce(reply(JSON.stringify({
      guide: { opener: UR_WITH_HINDI_WORD, steps: [MIXED_QUOTE, CLEAN_UR] }, score: 3,
    })));
    const { result } = await GPT5MiniService.completeJson('prompt', { job: 'coaching.observeDebrief' });
    expect(deepHasDevanagari(result)).toBe(false);
    expect(result.guide.opener.startsWith(UR_PREFIX)).toBe(true);
    expect(result.guide.steps[1]).toBe(CLEAN_UR);
    expect(result.score).toBe(3);
  });

  test('completeJson logs the conversion at warn, with where it happened and how much — never the sentence', async () => {
    create.mockResolvedValueOnce(reply(JSON.stringify({ a: UR_WITH_HINDI_WORD })));
    await GPT5MiniService.completeJson('prompt', { job: 'coaching.observeDebrief', label: 'observeDebriefGuide' });
    const hit = logToFile.mock.calls.find(([msg]) => /Devanagari/.test(msg));
    expect(hit).toBeTruthy();
    expect(hit[2]).toBe('warn');
    expect(hit[1]).toMatchObject({ where: expect.any(String), devanagariChars: expect.any(Number), strings: 1 });
    expect(JSON.stringify(hit[1])).not.toContain(UR_PREFIX.trim());
  });

  test('a clean completeJson reply is returned as parsed, and nothing is logged about script', async () => {
    create.mockResolvedValueOnce(reply(JSON.stringify({ a: CLEAN_UR, n: 2 })));
    const { result } = await GPT5MiniService.completeJson('prompt', {});
    expect(result).toEqual({ a: CLEAN_UR, n: 2 });
    expect(logToFile.mock.calls.some(([msg]) => /Devanagari/.test(msg))).toBe(false);
  });

  test('keepScript (video-reco, which has its own script gate) gets the reply exactly as the model wrote it', async () => {
    const reply_ = { reason_ur: UR_WITH_HINDI_WORD };
    create.mockResolvedValueOnce(reply(JSON.stringify(reply_)));
    const { result } = await GPT5MiniService.completeJson('prompt', { job: 'coaching.videoReco', label: 'videoReco', keepScript: true });
    expect(result).toEqual(reply_);
  });

  test('the reflective question a teacher is sent on WhatsApp has no Devanagari', async () => {
    const corpus = { analysis: { subject_topic: 'x' }, lesson_throughline_en: 'y', significant_moments: [], collective_moments: [], recurring_signals: [] };
    const question = 'جب ایک بچے نے جواب دیا تو آپ نے अगला سوال کیسے چنا؟';
    callReflective.mockResolvedValueOnce({ content: JSON.stringify({ question, question_en: 'How did you pick the next question?' }), model_used: 'm' });
    const out = await GPT5MiniService._generateReflectiveQuestionV12(corpus, [], 1, 'ur', '');
    expect(hasDevanagari(out)).toBe(false);
    expect(out).toBe(transliterateToUrdu(question));
  });

  test('the inferred lesson topic and subject (stored as analysis_data.topic / subject) have no Devanagari', async () => {
    create.mockResolvedValueOnce(reply('जोड़ — دو ہندسوں کی جمع'));
    expect(hasDevanagari(await GPT5MiniService.inferLessonTopic('transcript'))).toBe(false);
    create.mockResolvedValueOnce(reply('गणित'));
    expect(hasDevanagari(await GPT5MiniService.inferLessonSubject('transcript'))).toBe(false);
  });

  test('the voice-debrief script handed to TTS has no Devanagari', async () => {
    create.mockResolvedValueOnce(reply(`السلام علیکم۔ ${UR_WITH_HINDI_WORD}`));
    const script = await GPT5MiniService.summarizeForVoiceDebrief({ analysis: { framework: 'fico' } }, 'ur');
    expect(hasDevanagari(script)).toBe(false);
    expect(script.startsWith('السلام علیکم۔ ')).toBe(true);
  });
});

// ── 3. the report narrative (report image, PDF, the report page) ─────────────────────────────────────────────────
describe('report narrative — clean before it is rendered or stored', () => {
  let Narrative;
  let create;

  beforeEach(() => {
    jest.resetModules();
    create = jest.fn();
    jest.doMock('../../bot/shared/services/gpt5-mini.service', () => ({ openai: { chat: { completions: { create } } } }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
    Narrative = require('../../bot/shared/services/coaching/report-v2/narrative.service');
  });

  const reply = (content) => ({ choices: [{ message: { content } }] });

  test.each(['ur', 'en'])('generateReportNarrative (%s): identity, moments, domain whys, horizon — no Devanagari', async (language) => {
    create.mockResolvedValueOnce(reply(JSON.stringify({
      affirmation: CLEAN_UR,
      identity: UR_WITH_HINDI_WORD,
      strength_name: CLEAN_UR,
      horizon_title: CLEAN_UR,
      horizon_note: UR_WITH_HINDI_WORD,
      journey_note: MIXED_QUOTE,
      moments: [{ title: CLEAN_UR, quote: MIXED_QUOTE, why: UR_WITH_HINDI_WORD }],
      domain_whys: { high_leverage_practices: UR_WITH_HINDI_WORD, teacher_subject_knowledge: CLEAN_UR },
    })));
    const n = await Narrative.generateReportNarrative({ framework: 'fico', scores: {} }, { language });
    expect(deepHasDevanagari(n)).toBe(false);
    expect(n.identity.startsWith(UR_PREFIX)).toBe(true);
    expect(n.affirmation).toBe(CLEAN_UR);
    expect(n.domain_whys.teacher_subject_knowledge).toBe(CLEAN_UR);
  });

  test('generateFicoSDomainWhys (FICO 6-12 section lines): no Devanagari', async () => {
    create.mockResolvedValueOnce(reply(JSON.stringify({ domain_whys: { A: UR_WITH_HINDI_WORD, B: CLEAN_UR } })));
    const whys = await Narrative.generateFicoSDomainWhys({ sections: [], indicators: [] }, { language: 'ur' });
    expect(deepHasDevanagari(whys)).toBe(false);
    expect(whys.B).toBe(CLEAN_UR);
  });
});
