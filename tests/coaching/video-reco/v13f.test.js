'use strict';
/**
 * bd-8hhqhf (VIDREC round 7, eng-fix) — the engine gaps the live walk and the v1.3c panel found, code-only:
 *  1. the card-sentence fallback trims a long card sentence at a word boundary instead of refusing it (session 077b8021);
 *  2. the name check ignores honorifics and role words in users.name ("VIDREC Test Teacher", "Miss …");
 *  3. a quoted lesson moment inside a reason sits in its own FSI…PDI isolate (the 98-s3 "9 ہم نے …" reorder);
 *  4. 37-B8 is a NO_MOVE indicator like B7 / C10;
 *  5. a [a student] in a quote whose raw transcript line had no name there → validation:placeholder; the output
 *     redactor takes the lesson's subject terms as vocabulary.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let S;
let T;
let R;
let C;
const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FSI = '⁨';
const PDI = '⁩';

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  S = require('../../../bot/shared/services/coaching/video-reco/select');
  T = require('../../../bot/shared/services/coaching/video-reco/target');
  R = require('../../../bot/shared/services/coaching/video-reco/redact-names');
  C = require('../../../bot/shared/services/coaching/video-reco/copy');
});

const cps = (s) => [...String(s)].length;

function args({ lines, name = 'Saima Khan', card = { indicator: 'C1', action: 'Ask two why questions about shapes' }, lang = 'ur', subject = 'urdu' } = {}) {
  return {
    session: {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name, preferred_language: lang },
      diarization_data: { segments: lines || [
        { start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' },
        { start_ms: 45000, label: 'Student', text: 'Yes' },
      ] },
    },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [
        { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
        { id: 'C2', name: 'Re-explanation', score: 0, applicable: true, evidence: 'none', evidence_summary: '', timestamp: '[01:00]' },
      ] } },
      subject_resolution: { code: subject, grade: '3', confidence: 'high' },
      topic: 'shapes',
    },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
    loop: { state: { angle: 'show' } },
    card,
    coachingSessionId: SID,
  };
}
function deps(answers) {
  const written = [];
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockResolvedValueOnce({ result: a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }));
  return {
    written,
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(FIXTURE),
    store: {
      readForSession: jest.fn().mockResolvedValue(null),
      recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
      ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
      trainingBands: jest.fn().mockResolvedValue([]),
      write: jest.fn(async (row) => { written.push(row); return { id: 'rec-1', ...row }; }),
    },
    v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
    completeJson,
  };
}
const GOOD = {
  seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
  reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7,
};

describe('1 · the card-sentence fallback fits a long card sentence under the cap', () => {
  // Session 077b8021 (sandbox walk, 22 Oct): the real card action, 224 code points; the composed ur reason was 308 > 300.
  const SENTENCE = 'اگلی کلاس میں جب shaded fraction والے پہلے practice task پر تین بچے اپنا جواب دیں، ہر ایک کو specific feedback دیں کہ numerator اور denominator درست پہچانا؛ چوتھے بچے کو next step بتائیں کہ numerator کو denominator پر لکھیں۔';
  const base = {
    none: 'validation:name', segId: '97-s5', shortlist: { candidates: [{ seg_id: '97-s5' }] }, sentence: SENTENCE,
    startS: 237.2, endS: 297.2, language: 'ur', teacherName: 'VIDREC Test Teacher', module: { subjects: ['general'] }, subject: null,
  };

  test('the real 224-cp sentence → a reason ≤ 300 cp in both languages (today: null)', () => {
    expect(cps(SENTENCE)).toBe(224);
    const out = S.cardFallback(base);
    expect(out).not.toBeNull();
    expect(cps(out.reason_ur)).toBeLessThanOrEqual(300);
    expect(cps(out.reason_en)).toBeLessThanOrEqual(300);
  });

  test('the trim is at a word boundary, ends with an ellipsis, and never cuts a word', () => {
    const out = S.cardFallback(base);
    // R7c §6: the Urdu sentence is quoted in the Urdu reader's line only; the English line does not carry it
    expect(out.reason_en).not.toMatch(FSI);
    for (const r of [out.reason_ur]) {
      const quoted = new RegExp(`"${FSI}([^${PDI}]*)${PDI}"`).exec(r);
      expect(quoted).not.toBeNull();
      const shown = quoted[1];
      expect(shown.endsWith('…')).toBe(true);
      const kept = shown.slice(0, -1);
      expect(SENTENCE.startsWith(kept)).toBe(true);
      expect(/[\s\p{P}]/u.test(SENTENCE[kept.length])).toBe(true); // next char of the original: a space or a mark — whole words only
    }
  });

  test('the English reason, which has more room, keeps more of the sentence than it must lose', () => {
    const en = S.cardFallback({ ...base, language: 'en' });
    expect(en).not.toBeNull();
    expect(cps(en.reason_en)).toBeLessThanOrEqual(300);
  });

  test('a sentence that fits is shown whole, with no ellipsis', () => {
    const out = S.cardFallback({ ...base, sentence: 'اگلی کلاس میں دو کیوں والے سوال پوچھیں' });
    expect(out.reason_ur).toContain(`"${FSI}اگلی کلاس میں دو کیوں والے سوال پوچھیں${PDI}"`);
    expect(out.reason_ur).not.toContain('…');
  });

  test('one unbroken run longer than the room → the none stands (nothing to cut at a word boundary)', () => {
    expect(S.cardFallback({ ...base, sentence: 'ا'.repeat(400) })).toBeNull();
  });
});

describe('2 · the name check ignores honorifics and role words in users.name', () => {
  const excerpts = ['[00:30] Teacher: is this a triangle? Yes or no, quickly!', '[00:31] Student: جی۔'];
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const pick = (reasonEn, reasonUr = GOOD.reason_ur) => ({
    seg_id: '10-s1', moment: { at: '00:30', quote: 'is this a triangle? Yes or no' }, reason_en: reasonEn, reason_ur: reasonUr, confidence: 0.6,
  });

  test('"VIDREC Test Teacher" + a reason saying "the teacher" → ok (today validation:name)', () => {
    const v = S.validate(pick('At 00:30 the teacher asked only yes-or-no questions; this clip shows how to ask why.'), list, excerpts, { teacherName: 'VIDREC Test Teacher' });
    expect(v).toMatchObject({ ok: true, none: null });
  });

  test('"a quick test" in a reason is not the name either', () => {
    const v = S.validate(pick('At 00:30 a quick test of yes-or-no answers; this clip shows how to ask why instead.'), list, excerpts, { teacherName: 'VIDREC Test Teacher' });
    expect(v.ok).toBe(true);
  });

  test('Urdu role words in users.name (مس، ٹیچر، استانی) are not the name', () => {
    const ur = 'مس اور ٹیچر کی کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔'; // R7b: the respectful plural (validation:gender otherwise)
    const v = S.validate(pick(GOOD.reason_en, ur), list, excerpts, { teacherName: 'مس صائمہ ٹیچر استانی' });
    expect(v.ok).toBe(true);
  });

  test('a real given name in the reason still fails', () => {
    const v = S.validate(pick('At 00:30 Saima asked only yes-or-no questions; this clip shows how to ask why.'), list, excerpts, { teacherName: 'Miss Saima Khan' });
    expect(v.none).toBe('validation:name');
  });

  test('the output redactor no longer masks the role word "test" as the teacher', () => {
    expect(S.postRedact('Give a quick test at the end of the lesson', 'VIDREC Test Teacher')).toBe('Give a quick test at the end of the lesson');
    expect(S.postRedact('Ask VIDREC to read', 'VIDREC Test Teacher')).toBe('Ask [TEACHER] to read');
  });
});

describe('3 · a quoted lesson moment sits in an FSI…PDI isolate in the stored reasons', () => {
  // c53bf86d / 98-s3 on the React card: the leading "9" of the Urdu quote rendered on the wrong side.
  const Q = { ...GOOD, reason_en: 'The teacher confirms a student\'s answer: "9 ہم نے اوپر لکھنا ہے". The clip shows a teacher giving specific praise and one clear next step.' };

  test('the 98-s3 reason is stored with the quote isolated; the words are unchanged', async () => {
    const d = deps([Q]);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(row.status).toBe('shown');
    expect(row.reason_en).toBe(`The teacher confirms a student's answer: "${FSI}9 ہم نے اوپر لکھنا ہے${PDI}". The clip shows a teacher giving specific praise and one clear next step.`);
  });

  test('both reasons are isolated, and a reason with no quote is byte-identical', async () => {
    const both = { ...Q, reason_ur: 'استاد نے کہا "is this a triangle" اور کلاس نے صرف ہاں کہا؛ اس کلپ میں کیوں کے سوال ہیں۔' };
    const row = await E.recommendForReport({ ...args(), deps: deps([both]) });
    expect(row.reason_ur).toBe(`استاد نے کہا "${FSI}is this a triangle${PDI}" اور کلاس نے صرف ہاں کہا؛ اس کلپ میں کیوں کے سوال ہیں۔`);
    const plain = await E.recommendForReport({ ...args(), deps: deps([GOOD]) });
    expect(plain.reason_en).toBe(GOOD.reason_en);
    expect(plain.reason_ur).toBe(GOOD.reason_ur);
  });

  test('the WhatsApp body still isolates English runs OUTSIDE the quote in an Urdu line', () => {
    const body = C.messageBody({ minutes: 1, reason: `استاد نے کہا "${FSI}is this${PDI}" پھر next step دیا`, clipLanguage: 'ur', language: 'ur' });
    expect(body).toContain('⁦next step⁩');
    expect(body).toContain(`"${FSI}is this${PDI}"`);
  });
});

describe('4 · 37-B8 is a NO_MOVE indicator', () => {
  const C2 = require('./fixtures/catalog.fixture.json');
  test('a B8 step → hole:no_move, like B7 and C10', () => {
    const cat = require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(C2);
    const a = { framework: 'fico', indicator_scheme: 'fico_main_37', domains: { B: { indicators: [{ id: 'B8', name: 'Use of Prescribed Resources', score: 1, applicable: true, evidence: 'x', timestamp: '[01:00]' }] } } };
    expect(T.NO_MOVE.has('B8')).toBe(true);
    expect(T.pick(a, { target: { indicator: 'B8' } }, null, cat)).toMatchObject({ none: 'hole:no_move', storedIndicator: 'B8', aliasKind: 'no_move' });
  });
});

describe('5 · redactor false positives', () => {
  // d2a235f4 (gold, maths): the strict excerpt redactor masked میڈین (median); the model quoted the placeholder.
  // The fixture uses کوئنچ (quench, 383a31f3): since v13g میڈین is kept by the retroflex rule, کوئنچ is still masked by
  // the vocabulary rule alone, which is what this check is about.
  // R7c: a question (a topic announcement is not_moment)
  const MEDIAN = [{ start_ms: 1000, label: 'Teacher', text: 'ان نمبروں میں کوئنچ کون سا ہے، کون بتائے گا؟' }, { start_ms: 2000, label: 'Student', text: 'جی۔' }];
  const QUOTE_MEDIAN = {
    ...GOOD, moment: { at: '00:01', quote: 'ان نمبروں میں [a student] کون سا ہے، کون بتائے گا' },
    reason_en: 'At 00:01 the topic was named but no goal was written. This clip shows a teacher writing the objective on the board.',
  };

  test('(a) the excerpt really masks کوئنچ (the premise)', () => {
    const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
    expect(P.excerpts({ diarization_data: { segments: MEDIAN } }, {}, { teacher: 'Saima Khan' })[0]).toContain('[a student]');
  });

  test('(a) a placeholder where the raw line has no name → validation:placeholder on both tries → the card fallback', async () => {
    const d = deps([QUOTE_MEDIAN, QUOTE_MEDIAN]);
    const row = await E.recommendForReport({ ...args({ lines: MEDIAN, subject: 'maths' }), deps: d });
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ first_none_reason: 'validation:placeholder', moment_source: 'card', moment_quote: null });
  });

  test('(a) a placeholder where the raw line HAS a lexicon name → still shown (the redactor did its job)', async () => {
    const d = deps([GOOD]);
    const row = await E.recommendForReport({ ...args(), deps: d });
    expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript', moment_quote: GOOD.moment.quote });
    expect(d.completeJson).toHaveBeenCalledTimes(1);
  });

  test('(a) an Urdu lexicon name in the same slot → still shown', async () => {
    const lines = [{ start_ms: 1000, label: 'Teacher', text: 'ان نمبروں میں احمد کون سا ہے، کون بتائے گا؟' }, { start_ms: 2000, label: 'Student', text: 'جی۔' }];
    const d = deps([QUOTE_MEDIAN]);
    const row = await E.recommendForReport({ ...args({ lines, subject: 'maths' }), deps: d });
    expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript' });
  });

  test('(b) the output redactor keeps the lesson\'s subject terms: "میگنیٹ، آپ بتائیں" is unchanged; a name in the slot is masked', () => {
    expect(S.postRedact('اگلی بار پوچھیں: میگنیٹ، آپ بتائیں یہ کیا کھینچتا ہے؟', 'Saima Khan', ['میگنیٹ'])).toBe('اگلی بار پوچھیں: میگنیٹ، آپ بتائیں یہ کیا کھینچتا ہے؟');
    expect(S.postRedact('اگلی بار پوچھیں: احمد، آپ بتائیں یہ کیا کھینچتا ہے؟', 'Saima Khan', ['میگنیٹ'])).toBe('اگلی بار پوچھیں: [a student]، آپ بتائیں یہ کیا کھینچتا ہے؟');
  });

  test('(b) the engine passes the subject terms: a maths/science term in an address slot survives to the stored reason', async () => {
    const r = { ...GOOD, reason_ur: 'کلاس صرف ہاں یا نہیں کہتی رہی؛ اگلی بار پوچھیں: میڈین، آپ بتائیں کیسے نکالتے ہیں؟ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔' };
    const row = await E.recommendForReport({ ...args({ subject: 'maths' }), deps: deps([r]) });
    expect(row.reason_ur).toBe(r.reason_ur);
  });

  test('(b) the redactor vocabulary never shields a teacher-name token', () => {
    expect(R.redactNames('Saima, read it', { teacher: 'Saima Khan', strict: false, vocab: ['saima'] })).toBe('[TEACHER], read it');
  });
});

describe('red7 (23 Oct) probes on fixes 2 and 3', () => {
  const excerpts = ['[04:17] Teacher: open page twelve and read the first line', '[04:18] Student: جی۔'];
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const pick = (reasonEn, quote = 'open page twelve and read') => ({
    seg_id: '10-s1', moment: { at: '04:17', quote }, reason_en: reasonEn, reason_ur: GOOD.reason_ur, confidence: 0.6,
  });

  test('A11/A12: a name glued to an isolate is still the name', () => {
    expect(S.validate(pick(`At 04:17 ${FSI}Ayesha${PDI} opened page twelve; this clip shows a quick check instead.`), list, excerpts, { teacherName: 'Ayesha Khan' }).none).toBe('validation:name');
  });

  test('A3/A4: an ambiguous given name (Noor) in users.name still fails', () => {
    expect(S.validate(pick('At 04:17 Noor opened page twelve; this clip shows a quick check of understanding.'), list, excerpts, { teacherName: 'Noor Fatima' }).none).toBe('validation:name');
  });

  test('C3: a stray PDI in the model\'s reason is dropped before the quote is isolated', async () => {
    const r = { ...GOOD, reason_en: `The class said "yes${PDI} or no" only. This clip shows a teacher asking why and how instead.` };
    const row = await E.recommendForReport({ ...args(), deps: deps([r]) });
    expect(row.reason_en).toBe(`The class said "${FSI}yes or no${PDI}" only. This clip shows a teacher asking why and how instead.`);
  });

  test('C1/C2: an Urdu reason with an isolated quote AND a bare English run → both isolated in the WhatsApp body', () => {
    const body = C.messageBody({ minutes: 1, reason: C.isolateQuotes('استاد نے کہا "Open your books" اور پھر Think pair share کروایا'), clipLanguage: 'ur', language: 'ur' });
    expect(body).toContain(`"${FSI}Open your books${PDI}"`);
    expect(body).toContain('⁦Think pair share⁩');
  });
});
