'use strict';
/**
 * bd-gzfdu9 — SPEC §3.4 [v1.3c-3] (COS 20:57Z, lead-review 20:57Z): prompt vr-5. When the report language differs
 * from the lesson's, rule 2 says the reason paraphrases the moment in the report language and quotes at most 6
 * words verbatim; moment.quote stays the verbatim transcript line (for /v and validation). Same-language prompts are
 * byte-identical to vr-4. Validation is unchanged.
 */
const crypto = require('crypto');
const FIXTURE = require('./fixtures/catalog.fixture.json');

const P = require('../../../bot/shared/services/coaching/video-reco/prompt');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');

const cat = C.fromData(FIXTURE);
const base = {
  target: { indicator: 'C1', source: 'step', row: { id: 'C1', name: 'Quality Questioning', score: 1, timestamp: '[03:10]' } },
  rationale: 'Few open questions', tryText: 'Ask two why questions', subject: 'urdu',
  excerpts: ['[00:30] Teacher: tum batao: is this a triangle?'], candidates: [{ seg_id: '10-s1' }], catalog: cat,
  scorerQuote: 'Is this a triangle? Yes or no',
};
// sha256 of P.build(base) at vr-4 (cbcd4c39e4), taken before this change.
const VR4_SHA = '846c8f5e8f487e260b3629a36f2b03a5862e11e2fd72960aa26364c2f1033968';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

describe('prompt vr-5: the cross-language paraphrase rule', () => {
  test('PROMPT_VERSION is vr-5', () => expect(P.PROMPT_VERSION).toBe('vr-5'));

  test('en report + ur lesson: reason_en paraphrases the moment in English and quotes at most 6 words; moment.quote stays verbatim', () => {
    const text = P.build({ ...base, reportLanguage: 'en', lessonLanguage: 'ur' });
    expect(text).toMatch(/lesson is in Urdu and the teacher reads the reason in English/);
    expect(text).toMatch(/in reason_en, paraphrase the moment in English and quote at most 6 words of the lesson word for word/);
    expect(text).toMatch(/"moment"\."quote" stays the line copied word for word from the TRANSCRIPT MOMENTS/);
  });

  test('ur report + en lesson: the rule names reason_ur and Urdu', () => {
    const text = P.build({ ...base, reportLanguage: 'ur', lessonLanguage: 'en' });
    expect(text).toMatch(/lesson is in English and the teacher reads the reason in Urdu/);
    expect(text).toMatch(/in reason_ur, paraphrase the moment in Urdu and quote at most 6 words/);
  });

  test.each([
    ['ur/ur', { reportLanguage: 'ur', lessonLanguage: 'ur' }],
    ['en/en', { reportLanguage: 'en', lessonLanguage: 'en' }],
    ['unknown lesson language', { reportLanguage: 'en', lessonLanguage: null }],
    ['no languages passed', {}],
  ])('%s: the prompt is byte-identical to vr-4', (_, langs) => {
    expect(sha(P.build({ ...base, ...langs }))).toBe(VR4_SHA);
  });
});

describe('engine: the prompt gets the report and lesson languages', () => {
  const SID = '0b6f3c7e-2a41-4d8e-9a55-3f1c2d4e5f60';
  const UID = '60530046-7ac3-4ea3-a976-b43c37c23213';
  let E;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase in these tests'); }) }));
    jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
    E = require('../../../bot/shared/services/coaching/video-reco/engine');
  });
  function args(pref, transcript = 'ur') {
    return {
      session: {
        id: SID, user_id: UID, transcript_language: transcript, users: { name: 'Saima Khan', preferred_language: pref },
        diarization_data: { segments: [
          { start_ms: 30000, label: 'Teacher', text: 'Ahmed, tum batao: is this a triangle? Yes or no, quickly!' },
          { start_ms: 45000, label: 'Student', text: 'Yes' },
        ] },
      },
      analysis: {
        framework: 'fico',
        domains: { C: { indicators: [
          { id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed questions. Quote: "Is this a triangle? Yes or no"', evidence_summary: 'Only yes/no questions', timestamp: '[00:40]' },
        ] } },
        subject_resolution: { code: 'urdu', grade: '3', confidence: 'high' },
        topic: 'shapes',
      },
      nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'Few open questions', try: 'Ask two why questions' } },
      loop: { state: { angle: 'show' } },
      card: { indicator: 'C1', action: 'Ask two why questions about shapes' },
      coachingSessionId: SID,
    };
  }
  const PARAPHRASED = {
    seg_id: '10-s1', moment: { at: '00:30', quote: '[a student], tum batao: is this a triangle? Yes or no' },
    reason_en: 'At 00:30 the teacher asked the class whether the shape was a triangle, "yes or no". This clip shows a teacher asking why instead.',
    reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی؛ اس کلپ میں استاد کیوں اور کیسے کے سوال پوچھتے ہیں۔', confidence: 0.7,
  };
  function deps() {
    const written = [];
    return {
      written,
      env: { VIDEO_RECO_ENABLED: 'true' },
      catalog: C.fromData(FIXTURE),
      store: {
        readForSession: jest.fn().mockResolvedValue(null),
        recentHistory: jest.fn().mockResolvedValue({ segments: [], modules: [] }),
        ladderProgress: jest.fn().mockResolvedValue({ level: 2, completedModules: [] }),
        trainingBands: jest.fn().mockResolvedValue([]),
        write: jest.fn(async (row) => { written.push(row); return { id: 'rec-1', ...row }; }),
      },
      v10GroupFor: jest.fn().mockResolvedValue({ group: 'C' }),
      completeJson: jest.fn().mockResolvedValue({ result: PARAPHRASED, usage: { prompt_tokens: 900, completion_tokens: 100 }, finishReason: 'stop' }),
    };
  }
  const RULE = /paraphrase the moment in/;

  test('preferred en + Urdu lesson: the prompt carries the rule for reason_en; the paraphrased answer is shown, quote verbatim', async () => {
    const d = deps();
    const row = await E.recommendForReport({ ...args('en'), deps: d });
    expect(d.completeJson.mock.calls[0][0]).toMatch(/in reason_en, paraphrase the moment in English/);
    expect(row).toMatchObject({ status: 'shown', seg_id: '10-s1', prompt_version: 'vr-5', moment_source: 'transcript' });
    expect(row.moment_quote).toBe(PARAPHRASED.moment.quote);
    expect(row.reason_en).toBe(PARAPHRASED.reason_en.replace('"yes or no"', '"\u2068yes or no\u2069"')); // bd-8hhqhf: the quote is isolated
  });

  test('preferred ur + Urdu lesson: no rule', async () => {
    const d = deps();
    await E.recommendForReport({ ...args('ur'), deps: d });
    expect(d.completeJson.mock.calls[0][0]).not.toMatch(RULE);
  });

  test('no stored language (copy in the lesson language): no rule', async () => {
    const d = deps();
    await E.recommendForReport({ ...args(null), deps: d });
    expect(d.completeJson.mock.calls[0][0]).not.toMatch(RULE);
  });

  test('preferred en + an unknown lesson language: no rule (a difference we cannot see is not asserted)', async () => {
    const d = deps();
    await E.recommendForReport({ ...args('en', 'hindi'), deps: d });
    expect(d.completeJson.mock.calls[0][0]).not.toMatch(RULE);
  });
});
