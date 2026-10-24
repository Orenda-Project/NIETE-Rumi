'use strict';
/**
 * bd-8hhqhf R7j §2 (COS 20261024T022905; ped-scale 024200 URDU TERMS READY): the Urdu words are owned by the people who judge
 * them. The engine consumes ped/urdu_terms.json only (shipped verbatim as bot/shared/data/video-reco-urdu-terms.v1.json), and
 * the copy items of the v7 panel (finding §4 b–f, §5). Synthetic lines.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');
const TERMS = require('../../../bot/shared/data/video-reco-urdu-terms.v1.json');

const term = (id) => TERMS.moves.find((m) => m.id === id).ur;
const SID = '7c7c7c7c-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const seg = (id, s, e, title, summary, fico, main37, moves = [], extra = {}) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'کیوں والا سوال', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37, ...extra,
});
const mod = (id, segments) => ({ ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format: 'mixed', summary_en: 'x', language: 'ur', segments, subjects: ['general'] });
const DATA = { ...FIXTURE, holes: [], modules: [...FIXTURE.modules,
  mod(51, [seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A yes/no question against a why question.', [{ indicator: 'C1', strength: 2 }], ['C1', 'D2'], ['open_questions'])]),
] };

let E;
let C;
let CP;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  CP = require('../../../bot/shared/services/coaching/video-reco/copy');
});
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [T('01:00', 'Teacher', 'کیا یہ مثلث ہے؟ ہاں یا نہیں؟'), T('01:03', 'Students', 'جی ہاں'), T('01:06', 'Teacher', 'کیا یہ مربع ہے؟'), T('01:09', 'Student', 'نہیں'), T('01:12', 'Teacher', 'کیا یہ گول ہے؟'), T('01:15', 'Student', 'جی')];
const Q = 'کیا یہ مثلث ہے؟ ہاں یا نہیں؟';
function args({ lines = CLASS, lang = 'ur', action = 'اگلی کلاس میں شکلوں پر دو کیوں والے سوال پوچھیں اور پانچ سیکنڈ رکیں۔' } = {}) {
  return {
    session: { id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: lines } },
    analysis: { framework: 'fico', indicator_scheme: 'fico_main_37', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: `x. Quote: "${Q}"`, timestamp: '[01:00]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' }, topic: 'shapes' },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: action } }, card: { indicator: 'C1', action }, coachingSessionId: SID,
  };
}
const answer = (over = {}) => ({ seg_id: '51-s1', moment: { at: '01:00', quote: Q }, reason_en: 'The class answered only yes or no. The clip explains why questions.', reason_ur: 'کلاس نے صرف ہاں یا نہیں میں جواب دیا؛ یہ کلپ کیوں والے سوال سمجھاتا ہے۔', confidence: 0.7, ...over });
function deps(answers) {
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockImplementationOnce(async (p) => ({ result: typeof a === 'function' ? a(p) : a, usage: {}, finishReason: 'stop' })));
  completeJson.mockResolvedValue({ result: { seg_id: null, none_reason: 'none' }, usage: {}, finishReason: 'stop' });
  return { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: C.fromData(DATA), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => ({ id: 'r', ...r }) }, v10GroupFor: async () => null, completeJson };
}
const run = (a, d) => E.recommendForReport({ ...a, deps: d });
const bare = (t) => String(t || '').replace(/[⁦-⁩]/g, '');

describe('the terms file is the only source', () => {
  test('the shipped data file is ped-scale\'s v1, and the prompt (vr-11) names its terms and move ids, never the retired ones', () => {
    expect(TERMS.version).toBeDefined();
    const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
    expect(P.PROMPT_VERSION).toBe('vr-11');
    const text = P.build({ target: { source: 'card_text' }, candidates: [], catalog: C.fromData(DATA), excerpts: [], reportLanguage: 'ur', lessonLanguage: 'ur' });
    for (const id of ['recall_question', 'yes_no_question', 'chorus_answer']) expect(text).toContain(id);
    expect(text).toContain(term('recall_question'));
    expect(text).not.toContain('یاد سے بتانے والا سوال');
  });
  test.each([
    ['یاد سے بتانے والا سوال', 'سیدھا سا سوال'], ['ابتدائی سوال', 'شروع کا سوال'], ['اجتماعی جواب', 'ایک ساتھ جواب'],
    ['انتظار کا وقفہ', 'سوال کے بعد وقفہ'], ['مزید سوال', 'جواب پر اگلا سوال'], ['سبق کی سوال', 'سبق کا سوال'],
  ])('never-use «%s» → «%s» in an Urdu line', (bad, good) => {
    const out = bare(CP.composeReason(`استاد نے ${bad} پوچھا۔`, 'ur', null));
    expect(out).toContain(good);
    expect(out).not.toContain(bad);
  });
  test('the slash form is retired: «ہاں/نہیں والا سوال» → «ہاں یا نہیں والا سوال»; Latin «wait time» → «سوال کے بعد وقفہ»', () => {
    expect(bare(CP.composeReason('استاد نے ہاں/نہیں والا سوال پوچھا۔', 'ur', null))).toContain('ہاں یا نہیں والا سوال');
    expect(bare(CP.composeReason('استاد نے wait time نہیں دیا۔', 'ur', null))).toContain('سوال کے بعد وقفہ');
  });
});

describe('the Urdu reader\'s line from the transcript frame: the move term before the quote, nothing free after it', () => {
  test('a recall move: «سبق میں استاد نے ‹term› پوچھا، "…"۔ یہ کلپ اس بارے میں ہے: ‹title›۔»', async () => {
    const row = await run(args(), deps([answer({ move: 'recall_question' })]));
    // R7k §1d: a quote that ends in «؟» takes no second mark («؟۔», v8 Z108)
    expect(bare(row.reason_ur)).toBe(`سبق میں استاد نے ${term('recall_question')} پوچھا، "${Q.replace(/\?/g, '؟')}" یہ کلپ اس بارے میں ہے: کیوں والا سوال۔`);
  });
  test('an answer clause only from the file: chorus → «اور جواب ایک ساتھ آیا»', async () => {
    const row = await run(args(), deps([answer({ move: 'yes_no_question', answer: 'chorus_answer' })]));
    expect(bare(row.reason_ur)).toContain(`${term('yes_no_question')} پوچھا،`);
    expect(bare(row.reason_ur)).toContain('اور جواب ایک ساتھ آیا۔');
  });
  test('no move named → the empty-descriptor template, never a stub', async () => {
    const row = await run(args(), deps([answer()]));
    expect(bare(row.reason_ur)).toMatch(/^سبق میں استاد نے بچوں سے پوچھا، "/);
    expect(bare(row.reason_ur)).not.toMatch(/جو سوال تھا|یہ سوال تھا/);
  });
  test('the model writing the term itself (not its id) is the same move (gold r7: 14 of 52 answers)', async () => {
    const row = await run(args(), deps([answer({ move: term('recall_question') })]));
    expect(bare(row.reason_ur)).toContain(`${term('recall_question')} پوچھا،`);
  });
  // R7k §1d (urdu_terms v2 move_frame): a move name is the clip's, never what the teacher did («تھنک پیئر شیئر کروایا», 16 v8 rows)
  test('an activity move: the gap first, then «یہ کلپ ‹term› دکھاتا ہے»; never «کروایا»', async () => {
    const row = await run(args(), deps([answer({ move: 'think_pair_share' })]));
    expect(bare(row.reason_ur)).toContain('یہ کلپ تھنک پیئر شیئر دکھاتا ہے۔');
    expect(bare(row.reason_ur)).not.toContain('کروایا');
  });
  test('control: an English reader\'s English line is the model\'s', async () => {
    const row = await run(args({ lang: 'en' }), deps([answer({ move: 'recall_question' })]));
    expect(row.reason_en).toMatch(/^The class answered only yes or no/);
  });
});

describe('frames and copy rules (finding §4 b–e)', () => {
  test('header (header_ur): «🎬 اگلی کلاس میں آزمانے کے لیے ۱ منٹ کا کلپ۔»', () => {
    expect(CP.messageBody({ minutes: 1, reason: 'x', clipLanguage: 'ur', language: 'ur' }).split('\n')[0]).toBe('🎬 اگلی کلاس میں آزمانے کے لیے ۱ منٹ کا کلپ۔');
  });
  test('a quoted card keeps its own digits in the Urdu line («5 سیکنڈ», «30s»)', () => {
    const card = 'اگلی کلاس میں ہر سوال کے بعد 5 سیکنڈ رکیں اور 30s میں جواب لیں۔';
    // as the frame writes it: the card in its own isolate (ux-strings videoRecoCardFallbackReason)
    const out = bare(CP.composeReason(`آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: "\u2068${card}\u2069"۔ یہ کلپ اس کا ایک طریقہ دکھاتا ہے۔`, 'ur', null));
    expect(out).toContain('5 سیکنڈ');
    expect(out).toContain('30s');
  });
  test('no Latin full stop after an Urdu quote', () => {
    expect(bare(CP.composeReason('استاد نے پوچھا "کیا یہ مثلث ہے". یہ کلپ اس بارے میں ہے: کیوں۔', 'ur', null))).toContain('"۔');
  });
  test('the English stub «, which was.» is dropped', () => {
    expect(CP.composeReason('The teacher asked "Is this a triangle?", which was. The clip explains why.', 'en', null)).not.toMatch(/which was/);
  });
  test('a long card whose elision would drop its imperative → the plain frame (shorten the frame, not the card)', () => {
    const S = require('../../../bot/shared/services/coaching/video-reco/select');
    const long = `اگلی کلاس میں ${'سبق کے نام اور ان کی خصوصیات '.repeat(12)}پڑھنے کے بعد، ہر جواب کے بعد کیوں پوچھیں۔`;
    const cat = C.fromData(DATA);
    const hit = cat.segment('51-s1');
    const out = S.cardFrame({ sentence: long, startS: 0, endS: 52, language: 'ur', module: hit.module, subject: 'maths', segment: hit.segment });
    expect(out).not.toBeNull();
    expect(bare(out.reason_ur)).not.toMatch(/…[^"]*"۔/); // never a cut card without its «پوچھیں»
  });
});

describe('§5: a cited greeting, page call, filler or echo falls back to the card frame', () => {
  test('«I am fine» (a greeting) → the card frame, not silence', async () => {
    const lines = [T('00:30', 'Teacher', 'How are you all?'), T('00:32', 'Students', 'I am fine teacher'), ...CLASS];
    const greet = answer({ moment: { at: '00:32', quote: 'I am fine teacher' } });
    const row = await run(args({ lines }), deps([greet, greet]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
  });
});
