'use strict';
/**
 * bd-8hhqhf R7i (COS 20261024T021017 + 022306; panel v7 Z049 ⛔9; red7 S11/S11b): the stored quote masked a child's name
 * that both reasons (and so the WhatsApp body and the portal line) kept. The quote and each reason were redacted as
 * separate texts, and the `named` rule's turn-end test depends on what follows the word in the text being redacted.
 * By construction now: a token masked in the lesson (strict, by a name rule) or in the stored quote is masked in every
 * output built from them. Synthetic names only.
 */
const { redactNames } = require('../../../bot/shared/services/coaching/video-reco/redact-names');

const PH = { child: '[a student]' };
const strict = (t, ctx = {}) => redactNames(t, { placeholders: PH, ...ctx });
const loose = (t, ctx = {}) => redactNames(t, { placeholders: PH, strict: false, ...ctx });

// R7j (red7 HOLD 023908 H2): the second guard builds the lesson's name set and masks the stored text; the excerpt the model
// sees is not changed by it (no pick moves), and the one output gate keeps the name out of every teacher-facing string
describe('the second guard: a one-word call just before a masked name is a name (red7 S11)', () => {
  const { maskedKeys, nameKey } = require('../../../bot/shared/services/coaching/video-reco/redact-names');
  // «…چاہے؟ X؟ ‹ambiguous› ‹strong›؟»: X is followed by an ambiguous word, so `named` never fired in the excerpt
  test.each(['نور', 'گل', 'صبا', 'کرن'])('«…بتانا چاہے؟ %s؟ ‹ambiguous› ‹strong›؟» → in the lesson\'s name set (the excerpt itself unchanged)', (x) => {
    const line = `[00:47] Teacher (UR): اور کوئی بچہ اپنے دوست کی خوبی بتانا چاہے؟ ${x}؟ نور فاطمہ؟`.replace(`${x}؟ نور`, x === 'نور' ? `${x}؟ گل` : `${x}؟ نور`);
    expect(maskedKeys([line]).has(nameKey(x))).toBe(true);
    expect(strict(line)).toContain(`${x}؟`); // H2: the model's input is as before
  });
  test('S11 on model text: «…؟ X؟ [a student] [a student]؟» → masked by the stored-text redactor', () => {
    const { postRedact } = require('../../../bot/shared/services/coaching/video-reco/select');
    expect(postRedact('کوئی اور بتانا چاہے؟ صبا؟ [a student] [a student]؟', 'Saima Khan')).not.toContain('صبا');
  });
  test('control: a verb at a question\'s end before a vocative is not a one-word call', () => {
    expect(loose('تم نے کام مکمل کیا؟ [a student]، بتاؤ۔')).toContain('مکمل کیا');
  });
  test('control: the lesson-count guard keeps a word the lesson says more than 3 times', () => {
    expect(loose('یہ کیا ہے؟ نور؟ [a student]', { counts: new Map([['نور', 5]]) })).toContain('نور');
  });
});

describe('the carry-over: a token masked once is masked in every output (COS 022306 §1)', () => {
  test('carry: a token in the set is masked wherever it appears, whatever follows it', () => {
    const carry = new Set(['صبا']);
    expect(loose('The teacher asked, "کوئی اور بتانا چاہے؟ صبا؟" and moved on.', { carry })).not.toContain('صبا');
  });
  test('control: the noun use in another lesson (no carry) is untouched', () => {
    expect(loose('صبح کی صبا ٹھنڈی تھی اور سب نے دعا مانگی۔')).toContain('دعا مانگی');
  });
});

describe('engine: the stored quote, both reasons and the body never disagree (Z049 shape, S11b)', () => {
  const FIXTURE = require('./fixtures/catalog.fixture.json');
  let E;
  let C;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
    C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  });
  const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
  const LINES = [
    T('00:40', 'Teacher', 'کیا یہ مثلث ہے؟'), T('00:42', 'Student', 'جی'), T('00:44', 'Teacher', 'کیا یہ مربع ہے؟'), T('00:45', 'Student', 'نہیں'),
    // «صبا» (an ambiguous-lexicon word) as a one-word call, then an ambiguous and a strong name
    T('00:47', 'Teacher', 'اچھا۔ اور کوئی بچہ اپنے دوست کی خوبی بتانا چاہے؟ صبا؟ نور فاطمہ؟'), T('00:50', 'Student', 'جی'),
    T('00:52', 'Teacher', 'کیا یہ دائرہ ہے؟'), T('00:54', 'Student', 'جی'),
  ];
  const deps = (answer) => ({
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: C.fromData(FIXTURE),
    store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => ({ id: 'r1', ...r }) },
    v10GroupFor: async () => null,
    completeJson: jest.fn(async (p) => ({ result: answer(p), usage: {}, finishReason: 'stop' })),
  });
  const args = (lang) => ({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "کیا یہ مثلث ہے؟"', timestamp: '[00:40]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions about shapes.' } },
    card: { indicator: 'C1', action: 'Ask two why questions about shapes.' },
    coachingSessionId: 's1',
  });
  // the model quotes the line as it saw it; on the old head it saw «صبا»
  const answerOf = (p) => {
    const seen = /بتانا چاہے؟ (\S+)؟/.exec(p);
    const w = seen ? seen[1] : '[a student]';
    const q = `اپنے دوست کی خوبی بتانا چاہے؟ ${w}؟`;
    const segId = (p.split('CANDIDATE CLIPS')[1].match(/\b\d{1,3}-s\d+\b/) || [])[0];
    return { seg_id: segId, moment: { at: '00:47', quote: q }, confidence: 0.7,
      reason_en: `The teacher asked, "${q}" and moved straight on to asking for answers. The clip explains why questions.`,
      reason_ur: `استاد نے پوچھا، "${q}" اور فوراً جواب مانگے۔ یہ کلپ کیوں والے سوال سمجھاتا ہے۔` };
  };
  test.each(['ur', 'en'])('reader %s: no output carries the name the quote masks', async (lang) => {
    const d = deps(answerOf);
    const row = await E.recommendForReport({ ...args(lang), deps: d });
    // H2: the model may see it (its input is unchanged); no teacher-facing string carries it
    const out = `${row.moment_quote || ''} ${row.reason_en || ''} ${row.reason_ur || ''}`;
    expect(out).not.toContain('صبا');
  });
  test('S11b by construction: a quote the old excerpt let through is masked in both reasons, not only in the quote', async () => {
    // the model writes the name itself (the worst case: it reached the model by any path)
    const d = deps((p) => answerOf(p.replace(/بتانا چاہے؟ \S+؟/, 'بتانا چاہے؟ صبا؟')));
    const row = await E.recommendForReport({ ...args('ur'), deps: d });
    expect(`${row.moment_quote || ''} ${row.reason_en || ''} ${row.reason_ur || ''}`).not.toContain('صبا');
  });
});

describe('R7j (COS 022905 §1; red7 HOLD 023908): one output gate, the counts guard, nothing upstream', () => {
  const RN = () => require('../../../bot/shared/services/coaching/video-reco/redact-names');
  test('H1: a word the lesson uses as a word (6 times, masked once after a name) is not in the name set', () => {
    const lines = ['[00:10] Teacher: عائشہ کرن لاؤ۔', ...Array(5).fill('[00:20] Teacher: سورج کی کرن روشنی ہے۔')];
    const counts = RN().wordCounts(lines);
    expect(RN().maskedKeys(lines, { counts }).has(RN().nameKey('کرن'))).toBe(false);
    const few = ['[00:10] Teacher: عائشہ کرن لاؤ۔', '[00:20] Teacher: کرن آپ بتائیں۔'];
    expect(RN().maskedKeys(few, { counts: RN().wordCounts(few) }).has(RN().nameKey('کرن'))).toBe(true);
  });
  test('scrubNames: whole words of the set, placeholders left alone', () => {
    expect(RN().scrubNames("Hope said \"[a student] and Hope\" — Hope's turn", new Set(['hope']))).toBe("[a student] said \"[a student] and [a student]\" — [a student]'s turn");
  });

  const FIXTURE = require('./fixtures/catalog.fixture.json');
  let E;
  let C;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
    C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  });
  const T = (sec, who, text) => ({ start_ms: sec * 1000, label: who, text });
  const run = (lines, answer, { action = 'Ask two why questions about shapes.', lang = 'ur' } = {}) => {
    const completeJson = jest.fn(async (p) => ({ result: answer(p), usage: {}, finishReason: 'stop' }));
    return E.recommendForReport({
      session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: lines } },
      analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "کیا یہ مثلث ہے؟"', timestamp: '[00:30]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' } },
      nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: action } }, card: { indicator: 'C1', action }, coachingSessionId: 's1',
      deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(FIXTURE), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null, completeJson },
    }).then((row) => ({ row, prompt: (completeJson.mock.calls[0] || [])[0] || '' }));
  };
  const firstSeg = (p) => (p.split('CANDIDATE CLIPS')[1].match(/\b\d{1,3}-s\d+\b/) || [])[0];

  test('H2: the name set changes no model input and no validation — the model still sees and may cite the line; only the stored text is masked', async () => {
    // «کرن» is masked once (after a strong name) and used once more: in the name set (≤ 3 uses), but the excerpt shows it as said
    const lines = [T(20, 'Teacher', 'عائشہ کرن لاؤ۔'), T(22, 'Student', 'جی'), T(30, 'Teacher', 'کیا یہ صحیح ہے، کرن نے کہا تھا؟'), T(33, 'Student', 'جی'), T(36, 'Teacher', 'کیا یہ مربع ہے؟'), T(39, 'Student', 'نہیں')];
    const q = 'کیا یہ صحیح ہے، کرن نے کہا تھا؟';
    const { row, prompt } = await run(lines, (p) => ({ seg_id: firstSeg(p), moment: { at: '00:30', quote: q }, confidence: 0.7,
      reason_en: `The teacher asked "${q}" and the class answered yes or no only. The clip explains why questions.`,
      reason_ur: `استاد نے پوچھا "${q}" اور کلاس نے صرف جی کہا۔ یہ کلپ کیوں والے سوال سمجھاتا ہے۔` }));
    expect(prompt).toContain(q); // the model input is the strict excerpt, untouched by the gate
    expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript' });
    expect(`${row.moment_quote} ${row.reason_en} ${row.reason_ur}`).not.toMatch(/(?<![\p{L}])کرن(?![\p{L}])/u);
  });
  test('the gate on a quoted card sentence: a lesson name in it turns that line into the plain frame (never a placeholder in the quote)', async () => {
    const lines = [T(20, 'Teacher', 'ثمرین، بتاؤ یہ کیا ہے؟'), T(22, 'Student', 'مثلث'), T(30, 'Teacher', 'کیا یہ مثلث ہے؟'), T(33, 'Student', 'جی'), T(36, 'Teacher', 'کیا یہ مربع ہے؟'), T(39, 'Student', 'نہیں')];
    const action = 'اگلی کلاس میں ثمرین سے دو کیوں والے سوال پوچھیں اور پانچ سیکنڈ رکیں۔';
    const SHORT = (p) => ({ seg_id: firstSeg(p), moment: { at: '00:33', quote: 'جی' }, reason_en: 'x', reason_ur: 'y', confidence: 0.6 });
    const { row } = await run(lines, SHORT, { action });
    expect(`${row && row.reason_en} ${row && row.reason_ur}`).not.toContain('ثمرین');
    expect(`${row && row.reason_ur}`).not.toContain('[a student]');
  });
});
