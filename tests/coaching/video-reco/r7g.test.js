'use strict';
/**
 * bd-8hhqhf R7g (COS ruling 20261024T002603 item 1; panel ped/REVIEW_r7f_rejudge.md §2 §3 §4 §6): the two ⛔ routes, the
 * Urdu line at its source, the card frame's move check, the tag/card-text leaks and the owed silences, each from the
 * panel's Z rows. Fixture and helpers as r7f.test.js; synthetic lines, fictional names (corpus rule 171250: ids only).
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const SID = '7a7a7a7a-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

const seg = (id, s, e, title, summary, fico, main37, moves = [], extra = {}) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'عنوان', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37, ...extra,
});
const mod = (id, format, summary, language, segments) => ({
  ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format, summary_en: summary, language, segments,
});
// the real chapters' moves and tags (bot/shared/data/video-catalog.v1.json); keywords stand for the real match words
const DATA = {
  ...FIXTURE,
  holes: [],
  modules: [
    ...FIXTURE.modules,
    mod(50, 'talking_head', 'A podcast-style conversation in which a teacher explains think-pair-share in three steps.', 'ur', [
      seg('50-s2', 60, 115, 'Think-pair-share in three steps', 'Think alone, discuss with a partner, share with the class.', [{ indicator: 'D3', strength: 2 }], ['C9', 'D3', 'D2', 'F4'], ['think_pair_share', 'student_explains_in_own_words']),
    ]),
    mod(51, 'mixed', 'A short dramatised conversation between two teachers about getting children thinking.', 'ur', [
      seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A colleague contrasts a yes/no question with a why question so the child thinks and explains.', [{ indicator: 'C1', strength: 2 }], ['C1', 'D2'], ['open_questions'], { title_ur: "ہاں/نہیں والا سوال بمقابلہ 'کیوں' والا سوال" }),
      seg('51-s3', 82, 141, 'Open questions in a crowded class', 'Give each group one open question, let one child explain to another.', [{ indicator: 'C1', strength: 1 }], ['C1'], ['group_work', 'open_questions']),
    ]),
    mod(95, 'classroom_footage', 'x', 'en', [
      seg('95-s3', 120, 197, 'Open question stems, group talk and follow-up probes', 'The teacher asks why after a one-word answer.', [{ indicator: 'C1', strength: 2 }], ['C1', 'D2', 'C8'], ['open_questions', 'follow_up_probe', 'ask_for_reasoning'], { keywords: ['answers', 'reason'] }),
    ]),
    mod(150, 'talking_head', 'A Teacher-Leader mentor debrief after an observation.', 'ur', [
      seg('150-s4', 200, 260, "From 'good' to specific feedback and 'why?'", "A mentor asks why do you think after saying good to a wrong answer.", [{ indicator: 'C3', strength: 2 }], ['C3', 'D2', 'C8'], ['specific_feedback', 'ask_for_reasoning', 'professional_growth'], { keywords: ['why', 'think', 'wait', 'cold', 'call'] }),
    ]),
    mod(97, 'talking_head', 'x', 'ur', [
      seg('97-s5', 300, 360, 'Assess the collaboration, not just the answer', 'Grade group projects with peer review and a checklist.', [{ indicator: 'C3', strength: 1 }], ['C11', 'C9', 'D3', 'C12'], ['peer_self_assessment', 'group_work']),
    ]),
    mod(122, 'talking_head', 'x', 'ur', [
      seg('122-s3', 60, 110, 'Maths station with bottle caps and a writing station', 'A counting station with bottle caps and a writing corner.', [{ indicator: 'C2', strength: 1 }], ['C2', 'C8', 'F5', 'B6', 'D7'], ['concrete_pictorial_abstract', 'differentiate_tasks'], { keywords: ['stones', 'sets', 'comparing'] }),
    ]),
    mod(23, 'talking_head', 'x', 'ur', [
      seg('23-s2', 30, 90, 'Two parts: name what went well, then one next step', 'Praise one thing, then give one next step.', [{ indicator: 'C3', strength: 2 }], ['C3'], ['next_step_feedback', 'specific_feedback'], { keywords: ['answer', 'correct', 'repeat'] }),
    ]),
    mod(24, 'talking_head', 'x', 'ur', [
      seg('24-s3', 0, 50, 'Independent work that keeps everyone on task', 'Independent work routines and on task behavior during independent work.', [{ indicator: 'D5', strength: 1 }], ['D5'], ['routines']),
    ]),
  ],
};

let E;
let C;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
});

const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [ // closed answers
  T('01:00', 'Teacher', 'Is this a triangle? Yes or no?'), T('01:03', 'Student', 'Yes'), T('01:06', 'Teacher', 'Is this a square?'),
  T('01:09', 'Student', 'No'), T('01:12', 'Teacher', 'How many sides then?'), T('01:15', 'Student', 'Three'),
  T('01:18', 'Teacher', 'Is it big or small?'), T('01:21', 'Student', 'Big'), T('01:24', 'Teacher', 'Good, next one, is it red?'), T('01:27', 'Student', 'Yes'),
];

function args({ lines = CLASS, lang = 'en', action = 'Next class, ask two why questions about shapes and wait five seconds.', indicator = 'C1', subject = 'maths', grade = '3', card } = {}) {
  return {
    session: {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang },
      diarization_data: { segments: lines },
    },
    analysis: {
      framework: 'fico',
      indicator_scheme: 'fico_main_37',
      domains: { C: { indicators: [
        { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[01:00]' },
      ] } },
      subject_resolution: { code: subject, grade, confidence: 'high' },
      topic: 'shapes',
    },
    nextStep: indicator ? { target: { indicator, rung: 1, rationale: 'Few open questions', try: action } } : null,
    card: card === undefined ? { indicator, action } : card,
    coachingSessionId: SID,
  };
}
/** A card with no indicator: the card_text route. */
const cardText = (action, over = {}) => args({ indicator: null, card: { indicator: null, action }, ...over });

const answer = (over = {}) => ({
  seg_id: '51-s1', moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' },
  reason_en: 'The class could only answer yes or no. The clip explains asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ یہ کلپ کیوں اور کیسے کے سوال پوچھنا سمجھاتا ہے۔', confidence: 0.7, ...over,
});
// a quote of one word: validation:placeholder, the card fallback after the retry
const SHORT = (segId) => (p) => answer({ seg_id: p.includes(segId) ? segId : '51-s1', moment: { at: '01:03', quote: 'Yes' } });

function deps(answers, catalog = DATA) {
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockImplementationOnce(async (p) => ({ result: typeof a === 'function' ? a(p) : a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' })));
  completeJson.mockResolvedValue({ result: { seg_id: null, none_reason: 'no more answers' }, usage: {}, finishReason: 'stop' });
  return {
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: C.fromData(catalog),
    store: {
      readForSession: jest.fn().mockResolvedValue(null),
      recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
      ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
      trainingBands: jest.fn().mockResolvedValue([]),
      write: jest.fn(async (row) => ({ id: 'rec-1', ...row })),
    },
    v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
    completeJson,
  };
}
const run = (a, d) => E.recommendForReport({ ...a, deps: d });
const SL = () => require('../../../bot/shared/services/coaching/video-reco/shortlist');
const SE = () => require('../../../bot/shared/services/coaching/video-reco/select');
const CP = () => require('../../../bot/shared/services/coaching/video-reco/copy');
const PR = () => require('../../../bot/shared/services/coaching/video-reco/prompt');
const UR_PLAIN = 'آپ کی رپورٹ اگلی کلاس کے لیے ایک قدم بتاتی ہے۔';
const prompts = (d) => d.completeJson.mock.calls.map((c) => c[0]).join('\n');

describe('1a · the step-text route is retired (Z150 ⛔2; Q031 ⛔2 on v2–v5: 0 right on six heads)', () => {
  const ctx = { language: 'ur', preferred: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
  const lesson = { subject: 'english', grade: { lo: 1, hi: 1 }, topic: null, inapplicable: [] };
  const step = { action: 'Next class, improve on task behavior during independent work: give each child five minutes of independent work.', indicator: 'D5', scheme: 'fico_main_37' };

  test('build: an unknown 37 indicator lists no step-text chapter, even one tagged with it', () => {
    const t = { source: 'card', indicator: null, indicators: [], storedIndicator: 'D5', none: 'unknown_indicator', scheme: 'fico_main_37', moves: [] };
    const out = SL().build(C.fromData(DATA), t, ctx, '', lesson, step);
    expect(out.candidates).toEqual([]);
    expect(out.noneReason).toBe('unknown_indicator');
  });
  test('engine (Z150 shape): a D5 label card is silent with no model call', async () => {
    const a = args({ indicator: 'D5', subject: 'english', action: '[TEACHER]، اپنی اگلی کلاس میں On-Task Behavior During Independent Work بہتر بنانے کے لیے 5 منٹ independent work کریں۔' });
    a.analysis.domains = { D: { indicators: [{ id: 'D5', name: 'On-Task Behavior During Independent Work', score: 1, applicable: true, evidence: 'x', timestamp: '[01:00]' }] } };
    // as on v6: D5 is on no chapter (an unknown indicator), and an untagged chapter matches the card's words
    const NO_D5 = { ...DATA, modules: [...DATA.modules.filter((m) => m.module_id !== 24), mod(28, 'talking_head', 'x', 'en', [
      seg('28-s1', 0, 116, 'Independent work: a five minute daily journal', 'On task behavior during independent work, five minutes a day.', [], [], ['professional_growth'])])] };
    const d = deps([answer({ seg_id: '28-s1' })], NO_D5);
    const row = await run(a, d);
    expect(row.status).toBe('none');
    expect(d.completeJson).not.toHaveBeenCalled();
  });
  test('control: the card_text route (a card with no indicator) still lists by the card\'s words', () => {
    expect(SL().textRoute(C.fromData(DATA), { ...step, indicator: null }, ctx, lesson, [], 'card_text').map((c) => c.seg_id)).toContain('24-s3');
  });
  test('the shipped catalogue: 28-s1 (Reflective Journaling, a teacher\'s own habit) is not recommendable', () => {
    const hit = C.load().segment('28-s1');
    expect(hit.segment.recommendable).toBe(false);
    expect(SL().recommendable(hit.module, hit.segment)).toBe(false);
  });
});

describe('1a · the F5-label class needs a closed question at the cited line (Z199 ⛔2; Z025 right)', () => {
  const F5 = 'اگلی کلاس میں Subject-Specific Pedagogy: MATH بہتر بنانے کے لیے 5 منٹ مختص کریں۔ ان 5 منٹس میں کم از کم 2 open-ended questions پوچھیں اور ہر سوال کے بعد 10 سیکنڈ انتظار کریں۔';
  const PAGE = 'اچھا بچوں، آپ نے پہلے خط کے بارے میں پڑھا ہے، سمجھا ہے کہ خط کیسے ہم لکھتے ہیں۔ تو ابھی آج ہم سبق نیا شروع کر رہے ہیں، وہ آگے ہے، صفحہ نمبر 69، اور 70 پر کچھ الفاظ دیے ہوئے ہیں۔';
  const LINES = [T('00:05', 'Teacher', PAGE), T('00:20', 'Student', 'جی'), ...CLASS, T('01:30', 'Teacher', 'Why is it a triangle?'), T('01:33', 'Student', 'Three')];
  const label = () => {
    const a = args({ indicator: null, card: { indicator: 'F5', action: F5 }, subject: 'urdu', lines: LINES });
    a.nextStep = { target: { indicator: 'F5', rung: 1, rationale: 'x', try: F5 } };
    return a;
  };
  const cite = (at, quote) => answer({ seg_id: '50-s2', moment: { at, quote }, reason_en: 'The class only gave one-word answers to the teacher. The clip is about pair talk.' });

  test('Z199 shape: the cited line is the lesson\'s page announcement → silence, never the card', async () => {
    const A = cite('00:05', PAGE);
    const row = await run(label(), deps([A, A, A]));
    expect(row.status).toBe('none');
    expect(row.moment_source || null).not.toBe('card');
  });
  test('a why question cited is not the closed question the label class answers → silence', async () => {
    const A = cite('01:30', 'Why is it a triangle?');
    const row = await run(label(), deps([A, A, A]));
    expect(row.status).toBe('none');
  });
  test('control (Z025): a closed question cited → shown', async () => {
    const row = await run(label(), deps([cite('01:00', 'Is this a triangle? Yes or no?')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '50-s2', moment_source: 'transcript' });
  });
});

describe('1b · Urdu at the source: the approved word for each move, in the prompt and in the word table', () => {
  const ur = (t, q = null) => CP().composeReason(t, 'ur', q);

  test('the prompt names the approved Urdu words (vr-10)', () => {
    const P = PR();
    expect(P.PROMPT_VERSION).toBe('vr-10');
    const text = P.build({ target: { source: 'card_text' }, candidates: [], catalog: C.fromData(DATA), excerpts: [], reportLanguage: 'ur', lessonLanguage: 'ur' });
    for (const w of ['یاد سے بتانے والا سوال', 'ہاں/نہیں والا سوال', 'سب کا مل کر جواب', 'ساتھی سے بات چیت', 'ابتدائی سوال']) expect(text).toContain(w);
  });
  test.each([
    ['Z032 «یادداشت پر مبنی سوال»', 'استاد نے یادداشت پر مبنی سوال پوچھا۔', 'یاد سے بتانے والا سوال', 'یادداشت'],
    ['Z118 «یادداشتی سوال»', 'استاد نے ایک یادداشتی سوال پوچھا۔', 'یاد سے بتانے والا سوال', 'یادداشتی'],
    ['Z025 «یاد رکھنے والا سوال»', 'استاد نے یاد رکھنے والا سوال پوچھا۔', 'یاد سے بتانے والا سوال', 'یاد رکھنے'],
    ['Z062 «یاددہانی کا ہاں/نہ سوال»', 'استاد نے یاددہانی کا ہاں/نہ سوال پوچھا۔', 'ہاں/نہیں والا سوال', 'یاددہانی'],
    ['Latin «recall»', 'استاد نے ایک recall سوال پوچھا۔', 'یاد سے بتانے والا سوال', 'recall'],
    ['Z113 «گرمی سوال»', 'سبق ایک گرمی سوال سے شروع ہوا۔', 'ابتدائی سوال', 'گرمی'],
    ['Z102 «جو مل کر جواب لاتا ہے»', 'استاد نے ایک سوال کیا جو مل کر جواب لاتا ہے۔', 'سب مل کر', 'لاتا ہے'],
    ['Z139 «طلبہ کا کلام بند رہا»', 'پورے سبق میں طلبہ کا کلام بند رہا۔', 'بچوں کی آپس میں بات چیت', 'کلام'],
    ['Z172 Latin «peer talk»', 'سبق میں مختصر مرتب peer talk نہیں تھی۔', 'ساتھی سے بات چیت', 'peer'],
    ['Z200 Latin «partner talk»', 'کوئی partner talk نہیں ہوئی۔', 'ساتھی سے بات چیت', 'partner'],
    ['Z151 «ہاں/نہ پوچھا»', 'استاد نے ہاں/نہ پوچھا۔', 'ہاں/نہیں والا سوال پوچھا', 'ہاں/نہ پوچھا'],
    ['Z081 doubled «فوراً»', 'استاد نے فوراً فوراً جواب بتا دیا۔', 'نے فوراً جواب', 'فوراً فوراً'],
    ['Z001 «بندہ» for «بند»', 'یہ بندہ ہاں/نہ والا سوال تھا۔', 'یہ ہاں/نہیں والا سوال تھا', 'بندہ'],
  ])('%s', (_, text, want, gone) => {
    const out = ur(text);
    expect(out).toContain(want);
    expect(out).not.toContain(gone);
  });

  test.each([
    ['Z091 tense «پوچھ رہے ہیں» for a lesson that is over', 'استاد ہر بار ہاں یا نہیں والے سوال پوچھ رہے ہیں؛ یہ کلپ کیوں کے سوال سمجھاتا ہے۔'],
    ['Z019 passive «پوچھا گیا»', 'سبق میں کوئی کیوں والا سوال نہیں پوچھا گیا؛ یہ کلپ کیوں کے سوال سمجھاتا ہے۔'],
  ])('%s → validation:urdu_form on an Urdu reader\'s line', (_, reasonUr) => {
    const list = { candidates: [{ seg_id: '51-s1', indicator: 'C1' }] };
    const ex = CLASS.map((l) => `[${String(Math.floor(l.start_ms / 60000)).padStart(2, '0')}:${String((l.start_ms / 1000) % 60).padStart(2, '0')}] ${l.label}: ${l.text}`);
    const p = answer({ reason_ur: reasonUr });
    expect(SE().validate(p, list, ex, { catalog: C.fromData(DATA), reader: 'ur' }).none).toBe('validation:urdu_form');
    expect(SE().validate(answer(), list, ex, { catalog: C.fromData(DATA), reader: 'ur' }).ok).toBe(true); // control
  });

  test('an en-report teacher\'s Urdu line is the card frame, never the model\'s translation (English card → the plain frame)', async () => {
    const row = await run(args({ lang: 'en' }), deps([answer()]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript' });
    expect(row.reason_ur).toContain(UR_PLAIN);
    expect(row.reason_ur).not.toContain('کلاس صرف');
  });
  test('…an Urdu card is quoted in that Urdu line', async () => {
    const action = 'اگلی کلاس میں شکلوں کے بارے میں دو کیوں والے سوال پوچھیں اور پانچ سیکنڈ انتظار کریں۔';
    const row = await run(args({ lang: 'en', action }), deps([answer()]));
    expect(row.reason_ur).toContain('دو کیوں والے سوال پوچھیں');
  });
  test('…no card sentence: the model\'s Urdu line when it passes every Urdu check, else the plain frame', async () => {
    const a = args({ lang: 'en', card: null });
    a.nextStep = { target: { indicator: 'C1', rung: 1, rationale: 'x' } };
    const ok = await run(a, deps([answer()]));
    expect(ok.reason_ur).toContain('کلاس صرف');
    const bad = await run(args({ lang: 'en', card: null }), deps([answer({ reason_ur: 'استاد ہر بار ہاں یا نہیں والے سوال پوچھ رہے ہیں؛ یہ کلپ کیوں کے سوال سمجھاتا ہے۔' })]));
    expect(bad.reason_ur).toContain(UR_PLAIN);
  });
  test('control: an ur-report teacher\'s Urdu line is the model\'s, with the word table applied', async () => {
    const row = await run(args({ lang: 'ur' }), deps([answer()]));
    expect(row.reason_ur).toContain('کلاس صرف');
  });
});

describe('1c · the card frame says "this clip shows one way to do it" only on a chapter whose move the card names (Z040 Z077 Z135)', () => {
  const WAIT = 'Next class, when a child gets stuck on a word, give five seconds of wait time, then ask one open-ended question so they think alone first.';
  const MODEL = 'Next class, when a student gives a short answer, model the correct form clearly, then ask them to repeat the answer back fully before moving on.';
  const TPS = 'Next class, give one minute to think alone, then let each child discuss the answer with a partner before you ask two pairs to share.';

  test('Z040 shape: a wait-time / open-question card, the model\'s chapter is think-pair-share → the card frame on 51-s1', async () => {
    const row = await run(cardText(WAIT), deps([SHORT('50-s2'), SHORT('50-s2')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', moment_source: 'card' });
  });
  test('Z135 shape: a model-then-repeat card on the praise-plus-next-step chapter → silence', async () => {
    const row = await run(cardText(MODEL), deps([SHORT('23-s2'), SHORT('23-s2')]));
    expect(row.status).toBe('none');
  });
  test('Z167 shape: a «how did you decide» card on the stations chapter (matched on «stones») → 51-s1', async () => {
    const STONES = 'Next class, when comparing two stone sets, ask twice: "How did you decide that? Show or tell one step." wait 5–7 seconds; if the answer is wrong, model point-and-count with the stones.';
    const row = await run(cardText(STONES), deps([SHORT('122-s3'), SHORT('122-s3')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', moment_source: 'card' });
  });
  test('G3 (gold b4d78b5e, no second ask): on a move step 51-s1 is not the rescue unless it carries the step\'s tag', async () => {
    const a = args({ indicator: 'D3', subject: 'english', action: 'Next class, ask two why questions about the story and wait five seconds.' });
    a.analysis.domains = { D: { indicators: [{ id: 'D3', name: 'Student-to-Student Interaction', score: 1, applicable: true, evidence: 'x', timestamp: '[01:00]' }] } };
    const row = await run(a, deps([SHORT('50-s2'), SHORT('50-s2')]));
    expect(row.seg_id || null).not.toBe('51-s1');
    expect(row.status).toBe('none');
  });
  test('control: a think-pair-share card keeps its card frame on 50-s2', async () => {
    const row = await run(cardText(TPS), deps([SHORT('50-s2'), SHORT('50-s2')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '50-s2', moment_source: 'card' });
  });
  test('unit: the move check reads the chapter\'s moves; strict for the named-card plain frame', () => {
    const cat = C.fromData(DATA);
    expect(SE().cardMoveOk(WAIT, cat.segment('50-s2').segment)).toBe(false);
    expect(SE().cardMoveOk(TPS, cat.segment('50-s2').segment)).toBe(true);
    expect(SE().cardMoveOk(WAIT, cat.segment('51-s1').segment)).toBe(true);
    expect(SE().cardMoveOk(MODEL, cat.segment('23-s2').segment)).toBe(false);
    // gold b4d78b5e (50-s2 rank 1): «Turn-and-Tell» is the pair move; gold b1664ce6: «Sat together» is group work
    expect(SE().cardMoveOk('90 سیکنڈ Turn-and-Tell کروائیں؛ ایک open-ended question پوچھیں۔', cat.segment('50-s2').segment)).toBe(true);
    expect(SE().cardMoveOk('Sat together, worked alone', { moves: ['group_work'] })).toBe(true);
  });
});

describe('1d · the tag / card-text leaks (Z063 Z070 Z200 Z165)', () => {
  const ctx = { language: 'ur', preferred: 'ur', languages: ['ur', 'en', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
  const lesson = { subject: 'science', grade: { lo: 4, hi: 4 }, topic: null, inapplicable: [] };

  test('Z063: 150-s4 (a mentor debrief) is never offered for a why / wait / cold-call card', async () => {
    const WHY = "Next class, when a student answers 'upside down', ask 'Why do you think that?', wait 5 to 8 seconds, then cold-call another student.";
    const d = deps([answer()]);
    await run(cardText(WHY), d);
    expect(d.completeJson).toHaveBeenCalled();
    expect(prompts(d)).not.toContain('150-s4');
  });
  test('control: a feedback card still meets 150-s4', async () => {
    const FB = "Next class, instead of saying 'good' to a wrong answer, give specific feedback and ask why do you think so, then wait.";
    const d = deps([answer()]);
    await run(cardText(FB), d);
    expect(prompts(d)).toContain('150-s4');
  });
  test('Z200: a D3 label card never meets 97-s5 (assessing finished group work)', async () => {
    const a = args({ indicator: 'D3', subject: 'english', action: 'اگلی کلاس کے 5 منٹ Student-to-Student Interaction بہتر کرنے کے لیے مخصوص کریں۔' });
    a.analysis.domains = { D: { indicators: [{ id: 'D3', name: 'Student-to-Student Interaction', score: 1, applicable: true, evidence: 'x', timestamp: '[01:00]' }] } };
    const d = deps([answer({ seg_id: '50-s2' })]);
    await run(a, d);
    expect(d.completeJson).toHaveBeenCalled();
    expect(prompts(d)).not.toContain('97-s5');
  });
  test('control: a card that asks to assess how the groups worked keeps 97-s5', async () => {
    const a = args({ indicator: 'D3', subject: 'english', action: 'Next class, after group work, use a short checklist to assess how each group worked together.' });
    a.analysis.domains = { D: { indicators: [{ id: 'D3', name: 'Student-to-Student Interaction', score: 1, applicable: true, evidence: 'x', timestamp: '[01:00]' }] } };
    const d = deps([answer({ seg_id: '50-s2' })]);
    await run(a, d);
    expect(prompts(d)).toContain('97-s5');
  });
  test('Z165: an F1 precise-terms card is not served the enacted questioning chapter 95-s3', () => {
    const step = { action: 'Write three target terms on the board with one-line definitions; when a student answers, restate using the precise term and a 10-second reason.', indicator: 'F1', scheme: 'fico_main_37' };
    const listed = (st) => SL().textRoute(C.fromData(DATA), st, ctx, lesson, [], 'card_text').map((c) => c.seg_id);
    expect(listed(step)).not.toContain('95-s3');
    expect(listed({ ...step, indicator: 'C1' })).toContain('95-s3'); // control: a questioning card keeps it
  });
});

describe('1e · owed silences: the card placeholder rows (Z036 Z100, R/A sends in v5)', () => {
  test('Z100 shape: a why card naming children in a slot that cannot be dropped → the plain frame on 51-s1, no name, no quote', async () => {
    const NAMES = "Next class, when a student answers with just one word like 'minus' on Abu's wood or Bunty's ribbon problem, ask 'Why did you choose that operation?' and give them time to explain.";
    const row = await run(cardText(NAMES), deps([SHORT('51-s1'), SHORT('51-s1')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', moment_source: 'card' });
    expect(row.reason_en).toBe('Your report gives you one thing to try next class. This clip shows one way to do it.');
    expect(`${row.reason_en} ${row.reason_ur}`).not.toMatch(/Bunty|Abu/);
  });
  test('Z036 shape: «Tier 2» is a card word, not a name → the card sentence is quoted', async () => {
    const TIER = 'Next class, when a child answers in one word, ask a quick why follow-up, then give a Tier 2 sentence to explain why.';
    const row = await run(cardText(TIER), deps([SHORT('51-s1'), SHORT('51-s1')]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', moment_source: 'card' });
    expect(row.reason_en).toContain('Tier 2 sentence');
  });
  test('Z078 (a right silence): a scrubbed label card on a chapter whose moves the lexicon does not judge → no plain frame', () => {
    const LABEL = 'Try dedicating 5 minutes of your next class specifically to improving "[a student] [a student] & Learning [a student]".';
    const slo = { seg_id: '47-s1', start_s: 0, end_s: 60, moves: ['state_objective', 'lesson_planning'] };
    expect(SE().cardMoveOk(LABEL, slo)).toBe(true); // not judged for the quoted frame
    expect(SE().cardMoveOk(LABEL, slo, { strict: true })).toBe(false); // …but the plain frame for a named card needs the move
    const frame = (plainIfNamed) => SE().cardFrame({ sentence: LABEL, startS: 0, endS: 60, language: 'en', module: { subjects: ['general'] }, segment: slo, plainIfNamed });
    expect(frame(false)).toBeNull();
    expect(frame(true)).toMatchObject({ reason_en: 'Your report gives you one thing to try next class. This clip shows one way to do it.' });
  });
  test('control: a name card on a chapter whose move the card does not name stays silent', async () => {
    const NAMES = 'Next class, when Bunty gives a short answer, model the correct form, then ask them to repeat the answer back.';
    const row = await run(cardText(NAMES), deps([SHORT('23-s2'), SHORT('23-s2')]));
    expect(row.status).toBe('none');
  });
});
