'use strict';
/**
 * bd-tp4w7n.1 R9 (COS 20261119T115204 §R9.3; the operator, 19 Nov: "it should focus on videos that are demonstrating how
 * the teacher might execute the topic area and must be aligned with what the report is asking them to do").
 * VIDEO_RECO_ALIGNED=true: only demonstration / modelled chapters whose shown move AND sub-ask match the card's ask; the
 * next aligned clip from a different video once one is shown; never a repeat, never a fallback to a non-aligned clip; a
 * reason that names the ask and what the clip shows. Unset = today, byte for byte.
 * Fixture: lib's catalogue v2 (catalog/v2/catalog.v2.partial.json, 13:50Z build) for the 9 modules of ped-align's list.
 */
const V2 = require('./fixtures/catalog-v2.fixture.json');

let E;
let C;
let A;
beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('no supabase'); }) }));
  jest.doMock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn() }));
  E = require('../../../bot/shared/services/coaching/video-reco/engine');
  C = require('../../../bot/shared/services/coaching/video-reco/catalog');
  A = require('../../../bot/shared/services/coaching/video-reco/aligned');
});

const ALLOW = '177-s4,3-s2,451-s3,481-s2,722-s2,782-s1,790-s3,791-s2,95-s1';
const T = (mmss, who, text) => ({ start_ms: ((+mmss.split(':')[0] * 60) + +mmss.split(':')[1]) * 1000, label: who, text });
const LINES = [
  T('00:20', 'Teacher', 'Today we will read the story of the bull and the lion, everyone listen carefully'),
  T('00:30', 'Teacher', 'Where did the bull live?'), T('00:33', 'Student', 'Forest'),
  T('00:36', 'Teacher', 'Good. What did the lion say?'), T('00:39', 'Student', 'Run'),
  T('00:42', 'Teacher', 'Okay children, who else can tell me?'), T('00:45', 'Student', 'Me'),
];
const clone = (x) => JSON.parse(JSON.stringify(x));
const v2With = (edit) => { const d = clone(V2); if (edit) edit(d); return d; };
const seg = (d, id) => d.modules.flatMap((m) => m.segments).find((s) => s.seg_id === id);
const mod = (d, mid) => d.modules.find((m) => m.module_id === mid);

function run({ action, env = {}, history = { segments: [], modules: [] }, lang = 'en', subject = 'english', grade = '4', v2 = V2, arm } = {}) {
  const writes = [];
  return E.recommendForReport({
    session: { id: 's1', user_id: arm === 'control' ? 'u-control' : 'u1', transcript_language: 'ur', users: { name: 'Test Teacher', preferred_language: lang }, diarization_data: { segments: LINES } },
    analysis: { framework: 'fico', domains: { C: { indicators: [{ id: 'C1', name: 'Quality Questioning', score: 1, applicable: true, evidence: 'Closed. Quote: "Where did the bull live?"', timestamp: '[00:30]' }] } }, subject_resolution: { code: subject, grade, confidence: 'high' } },
    nextStep: { target: { indicator: 'C1', rung: 1, rationale: 'x', try: action } },
    card: { indicator: 'C1', action },
    coachingSessionId: 's1',
    deps: {
      env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_REASON: 'card', VIDEO_RECO_ALLOWLIST: ALLOW, ...env },
      catalogV2: C.fromData(v2),
      store: {
        readForSession: async () => null,
        recentHistory: async () => history,
        ladderProgress: async () => ({ level: 2, completedModules: [] }),
        trainingBands: async () => [],
        write: async (r) => { writes.push(r); return r; },
      },
      v10GroupFor: async () => null,
      completeJson: jest.fn(async () => { throw new Error('no model call in aligned mode'); }),
    },
  }).then((row) => ({ row, writes }));
}
const ON = { VIDEO_RECO_ALIGNED: 'true' };

const WAIT = 'Next class, right after you ask "Where did the bull live?", wait 5-8 seconds in silence before choosing a speaker.';
const TPS = 'Next class, when a student gives a one-word answer like "forest", run a 60-second Think-Pair-Share with a partner before anyone answers aloud.';
const OWN_WORDS = '[TEACHER], instead of asking "Do you understand?", try: "Can you explain WHY this works in your own words?"';
const REFLECT = '[TEACHER], pair students up for 3 minutes to discuss: "Tell your partner one thing you learned and one question you still have."';
const SILENT_WRITE = 'Next class, give 60 seconds for each student to quietly write their own list first, then call one by one.';
const DIFF = 'Next class, give two versions of the task, an easier and a harder one, and let students choose.';

describe('1 · demonstration / modelled only', () => {
  test('the wait card gets 790-s3 (modelled, shows wait_time)', async () => {
    const { row } = await run({ action: WAIT, env: ON });
    expect(row.status).toBe('shown');
    expect(row.seg_id).toBe('790-s3');
    expect(row.route).toBe('aligned');
  });
  test('the same chapter tagged explanation is never picked: silence', async () => {
    const { row } = await run({ action: WAIT, env: ON, v2: v2With((d) => { seg(d, '790-s3').kind = 'explanation'; }) });
    expect(row.status).toBe('none');
    expect(row.seg_id).toBeNull();
  });
  test('no usable span, poor sound or a duplicate file → silence', async () => {
    for (const edit of [(d) => { seg(d, '790-s3').quality.usable = null; }, (d) => { seg(d, '790-s3').quality.sound = 'poor'; }, (d) => { mod(d, 790).dup_of = 'tm-1'; }]) {
      const { row } = await run({ action: WAIT, env: ON, v2: v2With(edit) }); // eslint-disable-line no-await-in-loop
      expect(row.seg_id).toBeNull();
    }
  });
  test('plays lib\'s usable span, not the chapter bounds', async () => {
    const { row } = await run({ action: WAIT, env: ON });
    expect([row.start_s, row.end_s]).toEqual([seg(V2, '790-s3').quality.usable.start_s, seg(V2, '790-s3').quality.usable.end_s]);
  });
});

describe('2 · the shown move matches the card\'s ask (at its sub-ask)', () => {
  test('a think-pair-share card gets a think-pair-share clip', async () => {
    const { row } = await run({ action: TPS, env: ON });
    expect(A.SUB_ASK[row.seg_id].sub).toBe('think_pair_share:think_then_pair');
  });
  test.each([
    ['an own-words check (95-s1 shows a why about something observed)', OWN_WORDS],
    ['an end-of-lesson pair reflection', REFLECT],
    ['silent writing first', SILENT_WRITE],
    ['a differentiation card', DIFF],
  ])('%s → silence', async (_, action) => {
    const { row } = await run({ action, env: ON });
    expect(row.status).toBe('none');
    expect(row.seg_id).toBeNull();
  });
  test('a chapter that shows the move but has no sub-ask record never fires', async () => {
    const { row } = await run({ action: WAIT, env: { ...ON, VIDEO_RECO_ALLOWLIST: '' }, v2: v2With((d) => { mod(d, 790).segments = mod(d, 790).segments.map((s) => (s.seg_id === '790-s3' ? { ...s, seg_id: '790-s9' } : s)); }) });
    expect(row.seg_id).toBeNull();
  });
  test('the env allowlist still binds', async () => {
    const { row } = await run({ action: WAIT, env: { ...ON, VIDEO_RECO_ALLOWLIST: '95-s1' } });
    expect(row.seg_id).toBeNull();
  });
});

describe('3 · the next aligned clip comes from a different video', () => {
  // 451-s3 is a G9-12 science module in the catalogue; widened here so one lesson passes both think-pair-share chapters
  const both = (d) => { Object.assign(mod(d, 451), { subjects: ['general'], grade_band: 'all' }); };
  test('791-s2 already shown → 451-s3', async () => {
    const { row } = await run({ action: TPS, env: ON, v2: v2With(both), history: { segments: ['791-s2'], modules: [] } });
    expect(row.seg_id).toBe('451-s3');
  });
  test('another chapter of video 791 shown → 791-s2 is skipped for 451-s3', async () => {
    const { row } = await run({ action: TPS, env: ON, v2: v2With(both), history: { segments: ['791-s1'], modules: [] } });
    expect(row.seg_id).toBe('451-s3');
  });
});

describe('4 · never a repeat, never a misaligned fallback', () => {
  test('every aligned clip already shown → silence, not the 51-s1 why-swap', async () => {
    const { row } = await run({ action: WAIT, env: ON, history: { segments: ['790-s3'], modules: [] } });
    expect(row.status).toBe('none');
    expect(row.seg_id).toBeNull();
    expect(row.none_reason).toBe('aligned:seen');
  });
  test('a history read that failed → silence (fail closed)', async () => {
    const { row } = await run({ action: WAIT, env: ON, history: { segments: [], modules: [], failed: true } });
    expect(row.status).toBe('none');
    expect(row.none_reason).toBe('aligned:history_unread');
  });
  test('no model call in aligned mode', async () => {
    const out = await run({ action: TPS, env: ON });
    expect(out.row.attempts).toBe(0);
  });
});

describe('5 · the reason names the ask and what the clip shows', () => {
  test('en and ur, within 300 code points, no quote of a lesson moment', async () => {
    const { row } = await run({ action: WAIT, env: ON });
    const rec = A.SUB_ASK['790-s3'];
    const ask = A.SUB_ASKS[rec.sub];
    expect(row.reason_en).toContain(ask.ask_en);
    expect(row.reason_en).toContain(rec.shows_en);
    expect(row.reason_ur).toContain(ask.ask_ur);
    expect(row.reason_ur).toContain(rec.shows_ur);
    for (const r of [row.reason_en, row.reason_ur]) expect([...r].length).toBeLessThanOrEqual(300);
    expect(row.moment_quote).toBeNull();
    expect(row.moment_source).toBe('aligned');
  });
  test('every cleared chapter\'s line fits for every sub-ask (code points)', () => {
    for (const [id, rec] of Object.entries(A.SUB_ASK)) {
      const r = A.reasonFor({ sub: rec.sub }, { seg_id: id, quality: { usable: { start_s: 0, end_s: 180 } } });
      for (const l of [r.reason_en, r.reason_ur]) expect([...l].length).toBeLessThanOrEqual(300);
    }
  });
  test('teacher-facing words are gender-neutral (no she/her/he/his)', () => {
    const text = [...Object.values(A.SUB_ASKS).flatMap((x) => [x.ask_en]), ...Object.values(A.SUB_ASK).map((x) => x.shows_en)].join(' ');
    expect(text).not.toMatch(/\b(she|her|he|his|him)\b/i);
  });
});

describe('arms and modes', () => {
  test('a control-arm teacher gets the same pick as a shadow row', async () => {
    const env = { ...ON, VIDEO_RECO_AB_ENABLED: 'true' };
    const { row } = await run({ action: WAIT, env, arm: 'control' });
    if (row.arm === 'control') expect(row.status).toBe('shadow');
    expect(row.seg_id).toBe('790-s3');
  });
  test('VIDEO_RECO_MODE=shadow → shadow', async () => {
    const { row } = await run({ action: WAIT, env: { ...ON, VIDEO_RECO_MODE: 'shadow' } });
    expect(row.status).toBe('shadow');
  });
});

describe('flag off = today', () => {
  const strip = (row) => JSON.parse(JSON.stringify(row, (k, v) => (['engine_ms', 'created_at'].includes(k) ? undefined : v)));
  test.each([[{}], [{ VIDEO_RECO_ALIGNED: '' }], [{ VIDEO_RECO_ALIGNED: 'false' }]])('%p: the row is the row without a v2 catalogue', async (env) => {
    const a = await run({ action: WAIT, env });
    const b = await run({ action: WAIT, env: {}, v2: { modules: [] } });
    expect(strip(a.row)).toEqual(strip(b.row));
    expect(a.row.route).not.toBe('aligned');
  });
});

describe('catalogue: every surface resolves a v2-only chapter', () => {
  test('catalog.segment falls back to the v2 file on a v1 miss; a v1 hit is unchanged', () => {
    expect(C.segment('790-s3')).not.toBeNull();
    expect(C.segment('790-s3').segment.quality.usable).toBeTruthy();
    expect(C.segment('51-s1').module.module_id).toBe(51);
  });
});

describe('the ask classifier', () => {
  test.each([
    [WAIT, 'wait_time'],
    [TPS, 'think_pair_share'],
    ['Next class, when a student says the car drinks petrol, ask \'Why do you think that?\', then explain.', 'follow_up_probe'],
    ['Next class, after the shadow demo, ask an open-ended question like \'Why do you think the shadow got longer?\'', 'open_questions'],
    ['اگلی کلاس میں جب کوئی بچہ ایک لفظ میں جواب دے، تو فوراً ایک follow-up open-ended question پوچھیں، مثلاً \'اور کوئی وجہ بتائیں؟\'', 'follow_up_probe'],
    ['Next class, use a clap-pattern attention signal so every student is settled before the lesson starts.', 'attention_cue'],
  ])('%s → %s', (card, move) => {
    expect(A.classifyAsk(card).move).toBe(move);
  });
  test('the when-clause never decides: a "why" quoted in it is not the ask', () => {
    expect(A.classifyAsks('Next class, right after the \'why were the caves built?\' question, wait 5-8 seconds in silence.').map((x) => x.move)).toEqual(['wait_time']);
  });
  // found by the calibration over ped-align's judged items and the 4,934 prod cards (calib/fullpath.js): picks no panel judged
  test.each([
    ['a partner who checks is a peer check, not pair talk', 'Next class, when a student quickly answers S-V-O, pause and ask a partner to check the answer and explain why.', 'think_pair_share'],
    ['a card that leads with modelling', 'Next class, before partners build sentences, model one example sentence aloud, then cold-call one pair to share.', null],
    ['an exit slip with a wait', 'Next class, take an exit slip from every child after the paragraph, and give wait time before explaining.', null],
  ])('%s', (_, card, notMove) => {
    const moves = A.classifyAsks(card).map((x) => x.move);
    if (notMove) expect(moves).not.toContain(notMove); else expect(moves).toEqual([]);
  });
  test('a "spend 5 minutes improving" label names no move', () => {
    expect(A.classifyAsk('[TEACHER], try dedicating 5 minutes of your next class specifically to improving "Questioning".')).toBeNull();
  });
});
