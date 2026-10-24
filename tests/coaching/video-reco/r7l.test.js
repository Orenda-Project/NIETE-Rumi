'use strict';
/**
 * bd-8hhqhf R7l (COS 20261024T164428 §1; panel v9, ped-scale 164322 / 164826). Each test runs the changed line on its
 * live branch; the card sentences are the v9 items' own (names replaced by ordinary words).
 *  a. no lesson, no pick (Z261, Z350): every mode, every route.
 *  b. route gates from ped/vetoes.json (modules 128 / 122 / 75): never the card's sentence unless the card is theirs.
 *  c. the card's own move family (Z176 questions before feedback, Z207 a correction card is no wait-time card, Z196 a
 *     management card gets no questioning chapter).
 *  d. card quotes keep the clause the clip serves, one "…" at most, never open on "…"; a transcript quote never ends
 *     mid-word (Z246 Z164 Z062 Z029).
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');
const SHIPPED = require('../../../bot/shared/data/video-catalog.v1.json');

const seg = (id, s, e, title, summary, fico, main37, moves = []) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'عنوان', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37,
});
const mod = (id, summary, segments, extra = {}) => ({ ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format: 'talking_head', summary_en: summary, language: 'ur', segments, ...extra });
const GATE_122 = { deny_routes: ['card_text'], allow_routes: ['tag', 'enacted'], allow_card_indicators: { fico_main_37: ['B6'], v4: ['B6'] }, allow_card_text: '\\b(?:stations?|corners?)\\b' };
const DATA = {
  ...FIXTURE,
  holes: [],
  modules: [
    ...FIXTURE.modules,
    mod(50, 'Think-pair-share.', [seg('50-s2', 60, 115, 'Think-pair-share in three steps', 'Think alone, discuss with a partner, share with the class.', [{ indicator: 'D3', strength: 2 }], ['C9', 'D3', 'D2', 'F4'], ['think_pair_share', 'student_explains_in_own_words'])]),
    mod(51, 'Getting children thinking.', [seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A yes/no question against a why question.', [{ indicator: 'C1', strength: 2 }], ['C1', 'D2'], ['open_questions'])]),
    mod(23, 'Feedback.', [seg('23-s2', 30, 90, 'Two parts: name what went well, then one next step', 'Praise one thing, then give one next step.', [{ indicator: 'C3', strength: 2 }], ['C3'], ['next_step_feedback', 'specific_feedback'])]),
  ],
};
// Z477 shape: a learning-stations chapter tagged D3, gated to B6 station cards; the only D3 chapter in this catalogue
const DATA_122 = {
  ...FIXTURE,
  holes: [],
  modules: [...FIXTURE.modules, mod(122, 'Learning stations.', [seg('122-s2', 40, 120, 'Three corners by level', 'Children rotate through three corners and talk in groups.', [{ indicator: 'D3', strength: 2 }], ['D3', 'B6'], ['group_work', 'group_by_level'])], { route_gate: GATE_122 })],
};

let E;
let C;
let S;
let SL;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  S = require('../../../bot/shared/services/coaching/video-reco/select');
  SL = require('../../../bot/shared/services/coaching/video-reco/shortlist');
});
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [
  T('01:00', 'Teacher', 'Is this a triangle? Yes or no?'), T('01:03', 'Student', 'Yes'), T('01:06', 'Teacher', 'Is this a square?'),
  T('01:09', 'Student', 'No'), T('01:12', 'Teacher', 'How many sides then?'), T('01:15', 'Student', 'Three'),
  T('01:18', 'Teacher', 'Is it big or small?'), T('01:21', 'Student', 'Big'), T('01:24', 'Teacher', 'Good, next one, is it red?'), T('01:27', 'Student', 'Yes'),
];
// Z261 shape: one teacher turn about a recording that did not save; no lesson
const NOT_A_LESSON = [T('00:00', 'Teacher', 'صبح آپ کہہ رہی تھیں، ابھی تو میں آ گیا ہوں۔ ویڈیو جو ادھر ریکارڈ کی تھی، وہ مل نہیں رہی۔ تو کیا بات ہے، سیو نہیں ہوئی نا؟ کیونکہ نیٹ چلا گیا تھا، تو ابھی گھر آ گیا ہوں۔ صبح ان شاء اللہ کل والی بھی اور یہ والی دونوں بھی۔')];
const B1_CARD = 'Write a short learning objective on the board, read it at the start and ask the children one open question.';

function run({ lines = CLASS, indicator = null, action, env = {}, data = DATA, completeJson = null, lang = 'en', prompts = [] }) {
  return E.recommendForReport({
    session: { id: 's1', user_id: 'u1', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang }, diarization_data: { segments: lines } },
    analysis: { framework: 'fico', indicator_scheme: 'fico_main_37', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "Is this a triangle? Yes or no"', timestamp: '[01:00]' }] } }, subject_resolution: { code: 'maths', grade: '3', confidence: 'high' }, topic: 'shapes' },
    nextStep: indicator ? { target: { indicator, rung: 1, rationale: 'x', try: action } } : null, card: { indicator, action }, coachingSessionId: 's1',
    deps: { env: { VIDEO_RECO_ENABLED: 'true', ...env }, catalog: C.fromData(data), store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r }, v10GroupFor: async () => null,
      completeJson: completeJson || (async (p) => { prompts.push(p); return { result: { seg_id: null, none_reason: 'test' }, usage: {}, finishReason: 'stop' }; }) },
  });
}
const offeredIn = (p) => (String(p || '').split('CANDIDATE CLIPS')[1] || '').match(/\b\d{1,3}-s\d+\b/g) || [];
// a model that picks the first offered chapter and cites the class's first question
const firstPick = (calls) => async (p) => {
  calls.push(p);
  return { result: { seg_id: offeredIn(p)[0] || null, moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' }, confidence: 0.8,
    reason_en: 'The teacher asked "Is this a triangle? Yes or no?" and the children answered in one word. This clip shows another way to ask.',
    reason_ur: 'استاد نے پوچھا، "Is this a triangle? Yes or no?" اور بچوں نے ایک لفظ میں جواب دیا۔ یہ کلپ پوچھنے کا ایک اور طریقہ دکھاتا ہے۔' }, usage: {}, finishReason: 'stop' };
};

describe('a. no lesson, no pick (Z261, Z350)', () => {
  test.each([['llm', {}], ['card', { VIDEO_RECO_REASON: 'card' }]])('%s mode: one teacher turn about a lost recording → none, no model call', async (_m, env) => {
    const calls = [];
    const row = await run({ lines: NOT_A_LESSON, action: B1_CARD, env, completeJson: firstPick(calls) });
    expect(row.status).toBe('none');
    expect(row.none_reason).toBe('no_moments:not_lesson');
    expect(calls).toHaveLength(0);
  });
  test('control: a short lesson with children answering still gets its clip (card mode)', async () => {
    const row = await run({ action: B1_CARD, env: { VIDEO_RECO_REASON: 'card' } });
    expect(row.status).not.toBe('none');
    expect(row.seg_id).toBe('51-s1');
  });
});

describe('b. route gates (ped/vetoes.json kind: route_gate)', () => {
  test.each([128, 122, 75])('module %i carries its route gate and stays on the ladder', (id) => {
    const m = SHIPPED.modules.find((x) => x.module_id === id);
    expect(m.recommendable).not.toBe(false);
    expect(m.route_gate && m.route_gate.deny_routes).toEqual(['card_text']);
    expect(String(m.route_gate.allow_card_text).length).toBeGreaterThan(5);
  });
  // the v9 items' own inputs: no card indicator, the urdu lesson with no grade (Z338), the grade-4 maths lesson (Z321)
  test.each([
    ['Z338', "اگلی کلاس میں، جب کوئی بچہ 'آسمان سر پر اٹھا لینا' جیسے محاورے کا نیا معنی خود بتائے، تو اس سے فوراً ایک جملہ بنوائیں اور ساتھی طالب علم سے 3-point checklist پر جانچ کروائیں۔", 'urdu', null],
    ['Z321', "اگلی کلاس میں، جب پورا کلاس ایک ساتھ بولنے لگے، تو ایک فوری 60‑second exit check کریں: دو طلبا سامنے آئیں؛ ہر ایک 12574 + 3 (بارہ ہزار پانچ سو چوہتر میں 3 جمع) کے جواب کے لیے ایک sentence میں 'Explain one reason this is correct' اور 'Spot one possible error' بتائیں۔", 'maths', { lo: 4, hi: 4 }],
  ])('%s: the card_text route never lists Restorative Practices for a card that is not about behaviour', (_q, action, subject, grade) => {
    const cat = C.fromData(SHIPPED);
    const step = { action, indicator: null, scheme: 'fico_main_37' };
    const ids = SL.textRoute(cat, step, { language: 'ur', languages: ['ur', 'mixed'] }, { subject, grade }, [], 'card_text').map((c) => c.seg_id);
    expect(ids.filter((id) => /^(?:128|122|75)-/.test(id))).toEqual([]);
  });
  test('Z338 replay: the next chapter is no behaviour reminder either (first tag 37-C7, the routines test)', () => {
    const cat = C.fromData(SHIPPED);
    const step = { action: "اگلی کلاس میں، جب کوئی بچہ 'آسمان سر پر اٹھا لینا' جیسے محاورے کا نیا معنی خود بتائے، تو اس سے فوراً ایک جملہ بنوائیں اور ساتھی طالب علم سے 3-point checklist پر جانچ کروائیں۔", indicator: null, scheme: 'fico_main_37' };
    const ids = SL.textRoute(cat, step, { language: 'ur', languages: ['ur', 'mixed'] }, { subject: 'urdu', grade: null }, [], 'card_text').map((c) => c.seg_id);
    expect(ids).not.toContain('2-s2');
  });
  test('the gate opens for its own card: a C6 conflict card in the gate\'s words', () => {
    const m = SHIPPED.modules.find((x) => x.module_id === 128);
    expect(SL.routeGateOk(m, { indicator: 'C6', scheme: 'fico_main_37', text: 'When two children fight, ask each to use an I-statement about their feelings.' })).toBe(true);
    expect(SL.routeGateOk(m, { indicator: 'D1', scheme: 'fico_main_37', text: 'When two children fight, ask each to use an I-statement about their feelings.' })).toBe(false);
    expect(SL.routeGateOk(m, { indicator: 'C6', scheme: 'fico_main_37', text: 'Ask the class to reflect on how the sum felt.' })).toBe(false);
    expect(SL.routeGateOk({ module_id: 1 }, { indicator: null, text: '' })).toBe(true); // no gate, no judgement
  });
  test('Z477 shape: card mode never puts the card\'s sentence on a gated chapter, whatever the route', async () => {
    const row = await run({ indicator: 'D3', action: 'Next class, put the children in groups so they talk to each other about the answer.', env: { VIDEO_RECO_REASON: 'card' }, data: DATA_122 });
    expect(row.seg_id || null).toBeNull();
    expect(row.status).toBe('none');
  });
  test('…and the card fallback after a refused model answer does not either', async () => {
    const calls = [];
    const cj = async (p) => { calls.push(p); return { result: { seg_id: offeredIn(p)[0] || null, moment: { at: '09:59', quote: 'not in the lesson at all' }, confidence: 0.8, reason_en: 'x "not in the lesson at all" y.', reason_ur: 'x "not in the lesson at all" y۔' }, usage: {}, finishReason: 'stop' }; };
    const row = await run({ indicator: 'D3', action: 'Next class, put the children in groups so they talk to each other about the answer.', data: DATA_122, completeJson: cj });
    expect(offeredIn(calls[0])).toContain('122-s2'); // the tag route still lists it for a moment the model can cite
    expect(row.moment_source === 'card' && row.seg_id === '122-s2').toBe(false);
  });
});

describe('c. the card\'s own move family', () => {
  test('Z176: open questions named before feedback → 51-s1 first, not 23-s2', async () => {
    const prompts = [];
    await run({ action: "اگلی کلاس میں، جب کوئی طالب علم کہانی بتائے، تو 10 سیکنڈ wait time دیں، دو open-ended questions پوچھیں ('کردار نے ایسا کیوں کیا؟ Text سے evidence') اور فوری feedback دیں۔", prompts, lang: 'ur' });
    expect(offeredIn(prompts[0])[0]).toBe('51-s1');
  });
  test('control (Z197 shape): feedback named first still puts 23-s2 first', async () => {
    const prompts = [];
    await run({ action: "Next class, after each answer name one thing done well and give one next step, then ask 'why do you think so?'.", prompts });
    expect(offeredIn(prompts[0])[0]).toBe('23-s2');
  });
  // Z207 path: no chapter the card names (the fixture's wait-time chapter 10-s2 removed), so the why / wait rescue decides
  const NO_WAIT = { ...DATA, modules: DATA.modules.filter((m) => m.module_id !== 10) };
  const badQuote = (calls) => async (p) => { calls.push(p); return { result: { seg_id: offeredIn(p)[0] || null, moment: { at: '09:59', quote: 'not in the lesson at all' }, confidence: 0.8, reason_en: 'x "not in the lesson at all" y.', reason_ur: 'x "not in the lesson at all" y۔' }, usage: {}, finishReason: 'stop' }; };
  const Z207 = "Next class, when a student mixes up a homophone like 'knot' and 'not', gently name the exact error, give 5 seconds of wait time, then have them repeat the full corrected sentence aloud.";
  test.each([['llm', {}], ['card', { VIDEO_RECO_REASON: 'card' }]])('Z207 (%s): a correction card with wait time is no why / wait card → never 51-s1', async (_m, env) => {
    const calls = [];
    const row = await run({ action: Z207, env, data: NO_WAIT, completeJson: badQuote(calls) });
    expect(row.seg_id || null).not.toBe('51-s1');
  });
  test('control: the same path for a wait-time card that corrects nothing still lands on 51-s1 (card mode)', async () => {
    const row = await run({ action: "Next class, when a student says a homophone like 'knot' and 'not', give 5 seconds of wait time, then have them say the full sentence aloud.", env: { VIDEO_RECO_REASON: 'card' }, data: NO_WAIT });
    expect(row.seg_id).toBe('51-s1');
  });
  test('control: a wait-time card that corrects nothing still gets its clip (card mode)', async () => {
    const row = await run({ action: 'Next class, after you ask a question, wait five seconds before taking an answer.', env: { VIDEO_RECO_REASON: 'card' } });
    expect(row.status).not.toBe('none');
  });
  test('Z196: a C6 silent-work-signal card gets no questioning chapter on the card_text route', () => {
    const cat = C.fromData(SHIPPED);
    const step = { action: "گروپ ورک کے شروع میں 30 سیکنڈ 'سائلنٹ ورک' سگنل متعارف کرو، ٹیچر صرف گھوم کر چیک کرے۔", indicator: 'C6', scheme: 'fico_main_37' };
    const ids = SL.textRoute(cat, step, { language: 'ur', languages: ['ur', 'mixed'] }, { subject: 'english', grade: { lo: 5, hi: 5 } }, [], 'card_text').map((c) => c.seg_id);
    expect(ids.filter((id) => ['51-s1', '51-s3', '95-s3'].includes(id))).toEqual([]);
  });
  test('control (Z015 shape): a C6 card that asks an open question keeps the questioning chapters', () => {
    const s51 = C.fromData(SHIPPED).segment('51-s3').segment;
    expect(SL.cardFamilyOk(s51, { action: "جب کوئی بچہ غلط جواب دے تو 'غلط' کہنے کے بجائے ایک open-ended question پوچھیں، مثلاً 'کیوں؟'", indicator: 'C6', scheme: 'fico_main_37' })).toBe(true);
    expect(SL.cardFamilyOk(s51, { action: "گروپ ورک کے شروع میں 30 سیکنڈ 'سائلنٹ ورک' سگنل متعارف کرو۔", indicator: 'C6', scheme: 'fico_main_37' })).toBe(false);
  });
});

describe('d. card quotes keep the served clause; transcript quotes end on a whole word', () => {
  test('Z029 as recorded: two excerpt lines stitched into one quote, ending on a capped line\'s cut token → that token goes', () => {
    const ex = ['[02:40] Teacher (UR): واٹر، ایک دو منٹ۔ اچھا، ایک منٹ۔ یہاں سٹاپ کریں۔ ادھر آپ نے ایک چیز نوٹ کی ہے؟', '[03:04] Teacher (UR): لگی ہوئی ہے نا؟ اور ہم نے دو دن پہلے یہ ٹاپک پڑھا تھا جو یہاں پہ یوز ہوا ہ…'];
    const q = 'واٹر، ایک دو منٹ۔ اچھا، ایک منٹ۔ یہاں سٹاپ کریں۔ ادھر آپ نے ایک چیز نوٹ کی ہے؟ کہ ہم نے دو دن پہلے ایک ٹاپک پڑھا تھا اور اس کا یہاں پہ یوز ہوا ہ…';
    expect(S.wholeWordQuote(q, ex)).toBe('واٹر، ایک دو منٹ۔ اچھا، ایک منٹ۔ یہاں سٹاپ کریں۔ ادھر آپ نے ایک چیز نوٹ کی ہے؟ کہ ہم نے دو دن پہلے ایک ٹاپک پڑھا تھا اور اس کا یہاں پہ یوز ہوا…');
    expect(S.wholeWordQuote('یہ سوال کس نے پوچھا…', ex)).toBe('یہ سوال کس نے پوچھا…'); // no capped line ends on «پوچھا»: unchanged
  });
  const frame = (segId, sentence, subject = 'english') => {
    const hit = C.fromData(SHIPPED).segment(segId);
    return S.cardFrame({ sentence, startS: hit.segment.start_s, endS: hit.segment.end_s, language: 'ur', teacherName: 'Saima Khan', module: hit.module, subject, vocab: [], segment: hit.segment });
  };
  const quoted = (line) => (/"⁨?([^"]*?)⁩?"/.exec(String(line || '')) || [])[1] || '';
  test('Z246: the think-pair-share clause 51-s3 serves stays in the quote', () => {
    const out = frame('51-s3', "اگلی کلاس میں، جب آپ factual سوال 'What did the boy use to scratch the ball?' پوچھیں، تو بورڈ پر پہلے سے لکھا open-ended follow-up 'Why might the boy have done that?' دکھائیں، 8-10 سیکنڈ wait time رکھیں، پھر Think-Pair-Share کروائیں تاکہ students اپنا reasoning بتائیں۔");
    expect(quoted(out.reason_ur)).toMatch(/Think-Pair-Share/);
  });
  test('Z164: one "…" at most, and the served think-pair-share clause kept', () => {
    const out = frame('50-s2', "اگلی کلاس میں، جب 'spotted' اور 'laborer' پر جملہ بنانے کا حصہ آئے، آپ ایک open-ended question پوچھیں (مثلاً: 'When might someone use spotted? Give an example and explain why.'), 5–7 سیکنڈ wait time رکھیں، پھر 90 سیکنڈ کے لیے Think-Pair-Share کروائیں: Partner A معنی بیان کرے، Partner B مثال جملہ بنائے؛ struggling students کے لیے sentence frame '___ is a laborer because ___' دیں اور fast finishers کے لیے challenge question دیں کہ وہ دونوں الفاظ ایک ہی جملے میں استعمال کریں۔");
    const q = quoted(out.reason_ur);
    expect(q).toMatch(/Think-Pair-Share/);
    expect((q.match(/…/g) || []).length).toBeLessThanOrEqual(1);
  });
  test('Z062: a quote never opens on "…" (the plain frame instead)', () => {
    const out = frame('71-s2', "اگلی کلاس میں، جب آپ 'anagram' یا 'abbreviation' کا قاعدہ پوچھیں، تو 2 open-ended questions لکھیں، 8 سیکنڈ wait time دیں، pair work میں ہر جوڑے کو ایک sentence frame (\"My favorite YouTuber is ___ .\") اور ایک two‑sentence paragraph extension (یعنی تیز مکمل کرنے والوں کے لیے اضافی مشق) بنانے کو کہیں تاکہ وہ قاعدہ ایک جملے میں apply کریں۔");
    expect(quoted(out.reason_ur).startsWith('…')).toBe(false);
  });
  test('Z062: …and when it is cut, it is cut at a clause boundary, not inside a clause', () => {
    const sentence = "اگلی کلاس میں، جب آپ 'anagram' یا 'abbreviation' کا قاعدہ پوچھیں، تو 2 open-ended questions لکھیں، 8 سیکنڈ wait time دیں، pair work میں ہر جوڑے کو ایک sentence frame (\"My favorite YouTuber is ___ .\") اور ایک two‑sentence paragraph extension (یعنی تیز مکمل کرنے والوں کے لیے اضافی مشق) بنانے کو کہیں تاکہ وہ قاعدہ ایک جملے میں apply کریں۔";
    const bare = (t) => t.replace(/["“”‘’]/g, '');
    const stem = bare(quoted(frame('71-s2', sentence).reason_ur).replace(/…$/u, ''));
    expect(bare(sentence).startsWith(stem)).toBe(true); // the sentence's own opening
    expect(/^[،,؛;:]/u.test(bare(sentence).slice(stem.length))).toBe(true); // …up to a clause mark
  });
  test('Z029: a model quote copied from a capped excerpt line never ends mid-word', async () => {
    const long = 'بچو، ایک منٹ۔ یہاں سٹاپ کریں۔ ادھر آپ نے ایک چیز نوٹ کی ہے؟ کہ ہم نے دو دن پہلے ایک ٹاپک پڑھا تھا اور اس کا یہاں پہ یوز ہوا ہے۔ کوئی بتائے گا کہ وہ کون سا ٹاپک تھا جو ہم نے پڑھا تھا اور اس کا یہاں کیا مطلب بنتا ہے؟ سب بچے سوچیں اور پھر ہاتھ اٹھائیں۔';
    const lines = [T('02:40', 'Teacher', long), T('02:55', 'Student', 'جی ہاں'), T('03:00', 'Teacher', 'شاباش، اور کون بتائے گا؟'), T('03:05', 'Student', 'جی'), T('03:08', 'Teacher', 'ٹھیک ہے۔')];
    // what the model saw: the excerpt line «[02:40] Teacher: …» capped at prompt.js EXCERPT_MAX_CHARS (220), inside a word
    const line = `[02:40] Teacher: ${long}`;
    const capped = `${[...line].slice(0, 219).join('')}…`.replace('[02:40] Teacher: ', '');
    expect(/\p{L}…$/u.test(capped) && /\p{L}/u.test(long[[...capped].length - 1])).toBe(true); // the cap falls inside a word
    const cj = async (p) => ({ result: { seg_id: offeredIn(p)[0] || null, moment: { at: '02:40', quote: capped }, move: null, confidence: 0.8,
      reason_en: `During reading the teacher stopped and said "${capped}" and the class answered together. This clip shows think-pair-share.`,
      reason_ur: `سبق میں استاد نے پوچھا، "${capped}"۔ یہ کلپ اس بارے میں ہے: تھنک پیئر شیئر۔` }, usage: {}, finishReason: 'stop' });
    const row = await run({ lines, indicator: null, action: 'After a paragraph give one minute to think, then share an example with the person next to them (think-pair-share).', completeJson: cj, lang: 'ur' });
    expect(row.moment_quote).toBeTruthy();
    const stem = row.moment_quote.replace(/…$/u, '').trimEnd();
    expect(long.startsWith(stem)).toBe(true);
    expect(/[\s\p{P}]/u.test(long[stem.length] || ' ')).toBe(true); // the stored quote ends where a word ends
  });
});
