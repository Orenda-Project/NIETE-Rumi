'use strict';
/**
 * bd-8hhqhf R7e (COS ruling 20261023T185329, "proven chapters" mode): VIDEO_RECO_ALLOWLIST. Unset = today, byte for
 * byte. Set = a pick off the list is `none` / `allowlist` BEFORE the arm sets status, so the video and the control arm
 * store the same `none` for it (ab-ops' unbiased-index precondition); the second pass and the card fallback never
 * carry an off-list chapter. Fixture and helpers as r7d.test.js.
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
const ENACTED = ['50-s2', '51-s1', '51-s3', '95-s3'];
const ids = (prompt) => [...prompt.matchAll(/^(\d+-s\d+) · /gm)].map((m) => m[1]);
const NONE = { seg_id: null, none_reason: 'nothing fits', confidence: 0.2 };
const PICK51 = answer({
  seg_id: '51-s1', reason_en: 'The class could only answer yes or no. The clip explains how to turn that question into a why question.',
  reason_ur: 'کلاس صرف ہاں یا نہیں میں جواب دے سکی۔ یہ کلپ سمجھاتا ہے کہ اس سوال کو کیوں والے سوال میں کیسے بدلیں۔',
});
const withEnv = (d, env) => ({ ...d, env: { ...d.env, ...env } });
const strip = (row) => { const { engine_ms: _, ...rest } = row; return rest; };

// One teacher in each arm under the pre-registered salt (found, never hard-coded: the salt is arm.js's).
function armUsers() {
  const { assignArm } = require('../../../bot/shared/services/coaching/video-reco/arm');
  const env = { VIDEO_RECO_AB_ENABLED: 'true' };
  const out = {};
  for (let i = 0; !(out.video && out.control); i += 1) {
    const u = `60530046-7ac3-4ea3-a976-${String(i).padStart(12, '0')}`;
    out[assignArm(u, env)] = out[assignArm(u, env)] || u;
  }
  return out;
}
const asUser = (a, uid) => ({ ...a, session: { ...a.session, user_id: uid } });

describe('flag: videoRecoAllowlist', () => {
  const F = () => require('../../../bot/shared/services/coaching/video-reco/flags');
  test.each([[{}], [{ VIDEO_RECO_ALLOWLIST: '' }], [{ VIDEO_RECO_ALLOWLIST: '   ' }]])('%p → null (mode off)', (env) => {
    expect(F().videoRecoAllowlist(env)).toBeNull();
  });
  test('the daily.sql string format: comma-separated seg ids, spaces around commas tolerated', () => {
    expect([...F().videoRecoAllowlist({ VIDEO_RECO_ALLOWLIST: '50-s2, 51-s1 ,51-s3,95-s3' })]).toEqual(ENACTED);
  });
});

describe('unset → the row is exactly today\'s', () => {
  test.each([
    ['a first-call pick', () => [answer()]],
    ['the card fallback', () => [ROMAN, ROMAN]],
    ['the llm_none second pass', () => [NONE, PICK51]],
  ])('%s: unset and blank give the same row', async (_, answers) => {
    const a = await run(args(), deps(answers()));
    const b = await run(args(), withEnv(deps(answers()), { VIDEO_RECO_ALLOWLIST: '' }));
    expect(strip(b)).toEqual(strip(a));
    expect(a.status).toBe('shown');
  });
});

describe('set → an off-list pick is none/allowlist in BOTH arms, before the arm sets status', () => {
  const AB = { VIDEO_RECO_AB_ENABLED: 'true', VIDEO_RECO_ALLOWLIST: ENACTED.join(',') };

  test('control: list unset, A/B on → video shown, control shadow (the leak the list must stop)', async () => {
    const u = armUsers();
    const v = await run(asUser(args(), u.video), withEnv(deps([answer()]), { VIDEO_RECO_AB_ENABLED: 'true' }));
    const c = await run(asUser(args(), u.control), withEnv(deps([answer()]), { VIDEO_RECO_AB_ENABLED: 'true' }));
    expect([v.status, v.seg_id, c.status, c.seg_id]).toEqual(['shown', '10-s1', 'shadow', '10-s1']);
  });

  test('a valid first-call pick off the list (10-s1) → none / allowlist in the video AND the control arm', async () => {
    const u = armUsers();
    for (const uid of [u.video, u.control]) {
      const d = withEnv(deps([answer()]), AB);
      const row = await run(asUser(args(), uid), d);
      expect(row).toMatchObject({ status: 'none', none_reason: 'allowlist', seg_id: null, module_id: null });
      expect(row.reason_en).toBeUndefined();
      expect(d.completeJson).toHaveBeenCalledTimes(1); // no extra call to look for an on-list chapter
    }
  });

  test('VIDEO_RECO_MODE=shadow: the off-list pick is none, never shadow', async () => {
    const row = await run(args(), withEnv(deps([answer()]), { VIDEO_RECO_MODE: 'shadow', VIDEO_RECO_ALLOWLIST: '95-s3' }));
    expect(row).toMatchObject({ status: 'none', none_reason: 'allowlist', seg_id: null });
  });

  test('on the list → the row is the unset row, unchanged', async () => {
    const a = await run(args(), deps([answer()]));
    const b = await run(args(), withEnv(deps([answer()]), { VIDEO_RECO_ALLOWLIST: '10-s1,95-s3' }));
    expect(strip(b)).toEqual(strip(a));
  });
});

describe('the second pass and the card fallback cannot send an off-list chapter', () => {
  test('llm_none second pass: the enacted shortlist offered is only the on-list chapters', async () => {
    // unset, this C1 lesson's second pass offers 51-s1 and 95-s3 (r7d 3b); the list keeps 95-s3 only
    const d = withEnv(deps([NONE, answer({ ...PICK51, seg_id: '95-s3' })]), { VIDEO_RECO_ALLOWLIST: '95-s3' });
    const row = await run(args(), d);
    expect(ids(d.completeJson.mock.calls[1][0])).toEqual(['95-s3']);
    expect(row).toMatchObject({ status: 'shown', seg_id: '95-s3', route: 'enacted' });
  });

  test('llm_none second pass with no on-list enacted chapter → no second call, llm_none stands', async () => {
    const d = withEnv(deps([NONE, PICK51]), { VIDEO_RECO_ALLOWLIST: '10-s1' });
    const row = await run(args(), d);
    expect(d.completeJson).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'none', none_reason: 'llm_none' });
  });

  test('the model names an off-list chapter on the second pass anyway → none / allowlist', async () => {
    const d = withEnv(deps([NONE, PICK51]), { VIDEO_RECO_ALLOWLIST: '95-s3' });
    // the prompt offers 95-s3 only; a model that answers 51-s1 is refused by the shortlist check or the list
    const row = await run(args(), d);
    expect(row.status).toBe('none');
    expect(row.seg_id).toBeNull();
  });

  test('control: the card fallback on 10-s1 is shown when the list is unset', async () => {
    const row = await run(args(), deps([ROMAN, ROMAN]));
    expect(row).toMatchObject({ status: 'shown', moment_source: 'card', seg_id: '10-s1' });
  });

  test('the card fallback on an off-list chapter (10-s1) → none / allowlist, no card sent', async () => {
    const d = withEnv(deps([ROMAN, ROMAN]), { VIDEO_RECO_ALLOWLIST: ENACTED.join(',') });
    const row = await run(args(), d);
    expect(row).toMatchObject({ status: 'none', none_reason: 'allowlist', seg_id: null });
    expect(row.moment_source).toBeUndefined();
  });

  test('the card fallback on an on-list chapter is unchanged', async () => {
    const a = await run(args(), deps([ROMAN, ROMAN]));
    const b = await run(args(), withEnv(deps([ROMAN, ROMAN]), { VIDEO_RECO_ALLOWLIST: '10-s1' }));
    expect(strip(b)).toEqual(strip(a));
  });
});
