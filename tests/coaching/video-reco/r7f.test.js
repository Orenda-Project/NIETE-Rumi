'use strict';
/**
 * bd-8hhqhf R7f (COS ruling 20261023T223858; panel ped/REVIEW_r7e_rejudge.md §2 §3 §4 §6): the routes, the gap, closure,
 * the Urdu line and the owed silences, each from the panel's Q rows. Fixture and helpers as r7e-moment.test.js; synthetic
 * lines, fictional names (corpus rule 171250: ids only).
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const SID = '7f7f7f7f-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';

const seg = (id, s, e, title, summary, fico, main37, moves = [], extra = {}) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'عنوان', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37, ...extra,
});
const mod = (id, format, summary, language, segments) => ({
  ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format, summary_en: summary, language, segments,
});
const DATA = {
  ...FIXTURE,
  holes: [], // D3 is a move here (the fixture's own holes list names it)
  modules: [
    ...FIXTURE.modules,
    mod(50, 'talking_head', 'A podcast-style conversation in which a teacher explains think-pair-share in three steps.', 'ur', [
      seg('50-s2', 60, 115, 'Think-pair-share in three steps', 'Think alone, discuss with a partner, share with the class.', [{ indicator: 'D3', strength: 2 }], ['C9', 'D3'], ['think_pair_share']),
    ]),
    mod(51, 'mixed', 'A short dramatised conversation between two teachers about getting children thinking.', 'ur', [
      seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A colleague contrasts a yes/no question with a why question so the child thinks and explains.', [{ indicator: 'C1', strength: 2 }], ['C1'], ['open_questions']),
      seg('51-s3', 82, 141, 'Open questions in a crowded class', 'Give each group one open question, let one child explain to another.', [{ indicator: 'C1', strength: 1 }], ['C1'], ['open_questions']),
    ]),
    mod(95, 'classroom_footage', 'x', 'en', [
      seg('95-s3', 120, 197, 'Ask why after an answer', 'The teacher asks why after a one-word answer.', [{ indicator: 'C1', strength: 2 }], ['C1'], ['open_questions']),
    ]),
    mod(47, 'slides', 'x', 'ur', [
      seg('47-s6', 300, 361, 'Step 5: close by asking students what they learned', 'End the lesson by asking the children what they learned today.', [{ indicator: 'B7', strength: 1 }], ['B10', 'B1'], ['closure_check']),
    ]),
    mod(157, 'talking_head', 'x', 'ur', [
      seg('157-s3', 60, 98, 'Same content, different support: three-tier task', 'One task at three levels of support.', [{ indicator: 'B6', strength: 2 }], ['B6'], ['differentiate_tasks'], { keep_with_caveat: 'mixed_level_task' }),
    ]),
    mod(122, 'talking_head', 'x', 'ur', [
      seg('122-s4', 0, 56, 'Rotate groups and observe as facilitator', 'Stations rotate while the teacher observes independent work and on task behavior.', [{ indicator: 'B6', strength: 1 }], ['C6', 'B6'], ['routines']),
    ]),
    mod(24, 'talking_head', 'x', 'ur', [
      seg('24-s3', 0, 50, 'Independent work that keeps everyone on task', 'Independent work routines and on task behavior during independent work.', [{ indicator: 'D5', strength: 1 }], ['D5'], ['routines']),
    ]),
  ],
};

let E;
let S;
let C;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  S = require('../../../bot/shared/services/coaching/video-reco/select');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
});

const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [ // closed answers
  T('01:00', 'Teacher', 'Is this a triangle? Yes or no?'), T('01:03', 'Student', 'Yes'), T('01:06', 'Teacher', 'Is this a square?'),
  T('01:09', 'Student', 'No'), T('01:12', 'Teacher', 'How many sides then?'), T('01:15', 'Student', 'Three'),
  T('01:18', 'Teacher', 'Is it big or small?'), T('01:21', 'Student', 'Big'), T('01:24', 'Teacher', 'Good, next one, is it red?'), T('01:27', 'Student', 'Yes'),
];

function args({ lines = CLASS, lang = 'en', action = 'Next class, ask two why questions about shapes and wait five seconds.', indicator = 'C1', subject = 'maths', grade = '3', fa = null, card } = {}) {
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
      ...(fa ? { focus_area: fa } : {}),
    },
    nextStep: indicator ? { target: { indicator, rung: 1, rationale: 'Few open questions', try: action } } : null,
    card: card === undefined ? { indicator, action } : card,
    coachingSessionId: SID,
  };
}

const answer = (over = {}) => ({
  seg_id: '10-s1', moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' },
  reason_en: 'The class could only answer yes or no. The clip explains asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ یہ کلپ کیوں اور کیسے کے سوال پوچھنا سمجھاتا ہے۔', confidence: 0.7, ...over,
});

function deps(answers, catalog = DATA) {
  const completeJson = jest.fn();
  // an answer may be a function of the prompt (it picks a chapter the list actually offers)
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
const SI = () => require('../../../bot/shared/services/coaching/video-reco/silence');
const SL = () => require('../../../bot/shared/services/coaching/video-reco/shortlist');
const CP = () => require('../../../bot/shared/services/coaching/video-reco/copy');

describe('e · a retry that cites a greeting does not take the card fallback away (Q090 Q179: acceptable sends in v4)', () => {
  const SHORT = answer({ moment: { at: '01:03', quote: 'Yes' } }); // validation:placeholder (one word)
  const HELLO = [T('00:10', 'Teacher', 'Good morning class, how are you all today?'), T('00:12', 'Students', 'Fine teacher'), ...CLASS];
  const GREET = answer({ moment: { at: '00:10', quote: 'Good morning class, how are you all today?' } }); // validation:not_moment (routine)

  test('Q179 shape: placeholder, a routine line, then the second pass\'s placeholder → the card fallback, not silence', async () => {
    const row = await run(args({ lines: HELLO }), deps([SHORT, GREET, answer({ seg_id: '51-s1', moment: { at: '01:03', quote: 'Yes' } })]));
    // R7j §5: the retry's greeting now takes the card frame itself (on the retry's chapter), not the second pass's
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
  });

  test('control (Q063): a line from before the class is greeted still ends in silence, never the card', async () => {
    const SETUP = [T('00:20', 'Teacher', 'میرا موبائل کدھر ہے؟ ابھی شروع کرتے ہیں۔'), T('00:30', 'Student 2', 'ہاں، آپ سٹارٹ کریں۔'),
      T('00:35', 'Teacher', 'یہ دیکھو، کیسی لگی؟ یہ سارا کام ابھی یہاں شروع کریں گے۔'), T('00:50', 'Teacher', 'السلام علیکم بچو۔'), ...CLASS];
    const PRE = answer({ moment: { at: '00:35', quote: 'یہ دیکھو، کیسی لگی؟' } });
    const row = await run(args({ lines: SETUP }), deps([SHORT, PRE, PRE]));
    expect(row.status).toBe('none');
    expect(row.moment_source || null).not.toBe('card');
  });
});

describe('e · the quote validator reads a placeholder in the line as the line (Q066)', () => {
  const lines = ['[01:03] Teacher: Yes! Very good. اچھا، کیا آپ سب نے [a student] دیکھے ہیں؟', '[01:05] Students: Yes!'];
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };

  test('Q066: the quote with its [a student] is found on the line that carries the same placeholder', () => {
    expect(S.quoteFound('اچھا، کیا آپ سب نے [a student] دیکھے ہیں؟', lines)).toBe(true);
  });
  test('control: a quote the line does not have is still not found', () => {
    expect(S.quoteFound('اچھا، کیا آپ سب نے کتابیں پڑھی ہیں؟', lines)).toBe(false);
    expect(S.validate(answer({ moment: { at: '01:03', quote: 'کیا آپ سب نے بازار دیکھا ہے؟' } }), list, lines, {}).none).toBe('validation:quote');
  });
});

describe('1a · the step-text route passes the card_text evidence test: the chapter carries the card\'s indicator (Q031 ⛔2)', () => {
  const ctx = { language: 'ur', preferred: 'ur', languages: ['ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
  const lesson = { subject: 'english', grade: { lo: 1, hi: 1 }, topic: null, inapplicable: [] };
  const step = { action: 'Next class, improve on task behavior during independent work: rotate the stations and observe each group.', indicator: 'D5', scheme: 'fico_main_37' };
  const listed = (st, tagGate = true) => SL().textRoute(C.fromData(DATA), st, ctx, lesson, [], 'step_text', { tagGate }).map((c) => c.seg_id);

  test('Q031: a D5 card meets a stations chapter not tagged 37-D5 → not listed', () => {
    expect(listed(step)).not.toContain('122-s4');
  });
  test('control: the chapter tagged 37-D5 stays', () => expect(listed(step)).toContain('24-s3'));
  test('control: a card with no indicator is not judged by tag', () => expect(listed({ ...step, indicator: null })).toContain('122-s4'));
  test('control: a hole / label route (no gate) keeps the card-words route as before', () => expect(listed(step, false)).toContain('122-s4'));
  test('build: an unknown 37 indicator (D5 is on no chapter) gates its step-text list', () => {
    const t = { source: 'card', indicator: null, indicators: [], storedIndicator: 'D5', none: 'unknown_indicator', scheme: 'fico_main_37', moves: [] };
    const out = SL().build(C.fromData(DATA), t, ctx, '', lesson, step);
    expect(out.textReason).toBe('unknown');
    expect(out.candidates.map((c) => c.seg_id)).not.toContain('122-s4');
  });
});

describe('1a · a differentiation pick needs a mixed-level line at the moment (Q191 ⛔2, Q166)', () => {
  const list = { candidates: [{ seg_id: '157-s3', indicator: 'B6' }] };
  const lines = ['[02:00] Teacher: Come to the board, everyone clap for him.', '[02:03] Student: Yes teacher', '[02:10] Teacher: Write the word cat.',
    '[02:12] Student: C A T', '[06:00] Teacher: جن بچوں کو سمجھ نہیں آیا وہ ہاتھ اٹھائیں، کس کو سمجھ نہیں آیا؟', '[06:05] Student: مجھے نہیں آیا میڈم'];
  const opts = { stepIndicator: 'B6', indicators: ['B6'], source: 'card', catalog: null, cardIndicator: 'B6' };
  const pick = (at, quote) => answer({ seg_id: '157-s3', moment: { at, quote },
    reason_en: 'Some children could not follow and only one level of task was given. The clip shows one task at three levels.' });

  test('Q191: the clapping cue, far from any mixed-level line → validation:no_evidence', () => {
    expect(S.validate(pick('02:00', 'Come to the board, everyone clap for him.'), list, lines, { ...opts, catalog: C.fromData(DATA) }).none).toBe('validation:no_evidence');
  });
  test('control: the line where children say they did not follow → ok', () => {
    expect(S.validate(pick('06:00', 'جن بچوں کو سمجھ نہیں آیا وہ ہاتھ اٹھائیں، کس کو سمجھ نہیں آیا؟'), list, lines, { ...opts, catalog: C.fromData(DATA) })).toMatchObject({ ok: true });
  });
  test('no_evidence never takes the card fallback (else silence)', () => {
    expect(S.cardFallback({ none: 'validation:no_evidence', segId: '157-s3', shortlist: list, sentence: 'Prepare an easy and a challenge version.', startS: 60, endS: 98, module: { subjects: ['general'] }, language: 'en' })).toBeNull();
  });
});

describe('1b · the reason names the gap, the cited line shows it, no audit words (ask 1b; Q171 Q122 Q002)', () => {
  const list = { candidates: [{ seg_id: '51-s1', indicator: 'C1' }] };
  const lines = ['[01:00] Teacher: Is this a triangle? Yes or no?', '[01:03] Student: Yes', '[01:10] Teacher: A triangle has three sides and three corners.',
    '[01:12] Student: Okay', '[01:20] Teacher: Why is this one a triangle?', '[01:22] Student: Three'];
  const v = (over) => S.validate(answer({ seg_id: '51-s1', reason_en: 'The class could only answer yes or no. The clip explains asking why instead.', ...over }), list, lines, { catalog: C.fromData(DATA) });

  test('Q171 shape: a lesson half that only says a question was asked → validation:no_gap', () => {
    expect(v({ reason_en: 'In the lesson the teacher asked "Is this a triangle? Yes or no?". The clip is about turning it into a why question.' }).none).toBe('validation:no_gap');
  });
  test('control: the same quote with the gap named (one-word yes or no answers) → ok', () => {
    expect(v({ reason_en: 'In the lesson the teacher asked "Is this a triangle? Yes or no?" and the class only answered yes. The clip is about turning it into a why question.' })).toMatchObject({ ok: true });
  });
  test('Q122 shape: the cited line is the teacher telling, not asking, on a questioning chapter → validation:not_gap', () => {
    expect(v({ moment: { at: '01:10', quote: 'A triangle has three sides and three corners.' },
      reason_en: 'The teacher moved straight on without asking the class. The clip is about asking why.' }).none).toBe('validation:not_gap');
  });
  test('the yes/no-to-why chapter on a line that already asks why → validation:not_gap', () => {
    expect(v({ moment: { at: '01:20', quote: 'Why is this one a triangle?' },
      reason_en: 'The child only answered "Three" to the question. The clip is about turning a yes/no question into a why one.' }).none).toBe('validation:not_gap');
  });
  test('Q002: audit wording in either reason → validation:scorer', () => {
    expect(v({ reason_en: 'The class only repeated; no evidence of written work was found. The clip is about why questions.' }).none).toBe('validation:scorer');
    expect(v({ reason_ur: 'کلاس نے صرف دہرایا مگر لکھائی کا کوئی ثبوت نہیں ملا۔ یہ کلپ کیوں والے سوال سمجھاتا ہے۔' }).none).toBe('validation:scorer');
  });

  test('engine: a reason with no gap clause → the card-sentence fallback on the same chapter, with no second call', async () => {
    const BARE = answer({ reason_en: 'In the lesson the teacher asked "Is this a triangle? Yes or no?". The clip is about asking why.' });
    const d = deps([BARE, BARE]);
    const row = await run(args(), d);
    expect(d.completeJson).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card', seg_id: '10-s1', first_none_reason: 'validation:no_gap', attempts: 1 });
  });
});

describe('1c · closure: no LLM moment on an excerpt that does not reach the lesson end (Q075 Q151); the closing card → 47-s6 (Q117 Q136)', () => {
  // a 20-minute lesson; the scorer's moment sits in its first minutes, so the excerpt never reaches the end
  const LONG = [...CLASS, T('10:00', 'Teacher', 'Now open your copies and draw three shapes.'), T('10:05', 'Student', 'Okay teacher'),
    T('19:50', 'Teacher', 'That is all for today, pack your bags.'), T('19:55', 'Students', 'Allah hafiz teacher')];
  const CLOSING = 'سبق کے آخر میں دو بچوں سے کہیں کہ وہ اپنی زبان میں ایک جملے میں بتائیں کہ آج ہم نے کیا سیکھا۔';
  const MID = answer({ seg_id: '47-s6', moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' }, reason_en: 'The class only answered yes or no. The clip is about closing.' });

  test('Q117 shape: a B10 card naming a closing move, excerpt short of the end → no model call, 47-s6 with the card sentence', async () => {
    const d = deps([MID, MID]);
    const row = await run(args({ indicator: 'B10', action: CLOSING, lang: 'ur', lines: LONG }), d);
    expect(d.completeJson).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'shown', seg_id: '47-s6', moment_source: 'card' });
  });
  test('Q136 shape: a card with no indicator whose when-clause is the lesson end → 47-s6 too', async () => {
    const d = deps([MID, MID]);
    const row = await run(args({ indicator: null, card: { indicator: null, action: CLOSING }, lang: 'ur', lines: LONG }), d);
    expect(row).toMatchObject({ status: 'shown', seg_id: '47-s6', moment_source: 'card' });
  });
  test('control: a B10 card that names no closing move (a label) → silence, no model call', async () => {
    const d = deps([MID, MID]);
    const row = await run(args({ indicator: 'B10', action: 'Next class, dedicate 5 minutes to improving "Lesson Closure".', lines: LONG }), d);
    expect(d.completeJson).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'none', none_reason: 'closure:no_end' });
  });
  test('control: the transcript\'s last lines in the excerpt → the model is asked as before', async () => {
    const lines = [T('00:10', 'Teacher', 'Is this a triangle? Yes or no?'), T('00:13', 'Student', 'Yes'), T('00:20', 'Teacher', 'That is all for today.'), T('00:25', 'Students', 'Bye teacher')];
    const d = deps([MID, MID]);
    await run(args({ indicator: 'B10', action: CLOSING, lines }), d);
    expect(d.completeJson).toHaveBeenCalled();
  });
  test('control: a questioning card whose sentence mentions a summary is no closure card', () => {
    expect(SI().closingCard('Next class, ask two why questions and let pairs summarise their answer.')).toBe(false);
    expect(SI().closingCard(CLOSING)).toBe(true);
    expect(SI().closingCard('At lesson end ask two students to explain in their own words two key points.')).toBe(true);
  });
  test('Q117: closure_early takes the card fallback on the closure chapter (the retry found no late line)', () => {
    const fb = S.cardFallback({ none: 'validation:closure_early', segId: '47-s6', shortlist: { candidates: [{ seg_id: '47-s6' }] }, sentence: CLOSING, startS: 300, endS: 361, module: { subjects: ['general'] }, language: 'ur' });
    expect(fb).not.toBeNull();
  });
});

describe('1d · the Urdu line: the calques, «chorus», Latin terms, punctuation and one digit system (ask 1d)', () => {
  const ur = (t, q = null) => CP().composeReason(t, 'ur', q);

  test.each([
    ['Q189 «یاددہانی کی سوال»', 'استاد نے یاددہانی کی سوال پوچھا۔', 'سیدھا سا سوال'], // R7j: ped/urdu_terms.json
    ['Q033 «یاددہانی / ہاں-نہ سوال»', 'استاد نے ایک یاددہانی / ہاں-نہ سوال پوچھا۔', 'ہاں یا نہیں والا سوال'],
    ['Q006 Latin «recall yes/no»', 'استاد نے ایک recall yes/no سوال پوچھا۔', 'ہاں یا نہیں والا سوال'],
    ['Q143 Latin «recall»', 'ایک مختصر recall سوال پوچھا گیا۔', 'سیدھا سا سوال'],
    ['Q025 «open why/how»', 'اگلا قدم open why/how سوال مانگتا ہے۔', 'کیوں یا کیسے والا سوال'],
    ['Q111 «why سوال»', 'استاد ایک why سوال پوچھتے ہیں۔', 'کیوں والا سوال'],
    ['Q189 «کورس جواب»', 'جس سے مختصر کورس جواب ملتے ہیں۔', 'ایک ساتھ جواب'],
    ['Q126 «کلی طور پر جواب»', 'جس سے ایک بچے یا کلی طور پر جواب مل رہا تھا۔', 'ایک ساتھ'],
    ['Q055 masculine singular', 'استاد نے مختصر جواب قبول کر کے آگے بڑھا: «x»', 'آگے بڑھے'],
    ['Q157 tense slip', 'استاد نے جلدی جواب قبول کیا جب وہ پوچھتے ہیں «x»', 'قبول کیا جب انہوں نے پوچھا'],
    ['Q047 «سننے جائیں»', 'تاکہ جملے سننے جائیں۔', 'سنے جائیں'],
    ['Q131 «دوبارہ سوال میں»', 'دوبارہ سوال میں استاد پوچھتے ہیں۔', 'دہرائی کے دوران'],
    ['Q143 «شریکِ طالبِ علم کی گفتگو»', 'سوال بغیر شریکِ طالبِ علم کی گفتگو کے۔', 'ساتھی سے گفتگو'],
  ])('%s', (_, text, want) => expect(ur(text)).toContain(want));

  test('Q032/Q106 → R7j: a quoted lesson line keeps its own digits (ped/urdu_terms.json rules; COS 022905 §2)', () => {
    const q = 'تو آپ مجھے بتائیں کہ کیا 28 جو ہے، 28 کا فیکٹر ہے 7؟';
    const out = ur(`سبق میں استاد نے پوچھا، "${q}" اور وقت نہیں دیا۔`, q);
    expect(out).toMatch(/[0-9]/); // the quote's own digits
    expect(out).toContain('28');
  });
  test('Q048/Q197 → R7j: a quoted card keeps its own digits', () => {
    const out = ur('آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: "⁨جب Exit ticket دینے کا وقت آئے، تو اس پر 2 open-ended questions لکھیں، اور 5–7 سیکنڈ wait time رکھیں۔⁩"۔');
    expect(out).toMatch(/[0-9]/); // the quote's own digits
  });
  test('Q098: Latin punctuation after an Urdu word becomes Urdu punctuation, inside the quote too', () => {
    const q = 'جو decimal سے پہلے والا ہے, وو کیا ہے? Whole ہی۔';
    const out = ur(`سبق میں سوال پوچھا گیا: "${q}"`, q);
    expect(out).toContain('ہے، وو');
    expect(out).toContain('کیا ہے؟');
  });
  test('control: an English sentence quoted in the Urdu line keeps its own punctuation', () => {
    expect(ur('استاد نے کہا: "Why, then, is it a triangle?"')).toContain('Why, then, is it a triangle?');
  });
  test('the English line: digits inside the quoted lesson line are Western, as its frame', () => {
    const q = 'تو ۲۸ کا فیکٹر ہے ۷؟';
    expect(CP().composeReason(`The teacher asked "${q}" and gave no time.`, 'en', q)).toContain('28');
  });
  test('the word table on a model-written Urdu line (R7j: an Urdu reader\'s own line is the terms file\'s frame; the table still runs on any model Urdu)', () => {
    const out = CP().composeReason('کلاس نے مختصر کورس جواب دیے اور استاد نے ایک recall سوال پوچھا؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔', 'ur', null);
    expect(out).toContain('ایک ساتھ جواب');
    expect(out).toContain('سیدھا سا سوال');
  });
});

describe('e · owed silences: a D3 card over a teacher monologue → 50-s2 by the card (Q036 Q083)', () => {
  const MONO = [T('00:02', 'Teacher', 'کھانے میں کیا ہے؟ ناشتہ، دوپہر کا کھانا، رات کا کھانا، ہم سب یہ کھاتے ہیں، ٹھیک ہے، اب اگلا لفظ پڑھتے ہیں۔')];
  const NO_KID = answer({ seg_id: '50-s2', moment: { at: '00:02', quote: 'کھانے میں کیا ہے؟' }, reason_en: 'The teacher talked alone and no child spoke to another. The clip is about pair talk.' });
  const NONE = { seg_id: null, moment: { at: '', quote: '' }, reason_en: '', reason_ur: '', confidence: 0.3, none_reason: 'no child line' };
  const D3 = 'Next class, give children five minutes to talk to a partner about the words before you read them.';

  test('Q036 shape: no child turn in the lesson, the model gives up → the card sentence on 50-s2', async () => {
    const row = await run(args({ lines: MONO, indicator: 'D3', action: D3, subject: 'urdu' }), deps([NO_KID, NONE]));
    expect(row).toMatchObject({ status: 'shown', seg_id: '50-s2', moment_source: 'card' });
  });
  test('control: a C1 card on the same monologue stays silent', async () => {
    const row = await run(args({ lines: MONO, indicator: 'C1', subject: 'urdu' }), deps([NO_KID, NONE]));
    expect(row.status).toBe('none');
  });
});

describe('e · the F5 label with an open-question sentence on a closed-answer lesson (Q102 Q127 Q139 → 51-s1)', () => {
  const F5 = 'اگلی کلاس میں Subject-Specific Pedagogy: MATH بہتر بنانے کے لیے 5 منٹ مختص کریں۔ ان 5 منٹس میں کم از کم 2 open-ended questions پوچھیں اور ہر سوال کے بعد 10 سیکنڈ انتظار کریں۔';
  const label = (action, lines = CLASS) => {
    const a = args({ indicator: null, card: { indicator: 'F5', action }, subject: 'english', lines });
    a.nextStep = { target: { indicator: 'F5', rung: 1, rationale: 'x', try: action } };
    return a;
  };
  const PICK = answer({ seg_id: '51-s1', moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' } });

  test('Q127: the label goes to the questioning chapters instead of silence', async () => {
    const row = await run(label(F5), deps([PICK]));
    expect(row.none_reason).not.toBe('silence:label_subject');
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1' });
  });
  test('control: the bare label (no open-question sentence) stays silent', async () => {
    const row = await run(label('اگلی کلاس میں Subject-Specific Pedagogy: MATH کو بہتر بنانے کے لیے 5 منٹ مختص کریں۔'), deps([PICK]));
    expect(row.none_reason).toBe('silence:label_subject');
  });
});

describe('1b · the card sentence the fallback now carries more often: sentence openers and the masked address are not names (Q019 Q058 Q090 Q036)', () => {
  const CR = () => require('../../../bot/shared/services/coaching/video-reco/copy-rules');

  test.each([
    ['Q090: a later sentence opening with a verb', "Pick two sentences from the book and ask: 'Why is this pronoun correct here?' Pause 8–10 seconds; cold-call one pair to explain."],
    ['Q019: «… Explain to the class.\' Pause …»', "Next class, when any student gives a number for the array, ask 'How did you get that? Explain to the class.' Pause 8–10 seconds."],
    ['Q058: a Title-case pair «(Apply/Analyze)»', 'اگلی کلاس، جب ایک آیت پڑھائیں، تو دو open-ended questions (Apply/Analyze) پوچھیں، پھر ساتھی سے بات کروائیں۔'],
  ])('%s → kept', (_, s) => expect(CR().childFreeCard(s)).not.toBeNull());

  test('control: a child\'s name opening a later sentence is still a name', () => {
    expect(CR().childFreeCard('Ask the class why. Zunaira should answer first and explain it.')).toBeNull();
  });

  test('Q036: «[TEACHER] Bibi,» is the teacher\'s address and goes; a child placeholder never opens an address', () => {
    const s = '[TEACHER] Bibi, try dedicating 5 minutes of your next class to pair talk.';
    expect(s.slice(CR().leadingVocative(s))).toBe('try dedicating 5 minutes of your next class to pair talk.');
    expect(CR().leadingVocative('[a student] Rani, read the line again.')).toBe(0);
  });
  test('the eval corpus\'s own mask «‹name› ‹name›،» is an address too', () => {
    const s = '‹name› ‹name›، یہ پوچھیں: کیوں؟';
    expect(s.slice(CR().leadingVocative(s))).toBe('یہ پوچھیں: کیوں؟');
  });
});

describe('red7 230552 (pre-PR probes on the WIP)', () => {
  const ctxLines = [...CLASS, T('02:00', 'Teacher', 'سب نے کام ختم کیا؟'), T('02:05', 'Student', 'سر، میں نے کر لیا۔')];

  // a v4 analysis: D5 is on no chapter at strength ≥ 1, so the tag pool is empty and the step-text route runs; the stations
  // chapter carries v4-D5 at strength 0 (as the real 122-s4), so it passes the tag gate
  const V4 = { ...DATA, modules: [...DATA.modules.filter((m) => ![24, 122].includes(m.module_id)),
    mod(122, 'talking_head', 'x', 'ur', [seg('122-s4', 0, 56, 'Rotate groups and observe as facilitator', 'Rotate the groups through stations and observe independent work and on task behavior.', [{ indicator: 'B6', strength: 1 }, { indicator: 'D5', strength: 0 }], ['C6', 'B6'], ['routines'])])] };
  test('A1 (Q031 shape): a step-text pick refused for naming no gap is silence, never the card\'s sentence', async () => {
    const a = args({ lines: ctxLines, indicator: 'D5', action: 'Next class, rotate the groups through stations and observe independent work and on task behavior for each group.', subject: 'english' });
    delete a.analysis.indicator_scheme;
    a.analysis.domains = { D: { indicators: [{ id: 'D5', name: 'On-Task Behavior During Independent Work', score: 1, applicable: true, evidence: 'x', timestamp: '[02:00]' }] } };
    const pick = answer({ seg_id: '122-s4', moment: { at: '02:05', quote: 'سر، میں نے کر لیا۔' },
      reason_en: 'During the lesson one student announced completion: "سر، میں نے کر لیا۔". This clip is about rotating groups.' });
    const d = deps([pick, pick, pick], V4);
    const row = await run(a, d);
    expect(d.completeJson).not.toHaveBeenCalled(); // R7g: the step-text route that offered the chapter is retired
    expect(row.status).toBe('none');
    expect(row.moment_source || null).not.toBe('card');
  });

  test('A3 (Q166 shape): a tiered-work card refused for naming no gap is silence, never the card\'s sentence', async () => {
    const a = args({ indicator: null, card: { indicator: null, action: 'Next class, give a three-tier task: an easy and a challenge version of the shapes task, and ask each group why.' } });
    const first = (p) => answer({ seg_id: (p.match(/\b\d{1,3}-s\d+\b/g) || ['51-s1'])[0], reason_en: 'The lesson opened with "Is this a triangle? Yes or no?", starting the task for the whole class. This clip is about the task.' });
    const d = deps([first, first, first]);
    const row = await run(a, d);
    expect(d.completeJson.mock.calls.length).toBeGreaterThan(0);
    expect(row.moment_source || null).not.toBe('card');
  });
  test('control: the same no-gap reason on a questioning card still takes the card\'s sentence', async () => {
    const pick = answer({ seg_id: '51-s1', reason_en: 'The lesson opened with "Is this a triangle? Yes or no?", starting the task for the whole class. This clip is about open questions.' });
    const row = await run(args(), deps([pick]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
  });

  test('C2: a scorer quote from the lesson\'s last minute counts as reaching the end → the model is asked', async () => {
    const lines = [...CLASS, T('10:00', 'Teacher', 'Now open your copies and draw three shapes.'), T('10:05', 'Student', 'Okay teacher'),
      T('19:50', 'Teacher', 'So what did we learn about shapes today?'), T('19:55', 'Students', 'Shapes')];
    const a = args({ indicator: 'B10', action: 'سبق کے آخر میں دو بچوں سے کہیں کہ وہ اپنی زبان میں بتائیں کہ آج ہم نے کیا سیکھا۔', lines });
    a.analysis.domains = { B: { indicators: [{ id: 'B10', name: 'Closure', score: 1, applicable: true, evidence: 'No summary. Quote: "So what did we learn about shapes today?"', timestamp: '[01:00]' }] } };
    const d = deps([answer({ seg_id: '47-s6', moment: { at: '19:50', quote: 'So what did we learn about shapes today?' }, reason_en: 'At the end only one child answered with a single word. The clip is about closing.' })]);
    await run(a, d);
    expect(d.completeJson).toHaveBeenCalled();
  });

  test('D1: the calque «ریکال سوال» is written «یاد سے بتانے والا سوال» (R7g: the approved word)', () => {
    expect(CP().composeReason('استاد نے ایک ریکال سوال پوچھا۔', 'ur', null)).toContain('سیدھا سا سوال');
  });
  test('D4: «وہ کیوں پوچھنا بھول گیا» speaks of the teacher in the masculine singular → gendered', () => {
    const CR = require('../../../bot/shared/services/coaching/video-reco/copy-rules');
    expect(CR.genderedUrdu('استاد نے سوال کیا، وہ کیوں پوچھنا بھول گیا۔')).toBe(true);
    expect(CR.genderedUrdu('استاد نے سوال کیا، وہ کیوں پوچھنا بھول گئے۔')).toBe(false);
  });
});
