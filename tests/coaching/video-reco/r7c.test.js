'use strict';
/**
 * bd-8hhqhf R7c (COS ruling 20261023T170515; panel ped/REVIEW_r7b_rejudge.md §2–§6): the seven asks before the A/B, each
 * from the panel's Q rows. Names are fictional and outside the name lexicon, as the real ones in Q168/Q174 were.
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

describe('1 · ⛔9 (MUST): a child named inside the card sentence never reaches the fallback message', () => {
  test('Q168 shape: «when a child like X answers» → the comparison goes, the clip stays, the name is in neither line', async () => {
    const action = "Next class, when a child like Zarvesh answers with just 'inside', wait five seconds and ask 'Why do you think the cat is inside the box?'";
    const row = await run(args({ action }), deps([ROMAN, ROMAN]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
    expect(both(row)).not.toMatch(/Zarvesh/);
    expect(row.reason_en).toContain('when a child answers with just');
  });

  test('Q174 shape: «before calling on X Y or another quiet voice» → «before calling on another quiet voice»', async () => {
    const action = "Next class, after modelling the borrowing step, ask 'why does that work?' and wait 8-10 seconds before calling on Zarvesh Kintal or another quiet voice.";
    const row = await run(args({ action }), deps([ROMAN, ROMAN]));
    expect(both(row)).not.toMatch(/Zarvesh|Kintal/);
    expect(row.reason_en).toContain('before calling on another quiet voice');
  });

  test('Q181 shape: a [CHILD] token in an Urdu card («کوئی بچہ [CHILD] کی طرح») is dropped with its comparison', async () => {
    const action = "اگلی کلاس میں جب کوئی بچہ [CHILD] کی طرح صرف ایک لفظ بولے، تو پانچ سیکنڈ رکیں اور 'کیوں؟' پوچھیں۔";
    const row = await run(args({ action, lang: 'ur' }), deps([ROMAN, ROMAN]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card' });
    expect(both(row)).not.toMatch(/\[CHILD\]|\[a student\]/);
    expect(row.reason_ur).toContain('جب کوئی بچہ صرف ایک لفظ بولے');
  });

  test('a name that is not a comparison («Ask X to read aloud») → no fallback, the none stands', async () => {
    const row = await run(args({ action: 'Next class, ask Zarvesh to read the next line aloud and explain why.' }), deps([ROMAN, ROMAN]));
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:roman' });
  });

  test('an Urdu name after a praise cue («شاباش X») → no fallback', () => {
    const cat = C.fromData(DATA);
    const hit = cat.segment('10-s1');
    const out = S.cardFallback({
      none: 'validation:roman', segId: '10-s1', shortlist: { candidates: [{ seg_id: '10-s1' }] }, startS: 30, endS: 120, language: 'ur',
      module: hit.module, subject: null, segment: hit.segment, sentence: 'اگلی کلاس میں شاباش زرویش کہہ کر کیوں والا سوال پوچھیں۔',
    });
    expect(out).toBeNull();
  });

  test('control: a card with no name keeps its fallback unchanged', async () => {
    const row = await run(args(), deps([ROMAN, ROMAN]));
    expect(row.reason_en).toContain('Next class, ask two why questions about shapes and wait five seconds.');
  });
});

describe('2 · degenerate transcript (MUST, Q194): a recogniser loop has no moments', () => {
  const LOOP = `${'how to save water '.repeat(5)}${'awareness drive '.repeat(40)}`.trim();

  test('a transcript that is mostly one looped phrase → none no_moments:degenerate, no LLM call', async () => {
    const d = deps([answer()]);
    const row = await run(args({ lines: [{ start_ms: 1000, label: 'Teacher', text: LOOP }] }), d);
    expect(row).toMatchObject({ status: 'none', none_reason: 'no_moments:degenerate' });
    expect(d.completeJson).not.toHaveBeenCalled();
  });

  test('control: a times-table drill (each line said twice) is a lesson, not a loop', () => {
    const silence = require('../../../bot/shared/services/coaching/video-reco/silence');
    const drill = [];
    for (let n = 1; n <= 10; n++) drill.push(`[00:${String(n).padStart(2, '0')}] Teacher: 3, ${n}, ${3 * n}`, `[00:${String(n).padStart(2, '0')}] Student: 3, ${n}, ${3 * n}`);
    expect(silence.degenerate(drill)).toBe(false);
  });
});

describe('3 · a greeting, page call, order to the room or the lesson announcement is not a moment', () => {
  const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
  const v = (line, quote) => S.validate(answer({ moment: { at: '00:30', quote } }), list, [`[00:30] Teacher: ${line}`, '[00:31] Student: جی۔'], {});

  test.each([
    ['Q031 page call', 'اس کے لیے آپ پیج نمبر 46 اوپن کر دیں۔', 'اس کے لیے آپ پیج نمبر 46 اوپن کر دیں'],
    ['Q061 book call', 'Open your book on page number 35.', 'Open your book on page number 35'],
    ['Q084 greeting', 'السلام علیکم، اسٹوڈنٹس۔ How are you all?', 'السلام علیکم، اسٹوڈنٹس۔ How are you all'],
    ['Q170 order to the room', 'بیٹھ جاؤ، دو منٹ بیٹھ جاؤ۔', 'بیٹھ جاؤ، دو منٹ بیٹھ جاؤ'],
    ['Q063 announcement', 'دیکھیں نا، ہمارا آج جو ہے پڑھائی ہے۔ الفاظ میں نہیں، اور جملے ہیں۔ ان شاء اللہ ہم بنائیں گے، ٹھیک ہے؟', 'ہمارا آج جو ہے پڑھائی ہے۔ الفاظ میں نہیں، اور جملے ہیں۔ ان شاء اللہ ہم بنائیں گے'],
  ])('%s → validation:not_moment', (_, line, quote) => expect(v(line, quote).none).toBe('validation:not_moment'));

  test.each([
    ['a why question', 'آپ کو کیا لگتا ہے پانی کیوں ضروری ہے؟ سوچ کر بتائیں۔', 'آپ کو کیا لگتا ہے پانی کیوں ضروری ہے'],
    ['Q135: a question built like an announcement', 'نمبرز کو۔ گڈ۔ شاباش۔ ہم نے کس چیز کو سرکل کرنا ہے؟', 'ہم نے کس چیز کو سرکل کرنا ہے؟'],
    ['an announcement followed by the real question', 'Today we will learn fractions. Who can tell me why half is bigger than a quarter?', 'Today we will learn fractions. Who can tell me why half is bigger than a quarter'],
  ])('control: %s is a moment', (_, line, quote) => expect(v(line, quote).ok).toBe(true));

  test('engine: both answers cite a page call → silence, never the card fallback (Q063/Q170 → silence, as ruled)', async () => {
    const lines = [{ start_ms: 30000, label: 'Teacher', text: 'Open your book on page number 35.' }, { start_ms: 33000, label: 'Student', text: 'Yes' }];
    const page = answer({ moment: { at: '00:30', quote: 'Open your book on page number 35' } });
    const row = await run(args({ lines }), deps([page, page]));
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:not_moment', attempts: 2 });
  });
  test('a page call with a second fault in the reason (roman) is still silence: a routine line is never rescued by the fallback (Q063)', async () => {
    const lines = [{ start_ms: 30000, label: 'Teacher', text: 'Open your book on page number 35.' }, { start_ms: 33000, label: 'Student', text: 'Yes' }];
    const page = { ...ROMAN, moment: { at: '00:30', quote: 'Open your book on page number 35' } };
    const row = await run(args({ lines }), deps([page, page]));
    expect(row).toMatchObject({ status: 'none', none_reason: 'validation:not_moment' });
  });
});

describe('4 · 51-s1 before 51-s3 for a why/how card on a closed-answer lesson (11 picks, 0 right)', () => {
  const ids = (prompt) => [...prompt.matchAll(/^(\d+-s\d+) · /gm)].map((m) => m[1]);

  test('closed answers + a why card → 51-s3 is not offered; 51-s1 is', async () => {
    const d = deps([answer()]);
    await run(args(), d);
    const offered = ids(d.completeJson.mock.calls[0][0]);
    expect(offered).toContain('51-s1');
    expect(offered).not.toContain('51-s3');
  });

  test('control: children who give reasons → 51-s3 stays on the list', async () => {
    const d = deps([answer({ moment: { at: '00:30', quote: 'Is this a triangle? Tell me how you know it is one' } })]);
    await run(args({ lines: OPEN }), d);
    expect(ids(d.completeJson.mock.calls[0][0])).toContain('51-s3');
  });
});

describe('5 · reason grounding: what the clip IS, and what the cited line IS', () => {
  const list = { candidates: [{ seg_id: '51-s1', indicator: 'C1' }, { seg_id: '10-s1', indicator: 'C1' }] };
  const ex = ['[00:30] Teacher: Why did the ice melt? Think and tell me', '[00:31] Student: Because it is hot'];
  const v = (over) => S.validate(answer({ moment: { at: '00:30', quote: 'Why did the ice melt? Think and tell me' }, ...over }), list, ex, { catalog: C.fromData(DATA) });

  test('a conversation between teachers never "shows a teacher" (en or ur) → validation:scene', () => {
    expect(v({ seg_id: '51-s1' }).none).toBe('validation:scene');
    expect(v({ seg_id: '51-s1', reason_en: 'The class answered in one word. The clip explains how to turn a yes/no question into a why question.' }).none).toBe('validation:scene'); // ur line
  });

  test('the same clip described as an explanation passes; classroom footage may "show a teacher"', () => {
    expect(v({
      seg_id: '51-s1', reason_en: 'The class answered in one word. The clip explains how to turn a yes/no question into a why question.',
      reason_ur: 'کلاس نے ایک لفظ میں جواب دیا؛ یہ کلپ سمجھاتا ہے کہ ہاں یا نہیں والے سوال کو کیوں والے سوال میں کیسے بدلیں۔',
    }).ok).toBe(true);
    expect(v({ seg_id: '10-s1' }).ok).toBe(true);
  });

  test('Q146: the cited line asks why, and the reason calls it recall → validation:recall', () => {
    expect(v({ reason_en: 'The teacher asked a recall question. The clip shows a teacher asking why and how instead.' }).none).toBe('validation:recall');
    expect(v({ reason_ur: 'استاد نے ایک سادہ یادداشت سوال پوچھا؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔' }).none).toBe('validation:recall');
  });

  test('both are fallback rules, and the retry appendix names them', () => {
    const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
    expect(P.retryAppendix('validation:scene')).toMatch(/conversation, a talk, slides or an animation/);
    expect(P.retryAppendix('validation:recall')).toMatch(/asks why or how/);
    expect(P.retryAppendix('validation:not_moment')).toMatch(/page/);
  });

  test('the prompt (vr-9) tells the model what kind each clip is', () => {
    const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
    const text = P.build({ target: { source: 'card_text' }, candidates: [{ seg_id: '51-s1' }, { seg_id: '95-s3' }], catalog: C.fromData(DATA), excerpts: ['[00:30] Teacher: x'] });
    expect(P.PROMPT_VERSION).toBe('vr-9');
    expect(text).toContain('51-s1 · Yes/no question vs. a why question · 52s · ur · kind: a conversation between teachers (not a class) ·');
    expect(text).toContain('95-s3 · Ask why after an answer · 77s · en · kind: footage ·');
    expect(text).toContain('a line that asks why or how is never a recall or yes/no question');
  });
});

describe('6 · Urdu copy: the word table, the card in the other language, one digit system, the trim point', () => {
  const { composeReason } = require('../../../bot/shared/services/coaching/video-reco/copy');

  test.each([
    ['پورے کلاس سے پوچھیں', 'پوری کلاس سے پوچھیں'],
    ['اگلے کلاس میں', 'اگلی کلاس میں'],
    ['بچے جوڑ میں کام کریں', 'بچے جوڑوں میں کام کریں'],
    ['آپ کیوں سوچتے ہیں کہ پانی ضروری ہے؟', 'آپ کے خیال میں پانی ضروری ہے، ایسا کیوں؟'],
    ['یہ یاداشت کا سوال نہیں', 'یہ یادداشت کا سوال نہیں'],
    ['جگہ قدر سمجھائیں', 'مقامی قدر سمجھائیں'],
  ])('«%s» → «%s»', (from, to) => expect(composeReason(from, 'ur', null)).toBe(to));

  test('control: «جوڑ» meaning addition stays («جوڑ کے سوال»)', () => {
    expect(composeReason('جوڑ کے سوال حل کریں', 'ur', null)).toBe('جوڑ کے سوال حل کریں');
  });

  test('one digit system: the frame\'s (Urdu), a number beside Latin words too (R7f 1d, panel v5 §4: 8 rows)', () => {
    const out = composeReason('یہ ۵۵ سیکنڈ کا کلپ ہے؛ wait 5-7 seconds کریں۔', 'ur', null);
    expect(out).not.toMatch(/[0-9]/);
    expect(out).toContain('۵۵ سیکنڈ');
  });

  test('Q097: another script in a reason («факт») → validation:urdu', () => {
    const list = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
    const ex = ['[00:30] Teacher: Is this a triangle? Yes or no, everyone together!', '[00:33] Student: Yes'];
    expect(S.validate(answer({ reason_ur: 'کلاس نے ایک факт یاد کیا؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔' }), list, ex, {}).none).toBe('validation:urdu');
  });

  test('an English reader with an English card: the Urdu line does not carry the English sentence (ur_ok 51.6%)', async () => {
    const row = await run(args({ lang: 'en' }), deps([ROMAN, ROMAN]));
    expect(row.reason_en).toContain('Next class, ask two why questions');
    expect(row.reason_ur).not.toMatch(/[A-Za-z]/);
    expect(row.reason_ur).toContain('آپ کی رپورٹ اگلی کلاس کے لیے ایک قدم بتاتی ہے');
  });

  test('an Urdu reader with an English card still reads it, quoted and isolated, in the Urdu line (the engine passes the language)', async () => {
    const row = await run(args({ lang: 'ur' }), deps([ROMAN, ROMAN]));
    expect(row.reason_ur).toContain(`"${FSI}Next class, ask two why questions`);
  });

  test('Q172: a trimmed sentence keeps its own opening in front of the clause the clip serves', () => {
    const cat = C.fromData(DATA);
    const hit = cat.segment('10-s1');
    const HEAD = 'اگلی کلاس میں، جب کوئی بچہ صرف ایک لفظ کہے، تو بورڈ پر تین تصویریں لگائیں، ہر تصویر کے نیچے دو نئے الفاظ لکھیں، بچوں سے الفاظ دہرائیں، پھر کاپی میں لکھوائیں،';
    const out = S.cardFallback({
      none: 'validation:roman', segId: '10-s1', shortlist: { candidates: [{ seg_id: '10-s1' }] }, startS: 30, endS: 120, language: 'ur',
      module: hit.module, subject: null, segment: hit.segment, sentence: `${HEAD} ${HEAD} اور آخر میں ہر جواب کے بعد why اور how والا سوال پوچھیں۔`,
    });
    expect([...out.reason_ur].length).toBeLessThanOrEqual(300);
    expect(out.reason_ur).toMatch(new RegExp(`"${FSI}اگلی کلاس میں[^"]*… [^"]*why اور how والا سوال پوچھیں`));
  });
});

describe('7 · llm_none: one more call with the four enacted chapters for a C1/D3/C3 card on a closed-answer lesson', () => {
  const NONE = { seg_id: null, none_reason: 'nothing fits', confidence: 0.2 };
  const PICK = answer({
    seg_id: '51-s1',
    reason_en: 'The class could only answer yes or no. The clip explains how to turn that question into a why question.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ یہ کلپ سمجھاتا ہے کہ اس سوال کو کیوں والے سوال میں کیسے بدلیں۔',
  });
  const ids = (prompt) => [...prompt.matchAll(/^(\d+-s\d+) · /gm)].map((m) => m[1]);

  test('Q051/Q026 shape: the first answer is null → a second call lists only the enacted chapters → 51-s1 is shown', async () => {
    const d = deps([NONE, PICK]);
    const row = await run(args(), d);
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    const second = ids(d.completeJson.mock.calls[1][0]);
    expect(second.every((id) => ['50-s2', '51-s1', '51-s3', '95-s3'].includes(id))).toBe(true);
    expect(second).toContain('51-s1');
    expect(second).not.toContain('51-s3'); // §4 holds on the second list too
    expect(row).toMatchObject({ status: 'shown', seg_id: '51-s1', route: 'enacted', attempts: 2, first_none_reason: 'llm_none' });
  });

  test('control: children who give reasons → no second call; llm_none stands', async () => {
    const d = deps([NONE, PICK]);
    const row = await run(args({ lines: OPEN }), d);
    expect(d.completeJson).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'none', none_reason: 'llm_none' });
  });

  test('control: a card on another step (B6) → no second call', async () => {
    const d = deps([NONE, PICK]);
    const lines = [...CLOSED, { start_ms: 48000, label: 'Teacher', text: 'Who has finished? Those who are done take the extra question' }];
    await run(args({ indicator: 'B6', lines }), d);
    // R7f 1a: this catalogue tags no chapter B6, so the gated step-text list is empty and no call is made at all
    expect(d.completeJson.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('red7 HOLD 174103 on 6c7c480f8b (H1–H6) and notes N2/N4/N5', () => {
  const cat = () => C.fromData(DATA);
  const fb = (sentence, language = 'en') => {
    const hit = cat().segment('10-s1');
    return S.cardFallback({
      none: 'validation:roman', segId: '10-s1', shortlist: { candidates: [{ seg_id: '10-s1' }] }, startS: 30, endS: 120, language,
      module: hit.module, subject: null, segment: hit.segment, sentence, teacherName: 'Saima Khan',
    });
  };

  test.each([
    ['A20 after the capitalised opener', 'Ask Pervaize why the ice floats before telling the class.'],
    ['A14 glued to ’s', "Ask Zunaira's group why the sum changed."],
    ['A22 after a closing quote', 'Say "why?" Pervaize should answer first, then the class.'],
    ['A21 after a digit', 'Give 2 Pervaize-style why questions to the class.'],
  ])('H1 %s: a Latin child name is never shown', (_, sentence) => {
    const out = fb(sentence);
    expect(out === null || !/Pervaize|Zunaira/.test(`${out.reason_en} ${out.reason_ur}`)).toBe(true);
  });

  test.each([
    ['A29 after بیٹا', 'کل بیٹا تبسم سے پوچھیں کہ یہ کیوں ہوا'],
    ['A23 before کی طرح', 'کوئی بچہ تبسم کی طرح ایک لفظ میں جواب دے تو کیوں پوچھیں'],
  ])('H2 %s: an Urdu name that is also a word («تبسم») is never shown', (_, sentence) => {
    const out = fb(sentence, 'ur');
    expect(out === null || !/تبسم/.test(`${out.reason_en} ${out.reason_ur}`)).toBe(true);
  });

  test('controls: Title-case terms and an Urdu verb after «بچہ» keep the fallback (N1)', () => {
    expect(fb('Next class, use Student-to-Student Interaction and the Use of Technology: ask why after each answer.')).not.toBeNull();
    expect(fb('اگلی کلاس میں جو بچہ اٹک جائے اس کی مدد کریں اور کیوں پوچھیں۔', 'ur')).not.toBeNull();
  });

  const silence = () => require('../../../bot/shared/services/coaching/video-reco/silence');
  const stamp = (texts) => texts.map((t, i) => `[00:${String(i).padStart(2, '0')}] Teacher: ${t}`);

  test('H3: a looped line of 9 or 11 words is a loop', () => {
    expect(silence().degenerate(stamp([...Array(10).fill('how can we save water at home and at school'), '…', '[inaudible]', '…', '…']))).toBe(true);
    expect(silence().degenerate(stamp(Array(10).fill('we will now read the lesson about saving water in our homes')))).toBe(true);
  });

  test('H4: a transcript of placeholder lines under 20 words has no moments (engine: no LLM call)', async () => {
    expect(silence().degenerate(stamp(['…', '[inaudible]', '…', '—', '[inaudible]']))).toBe(true);
    const lines = ['…', '[inaudible]', '…', '—', '[inaudible]'].map((text, i) => ({ start_ms: 1000 * (i + 1), label: 'Teacher', text }));
    const d = deps([answer(), answer()]);
    const row = await run(args({ lines }), d);
    expect(row).toMatchObject({ status: 'none', none_reason: 'no_moments:degenerate' });
    expect(d.completeJson).not.toHaveBeenCalled();
  });

  test.each([
    ['C6', 'page 46, question 3: why does the sun rise in the east?'],
    ['C9', 'صفحہ ۱۲ کھولیں، بتاؤ تصویر میں کیا ہے؟'],
  ])('H5 %s: a page call that asks a question in the same sentence is a moment', (_, q) => {
    expect(silence().routineLine(q)).toBe(false);
  });

  test('H6: the second pass keeps the module no-repeat (module 51 already sent → 51-s1 is not offered first)', async () => {
    const NONE = { seg_id: null, none_reason: 'nothing fits', confidence: 0.2 };
    const d = deps([NONE, answer({ seg_id: '95-s3' })]);
    d.store.recentHistory = jest.fn().mockResolvedValue({ segments: ['51-s2'], modules: [51] });
    await run(args({ lang: 'en' }), d);
    expect(d.completeJson).toHaveBeenCalledTimes(2);
    const second = [...d.completeJson.mock.calls[1][0].matchAll(/^(\d+-s\d+) · /gm)].map((m) => m[1]);
    expect(second.some((id) => id.startsWith('51-'))).toBe(false);
  });

  test('N2: 51-s1 already sent → 51-s3 is not offered either', () => {
    const sl = require('../../../bot/shared/services/coaching/video-reco/shortlist');
    const out = sl.whyFirst([{ seg_id: '51-s3' }, { seg_id: '10-s1' }], cat(), { apply: true, history: { segments: ['51-s1'], modules: [] } });
    expect(out.map((c) => c.seg_id)).toEqual(['10-s1']);
  });

  test('N4: a quoted transcript span keeps its own words and digits; N5: «کیوں» keeps the clause order', () => {
    const { composeReason } = require('../../../bot/shared/services/coaching/video-reco/copy');
    // the transcript's moment is the span the validator accepted (red7 H7: only it, and the card isolate, are skipped)
    const out = composeReason('استاد نے کہا "طبقے میں ۱۲ بچے ہیں" اور پورے کلاس سے پوچھا؛ یہ 52 سیکنڈ کا کلپ ہے۔', 'ur', 'طبقے میں ۱۲ بچے ہیں');
    expect(out).toContain('طبقے میں ۱۲ بچے ہیں');
    expect(out).toContain('پوری کلاس');
    expect(composeReason('آپ کیوں سوچتے ہیں کہ پانی ضروری ہے؟', 'ur', null)).toBe('آپ کے خیال میں پانی ضروری ہے، ایسا کیوں؟');
  });
});

describe('red7 HOLD 175620 on 4a67ce8fb2 (H7): the word table reaches the model\'s own quoted suggestion', () => {
  const { composeReason } = require('../../../bot/shared/services/coaching/video-reco/copy');

  test('a quoted suggestion carrying the calque is rewritten (Q082/Q149/Q200 shape)', () => {
    const out = composeReason('کلاس نے ایک لفظ کہا؛ کل پوچھیں "آپ کیوں سوچتے ہیں کہ پانی ضروری ہے؟" اور سنیں۔', 'ur', 'بچو یہ سوال کس نے حل کیا ہے');
    expect(out).toContain('آپ کے خیال میں پانی ضروری ہے، ایسا کیوں؟');
    expect(out).not.toContain('آپ کیوں سوچتے ہیں');
  });

  test('the transcript\'s moment keeps its words and digits; the card isolate keeps the card\'s words', () => {
    const moment = 'طبقے میں ۱۲ بچے جوڑ میں بیٹھے ہیں';
    const out = composeReason(`استاد نے کہا "${moment}" تو پورے کلاس خاموش رہی؛ یہ 52 سیکنڈ کا کلپ ہے۔`, 'ur', moment);
    expect(out).toContain(moment);
    expect(out).toContain('پوری کلاس');
    const card = composeReason('آپ کی رپورٹ کہتی ہے کہ یہ آزمائیں: "⁨جوڑ میں کام کرائیں⁩"۔ یہ 52 سیکنڈ کا کلپ ہے۔', 'ur', null);
    expect(card).toContain('⁨جوڑ میں کام کرائیں⁩');
  });
});
