'use strict';
/**
 * bd-8hhqhf R7e (COS ruling 20261023T202042; panel ped/REVIEW_r7d_rejudge.md §2 §3 §6): the moment rule and the copy
 * residuals, each from the panel's Q rows. Fixture and helpers as r7d.test.js; names are fictional.
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
const CR = () => require('../../../bot/shared/services/coaching/video-reco/copy-rules');
const SI = () => require('../../../bot/shared/services/coaching/video-reco/silence');
const SL = () => require('../../../bot/shared/services/coaching/video-reco/shortlist');
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const CLASS = [ // the class itself: closed answers
  T('01:00', 'Teacher', 'Is this a triangle? Yes or no?'), T('01:03', 'Student', 'Yes'), T('01:06', 'Teacher', 'Is this a square?'),
  T('01:09', 'Student', 'No'), T('01:12', 'Teacher', 'How many sides then?'), T('01:15', 'Student', 'Three'),
  T('01:18', 'Teacher', 'Is it big or small?'), T('01:21', 'Student', 'Big'), T('01:24', 'Teacher', 'Good, next one, is it red?'), T('01:27', 'Student', 'Yes'),
];

describe('1 · a line spoken while no lesson is happening is no moment (Q063, Q170)', () => {
  // Q063: the teacher and the observer set up the phone; the class is greeted after
  const SETUP = [
    T('00:20', 'Teacher', 'میرا موبائل کدھر ہے؟ ابھی شروع کرتے ہیں۔'), T('00:30', 'Student 2', 'ہاں، آپ سٹارٹ کریں۔'),
    T('00:35', 'Teacher', 'یہ دیکھو، کیسی لگی؟ یہ سارا کام ابھی یہاں شروع کریں گے۔'), T('00:50', 'Teacher', 'السلام علیکم بچو۔'), ...CLASS,
  ];
  const PRE = answer({ moment: { at: '00:35', quote: 'یہ دیکھو، کیسی لگی؟' } });

  test('Q063: a line from before the class is greeted → never shown', async () => {
    const row = await run(args({ lines: SETUP }), deps([PRE, PRE, PRE]));
    expect(row.first_none_reason || row.none_reason).toBe('validation:not_moment');
    expect(row.moment_quote || '').not.toMatch(/کیسی لگی/);
    expect(row.status).toBe('none');
  });

  test('control: the same lesson, a question asked after the greeting → shown', async () => {
    const IN = answer({ moment: { at: '01:00', quote: 'Is this a triangle? Yes or no?' } });
    const row = await run(args({ lines: SETUP }), deps([IN]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'transcript' });
  });

  // Q170: a test period; a child's line about the group is quoted as a moment
  const TEST = [T('00:01', 'Teacher', 'السلام علیکم، پیارے بچوں۔ آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے۔'),
    T('00:30', 'Student 2', 'میں اپنے گروپ میں ایکسپلین کرواؤں گی۔'), T('00:33', 'Teacher', 'ٹھیک ہے، اپنا کام کریں۔'), ...CLASS];
  const GROUP = answer({ moment: { at: '00:30', quote: 'میں اپنے گروپ میں ایکسپلین کرواؤں گی۔' } });

  test('Q170: a line in a period held as a test → never shown', async () => {
    const row = await run(args({ lines: TEST }), deps([GROUP, GROUP, GROUP]));
    expect(row.status).toBe('none');
    expect(row.first_none_reason || row.none_reason).toBe('validation:not_moment');
  });

  test('control: a lesson that prepares for a test («ٹیسٹ کی تیاری») is a lesson → shown', async () => {
    const PREP = [T('00:01', 'Teacher', 'آج ہم ٹیسٹ کی تیاری کریں گے۔'), ...TEST.slice(1)];
    const row = await run(args({ lines: PREP }), deps([GROUP]));
    expect(row).toMatchObject({ status: 'shown' });
  });

  test('control: a greeting late in the lesson (a visitor at minute 20) does not void the lines before it', () => {
    const lines = [...CLASS, ...CLASS, T('20:00', 'Teacher', 'السلام علیکم بچو، مہمان آئے ہیں۔')].map((l, i) => `[${String(i).padStart(2, '0')}:00] ${l.label}: ${l.text}`);
    expect(SI().notTeaching(lines, 2)).toBe(false);
  });
});

describe('2 · B10 closure chapters answer the end of the lesson (Q117 Q136 Q197)', () => {
  const CLOSE = { ...DATA, modules: [...DATA.modules, mod(11, 'talking_head', 'x', 'ur', [
    seg('11-s5', 300, 360, "Closure: exit ticket, quick quiz, 'what did you learn today?'", 'End the lesson with an exit ticket and a quick quiz.', [{ indicator: 'B7', strength: 2 }], ['B10', 'C2']),
  ])] };
  const SAID = ['How did you all come to school today?', 'Open your books to the triangles we drew', 'Count the sides of each shape you see',
    'Now draw two squares in your copy', 'Which shape had the most corners?', 'So what did we learn about shapes today?'];
  const lines = ['00:16', '02:00', '04:00', '06:00', '08:00', '09:00'].flatMap((t, i) => [`[${t}] Teacher: ${SAID[i]}`, `[${t.slice(0, 3)}${String(+t.slice(3) + 2).padStart(2, '0')}] Student: We did the sums`]);
  const list = { candidates: [{ seg_id: '11-s5', indicator: 'B7' }] };
  const pick = (at, i) => answer({ seg_id: '11-s5', moment: { at, quote: SAID[i] },
    reason_en: 'At the end the class only gave one-word answers to the teacher.', reason_ur: 'آخر میں کلاس نے استاد کو صرف ایک لفظ میں جواب دیے۔' });
  const v = (at, i) => S.validate(pick(at, i), list, lines, { catalog: C.fromData(CLOSE), fullLines: lines });

  test('Q136 shape: a closure chapter cited on the opening line (00:16 of 09:02) → validation:closure_early', () => {
    expect(v('00:16', 0).none).toBe('validation:closure_early');
  });
  test('control: the same chapter on a line from the last third → ok', () => {
    expect(v('09:00', 5)).toMatchObject({ ok: true });
  });
});

describe('3 · Grade 1–2: the child\'s own echo of the teacher\'s line is reading, not a chorus answer (Q038)', () => {
  const lines = ['[02:02] Teacher: چلو جی۔ پہلی لائن ہے اس کی: A girl is۔', '[02:12] Student: A girl is۔', '[02:13] Teacher: Smiling۔',
    '[02:14] Student: Smiling۔', '[02:15] Teacher: A girl is smiling.', '[02:17] Student: A girl is smiling.'];
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const v = (grade) => S.validate(answer({ moment: { at: '02:12', quote: 'A girl is۔' } }), list, lines, { grade });

  test('Q038: the quoted line is the child echoing, inside an echo run, in Grade 1 → validation:not_moment', () => {
    expect(v({ lo: 1, hi: 1 }).none).toBe('validation:not_moment');
  });
  test('control: the same lines in Grade 4 are not judged as echo reading', () => {
    expect(v({ lo: 4, hi: 4 }).none).not.toBe('validation:not_moment');
  });
});

describe('4 · small talk and an attention check are routine lines (Q179 Q136); which-lesson is not built (red7 F1)', () => {
  test.each([
    ['Q179', 'اوکے۔ ایکٹیو ہیں؟'],
    ['Q136', 'میں نے کہا، آج آپ لوگ اسکول کیسے آئے؟'],
  ])('%s → routine', (_, line) => expect(SI().routineLine(line)).toBe(true));

  test.each([
    ['a content what-question', 'اللہ کے حقوق کیا ہیں؟'],
    ['a reading question about the text', 'Why did the girl in the story smile?'],
    ['a how question with «پڑھ»', 'یہ لفظ کیسے پڑھیں گے، اور کیوں؟'],
    ['the closure question (en)', 'So what did we learn about shapes today?'],
    ['the closure question (ur)', 'آج ہم نے کیا پڑھا؟ کون بتائے گا؟'],
    ['red7 F1: which lesson (Q026 was right)', 'آج ہم نے کون سا سبق پڑھنا ہے؟'],
    ['apple, not the app', 'ایپل کس رنگ کا ہوتا ہے اور کیوں؟'],
  ])('control: %s → not routine', (_, line) => expect(SI().routineLine(line)).toBe(false));
});

describe('5 · card_text: a questioning card never lands on a non-questioning chapter; a routine chapter needs a routine card', () => {
  const CT = { ...DATA, modules: [...DATA.modules,
    mod(80, 'talking_head', 'x', 'ur', [seg('80-s2', 60, 120, 'Choice board, mixed formats and peer-review rubrics', 'Pairs use a peer review rubric and a choice board of formats.', [{ indicator: 'C5', strength: 2 }], ['C5', 'C11', 'C3'])]),
    mod(81, 'talking_head', 'x', 'ur', [seg('81-s1', 60, 120, 'Peer review rubric with a why question', 'Pairs use a peer review rubric and ask why.', [{ indicator: 'C1', strength: 2 }], ['C1'])]),
    mod(1, 'talking_head', 'x', 'ur', [seg('1-s5', 60, 120, 'Model, practise, repeat, praise a routine', 'Model the routine, children practise and repeat it, then praise them.', [{ indicator: 'C6', strength: 2 }], ['C6', 'B9', 'C7'])]),
  ] };
  const ctx = { language: 'en', preferred: 'en', languages: ['en', 'ur', 'mixed'], level: 2, ladderComplete: false, history: { segments: [], modules: [] } };
  const lesson = { subject: 'maths', grade: { lo: 3, hi: 3 }, topic: null, inapplicable: [] };
  const listed = (action, extra = { scheme: 'fico_main_37' }) => SL().build(C.fromData(CT), { source: 'card_text', cardText: action }, ctx, '', lesson, { action, ...extra }).candidates.map((c) => c.seg_id);
  const WHY = 'Next class, after you model one example, ask each pair one open-ended question and let them use a peer review rubric.';

  test('Q095/Q171 shape: an open-question card meets a peer-review rubric chapter (37 C5/C11/C3) → not listed', () => {
    expect(listed(WHY)).not.toContain('80-s2');
  });
  test('control: the same card, a chapter tagged 37-C1 → listed', () => expect(listed(WHY)).toContain('81-s1'));
  test('control: on a v4 analysis the rule does not apply', () => expect(listed(WHY, { scheme: 'fico' })).toContain('80-s2'));
  test('control: a card that is not about questions keeps the rubric chapter', () => {
    expect(listed('Next class, give pairs a peer review rubric and a choice board of formats for their work.')).toContain('80-s2');
  });

  test('Q011: «model the correct sentence and have the child repeat it» meets a routines chapter (37 C6 first) → not listed', () => {
    expect(listed('Next class, when a child gives a short answer, model the correct sentence and have the child repeat it, then praise.')).not.toContain('1-s5');
  });
  test('control: a card about the routine itself keeps it', () => {
    expect(listed('Next class, model the line-up routine, let children practise and repeat it, then praise them.')).toContain('1-s5');
  });
});

describe('6 · copy: no pointer without a line, no empty appositive, no bare recall rewrite (Q191 Q182 Q058 Q196 Q056 Q097 Q106)', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const lines = ['[00:30] Teacher: Is this a triangle? Yes or no, everyone together', '[00:31] Student: Yes'];
  const v = (over) => S.validate(answer({ ...over }), list, lines, {});

  test('Q191: "said that line" with nothing quoted → validation:no_line', () => {
    expect(v({ reason_en: 'While defining the term the teacher said that line, showing whole-class explanation of words.' }).none).toBe('validation:no_line');
  });
  test('control: a reason that quotes the line → ok', () => {
    expect(v({ reason_en: 'The class answered "Yes" in chorus to that line, a yes or no question.' })).toMatchObject({ ok: true });
  });

  test('Q058/Q196: the rewritten label leaves no empty appositive', () => {
    const q = 'اللہ کے حقوق کیا ہیں؟';
    expect(CR().relabelRecall(`In the lesson the teacher asked '${q}', a recall question. This clip is about: X.`, 'en', q)).toBe(`In the lesson the teacher asked '${q}'. This clip is about: X.`);
    expect(CR().relabelRecall(`The teacher asked, "${q}" which is a recall question. This clip is about: X.`, 'en', q)).toBe(`The teacher asked, "${q}". This clip is about: X.`);
  });

  test('Q056/Q097 shape: a bare recall label on a what-question is refused (validation:recall), never rewritten to «سوال سوال»', async () => {
    const lines2 = [{ start_ms: 30000, label: 'Teacher', text: 'ابو جان کیا چیزیں لے کر آئے؟' }, { start_ms: 33000, label: 'Student', text: 'آم' }, ...CLOSED.slice(2)];
    const bare = answer({ moment: { at: '00:30', quote: 'ابو جان کیا چیزیں لے کر آئے؟' },
      reason_en: 'The lesson keeps asking recall, as when the teacher asks one thing after another.',
      reason_ur: 'سبق میں یادداشت سوال تک محدود ہے، جیسے استاد نے ایک کے بعد ایک بات پوچھی۔' });
    const row = await run(args({ lines: lines2, lang: 'ur' }), deps([bare, bare, bare]));
    expect(row.first_none_reason).toBe('validation:recall');
    expect(both(row.status === 'none' ? { reason_en: '', reason_ur: '' } : row)).not.toMatch(/سوال سوال|asking question/);
  });

  test('Q106: «کہ کر» is written «کہہ کر» in the Urdu line', () => {
    const { composeReason } = require('../../../bot/shared/services/coaching/video-reco/copy');
    expect(composeReason('استاد نے بچے سے پوچھا، کہ کر کہ یہ کس کے قریب ہے۔', 'ur', null)).toContain('کہہ کر');
  });
});

describe('7 · red7 HOLD 210805 on #3648', () => {
  const STUDENT = 'میں اپنے گروپ میں ایکسپلین کرواؤں گی۔';
  const TEST = [T('00:01', 'Teacher', 'السلام علیکم، پیارے بچوں۔ آج ٹیسٹ ہے آپ کا، ابھی آپ مجھے لکھ کر دکھائیں گے۔'), T('00:20', 'Students', 'جی میڈم'),
    T('00:30', 'Teacher', 'لکھیں، اور ڈائری میں مجھے چیک کروائیں'), T('00:40', 'Student', 'جی'), T('00:50', 'Teacher', 'جلدی کریں، وقت کم ہے'),
    T('01:00', 'Student', 'میڈم پنسل'), T('03:30', 'Student', STUDENT), T('03:40', 'Teacher', 'ٹھیک ہے، لکھو')];
  // the model quotes the student line at a stamp the excerpt does not carry: validation:quote, then the fallback path
  const MISQUOTED = answer({ moment: { at: '03:30', quote: `${STUDENT} اور میں سب کو بتاؤں گی` } });

  test('H1 (T1): a test period never gets the card fallback, whatever rule refused the quote', async () => {
    const row = await run(args({ lines: TEST }), deps([MISQUOTED, MISQUOTED, MISQUOTED]));
    expect(row.status).toBe('none');
    expect(row.moment_source || null).not.toBe('card');
  });

  test('control: a lesson that announces a test for later («آخر میں») is a lesson: the fallback stays open', () => {
    const lines = ['[01:00] Teacher: آج ہم ٹیسٹ لیں گے آخر میں، پہلے سبق دہراتے ہیں۔', '[10:00] Teacher: پانی کیوں ضروری ہے؟'];
    expect(SI().testPeriod(lines)).toBe(false);
    expect(SI().notTeaching(lines, 1)).toBe(false);
    expect(SI().testPeriod(TEST.map((l) => `[00:00] ${l.label}: ${l.text}`))).toBe(true);
  });

  // P1: device talk to the observer, no class greeting anywhere; the first child answer comes at 01:43
  const PRE = [T('00:05', 'Teacher', 'جی سر، یہ ایپ کھل گئی ہے۔ ریکارڈنگ چل رہی ہے؟'), T('00:12', 'Speaker 2', 'جی، چل رہی ہے، آپ شروع کریں'),
    T('00:36', 'Teacher', 'دیکھیں نا، ہمارا آج جو ہے پڑھائی ہے۔ ان شاء اللہ ہم بنائیں گے، ٹھیک ہے؟'), T('01:00', 'Speaker 2', 'ٹھیک ہے'),
    T('01:16', 'Teacher', 'یہ دیکھو، کیسی لگی؟ اچھی ہے نا یہ والی؟'), T('01:20', 'Speaker 2', 'اچھی ہے'),
    ...CLASS.map((l) => ({ ...l, start_ms: l.start_ms + 40000 }))];
  const stamped = (ls) => ls.map((l) => `[${String(Math.floor(l.start_ms / 60000)).padStart(2, '0')}:${String((l.start_ms / 1000) % 60).padStart(2, '0')}] ${l.label}: ${l.text}`);

  test('H2 (P1): with no class greeting, a line before the lesson\'s first question, after device talk → before_lesson', () => {
    expect(SI().notTeaching(stamped(PRE), 4)).toBe('before_lesson');
  });
  test('control (P2): the lesson\'s first question itself, and every line after → teaching', () => {
    expect(SI().notTeaching(stamped(PRE), 6)).toBe(false);
    expect(SI().notTeaching(stamped(PRE), 9)).toBe(false);
  });
  test('control: no device talk in the opening → nothing before the first child answer is voided', () => {
    expect(SI().notTeaching(stamped(PRE.slice(2)), 2)).toBe(false);
  });

  test.each([
    ['N5', 'Is it recording? Sir, the app is open now.'],
    ['N6', 'جی سر، یہ ایپ کھل گئی ہے۔ ریکارڈنگ چل رہی ہے؟'],
    ['F5 roll call', 'present miss'],
    ['F5 roll call ur', 'یس میڈم'],
    ['N8', 'Who is absent today? Say present.'],
  ])('%s → routine', (_, line) => expect(SI().routineLine(line)).toBe(true));
  test.each([
    ['N9 «ریکارڈ» as content', 'آج کا درجہ حرارت ریکارڈ کیوں ٹوٹا؟'],
    ['present tense', 'Why do we use the present tense here?'],
  ])('control: %s → not routine', (_, line) => expect(SI().routineLine(line)).toBe(false));

  test('F2 (Q090): a C1 card keeps a non-enacted 37-C8 chapter, as the open-question card does', () => {
    expect(SL().cardTagOk({ seg_id: 'x', fico_main37: ['C8'] }, 'C1', 'fico_main_37')).toBe(true);
    expect(SL().cardTagOk({ seg_id: 'x', fico_main37: ['C5'] }, 'C1', 'fico_main_37')).toBe(false);
  });
});

describe('8 · red7 T4: a test that ends, then a lesson → the lesson is teaching again', () => {
  const lines = ['[00:01] Teacher: آج ٹیسٹ ہے آپ کا، ابھی لکھیں۔', '[00:20] Students: جی میڈم', '[00:50] Teacher: جلدی کریں، وقت کم ہے',
    '[05:30] Teacher: Is water necessary? Yes or no, quickly!', '[05:45] Student: Yes', '[05:50] Teacher: Good. Is air necessary? Yes or no',
    '[05:55] Students: Yes miss', '[06:00] Teacher: Is the sun hot? Yes or no', '[06:05] Student: Yes'];
  test('the test lines are test, the lesson after is not, and the lesson is no test period', () => {
    expect(SI().notTeaching(lines, 2)).toBe('test');
    expect(SI().notTeaching(lines, 3)).toBe(false);
    expect(SI().testPeriod(lines)).toBe(false);
  });
  test('control: a test period with two «did you finish?» exchanges never resumes', () => {
    const t = ['[00:01] Teacher: آج ٹیسٹ ہے آپ کا۔', '[01:00] Teacher: سب نے لکھ لیا؟', '[01:02] Students: جی', '[02:00] Teacher: کس نے نہیں لکھا؟', '[02:02] Student: میں نے', '[03:30] Student: میں اپنے گروپ میں ایکسپلین کرواؤں گی۔'];
    expect(SI().testPeriod(t)).toBe(true);
    expect(SI().notTeaching(t, 5)).toBe('test');
  });
});

describe('9 · Q170 (real shape): answered admin questions minutes apart do not end a test period', () => {
  const lines = ['[00:01] Teacher (UR): السلام علیکم، پیارے بچوں۔ آج ٹیسٹ ہے آپ کا، ابھی لکھ کر دکھائیں گے۔', '[00:52] Student (UR): جو آپ نے ٹک لگایا تھا، وہی؟',
    '[00:54] Teacher (UR): وہ فارم چیک کریں ذرا، سمجھ آئی؟', '[03:30] Student 2 (UR): میں اپنے گروپ میں ایکسپلین کرواؤں گی۔',
    '[03:36] Teacher (UR): یہ نہیں ہے نا؟ وہ میں نے مانگا تھا؟', '[03:43] Student (UR): مجھے وہ—', '[11:38] Teacher (UR): کون سا والا؟ یہاں پہ تو ہے نا؟',
    '[11:48] Student (UR): یس۔', '[12:31] Teacher (UR): کون تیاری کرواتا ہے آپ کو؟', '[12:34] Student (UR): میں تو آج ہی کر لوں گی۔'];
  test('the student line at 03:30 is in the test period, and the lesson is a test period', () => {
    expect(SI().notTeaching(lines, 3)).toBe('test');
    expect(SI().testPeriod(lines)).toBe(true);
  });
});
