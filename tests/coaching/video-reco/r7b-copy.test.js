'use strict';
/**
 * bd-8hhqhf R7b (COS ruling 20261023T144730 2b; panel ped/REVIEW_r7_scale.md §2–§4; red7 145611): the message as the
 * teacher reads it. Names are fictional; «زرفشاں گلریز» is outside the name lexicon, as P165's real name was.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');
const S = require('../../../bot/shared/services/coaching/video-reco/select');
const { composeReason } = require('../../../bot/shared/services/coaching/video-reco/copy');
const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(FIXTURE);
const SL = { candidates: [{ seg_id: '10-s1', indicator: 'C1' }] };
const SEG = cat.segment('10-s1');
const BODY = "'Do you understand?' پوچھنے کے بجائے یہ پوچھیں: 'Can you explain WHY this works in your own words?'";
const fb = (sentence, extra = {}) => S.cardFallback({
  none: 'validation:quote', segId: '10-s1', shortlist: SL, sentence, startS: SEG.segment.start_s, endS: SEG.segment.end_s,
  language: 'ur', teacherName: 'Saima Khan', module: SEG.module, subject: null, segment: SEG.segment, ...extra,
});
const shown = (r) => [r.reason_en, r.reason_ur].join(' ');

describe('P165 ⛔9: the card\'s vocative is dropped by its shape, whatever users.name says', () => {
  test.each([
    ['two Urdu-script words (P165)', 'زرفشاں گلریز، '],
    ['three words with a title (V9)', 'سیدہ زرفشاں گلریز، '],
    ['one word and an honorific', 'زرفشاں بی بی، '],
    ['inside a bidi isolate (V10)', '⁨زرفشاں گلریز⁩، '],
    ['a Latin spelling unlike users.name (V3)', 'Sayma, '],
  ])('%s → the clip is shown and no word of the name is in either reason', (_, voc) => {
    const r = fb(voc + BODY);
    expect(r).not.toBeNull();
    for (const w of ['زرفشاں', 'گلریز', 'سیدہ', 'Sayma', 'بی بی']) expect(shown(r)).not.toContain(w);
    expect(r.reason_ur).toContain("'Do you understand?'");
  });

  test('a clause opener is not a name: «اگلی کلاس میں،» stays', () => {
    expect(fb(`اگلی کلاس میں، ${BODY}`).reason_ur).toContain('اگلی کلاس میں،');
  });

  test('no vocative → the fallback is unchanged (control)', () => {
    expect(fb(BODY).reason_ur).toContain(BODY.replace(/'/g, "'"));
  });

  test('N1/N3: an LLM reason quoting the card with its vocative → validation:name, users.name Latin or a role word', () => {
    const EX = ['[03:10] Teacher: آج ہم نے صفحہ بارہ کھولا اور سب نے مل کر پڑھا', '[03:12] Student: جی، پڑھا۔'];
    const p = (voc) => ({
      seg_id: '10-s1', moment: { at: '03:10', quote: 'آج ہم نے صفحہ بارہ کھولا اور سب نے مل کر پڑھا' }, confidence: 0.8,
      reason_en: `Your lesson moment fits this step: "⁨${voc}${BODY}⁩". The clip shows a teacher asking why and how instead.`,
      reason_ur: `سبق کا یہ لمحہ اس قدم سے ملتا ہے: "⁨${voc}${BODY}⁩"۔ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔`,
    });
    for (const name of ['Saima Khan', 'Teacher']) {
      expect(S.validate(p('زرفشاں گلریز، '), SL, EX, { teacherName: name, source: 'card_text', catalog: cat }).none).toBe('validation:name');
      expect(S.validate(p(''), SL, EX, { teacherName: name, source: 'card_text', catalog: cat }).ok).toBe(true);
    }
  });

  test('P109: a Latin card that opened with the name starts with a capital after the strip', () => {
    expect(fb('Sayma, try asking why after each answer.').reason_en).toContain('"⁨Try asking why');
  });
});

describe('the validator: gendered Urdu, system notes, claims the clip cannot back', () => {
  const EX = ['[00:30] Teacher: is this a triangle? Yes or no, quickly!', '[00:31] Student: جی۔'];
  const ok = {
    seg_id: '10-s1', moment: { at: '00:30', quote: 'is this a triangle? Yes or no' }, confidence: 0.6,
    reason_en: 'The class could only answer yes or no. The clip shows a teacher turning yes/no questions into why and how questions.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔',
  };
  const v = (x) => S.validate({ ...ok, ...x }, SL, EX, { stepIndicator: 'C1', indicators: ['C1'], source: 'step', catalog: cat });

  test('the respectful plural passes', () => expect(v({}).ok).toBe(true));
  test.each([
    ['masculine singular of the clip\'s teacher', 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ یہ کلپ دکھاتا ہے کہ استاد سوال کو کیوں والے سوال میں بدل دیتا ہے۔'],
    ['feminine of the reader\'s teacher', 'ٹیچر کہتی ہیں کہ کیا یہ مثلث ہے؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔'],
    ['a feminine noun for the teacher', 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں معلمہ کیوں اور کیسے کے سوال پوچھتے ہیں۔'],
    ['آپ with a feminine plural verb', 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ آپ کل کیوں والا سوال پوچھ سکتی ہیں۔'],
  ])('%s → validation:gender', (_, reason_ur) => expect(v({ reason_ur }).none).toBe('validation:gender'));
  test('a clip or a report is not a person: «یہ کلپ دکھاتا ہے», «آپ کی رپورٹ کہتی ہے» pass', () => {
    expect(v({ reason_ur: 'آپ کی رپورٹ کہتی ہے کہ کلاس نے ہاں یا نہیں کہا؛ یہ کلپ دکھاتا ہے کہ استاد کیوں کے سوال پوچھتے ہیں۔' }).ok).toBe(true);
  });

  test('P005: a system note in the teacher line → validation:scorer', () => {
    expect(v({ reason_en: 'No student activity recorded in this part. The clip shows a teacher turning yes/no questions into why questions.' }).none).toBe('validation:scorer');
    expect(v({ reason_en: 'The class answered yes or no (no material use referenced). The clip shows a teacher turning yes/no questions into why questions.' }).none).toBe('validation:scorer');
  });

  test('a claim the chapter cannot back (wait time, cold-call, pairs) → validation:unshown; the clip\'s own move passes', () => {
    expect(v({ reason_en: 'The class answered yes or no. The clip shows a teacher waiting five seconds and then cold-calling a student.' }).none).toBe('validation:unshown');
    expect(v({ reason_en: 'The class answered yes or no. The clip shows the teacher putting children in pairs to discuss.' }).none).toBe('validation:unshown');
    expect(v({ reason_en: 'The class answered yes or no. The clip shows a teacher asking why and how; tomorrow you could say "wait, think, then tell your partner".' }).ok).toBe(true);
  });

  test('the retry appendix names both new rules; the prompt is vr-7 and carries both', () => {
    expect(P.retryAppendix('validation:gender')).toMatch(/plural/);
    expect(P.retryAppendix('validation:unshown')).toMatch(/clip/);
    expect(P.PROMPT_VERSION).toBe('vr-8');
    const text = P.build({ target: { source: 'card_text' }, candidates: [], catalog: cat, excerpts: ['[00:30] Teacher: x'] });
    expect(text).toContain('کرتے ہیں');
    expect(text).toMatch(/only what the clip's own line says it shows/);
  });
});

describe('the card fallback: trimmed at a clause, keeping the clause the clip serves; no label text; one quote style', () => {
  // P033 shape: the clip (10-s1: why and how questions) serves the card's LAST clause; the head is about something else.
  const HEAD = 'اگلی کلاس میں جب کوئی بچہ صرف ایک لفظ کہے تو پہلے بورڈ پر تین تصویریں لگائیں، ہر تصویر کے نیچے دو نئے الفاظ لکھیں، بچوں سے الفاظ دہرائیں، پھر کاپی میں لکھوائیں،';
  const LONG = `${HEAD} ${HEAD} اور آخر میں ہر جواب کے بعد why اور how والا سوال پوچھیں۔`;

  test('P033/P037/P040: the clause the clip serves survives the trim, cut at a clause boundary, ≤ 300 code points', () => {
    const r = fb(LONG);
    expect(r).not.toBeNull();
    for (const x of [r.reason_en, r.reason_ur]) {
      expect([...x].length).toBeLessThanOrEqual(300);
      expect(x).toContain('why اور how والا سوال پوچھیں');
    }
    expect(r.reason_ur).toMatch(/"⁨…/);
  });

  test('a card sentence that quotes an indicator label is not a fallback (P036, P042, P046)', () => {
    expect(fb("اگلی کلاس میں 'Subject-Specific Pedagogy: SCIENCE' کے لیے پانچ منٹ مخصوص کریں۔")).toBeNull();
    expect(fb('Dedicate 5 minutes of your next class to improving "Meaningful & Real-World Connections".')).toBeNull();
  });

  test('P109/P154: a card with its own double quotes is not nested inside the template\'s quotes', () => {
    const r = fb('Instead of asking "Do you understand?", try: "Can you explain WHY this works in your own words?"');
    const inner = r.reason_en.slice(r.reason_en.indexOf('⁨') + 1, r.reason_en.indexOf('⁩'));
    expect(inner).not.toMatch(/["“”]/);
    expect(inner).toContain('‘Do you understand?’');
  });
});

describe('composition: one digit system per message, Latin runs isolated in Urdu, no CJK stop', () => {
  test('ur: Western digits in Urdu prose become Urdu digits; a number inside a Latin run stays as it is', () => {
    const out = composeReason('یہ 55 سیکنڈ کا کلپ ہے؛ کل 5-7 سیکنڈ انتظار کریں اور 4 digit addition کی مثال دیں۔', 'ur', null);
    expect(out).toContain('۵۵ سیکنڈ');
    expect(out).toContain('۵-۷ سیکنڈ');
    expect(out).toContain('\u20664 digit addition\u2069');
  });
  test('ur: an English term inside the Urdu line is set in its own LTR isolate (translate-or-isolate)', () => {
    expect(composeReason('اس کلپ میں استاد wait time دیتے ہیں۔', 'ur', null)).toContain('⁦wait time⁩');
  });
  test('en: Urdu digits outside the quoted moment become Western digits; the quote stays verbatim', () => {
    const out = composeReason('This ۵۵-second clip shows it. The class said "۹ ہم نے گنے" together.', 'en', '۹ ہم نے گنے');
    expect(out).toContain('This 55-second clip');
    expect(out).toContain('۹ ہم نے گنے');
  });
  test('P027/P140: a CJK full stop becomes the line\'s own stop', () => {
    expect(composeReason('The class answered in one word。 The clip shows why questions.', 'en', null)).not.toContain('。');
    expect(composeReason('کلاس نے ایک لفظ کہا。 کلپ میں کیوں کے سوال ہیں۔', 'ur', null)).not.toContain('。');
  });
});

// ── red7 REVIEW_3630 F1–F4 (bin/attack_r7b_copy.js cases) ──────────────────────────────────────────────────────────────
describe('red7 REVIEW_3630', () => {
  const R = require('../../../bot/shared/services/coaching/video-reco/copy-rules');
  test('F1: a name with one dictionary word and one strict-masked word is still a vocative; a clause opener is not', () => {
    const one = 'زرفشاں جہاں، ';
    expect(R.leadingVocative(`${one}${BODY}`)).toBe([...one].length);
    for (const opener of ['اگلی کلاس میں، ', 'کل کلاس میں، ', 'ہر جواب کے بعد، ', 'Dear teacher, ']) expect(R.leadingVocative(`${opener}${BODY}`)).toBe(0);
  });
  test('F1 stays on the card\'s own opening: in a reason, a capitalised English run after a quote is not a name', () => {
    expect(R.quotedVocative('"⁨[a student]، آپ بتائیں⁩" The clip shows a Why-style question (example, then pairs).')).toBe(false);
  });
  test('F2: «استاد صاحب،» (role + honorific) is an address, not a name in a quote', () => {
    expect(R.quotedVocative(`try: "⁨استاد صاحب، ${BODY}⁩"`)).toBe(false);
  });
  // F3 (keywords carry transcript words) is NOT changed: without them 805 of 2,200 first answers are refused, not 343.
  test('F4: an adjective predicate of a teacher (G12) and «no hands up was observed» (S4)', () => {
    expect(R.genderedUrdu('استاد کلاس میں کھڑی ہیں')).toBe(true);
    expect(R.genderedUrdu('استاد کلاس میں کھڑے ہیں')).toBe(false);
    expect(R.systemNote('At 03:10 no hands up was observed, so you asked again')).toBe(true);
  });
});

// ── red7 155809 (HOLD #3632): the same shape on the reason path, and the model never sees the vocative ──────────────────
describe('red7 155809', () => {
  const EX = ['[03:10] Teacher: آج ہم نے صفحہ بارہ کھولا اور سب نے مل کر پڑھا', '[03:12] Student: جی، پڑھا۔'];
  const p = (opening) => ({
    seg_id: '10-s1', moment: { at: '03:10', quote: 'آج ہم نے صفحہ بارہ کھولا اور سب نے مل کر پڑھا' }, confidence: 0.8,
    reason_en: `Your lesson moment fits this step: "${opening}${BODY}". The clip shows a teacher asking why and how instead.`,
    reason_ur: `سبق کا یہ لمحہ اس قدم سے ملتا ہے: "${opening}${BODY}"۔ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔`,
  });
  test('N1 with a name of one masked and one dictionary word → validation:name', () => {
    expect(S.validate(p('زرفشاں جہاں، '), SL, EX, { teacherName: 'Saima Khan', source: 'card_text', catalog: cat }).none).toBe('validation:name');
  });
  test('a classroom line opening «اچھا جی،» / «ہاں جی،» is a moment, not a name', () => {
    for (const o of ['اچھا جی، ', 'ہاں جی، ', 'تو جی، ']) expect(S.validate(p(o), SL, EX, { teacherName: 'Saima Khan', source: 'card_text', catalog: cat }).ok).toBe(true);
  });
  test('the prompt\'s "Try this tomorrow" never carries the card\'s vocative', async () => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    const E = require('../../../bot/shared/services/coaching/video-reco/engine');
    const completeJson = jest.fn().mockResolvedValue({ result: { seg_id: null, none_reason: 'x' }, usage: {}, finishReason: 'stop' });
    await E.recommendForReport({
      session: { id: 's', user_id: 'u', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
        diarization_data: { segments: [{ start_ms: 40000, label: 'Teacher', text: 'یہ لفظ کون پڑھے گا؟' }, { start_ms: 41000, label: 'Student', text: 'میں پڑھوں گا۔' }] } },
      analysis: { framework: 'fico', subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' } },
      nextStep: { target: null }, card: { action: `زرفشاں جہاں، ${BODY}` }, coachingSessionId: 's',
      deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog: cat, completeJson, v10GroupFor: async () => null,
        store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r } },
    });
    const prompt = completeJson.mock.calls[0][0];
    expect(prompt).toContain("Try this tomorrow: 'Do you understand?'");
    expect(prompt).not.toMatch(/جہاں|زرفشاں/);
  });
});

// ── scale-run 161526: the label refusal took right picks (P003, P015, P051, P056, P062: «Student-to-Student
// Interaction», «Student Agency & Voice» cards). Only the labels the panel named are refused (P036/42/46, P135/178).
test('a card quoting an ordinary indicator name keeps its fallback in the engine; the subject-pedagogy label does not', async () => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  const E = require('../../../bot/shared/services/coaching/video-reco/engine');
  const data = JSON.parse(JSON.stringify(FIXTURE));
  data.indicator_aliases.D3 = { exact: 'D3', approx: [], name: 'Student-to-Student Interaction' };
  const catalog = C.fromData(data);
  const bad = { seg_id: '10-s1', moment: { at: '00:40', quote: 'a line that is nowhere in the lesson' }, reason_en: 'x'.repeat(30), reason_ur: 'ی'.repeat(30), confidence: 0.5 };
  const run = async (action) => E.recommendForReport({
    session: { id: 's', user_id: 'u', transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: [{ start_ms: 40000, label: 'Teacher', text: 'یہ لفظ کون پڑھے گا؟' }, { start_ms: 41000, label: 'Student', text: 'میں پڑھوں گا۔' }] } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Q', score: 1, applicable: true, evidence: 'x', timestamp: '[00:40]' }] } }, subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'r', try: '' } }, card: { indicator: 'C1', action }, coachingSessionId: 's',
    deps: { env: { VIDEO_RECO_ENABLED: 'true' }, catalog, v10GroupFor: async () => null,
      completeJson: jest.fn().mockResolvedValue({ result: bad, usage: {}, finishReason: 'stop' }),
      store: { readForSession: async () => null, recentHistory: async () => ({ segments: [], modules: [] }), ladderProgress: async () => ({ level: 2, completedModules: [] }), trainingBands: async () => [], write: async (r) => r } },
  });
  expect(await run('اگلی کلاس کے پانچ منٹ Student-to-Student Interaction بہتر کرنے کے لیے دو کیوں والے سوال پوچھیں۔')).toMatchObject({ status: 'shown', moment_source: 'card' });
  expect(await run("اگلی کلاس میں 'Subject-Specific Pedagogy: MATH' کے لیے دو کیوں والے سوال پوچھیں۔")).toMatchObject({ status: 'none' });
});

// ── red7 161951: «‹name› جی،» is a vocative; «اچھا جی، / ہاں جی، / تو جی،» are not ──────────────────────────────────────
test('red7 161951: «جی» is an honorific after a name and nothing after an interjection', () => {
  const R = require('../../../bot/shared/services/coaching/video-reco/copy-rules');
  for (const v of ['زرفشاں جی، ', 'زرفشاں گلریز جی، ']) {
    expect(R.leadingVocative(`${v}${BODY}`)).toBe([...v].length);
    expect(R.quotedVocative(`try: "⁨${v}${BODY}⁩"`)).toBe(true);
  }
  for (const v of ['اچھا جی، ', 'ہاں جی، ', 'تو جی، ', 'پڑھیں جی، ', 'اچھا بیٹا جی، ']) {
    expect(R.leadingVocative(`${v}${BODY}`)).toBe(0);
    expect(R.quotedVocative(`try: "⁨${v}${BODY}⁩"`)).toBe(false);
  }
});
