'use strict';
/**
 * bd-8hhqhf R7d (COS ruling 20261023T184404 TRACK 1; panel ped/REVIEW_r7c_rejudge.md §6): the seven asks, each from the
 * panel's Q rows. Names are fictional and outside the name lexicon unless the test says so.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

const SID = '7c7c7c7c-2a41-4d8e-9a55-3f1c2d4e5f60';
const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
const FSI = '⁨';

// The fixture plus the four chapters the engine enacts well (50-s2, 51-s1, 51-s3, 95-s3), with their real kinds:
// 50 and 51 are conversations between teachers, not a class.
const seg = (id, s, e, title, summary, fico, main37, moves = []) => ({
  seg_id: id, start_s: s, end_s: e, title_en: title, title_ur: 'عنوان', summary_en: summary, moves, fico, keywords: [], symptoms: [], fico_main37: main37,
});
const mod = (id, format, summary, language, segments) => ({
  ...FIXTURE.modules[0], module_id: id, title: `Module ${id}`, format, summary_en: summary, language, segments,
});
const DATA = {
  ...FIXTURE,
  modules: [
    ...FIXTURE.modules,
    mod(50, 'talking_head', 'A podcast-style conversation in which a teacher explains think-pair-share in three steps.', 'ur', [
      seg('50-s2', 60, 115, 'Think-pair-share in three steps', 'Think alone, discuss with a partner, share with the class.', [{ indicator: 'D3', strength: 2 }], ['D3']),
    ]),
    mod(51, 'mixed', 'A short dramatised conversation between two teachers about getting children thinking.', 'ur', [
      seg('51-s1', 0, 52, 'Yes/no question vs. a why question', 'A colleague contrasts a yes/no question with a why question so the child thinks and explains.', [{ indicator: 'C1', strength: 2 }], ['C1']),
      seg('51-s3', 82, 141, 'Open questions in a crowded class', 'Give each group one open question, let one child explain to another, a clap signal before sharing.', [{ indicator: 'C1', strength: 1 }], ['C1']),
    ]),
    mod(95, 'classroom_footage', 'x', 'en', [
      seg('95-s3', 120, 197, 'Ask why after an answer', 'The teacher asks why after a one-word answer.', [{ indicator: 'C1', strength: 2 }], ['C1']),
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

// A closed-answer lesson: the teacher asks, the children answer in one word.
const CLOSED = [
  { start_ms: 30000, label: 'Teacher', text: 'Is this a triangle? Yes or no, everyone together!' },
  { start_ms: 33000, label: 'Student', text: 'Yes' },
  { start_ms: 36000, label: 'Teacher', text: 'And this one, is it a square? Tell me quickly' },
  { start_ms: 39000, label: 'Student', text: 'No' },
  { start_ms: 42000, label: 'Teacher', text: 'How many sides does the triangle have then?' },
  { start_ms: 45000, label: 'Student', text: 'Three' },
];
// …and one where the children give reasons.
const OPEN = [
  { start_ms: 30000, label: 'Teacher', text: 'Is this a triangle? Tell me how you know it is one.' },
  { start_ms: 33000, label: 'Student', text: 'It is a triangle because it has three sides and three corners' },
  { start_ms: 36000, label: 'Teacher', text: 'Good, and why is this one not a square?' },
  { start_ms: 39000, label: 'Student', text: 'Because its sides are not the same, so it is a rectangle' },
  { start_ms: 42000, label: 'Teacher', text: 'Why do you think so? Explain to your partner' },
  { start_ms: 45000, label: 'Student', text: 'Because the top side is longer than the side next to it' },
];

function args({ lines = CLOSED, lang = 'en', action = 'Next class, ask two why questions about shapes and wait five seconds.', indicator = 'C1', transcript } = {}) {
  return {
    session: {
      // an Urdu-medium lesson: Urdu and English chapters are both on the list for either reader
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: lang },
      diarization_data: { segments: lines }, ...(transcript === undefined ? {} : { transcript_text: transcript }),
    },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [
        { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
      ] } },
      subject_resolution: { code: 'maths', grade: '3', confidence: 'high' },
      topic: 'shapes',
    },
    nextStep: { target: { indicator, rung: 1, rationale: 'Few open questions', try: action } },
    card: { indicator, action },
    coachingSessionId: SID,
  };
}

const answer = (over = {}) => ({
  seg_id: '10-s1', moment: { at: '00:30', quote: 'Is this a triangle? Yes or no, everyone together' },
  reason_en: 'The class could only answer yes or no. The clip shows a teacher asking why and how instead.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7, ...over,
});
const ROMAN = answer({ reason_ur: 'کلاس agli dafa yeh karo اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔' }); // validation:roman

function deps(answers, catalog = DATA) {
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockResolvedValueOnce({ result: a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }));
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
const both = (row) => `${row.reason_en} ${row.reason_ur}`;

const withRoster = (d, names) => ({ ...d, store: { ...d.store, rosterNames: jest.fn().mockResolvedValue(names) } });
const ENACTED = ['50-s2', '51-s1', '51-s3', '95-s3'];
const ids = (prompt) => [...prompt.matchAll(/^(\d+-s\d+) · /gm)].map((m) => m[1]);

describe('1 · ⛔9: a name in the card sentence refuses the fallback whatever its position (Q086)', () => {
  test('a lexicon name inside a quoted title (no cue before or after it) → never quoted; R7g: the plain frame', async () => {
    const action = "اگلی کلاس میں، جب 'گنتی احمد' کا پیراگراف پڑھیں، تو بورڈ پر تین کیوں والے سوال لکھیں اور پانچ سیکنڈ رکیں۔";
    const row = await run(args({ action, lang: 'ur' }), deps([ROMAN, ROMAN]));
    // R7g 1e (COS 20261024T002603; panel Z100): the sentence that names a child is never quoted; the plain frame carries the clip
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card', reason_en: 'Your report gives you one thing to try next class. This clip shows one way to do it.' });
    expect(`${row.reason_en} ${row.reason_ur}`).not.toMatch(/احمد/);
  });

  test('a name on the teacher\'s own class roster, anywhere in the card → never quoted; R7g: the plain frame', async () => {
    const action = "اگلی کلاس میں، جب 'گنتی زرویش' کا پیراگراف پڑھیں، تو بورڈ پر تین کیوں والے سوال لکھیں اور پانچ سیکنڈ رکیں۔";
    const row = await run(args({ action, lang: 'ur' }), withRoster(deps([ROMAN, ROMAN]), ['زرویش', 'Kintal']));
    // R7g 1e (COS 20261024T002603; panel Z100): the sentence that names a child is never quoted; the plain frame carries the clip
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card', reason_en: 'Your report gives you one thing to try next class. This clip shows one way to do it.' });
    expect(`${row.reason_en} ${row.reason_ur}`).not.toMatch(/زرویش/);
  });

  test('a roster name in the model\'s own reason → validation:name (never stored, never sent)', async () => {
    const named = answer({ reason_en: 'Zarvesh could only answer yes or no. The clip explains how to ask why instead.' });
    const row = await run(args(), withRoster(deps([named, named]), ['Zarvesh']));
    expect(both(row || {})).not.toMatch(/Zarvesh/);
    expect(row.first_none_reason).toBe('validation:name');
  });

  test('control (Q086 as checked): the title word is not on the roster → the fallback stays', async () => {
    const action = "اگلی کلاس میں، جب 'گنتی زرویش' کا پیراگراف پڑھیں، تو بورڈ پر تین کیوں والے سوال لکھیں اور پانچ سیکنڈ رکیں۔";
    const row = await run(args({ action, lang: 'ur' }), withRoster(deps([ROMAN, ROMAN]), ['Kintal']));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
  });
});

describe('2 · a failed quote / placeholder / not_moment check looks for a second moment before going silent', () => {
  const PAGE = answer({ moment: { at: '00:30', quote: 'Is this a triangle? Yes or no, everyone together' }, reason_en: 'x' });
  const BADQ = answer({ moment: { at: '00:30', quote: 'Tell me about the history of triangles in Egypt' } });
  const PICK = answer({
    seg_id: '51-s1', moment: { at: '00:42', quote: 'How many sides does the triangle have then' },
    reason_en: 'The class answered in one word. The clip explains how to turn that question into a why question.',
    reason_ur: 'کلاس نے ایک لفظ میں جواب دیا۔ یہ کلپ سمجھاتا ہے کہ اس سوال کو کیوں والے سوال میں کیسے بدلیں۔',
  });

  test('Q144 shape: both answers quote a line the lesson never had, the card cannot fall back → one more call, enacted only', async () => {
    const d = deps([BADQ, BADQ, PICK]);
    const row = await run(args({ action: 'Few open questions were asked in this lesson.' }), d);
    expect(d.completeJson).toHaveBeenCalledTimes(3);
    expect(ids(d.completeJson.mock.calls[2][0]).every((id) => ENACTED.includes(id))).toBe(true);
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', route: 'enacted', attempts: 3 });
  });

  test('control: children who give reasons → no third call, the none stands', async () => {
    const d = deps([BADQ, BADQ, PICK]);
    const row = await run(args({ lines: OPEN, action: 'Few open questions were asked in this lesson.' }), d);
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:quote' });
  });
  void PAGE;
});

describe('3 · the second-pass shortlist is exactly the four enacted chapters', () => {
  test('Q077 is a first-call card_text pick (attempts 1); every second- and third-pass list is ⊆ the four', async () => {
    const NONE = { seg_id: null, none_reason: 'nothing fits', confidence: 0.2 };
    const d = deps([NONE, NONE]);
    await run(args(), d);
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    const second = ids(d.completeJson.mock.calls[1][0]);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((id) => ENACTED.includes(id))).toBe(true);
  });
});

describe('3b · G3 (no second ask): on a move step the enacted list keeps only chapters tagged for that step (gold be2a6d28)', () => {
  test('control: a step with no tag to keep (D3 is a declared hole in this catalogue) → R7g: no route at all, no model call', async () => {
    const NONE = { seg_id: null, none_reason: 'nothing fits', confidence: 0.2 };
    const d = deps([NONE, NONE]);
    const row = await run(args({ indicator: 'D3' }), d);
    expect(d.completeJson).not.toHaveBeenCalled(); // the step-text list it was asked from is retired (COS 20261024T002603 1a)
    expect(row).toMatchObject({ status: 'none', none_reason: 'hole' });
  });


  test('a C1 step: 51-s1 is offered (tagged C1), 50-s2 (D3) is not, and the shown pick is never a second ask', async () => {
    const NONE = { seg_id: null, none_reason: 'nothing fits', confidence: 0.2 };
    const PICK = answer({
      seg_id: '51-s1', reason_en: 'The class could only answer yes or no. The clip explains how to turn that question into a why question.',
      reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی۔ یہ کلپ سمجھاتا ہے کہ اس سوال کو کیوں والے سوال میں کیسے بدلیں۔',
    });
    const d = deps([NONE, PICK]);
    const row = await run(args(), d);
    const second = ids(d.completeJson.mock.calls[1][0]);
    expect(second).toContain('51-s1');
    expect(second).not.toContain('50-s2');
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', differs_from_step: false });
  });
});

describe('4 · card_text route: a single-word match never carries a chapter (⛔2 × 6 of 10)', () => {
  const SL = () => require('../../../bot/shared/services/coaching/video-reco/shortlist');
  const CHECK = {
    ...DATA,
    modules: [...DATA.modules, mod(97, 'talking_head', 'x', 'ur', [
      seg('97-s5', 200, 260, 'Peer checklist for the final draft', 'Pairs swap drafts and tick a peer checklist before the final copy.', [{ indicator: 'D5', strength: 2 }], ['D5'], ['peer_self_assessment']),
    ])],
  };
  const ctx = { language: 'en', preferred: 'en', languages: ['en', 'ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
  const lesson = { subject: 'maths', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [] };
  const target = { source: 'card_text', cardText: '' };

  test('Q171 shape: a questioning card that meets the chapter on «checklist» alone → that chapter is not listed', () => {
    const action = 'Next class, keep a short checklist of three why questions on the board and ask one after each answer.';
    const out = SL().build(C.fromData(CHECK), { ...target, cardText: action }, ctx, '', lesson, { action });
    expect(out.candidates.map((c) => c.seg_id)).not.toContain('97-s5');
  });

  test('control: a card about the move itself («peer checklist … final draft») keeps the chapter', () => {
    const action = 'Next class, give pairs a peer checklist to tick on each other\'s draft before they write the final copy.';
    const out = SL().build(C.fromData(CHECK), { ...target, cardText: action }, ctx, '', lesson, { action });
    expect(out.candidates.map((c) => c.seg_id)).toContain('97-s5');
  });

  test('Q089 shape: a B7 (plan) card meets 50-s2 on «steps» alone → 50-s2 is not listed, though it is enacted', () => {
    const action = 'Next class, follow the plan steps one by one and tick each in your lesson plan.';
    const out = SL().build(C.fromData(CHECK), { ...target, cardText: action }, ctx, '', lesson, { action, indicator: 'B7' });
    expect(out.candidates.map((c) => c.seg_id)).not.toContain('50-s2');
  });
});

describe('5 · a test period, a greeting, a reprimand, an announcement, an echo-read line are not moments', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const v = (line, quote, opts = {}, next = '[00:31] Student: جی۔') => S.validate(answer({ moment: { at: '00:30', quote } }), list, [`[00:30] Teacher: ${line}`, next], opts);

  test.each([
    ['Q113 greeting', 'تم کیسے ہو؟ سب ٹھیک ہیں؟', 'تم کیسے ہو؟ سب ٹھیک ہیں'],
    ['Q076 reprimand', 'آپ کیوں اتنے سست ہو کے بیٹھے ہوئے ہیں؟ کیا ہوا ہے آپ کو؟', 'آپ کیوں اتنے سست ہو کے بیٹھے ہوئے ہیں؟ کیا ہوا ہے آپ کو؟'],
    ['Q170 test period', 'آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے۔', 'آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے'],
    ['Q198 the topic asked', 'اچھا، آج کا جو ہمارا ٹاپک ہے وہ کیا ہے؟', 'اچھا، آج کا جو ہمارا ٹاپک ہے وہ کیا ہے؟'],
  ])('%s → validation:not_moment', (_, line, quote) => expect(v(line, quote).none).toBe('validation:not_moment'));

  test('Q199: the lesson\'s own topic said as a question («What is sound») → validation:not_moment', () => {
    expect(v('What is sound? Today we read about it.', 'What is sound', { topic: 'Sound' }).none).toBe('validation:not_moment');
  });

  test('Q038/Q056: in Grade 1–2 a line the children echo back is reading, not a question → validation:not_moment', () => {
    expect(v('A girl is smiling at the cat.', 'A girl is smiling at the cat', { grade: { lo: 1, hi: 1 } }, '[00:32] Student: A girl is smiling at the cat.').none).toBe('validation:not_moment');
  });

  test.each([
    ['a why question about the lesson', 'Why does a magnet pull the pin but not the paper?', 'Why does a magnet pull the pin but not the paper', {}],
    ['a topic question in another lesson', 'What is sound made of, do you think?', 'What is sound made of, do you think', { topic: 'Magnets' }],
    ['an echoed line in Grade 4', 'A girl is smiling at the cat.', 'A girl is smiling at the cat', { grade: { lo: 4, hi: 4 } }],
  ])('control: %s is a moment', (_, line, quote, opts) => {
    const next = /girl/.test(line) ? '[00:32] Student: A girl is smiling at the cat.' : '[00:31] Student: جی۔';
    expect(v(line, quote, opts, next).ok).toBe(true);
  });

  test('Grade 1–2 echo reading is not a closed-answer lesson (Q038: 51-s3 sent on an echo-read lesson)', () => {
    const SI = require('../../../bot/shared/services/coaching/video-reco/silence');
    const echo = ['A girl is', 'smiling', 'at the cat', 'The cat is', 'on the mat'].flatMap((t, i) => [`[00:${10 + 2 * i}] Teacher: ${t}.`, `[00:${11 + 2 * i}] Student: ${t}.`]);
    expect(SI.closedAnswers(echo, { grade: { lo: 1, hi: 1 } })).toBe(false);
    expect(SI.closedAnswers(echo, { grade: { lo: 4, hi: 4 } })).toBe(true); // unchanged above Grade 2
  });
});

describe('6 · the clip half is written from the chapter; the lesson half from the cited line', () => {
  const SCRIPT = answer({
    seg_id: '51-s1',
    reason_en: 'The class could only answer yes or no: "Is this a triangle? Yes or no, everyone together". This clip explains the three-step routine and gives a script: \'Say it with me, then tell your partner.\'',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی۔ یہ کلپ تین مراحل سمجھاتا ہے اور کل کہنے کو جملہ دیتا ہے: "میرے ساتھ دہرائیں۔"',
  });

  test('Q105/Q150 shape: the card\'s script attributed to the clip is replaced by the chapter\'s own title (en + ur)', async () => {
    const row = await run(args({ lang: 'ur' }), deps([SCRIPT])); // R7g: an Urdu reader (an en reader's Urdu line is the card frame)
    expect(row.status).toBe('shown');
    expect(both(row)).not.toMatch(/Say it with me|میرے ساتھ دہرائیں/);
    expect(row.reason_en).toMatch(/^The class could only answer yes or no/);
    expect(row.reason_en).toContain('Yes/no question vs. a why question');
    expect(row.reason_ur).toContain('کلاس صرف ہاں یا نہیں میں جواب دے سکی');
    expect(row.reason_ur).toContain('عنوان');
  });

  test('control: a reason that opens with the clip keeps the model\'s text, and the validators still apply (R7f 1b: it names no gap of the lesson → the card\'s sentence)', async () => {
    const lead = answer({
      seg_id: '51-s1', reason_en: 'This clip explains how to turn a yes/no question into a why question, as in "Is this a triangle? Yes or no, everyone together".',
      reason_ur: 'یہ کلپ سمجھاتا ہے کہ ہاں یا نہیں والے سوال کو کیوں والے سوال میں کیسے بدلیں۔',
    });
    const grounded = S.groundReasons(lead, C.fromData(DATA));
    expect(grounded.reason_en).toContain('This clip explains how to turn a yes/no question into a why question');
    const row = await run(args(), deps([lead]));
    expect(row).toMatchObject({ moment_source: 'card', first_none_reason: 'validation:no_gap' });
  });

  test('a what-question is never called recall: the label is rewritten in the lesson half (en + ur), the pick is kept', async () => {
    const lines = [{ start_ms: 30000, label: 'Teacher', text: 'What is the name of this shape?' }, { start_ms: 33000, label: 'Student', text: 'Triangle' }];
    const r = answer({
      seg_id: '51-s1', moment: { at: '00:30', quote: 'What is the name of this shape' },
      reason_en: 'The teacher asked a recall question: "What is the name of this shape". The clip explains asking why instead.',
      reason_ur: 'استاد نے یادداشت پر مبنی سوال پوچھا۔ یہ کلپ سمجھاتا ہے کہ کیوں والا سوال کیسے پوچھیں۔',
    });
    const row = await run(args({ lines, lang: 'ur' }), deps([r])); // R7g: an Urdu reader reads the model's Urdu line
    expect(row.status).toBe('shown');
    expect(row.reason_en).toMatch(/^The teacher asked a question:/);
    expect(row.reason_ur).toMatch(/^استاد نے سوال پوچھا/);
    expect(both(row)).not.toMatch(/recall|یادداشت/);
  });

});

describe('7 · Urdu: the fixed lexical list, the familiar imperative, one digit system, header/body duration', () => {
  const { composeReason } = require('../../../bot/shared/services/coaching/video-reco/copy');

  test.each([
    ['استاد نے یاددہانی سوال پوچھا', 'استاد نے یاد سے بتانے والا سوال پوچھا'], // R7g: the approved word
    ['جوڑ کی گفتگو نہیں ہوئی', 'جوڑوں میں گفتگو نہیں ہوئی'],
    ['ہم ایک جوڑ کی وجہ سنتے ہیں', 'ہم ایک جوڑے کی وجہ سنتے ہیں'],
    ['ایک طالب نے کہا', 'ایک طالب علم نے کہا'],
    ['ہر طالب سوچ کر لکھے', 'ہر طالب علم سوچ کر لکھے'],
    ['استاد ایک نفی مسئلہ پوچھ رہے ہیں', 'استاد ایک تفریق کا سوال پوچھ رہے ہیں'],
    ['چہار سیکنڈ سوچیں', 'چار سیکنڈ سوچیں'],
    ['استاد نے لفظ کا مطلب پوچھائی', 'استاد نے لفظ کا مطلب پوچھی'],
    ['استاد نے پیشن گوئی پوچھي', 'استاد نے پیشین گوئی پوچھی'],
    ['پھر گروپوں سے کہو کہ رولز طے کریں', 'پھر گروپوں سے کہیں کہ رولز طے کریں'],
  ])('«%s» → «%s»', (from, to) => expect(composeReason(from, 'ur', null)).toBe(to));

  test('factors: «عناصر» on a maths lesson → «اجزائے ضربی»; a science lesson keeps «عناصر» (elements)', () => {
    expect(composeReason('سبق میں عناصر کو ترتیب دیا', 'ur', null, { subject: 'maths' })).toBe('سبق میں اجزائے ضربی کو ترتیب دیا');
    expect(composeReason('سبق میں عناصر کو ترتیب دیا', 'ur', null, { subject: 'science' })).toBe('سبق میں عناصر کو ترتیب دیا');
  });

  test('control: a familiar imperative inside a quoted line to children stays («چلو …»)', () => {
    expect(composeReason('استاد کہہ سکتے ہیں: "چلو ایک سوال سوچو"', 'ur', null)).toContain('چلو ایک سوال سوچو');
  });

  test('Q078/Q048: the card fallback in Urdu carries no seconds (the header says minutes) and no Western digit outside the card', async () => {
    const action = 'اگلی کلاس میں دو open-ended questions پوچھیں اور 3-5 سیکنڈ wait time رکھیں۔';
    const row = await run(args({ action, lang: 'ur' }), deps([ROMAN, ROMAN]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
    const outside = row.reason_ur.replace(/[⁦-⁨][^⁩]*⁩/g, ' ');
    expect(outside).not.toMatch(/[0-9۰-۹]/);
    expect(row.reason_en).not.toMatch(/\d+-second/);
  });
});

describe('red7 HOLD 194127 on 34450db474', () => {
  test('H1 (Q170): a rejected routine quote (a test held this period) never falls back to the card → silence', async () => {
    const lines = [{ start_ms: 30000, label: 'Teacher', text: 'آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے۔' }, { start_ms: 33000, label: 'Student', text: 'جی' }];
    const test = answer({ moment: { at: '00:30', quote: 'آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے' } });
    const elsewhere = answer({ moment: { at: '00:30', quote: 'Tell me about the history of triangles in Egypt' } });
    const row = await run(args({ lines }), deps([test, elsewhere]));
    expect(row).toMatchObject({ status: 'none' });
    expect(row.moment_source).not.toBe('card');
  });

  test('H1 (Q170, be44ca36 shape): the routine quote is refused for a placeholder first, twice → still no card fallback', async () => {
    const lines = [{ start_ms: 30000, label: 'Teacher', text: 'آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے۔' }, { start_ms: 33000, label: 'Student', text: 'جی' }];
    const ph = answer({ moment: { at: '00:30', quote: 'آج ٹیسٹ ہے [TEACHER] آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے' } });
    const d = deps([ph, ph]);
    const row = await run(args({ lines }), d);
    expect(row.first_none_reason).toBe('validation:placeholder');
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:placeholder' });
  });

  test('H2 (A14): a strong lexicon name as the card\'s first word, no comma → never quoted; R7g: the plain frame', async () => {
    const row = await run(args({ action: 'Zunaira should answer first, then ask the class why.' }), deps([ROMAN, ROMAN]));
    // R7g 1e (COS 20261024T002603; panel Z100): the sentence that names a child is never quoted; the plain frame carries the clip
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card', reason_en: 'Your report gives you one thing to try next class. This clip shows one way to do it.' });
    expect(`${row.reason_en} ${row.reason_ur}`).not.toMatch(/Zunaira/);
  });

  test('control: a card opening with an ordinary capitalised word keeps its fallback', async () => {
    const row = await run(args({ action: 'Ask the class why after every answer and wait five seconds.' }), deps([ROMAN, ROMAN]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
  });

  test('nit: a chapter title ending in a question mark is not doubled with the line\'s full stop', () => {
    const Q = { ...DATA, modules: DATA.modules.map((m) => (m.module_id !== 51 ? m : { ...m, segments: m.segments.map((x) => (x.seg_id !== '51-s1' ? x : { ...x, title_en: 'What did you learn today?', title_ur: 'آج کیا سیکھا؟' })) })) };
    const out = S.groundReasons(answer({ seg_id: '51-s1', reason_en: 'The class answered yes. This clip shows more.', reason_ur: 'کلاس نے ہاں کہا۔ یہ کلپ مزید دکھاتا ہے۔' }), C.fromData(Q));
    expect(out.reason_en).toBe('The class answered yes. This clip is about: What did you learn today?');
    expect(out.reason_ur).toBe('کلاس نے ہاں کہا۔ یہ کلپ اس بارے میں ہے: آج کیا سیکھا؟');
  });
});
