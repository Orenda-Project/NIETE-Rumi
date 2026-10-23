'use strict';
/**
 * bd-8hhqhf (VIDREC round 7): the three items red7 held on #3575 (COS 07:05Z, 07:08Z, 07:14Z), red first.
 *  1. A vocabulary word never shields a lexicon name, nor an address slot (topic words reach only the vocabulary
 *     rule); red7's probes are the acceptance tests.
 *  2. The isolate goes around the span of the reason that the validator accepted as the moment, so inner quotes
 *     (d029b87c: «اب "سی" اے ٹی کیا ہوتا ہے؟») stay one run; stored moment_quote is stripped of bidi controls.
 *  3. A card_text pick on a fico_main_37 analysis stores a main-37 id in `indicator` (never a v4 id under a 37 label);
 *     `catalog_indicator` keeps the chapter's v4 tag.
 */
const FIXTURE = require('./fixtures/catalog.fixture.json');

let E;
let S;
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
  C = require('../../../bot/shared/services/coaching/video-reco/copy');
});

function deps(answers, catalogData = FIXTURE) {
  const completeJson = jest.fn();
  answers.forEach((a) => completeJson.mockResolvedValueOnce({ result: a, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }));
  return {
    env: { VIDEO_RECO_ENABLED: 'true' },
    catalog: require('../../../bot/shared/services/coaching/video-reco/catalog').fromData(catalogData),
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
function args({ lines, topic = 'shapes', card = { indicator: 'C1', action: 'Ask two why questions about shapes' }, analysis = {}, nextStep } = {}) {
  return {
    session: {
      id: SID, user_id: UID, transcript_language: 'ur', users: { name: 'Saima Khan', preferred_language: 'ur' },
      diarization_data: { segments: lines || [{ start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' }] },
    },
    analysis: {
      framework: 'fico',
      domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'x', timestamp: '[00:40]' }] } },
      subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
      topic,
      ...analysis,
    },
    nextStep: nextStep === undefined ? { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } } : nextStep,
    loop: { state: { angle: 'show' } },
    card,
    coachingSessionId: SID,
  };
}

describe('1 · a vocabulary word never shields a lexicon name or an address slot (red7 070504 / 070505)', () => {
  const lex = (topic) => S.subjectVocab(topic);
  test.each([
    ['علی، آپ پڑھیں', 'حضرت علی کی سیرت'],
    ['Ali, read the next line', 'Quaid-e-Azam Muhammad Ali Jinnah'],
    ['عمر نے بتایا', 'حضرت عمر فاروق'],
    ['راشد، آپ پڑھیں', 'راشد منہاج شہید'],
  ])('output redactor: "%s" with topic "%s" → the name is masked', (text, topic) => {
    expect(S.postRedact(text, 'Saima Khan', lex(topic))).toContain('[a student]');
  });

  test('a topic word that is not a lexicon name, in an address slot, is still masked (topic words reach only the vocabulary rule)', () => {
    expect(S.postRedact('منہاج، آپ پڑھیں', 'Saima Khan', lex('راشد منہاج شہید'))).toBe('[a student]، آپ پڑھیں');
  });

  test('a subject term in an address slot is still kept (the v13f میگنیٹ case)', () => {
    const t = 'اگلی بار پوچھیں: میگنیٹ، آپ بتائیں یہ کیا کھینچتا ہے؟';
    expect(S.postRedact(t, 'Saima Khan', lex('magnets'))).toBe(t);
  });

  test('engine: a topic naming a person does not let the same name through into the stored reason', async () => {
    const r = {
      seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
      reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why and how instead.',
      reason_ur: 'علی، آپ کی کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں کے سوال پوچھتے ہیں۔', confidence: 0.7,
    };
    const row = await E.recommendForReport({ ...args({ topic: 'حضرت علی کی سیرت' }), deps: deps([r]) });
    expect(row.reason_ur).not.toContain('علی');
  });
});

describe('2 · the isolate goes around the accepted moment span (red7 070727)', () => {
  // d029b87c (gold r7, b226499a95): the retry's stored reason, isolates removed, and its accepted moment quote.
  const QUOTE = 'کسی بھی لیٹر کا ساؤنڈ، جیسے ہم پڑھتے ہیں "اے"۔ "اے" کا ساؤنڈ کیا ہے؟ "بی"۔ "بی"۔ شاباش۔ "سی"؟ "خ"۔ جی، "سی"۔ "خ"۔ اب "سی" اے ٹی کیا ہوتا ہے؟';
  const EN = '[00:03] "اب "سی" اے ٹی کیا ہوتا ہے؟". The clip shows a teacher using a simple peer checklist and modelling a short peer exchange so pairs practice reading, blending and clapping syllables — copy that model and checklist tomorrow.';

  test('d029b87c: one FSI…PDI around «اب "سی" اے ٹی کیا ہوتا ہے؟» (today: split into three runs)', () => {
    expect(C.isolateQuotes(EN, QUOTE)).toBe(`[00:03] "${FSI}اب "سی" اے ٹی کیا ہوتا ہے؟${PDI}". The clip shows a teacher using a simple peer checklist and modelling a short peer exchange so pairs practice reading, blending and clapping syllables — copy that model and checklist tomorrow.`);
  });

  test('no known span, two plain pairs of Latin text → two isolates', () => {
    expect(C.isolateQuotes('The class said "yes" then "no".')).toBe(`The class said "${FSI}yes${PDI}" then "${FSI}no${PDI}".`);
  });

  test('no known span, several pairs around Urdu text → left as written (no guess)', () => {
    expect(C.isolateQuotes(EN)).toBe(EN);
  });

  test('the span isolated, then a separate one-pair suggestion later in the line is isolated too', () => {
    const t = 'At 20:30 "آپ کا ہوم ورک ہے" was said. Tomorrow try: "پارٹنر سے پوچھو".';
    expect(C.isolateQuotes(t, 'آپ کا ہوم ورک ہے... [a student] میں کر کے')).toBe(`At 20:30 "${FSI}آپ کا ہوم ورک ہے${PDI}" was said. Tomorrow try: "${FSI}پارٹنر سے پوچھو${PDI}".`);
  });

  test('engine: the stored reason isolates the accepted span; moment_quote carries no bidi controls', async () => {
    const lines = [{ start_ms: 3000, label: 'Teacher', text: QUOTE }];
    const r = {
      seg_id: '10-s1', moment: { at: '00:03', quote: `${PDI}${QUOTE}` }, reason_en: EN,
      reason_ur: 'استاد نے پوچھا "اب "سی" اے ٹی کیا ہوتا ہے؟"؛ اس کلپ میں جوڑوں کی مشق ہے۔', confidence: 0.6,
    };
    const row = await E.recommendForReport({ ...args({ lines }), deps: deps([r]) });
    expect(row.status).toBe('shown');
    expect(row.reason_en.startsWith(`[00:03] "${FSI}اب "سی" اے ٹی کیا ہوتا ہے؟${PDI}".`)).toBe(true);
    expect(row.reason_ur).toBe(`استاد نے پوچھا "${FSI}اب "سی" اے ٹی کیا ہوتا ہے؟${PDI}"؛ اس کلپ میں جوڑوں کی مشق ہے۔`);
    expect(row.moment_quote).toBe(QUOTE);
  });
});

describe('3 · a card_text pick on a main-37 analysis stores a main-37 id (scale-run 070730, COS 070808)', () => {
  // The fixture's 10-s1: its first v4 tag is the step chapter; give it a main-37 tag that differs.
  const withMain37 = (ids) => ({ ...FIXTURE, modules: FIXTURE.modules.map((m) => ({ ...m, segments: m.segments.map((s) => (s.seg_id === '10-s1' ? { ...s, fico: [{ indicator: 'D1', strength: 2 }, ...(s.fico || [])], fico_main37: ids } : s)) })) });
  const CARD_TEXT = {
    seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the class could only answer yes or no. This clip shows a teacher asking why and how instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7,
  };
  const a37 = { indicator_scheme: 'fico_main_37' };
  const cardText = { action: 'Ask two why questions about shapes and wait for answers' };

  test('chapter v4 D1 + main-37 C1 → indicator C1 (37), catalog_indicator D1 (v4); today both D1', async () => {
    const row = await E.recommendForReport({ ...args({ card: cardText, analysis: a37, nextStep: { target: null } }), deps: deps([CARD_TEXT], withMain37(['C1'])) });
    expect(row).toMatchObject({ status: 'shown', target_source: 'card_text', indicator_scheme: 'fico_main_37', indicator: 'C1', catalog_indicator: 'D1' });
  });

  test('a chapter with no main-37 tag → indicator null, never the v4 id', async () => {
    const row = await E.recommendForReport({ ...args({ card: cardText, analysis: a37, nextStep: { target: null } }), deps: deps([CARD_TEXT], withMain37([])) });
    expect(row.indicator).toBeNull();
    expect(row.catalog_indicator).toBe('D1');
  });

  test('on the v4 scheme the v4 id stays in both columns', async () => {
    const row = await E.recommendForReport({ ...args({ card: cardText, nextStep: { target: null } }), deps: deps([CARD_TEXT], withMain37(['C1'])) });
    expect(row).toMatchObject({ indicator: 'D1', catalog_indicator: 'D1' });
  });
});
