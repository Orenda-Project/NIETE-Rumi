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
    // R9c: 451-s1 (the second wait clip) already shown, so the unrecorded chapter is the only one left
    const { row } = await run({ action: WAIT, env: { ...ON, VIDEO_RECO_ALLOWLIST: '' }, history: { segments: ['451-s1'], modules: [] }, v2: v2With((d) => { mod(d, 790).segments = mod(d, 790).segments.map((s) => (s.seg_id === '790-s3' ? { ...s, seg_id: '790-s9' } : s)); }) });
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
  // red7 HOLD 20261119T150737 H1: 5 of 3-s2's 9 prod picks (calib/engine_picks_prod.jsonl) were clapping as praise, clapping
  // syllables, or differentiation; and N1, red7's attack set (gate_6527c6568f/attack_r9.jsonl), K1–K20
  test.each([
    ['clapping as praise after an answer (a6d2cb8c)', 'اگلی کلاس میں جب کوئی شاگرد \'وہ بھاگ رہے ہیں\' جیسا جملہ بار بار [a student]، جملہ خود مکمل کرنے کے بجائے ایک open-ended question پوچھیں، پانچ سے دس سیکنڈ کا wait time دیں، پھر نیا جواب آنے پر تالیاں [a student]۔', 'attention_cue'],
    ['clapping before the next question (4267ec05)', 'اگلی کلاس میں جب [a student] جیسا بچہ تقسیم کا سوال حل کرے، تالیاں سے پہلے open-ended question پوچھیں \'کیسے سوچا؟\' اور 5-7 سیکنڈ wait time دے کر مزید بچوں سے سنیں۔', 'attention_cue'],
    ['clapping out syllables (21380f6b)', 'اگلی کلاس میں جب \'[a student]\' جیسا لفظ توڑنے کا موقع آئے، خود لفظ بنانے کے بجائے ایک open-ended question پوچھیں، wait time دیں، پھر تالیاں بجا کر syllables دکھائیں۔', 'attention_cue'],
    ['a silent count-down for chatter (cd2b15d3)', 'Next class, the moment chatter starts during independent work, silently count down 5-1 with your hand, step closer to that group, and start the visible timer—no words needed.', 'attention_cue'],
    ['K6 count down to finish a task', 'Next class, count down from 30 so students finish their group task on time.', 'attention_cue'],
    ['K1 follow up on homework', 'Next class, follow up with the three students who missed the homework.', 'follow_up_probe'],
    ['K14 probe for homework', 'Next class, probe the class for homework completion at the start.', 'follow_up_probe'],
    ['K2 recall at the end of the lesson', 'Next class, at the end of the lesson, ask students to recall the three key words from today.', 'activate_prior_knowledge'],
    ['K7 remember the rules', 'Next class, remember the safety rules before the experiment.', 'activate_prior_knowledge'],
    ['K8 correct past mistakes', 'اگلی کلاس میں پچھلی غلطیوں کو بورڈ پر درست کریں۔', 'activate_prior_knowledge'],
    ['K20 a written quiz', 'Next class, ask students what they already know by giving a short written quiz.', 'activate_prior_knowledge'],
    ['K3 wait for latecomers', 'Next class, wait a few minutes for latecomers before starting the reading.', 'wait_time'],
    ['K17 silence to copy the board', 'Next class, give students 10 seconds of silence to copy the board.', 'wait_time'],
    ['K18 wait after an instruction', 'Next class, wait five seconds after each instruction before repeating it.', 'wait_time'],
    ['K4 predict the story', 'Next class, ask students to predict what happens next in the story before turning the page.', 'inquiry_opening'],
    ['K5 real objects to explain', 'Next class, show real-life objects like a chocolate bar to explain fractions.', 'inquiry_opening'],
    ['K9 pairs share worksheet answers', 'Next class, have pairs share their worksheet answers with each other.', 'think_pair_share'],
    ['K12 the teacher explains', 'Next class, explain why the answer is correct before moving on.', 'ask_for_reasoning'],
  ])('red7: %s', (_, card, notMove) => {
    expect(A.classifyAsks(card).map((x) => x.move)).not.toContain(notMove);
  });
  test.each([
    ['two parts: support set and challenge set (53e5e632)', 'اگلی کلاس میں تالی [a student] کی activity میں دو حصے بنائیں: support set میں \'دو\' جیسے آسان لفظ پر رہنمائی کے ساتھ تالی [a student]، اور challenge set میں \'[a student]\' جیسے مشکل لفظ یا غیر ملنے والے حروف [a student] کو دیں۔'],
    ['two parts with easy and hard sentences (eb3e24a0)', 'اگلی کلاس میں جب \'lively\' جیسے الفاظ پر sentence بنانے کو کہیں، تو سب کو ایک ہی کام دینے کے بجائے دو حصے بنائیں: [a student] [a student] میں ایک لفظ پر ایک آسان sentence، اور [a student] [a student] میں دو مشکل sentences لکھو'],
  ])('red7: a differentiation card is silent: %s', (_, card) => {
    expect(A.classifyAsks(card)).toEqual([]);
  });
  test.each([
    ['the attention cue the panel cleared (0bdebb8c)', 'Next class, when starting the seasons lesson, use a clap-pattern attention signal so every student is settled, then ask an open-ended question like \'Why does humidity change between seasons?\' and wait 5-10 seconds before calling on volunteers.', 'attention_cue'],
    ['K21 wait after a question', 'Next class, after you ask a question, wait 5 seconds before choosing who answers.', 'wait_time'],
    ['K22 what they already know, before the topic', 'Next class, before the new topic, ask what students already know about plants.', 'activate_prior_knowledge'],
  ])('red7 keeps: %s', (_, card, move) => {
    expect(A.classifyAsks(card).map((x) => x.move)).toContain(move);
  });
  // red7 HOLD 20261119T151939 H2 (gate_2ab5e211e9/pick_delta.txt): explain cards and "follow up with a why" cards fell to
  // open_questions → 95-s1, the family the panel failed (10 A / 7 W); 95-s1 is cleared only for "why do you think…?"
  test.each([
    ['explain in one sentence', 'Next class, when a student shares a homophone sentence like \'I bear my four,\' praise the matching sounds first, then ask: \'Why does this spelling fit here? Explain in one sentence.\''],
    ['explain in two sentences', 'Next class, after the ruler-and-paper experiment, ask \'Why did the paper stick to the ruler? Explain in two sentences,\' then add a next step.'],
    ['explain your steps', 'Next class, when a student gives a short answer for 16/10, pause, wait 5–7 seconds, and ask \'Why does the point go there? Explain your steps\' before giving the fix.'],
    ['how would you explain why', 'Next class, when a student pauses on a place value question like 642, wait 5–7 seconds, appreciate their effort, then ask \'How would you explain why 6 is 600?\''],
    ['pairs explain why', 'Next class, after modeling the square perimeter formula, pair students 3 minutes to explain why we multiply by 4; then ask how a pentagon\'s formula changes.'],
    ['follow up with a why question', 'Next class, during independent comma practice, when a child gives a one-word answer, follow up with a real-life why question and wait 5-7 seconds before moving on.'],
    ['follow up with one open question', 'Next class, when the orbit video ends and a student answers with one word, follow up with one open question such as \'Why do planets stay in orbit?\' to stretch their thinking.'],
  ])('red7 H2: %s never reaches 95-s1 (open_questions)', (_, card) => {
    expect(A.classifyAsks(card).map((x) => x.move)).not.toContain('open_questions');
  });
  test('red7 H2: "follow up with a why question" is a follow-up', () => {
    expect(A.classifyAsk('Next class, when a child gives a one-word answer, follow up with a real-life why question and wait 5-7 seconds.').move).toBe('follow_up_probe');
  });
  test('an aligned row stamps the v2 catalogue version (red7 N4)', async () => {
    const { row } = await run({ action: WAIT, env: ON });
    expect(row.catalog_version).toBe(V2.version);
  });
  test('a "spend 5 minutes improving" label names no move', () => {
    expect(A.classifyAsk('[TEACHER], try dedicating 5 minutes of your next class specifically to improving "Questioning".')).toBeNull();
  });
});

// R9b (COS 20261119T152504 §2; ped-align r5 20261119T152426): the 45 picks the blind panel judged wrong at #5136 2ab5e211e9,
// each through the real v2 file, the panel's gates and the 9-list. Each is silent, or moves to a clip other than the one
// judged wrong (that new pair goes to ped-align).
describe('R9b · the card\'s main move decides (r5 wrong picks)', () => {
  const R5 = require('./fixtures/r5-wrong-picks.json').picks;
  const LIST = new Set(ALLOW.split(','));
  const pickFor = (x) => {
    const g = Number(x.grade);
    const langs = [...new Set([x.report_lang, x.lesson_lang, 'mixed'].filter(Boolean))];
    for (const ask of A.classifyAsks(x.card)) {
      const c = A.candidates(C.loadV2(), ask, { languages: langs, allow: LIST, history: { segments: [], modules: [] } }, { subject: x.subject, grade: Number.isFinite(g) && g > 0 ? { lo: g, hi: g } : null });
      if (c.length) return c[0].seg.seg_id;
    }
    return null;
  };
  test.each(R5.map((x) => [x.id, x.seg, x]))('%s never gets %s again', (_, seg, x) => {
    expect(pickFor(x)).not.toBe(seg);
  });
  test('the open "why… then wait" card is one ask in two steps (either order) and still gets its clip', () => {
    const card = 'Next class, when a student answers a fractions question in just one word, wait 5 to 7 seconds, then ask an open-ended \'why\' question to stretch their thinking.';
    expect(A.classifyAsks(card).map((x) => x.move)).toEqual(['wait_time', 'open_questions']);
  });
  test('after a non-questioning main move nothing later is served («ask what they already know, then wait»)', () => {
    expect(A.classifyAsks('Next class, before the new topic, ask what students already know about plants, give wait time, then link their answers.').map((x) => x.move)).toEqual(['activate_prior_knowledge']);
  });
});

// R9b (COS 20261119T152504 §3; ped-align r5 cross-gate round: think_pair_share 80/80, follow_up_probe 40/40, 0 ⛔): the
// subject × grade gate is lifted for these two moves only; language still binds; the other moves keep the gate.
describe('R9b · cross-gate: think_pair_share and follow_up_probe reach across subject and grade', () => {
  test('a think-pair-share card on a Grade 4 science lesson gets 451-s3 (science, G9-12: same subject first, across grade)', async () => {
    const { row } = await run({ action: TPS, env: ON, subject: 'science', grade: '4' });
    expect(row.seg_id).toBe('451-s3');
  });
  test('…and on a Grade 4 maths lesson, 791-s2 (English 4-5: no subject match, the narrower band first)', async () => {
    const { row } = await run({ action: TPS, env: ON, subject: 'maths', grade: '4' });
    expect(row.seg_id).toBe('791-s2');
  });
  test('a follow-up card on a Grade 4 English lesson gets 782-s1 (a primary science clip)', async () => {
    const { row } = await run({ action: 'Next class, when a student says the car drinks petrol, ask \'Why do you think that?\', then explain.', env: ON, subject: 'english', grade: '4' });
    expect(row.seg_id).toBe('782-s1');
  });
  test('ask_for_reasoning keeps the gate: 177-s4 (science 6-8) never reaches a Grade 4 English lesson', () => {
    const ask = { move: 'ask_for_reasoning', sub: 'ask_for_reasoning:why_after_observation' };
    expect(A.candidates(C.fromData(V2), ask, { languages: ['en', 'mixed'], allow: null, history: null }, { subject: 'english', grade: { lo: 4, hi: 4 } }).map((c) => c.seg.seg_id)).not.toContain('177-s4');
  });
  test('language still binds across the gate: an Urdu-only reader never gets 791-s2 (English)', async () => {
    const { row } = await run({ action: TPS, env: ON, subject: 'science', grade: '4', lang: 'ur' });
    expect(row.seg_id).not.toBe('791-s2');
  });
});

// R9b (COS 20261119T152504 §3; ped-align r5 cross-gate: wait_time 39/40 = 97.5%, 0 ⛔, lifted only WITH the 790-s3
// near-miss exclusion, which a6621403fa put in place)
describe('R9b · cross-gate: wait_time', () => {
  test('a wait card on a Grade 4 maths lesson gets 790-s3 (an English 4-5 clip)', async () => {
    const { row } = await run({ action: WAIT, env: ON, subject: 'maths', grade: '4' });
    expect(row.seg_id).toBe('790-s3');
  });
  test('…and a wait card on a Grade 9 science lesson too (across grade)', async () => {
    const { row } = await run({ action: WAIT, env: ON, subject: 'science', grade: '9' });
    expect(row.seg_id).toBe('790-s3');
  });
  test('the near-miss exclusion still holds across the gate: wait after a stumble stays silent', async () => {
    const { row } = await run({ action: 'Next class, when a student stumbles on a word like \'friction\', pause for a few seconds of wait time, then ask a guiding question.', env: ON, subject: 'maths', grade: '4' });
    expect(row.seg_id).toBeNull();
  });
});

// R9c (bd-tp4w7n.5; COS 20261119T174101, red7 20261119T175254): six second clips (ped-align ADDON.md, 20/20 R+A each,
// 0 ⛔, transcript PASS). 778-s2 stays OUT (red7 HOLD). 794-s2 never below Grade 3. The 9 first clips keep their place;
// 790-s2 ranks last within think_pair_share (it shares video 790 with 790-s3: red7 N1).
describe('R9c · second clips', () => {
  const ALLOW15 = `${ALLOW},790-s2,804-s2,905-s5,794-s2,745-s1,451-s1`;
  const ADDONS = { '790-s2': 'think_pair_share:think_then_pair', '804-s2': 'think_pair_share:think_then_pair', '905-s5': 'think_pair_share:think_then_pair', '794-s2': 'think_pair_share:think_then_pair', '745-s1': 'think_pair_share:think_then_pair', '451-s1': 'wait_time:after_question' };
  const TPS_ALL = ['791-s2', '451-s3', '804-s2', '905-s5', '794-s2', '745-s1', '790-s2'];
  const on15 = { ...ON, VIDEO_RECO_ALLOWLIST: ALLOW15 };
  test.each(Object.entries(ADDONS))('%s carries a sub-ask record (%s) and shows its move in v2', (id, sub) => {
    expect(A.SUB_ASK[id] && A.SUB_ASK[id].sub).toBe(sub);
    const s = C.fromData(V2).segment(id);
    expect(s && s.segment.shows.move).toBe(A.SUB_ASKS[sub].move);
  });
  test('778-s2 is held (red7 HOLD 175254): no record, never picked even when allowlisted', async () => {
    expect(A.SUB_ASK['778-s2']).toBeUndefined();
    const { row } = await run({ action: WAIT, env: { ...ON, VIDEO_RECO_ALLOWLIST: `${ALLOW15},778-s2` }, history: { segments: ['790-s3', '451-s1'], modules: [] } });
    expect(row.seg_id).toBeNull();
    expect(row.none_reason).toBe('aligned:seen');
  });
  test('first contact is unchanged by the 15-list: wait → 790-s3, think-pair-share → 791-s2', async () => {
    expect((await run({ action: WAIT, env: on15 })).row.seg_id).toBe('790-s3');
    expect((await run({ action: TPS, env: on15 })).row.seg_id).toBe('791-s2');
    expect((await run({ action: TPS, env: on15, subject: 'science', grade: '4' })).row.seg_id).toBe('451-s3');
  });
  test('a repeat teacher gets a second wait clip from a different video: 790-s3 shown → 451-s1, shown, with its reason', async () => {
    const { row } = await run({ action: WAIT, env: on15, history: { segments: ['790-s3'], modules: [] } });
    expect(row.status).toBe('shown');
    expect(row.seg_id).toBe('451-s1');
    expect(row.module_id).not.toBe(790);
    expect(row.reason_en).toContain(A.SUB_ASK['451-s1'].shows_en);
    expect(row.reason_ur).toContain(A.SUB_ASK['451-s1'].shows_ur);
  });
  test('a repeat teacher walks the think-pair-share clips one video at a time, 790-s2 last, then silence', async () => {
    const seen = [];
    for (;;) {
      const { row } = await run({ action: TPS, env: on15, grade: '4', history: { segments: [...seen], modules: [] } }); // eslint-disable-line no-await-in-loop
      if (!row.seg_id) { expect(row.none_reason).toBe('aligned:seen'); break; }
      expect(seen.map((s) => s.split('-')[0])).not.toContain(String(row.module_id)); // never a video already shown
      seen.push(row.seg_id);
    }
    expect(seen[0]).toBe('791-s2');
    expect(seen[seen.length - 1]).toBe('790-s2');
    expect([...seen].sort()).toEqual([...TPS_ALL].sort());
  });
  test('790-s2 never follows 790-s3 (same video)', async () => {
    const others = TPS_ALL.filter((s) => s !== '790-s2');
    const { row } = await run({ action: TPS, env: on15, grade: '4', history: { segments: ['790-s3', ...others], modules: [] } });
    expect(row.seg_id).toBeNull();
  });
  test.each([['1', false], ['2', false], ['3', true], ['5', true]])('794-s2 grade floor 3: Grade %s → reachable %p', async (grade, ok) => {
    const others = TPS_ALL.filter((s) => s !== '794-s2' && s !== '790-s2');
    const { row } = await run({ action: TPS, env: on15, grade, history: { segments: others, modules: [] } });
    expect(row.seg_id === '794-s2').toBe(ok);
  });
  test('794-s2 with no known grade is not served (fail closed)', () => {
    const ask = { move: 'think_pair_share', sub: 'think_pair_share:think_then_pair' };
    const ids = (g) => A.candidates(C.fromData(V2), ask, { languages: ['en', 'ur', 'mixed'], allow: null, history: null }, { subject: 'english', grade: g }).map((c) => c.seg.seg_id);
    expect(ids(null)).not.toContain('794-s2');
    expect(ids({ lo: 1, hi: 5 })).not.toContain('794-s2'); // a PRIMARY band reaches Grade 1
    expect(ids({ lo: 4, hi: 4 })).toContain('794-s2');
  });
  test('the add-on Urdu lines are gender-neutral (plural-respect verbs, no singular gendered ending)', () => {
    for (const id of Object.keys(ADDONS)) expect(A.SUB_ASK[id].shows_ur).not.toMatch(/(?:تا|تی) ہے|تی ہیں|رہی ہیں|بتاتی|کرتی/u);
  });
});

// R9c (ped-align r6 20261119T172641; COS 174509): the 22 picks the blind panel judged wrong at #5141 74842aad5e, each
// through the real v2 file, the panel's gates and the 15-list. Each is silent now. 4 of them are the 782-s1 `model`
// near-miss (ped-align: 179/185 = 96.8% with it).
describe('R9c · r6 wrong picks are silent (incl. the 782-s1 model exclusion)', () => {
  const R6 = require('./fixtures/r6-wrong-picks.json').picks;
  const LIST = new Set(`${ALLOW},790-s2,804-s2,905-s5,794-s2,745-s1,451-s1`.split(','));
  const BAND = { '1-2': { lo: 1, hi: 2 }, '3-5': { lo: 3, hi: 5 }, '6-8': { lo: 6, hi: 8 }, '9-12': { lo: 9, hi: 12 } };
  const pickFor = (x) => {
    const langs = [...new Set([x.report_lang, x.lesson_lang, 'mixed'].filter(Boolean))];
    for (const ask of A.classifyAsks(x.card)) {
      const c = A.candidates(C.loadV2(), ask, { languages: langs, allow: LIST, history: { segments: [], modules: [] } }, { subject: x.subject, grade: BAND[x.grade_band] || null });
      if (c.length) return c[0].seg.seg_id;
    }
    return null;
  };
  test.each(R6.map((x) => [x.item, x.seg, x]))('%s (%s) → silence', (_, seg, x) => {
    expect(pickFor(x)).toBeNull();
  });
  test.each([
    ['a plain follow-up', 'Next class, when a student says the car drinks petrol, ask \'Why do you think that?\', then explain.'],
    ['a follow-up after a one-word answer', 'Next class, when a child gives a one-word answer, follow up with a real-life why question and wait 5-7 seconds.'],
  ])('782-s1 keeps %s', (_, card) => {
    expect(A.classifyAsks(card).map((x) => x.move)).toContain('follow_up_probe');
  });
});

// R9c A9b (COS 20261119T143330 / 174509; red7 174442): a teacher's own report on a framework the engine cannot read is a
// `none` row that names it, so the A/B sees it. A leader observation stays with no row (queue #186). Flag off = today.
describe('R9c · A9b framework_unsupported', () => {
  const runFw = ({ framework, env = ON, observer = null }) => {
    const writes = [];
    return E.recommendForReport({
      session: { id: 's1', user_id: 'u1', observer_user_id: observer, transcript_language: 'ur', users: { name: 'Test Teacher', preferred_language: 'en' }, diarization_data: { segments: LINES } },
      analysis: { framework, domains: {}, subject_resolution: { code: 'english', grade: '4', confidence: 'high' } },
      card: { indicator: 'C1', action: WAIT },
      coachingSessionId: 's1',
      deps: { env: { VIDEO_RECO_ENABLED: 'true', VIDEO_RECO_ALLOWLIST: ALLOW, ...env }, catalogV2: C.fromData(V2), store: { write: async (r) => { writes.push(r); return r; } } },
    }).then((row) => ({ row, writes }));
  };
  test('an own report on fico17_v6 → one none row, framework_unsupported:fico17_v6', async () => {
    const { row, writes } = await runFw({ framework: 'fico17_v6' });
    expect(writes).toHaveLength(1);
    expect(row).toMatchObject({ status: 'none', none_reason: 'framework_unsupported:fico17_v6', coaching_session_id: 's1', user_id: 'u1', observation_type: 'self', seg_id: null, route: 'aligned' });
  });
  test('…with no framework at all → framework_unsupported:none', async () => {
    const { row } = await runFw({ framework: undefined });
    expect(row.none_reason).toBe('framework_unsupported:none');
  });
  test('a leader observation on fico17_v6 → no row (queue #186)', async () => {
    const { row, writes } = await runFw({ framework: 'fico17_v6', observer: 'coach-1' });
    expect(row).toBeNull();
    expect(writes).toHaveLength(0);
  });
  test('flag off → today: null, no row', async () => {
    const { row, writes } = await runFw({ framework: 'fico17_v6', env: {} });
    expect(row).toBeNull();
    expect(writes).toHaveLength(0);
  });
});
