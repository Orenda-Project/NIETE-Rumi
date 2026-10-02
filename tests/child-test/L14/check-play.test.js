/**
 * Child test L14 (bd-s1oo0.18) — the simulated coach really does the check.
 *
 * check-play.js plays the check Flow the way Meta does — INIT, a data_exchange per screen (URDU,
 * ENGLISH, MATHS) with the screen's own init values, then the nfm_reply completion — and a seeded
 * coach model decides each field against the fixture's key:
 *   empty required field          → the coach enters the key's value
 *   pre-filled, disagrees with key → corrected with probability catchP (L5's tolerance decides "disagrees")
 *   pre-filled, agrees             → confirmed (no action beyond the screen's confirm)
 * Every action has a cost from coach-actions.json and is returned for the timeline.
 *
 * Real: the coach model, the Flow client encryption (flow-emulator FlowTransport), the bot's Flow
 * decryption, L6's endpoint + payload builder + check store. Mocked: the Supabase client (in-memory),
 * the log sinks, and fetch (it hands the encrypted body straight to the bot's route handler).
 */
const crypto = require('crypto');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');

const KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
process.env.FLOW_PRIVATE_KEY = KEYS.privateKey;

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({ ...jest.requireActual('../../../bot/shared/utils/structured-logger'), logEvent: jest.fn() }));

const FlowEncryptionService = require('../../../bot/shared/services/flow-encryption.service');
const Check = require('../../../bot/shared/routes/child-test-check-endpoint');
const Bars = require('../../../bot/shared/services/child-test/check-flow/bars');
const { formItems } = require('../../../bot/shared/services/child-test/check-flow/items');
const F = require('../L6/fixtures/ai-marks');
const P = require('../../../bot/scripts/e2e/child-test-sim/check-play');

Bars.__pinBarsForTest(Bars.DEFAULT_BARS);
afterAll(() => Bars.__pinBarsForTest(null));

const COSTS = P.loadActionCosts();
const items = formItems(3, 'A');
const token = (sid = 'sess-1', uid = 'coach-1') => `${uid}:child-test-check:${sid}`;

/** A fixture key in the ai-marks shape: the AI's marks with the differences a test names. */
function keyFrom(edit = (k) => k) {
  const strip = (m) => { const o = JSON.parse(JSON.stringify(m)); delete o.version; delete o.block; return o; };
  const k = { fixture_id: 'AA_test', kind: 'real', grade: 3, form: 'A',
    blocks: { urdu: strip(F.urduConfident()), english: strip(F.englishConfident()), maths: { maths: strip(F.mathsConfident()).maths } } };
  edit(k);
  return k;
}

function seed(blocks = { urdu: F.urduConfident(), english: F.englishConfident(), maths: F.mathsConfident() }) {
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: 'ur' }],
    child_test_sessions: [{ id: 'sess-1', coach_user_id: 'coach-1', grade: 3, form: 'A', student_id: 'stu-1', draw_id: 'draw-1', status: 'completed', timings: {} }],
    child_test_draws: [{ id: 'draw-1', roll_number: '14', grade: '3' }],
    child_test_blocks: Object.entries(blocks).map(([block, ai], i) => ({
      id: `blk-${i}`, session_id: 'sess-1', block, ai_marks: ai, ai_status: 'scored', coach_marks: null, coach_edits: null, checked_at: null,
    })),
  });
}
const blockRow = (block) => mockFake.__tables.child_test_blocks.find((r) => r.session_id === 'sess-1' && r.block === block);

beforeEach(() => { jest.clearAllMocks(); process.env.CHILD_TEST_ENABLED = 'true'; seed(); });

describe('coach-actions.json', () => {
  test('every action has a cost in seconds and a stated source', () => {
    for (const a of ['open_check', 'confirm_screen', 'type_count', 'tick_chip', 'choose_radio', 'fix_error', 'submit']) {
      expect(typeof COSTS[a]).toBe('number');
      expect(COSTS[a]).toBeGreaterThan(0);
    }
    expect(Object.keys(P.ACTION_SOURCES).length).toBeGreaterThan(0);
  });
});

describe('coachFill — one screen, the coach model', () => {
  // the screen exactly as L6's endpoint would send it for these marks
  const screenOf = (block, ai) => require('../../../bot/shared/services/child-test/check-flow/prefill').renderScreen(block, { aiMarks: ai, items, lang: 'ur', child: { label: 'Roll 14' } });

  test('an empty required field gets the key\'s value; a pre-filled one that agrees is only confirmed', () => {
    const ai = F.urduConfident(); ai.story.words_correct = 43;   // within ±5 of the key's 41
    const s = screenOf('urdu', ai);
    expect(s.data.q3_i).toBe('');                                   // conf 0.4: arrives empty
    const key = keyFrom((k) => { k.blocks.urdu.questions[2].verdict = 'wrong'; });
    const out = P.coachFill({ screen: 'URDU', data: s.data, key, items, rng: P.makeRng(1), catchP: 0.9, costs: COSTS });
    expect(out.posted.u_q3).toBe('wrong');
    expect(out.posted.u_wc).toBe('43');                             // agrees within tolerance: left as is
    const q3 = out.actions.find((a) => a.field === 'u_q3');
    expect(q3).toMatchObject({ action: 'choose_radio', reason: 'fill_empty', cost_s: COSTS.choose_radio });
    expect(out.actions.find((a) => a.field === 'u_wc')).toBeUndefined();
    expect(out.actions.filter((a) => a.action === 'confirm_screen')).toHaveLength(1);
  });

  test('a pre-filled count beyond tolerance is corrected when caught, left (and logged as missed) when not', () => {
    const s = screenOf('urdu', F.urduConfident());                  // wc 41, conf 0.9: pre-filled
    const key = keyFrom((k) => { k.blocks.urdu.story.words_correct = 30; });
    const caught = P.coachFill({ screen: 'URDU', data: s.data, key, items, rng: P.makeRng(1), catchP: 1, costs: COSTS });
    expect(caught.posted.u_wc).toBe('30');
    expect(caught.actions.find((a) => a.field === 'u_wc')).toMatchObject({ action: 'type_count', reason: 'correct', ai: '41', key: 30 });
    const missed = P.coachFill({ screen: 'URDU', data: s.data, key, items, rng: P.makeRng(1), catchP: 0, costs: COSTS });
    expect(missed.posted.u_wc).toBe('41');
    expect(missed.actions.find((a) => a.field === 'u_wc')).toMatchObject({ reason: 'missed', cost_s: 0 });
  });

  test('chips are toggled to match the key\'s wrong words, one tick per change', () => {
    const s = screenOf('urdu', F.urduConfident());
    expect(s.data.flag_on).toEqual(['w4', 'w8']);
    const key = keyFrom((k) => { k.blocks.urdu.story.flagged = [{ idx: 4 }, { idx: 10 }]; });
    const out = P.coachFill({ screen: 'URDU', data: s.data, key, items, rng: P.makeRng(1), catchP: 1, costs: COSTS });
    expect(out.posted.u_flag.sort()).toEqual(['w10', 'w4']);
    expect(out.actions.filter((a) => a.action === 'tick_chip').map((a) => a.field)).toEqual(['u_flag:w8', 'u_flag:w10']);
  });

  test('the same seed gives the same coach; a different seed may differ', () => {
    const s = screenOf('urdu', F.urduConfident());
    const key = keyFrom((k) => { k.blocks.urdu.story.words_correct = 30; k.blocks.urdu.questions[0].verdict = 'wrong'; k.blocks.urdu.questions[1].verdict = 'correct'; });
    const run = (seedN) => P.coachFill({ screen: 'URDU', data: s.data, key, items, rng: P.makeRng(seedN), catchP: 0.5, costs: COSTS }).actions.map((a) => a.reason).join(',');
    expect(run(7)).toBe(run(7));
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(run));
    expect(seen.size).toBeGreaterThan(1);
  });

  test('maths: written sums from the strip key, quick sums typed when empty', () => {
    const ai = F.mathsConfident(); ai.maths.quick_sums.confidence = 0.2;   // below the bar → empty
    const s = screenOf('maths', ai);
    expect(s.data.qc_i).toBe('');
    const key = keyFrom((k) => { k.blocks.maths.maths.quick_sums = { correct: 9, attempted: 13 }; k.blocks.maths.maths.written[2].verdict = 'wrong'; });
    const out = P.coachFill({ screen: 'MATHS', data: s.data, key, items, rng: P.makeRng(1), catchP: 1, costs: COSTS });
    expect(out.posted).toMatchObject({ m_qc: '9', m_qa: '13', m_w3: 'wrong' });
    expect(out.actions.filter((a) => a.reason === 'fill_empty').map((a) => a.field).sort()).toEqual(expect.arrayContaining(['m_qa', 'm_qc', 'm_w3']));
  });
});

describe('playCheck — the whole Flow through the encryption, against L6\'s endpoint', () => {
  const transport = () => new (require('../../../bot/scripts/e2e/flow-emulator').FlowTransport)({
    publicKeyPem: KEYS.publicKey,
    // the network boundary: the encrypted body goes straight into the bot's route handler
    fetch: async (url, init) => {
      const text = await FlowEncryptionService.processEncryptedRequest(JSON.parse(init.body), Check.handleChildTestCheckFlow);
      return { ok: true, status: 200, text: async () => text };
    },
  });

  test('INIT → URDU → ENGLISH → MATHS → DONE; the coach\'s corrections are what L6 saves', async () => {
    const key = keyFrom((k) => {
      k.blocks.urdu.story.words_correct = 30;
      k.blocks.urdu.questions[2].verdict = 'wrong';
      k.blocks.maths.maths.written[2].verdict = 'blank';
    });
    const res = await P.playCheck({ token: token(), url: 'http://bot/api/flows/child-test-check', transport: transport(), key, items, rng: P.makeRng(3), catchP: 1, costs: COSTS });
    expect(res.ok).toBe(true);
    expect(res.screens).toEqual(['URDU', 'ENGLISH', 'MATHS', 'DONE']);
    expect(res.session_id).toBe('sess-1');
    expect(res.response_json).toEqual({ flow_token: token(), child_test: 'checked', session_id: 'sess-1' });
    expect(blockRow('urdu').coach_marks.story.words_correct).toBe(30);
    expect(blockRow('urdu').coach_marks.questions.find((q) => q.id === 'u3A-q3').verdict).toBe('wrong');
    expect(blockRow('maths').coach_marks.maths.written.find((w) => w.id === 'm3A-w3').verdict).toBe('blank');
    expect(['urdu', 'english', 'maths'].every((b) => blockRow(b).checked_at)).toBe(true);
    const timings = mockFake.__tables.child_test_sessions[0].timings;
    expect(timings['check.opened']).toBeTruthy();
    expect(timings['check.submitted']).toBeTruthy();
    // the check's time: every action priced, plus a measured round trip per request
    expect(res.actions[0]).toMatchObject({ action: 'open_check' });
    expect(res.actions[res.actions.length - 1]).toMatchObject({ action: 'submit' });
    expect(res.rtts.map((r) => r.action)).toEqual(['INIT', 'data_exchange', 'data_exchange', 'data_exchange']);
    expect(res.check_s).toBeCloseTo(res.actions.reduce((a, x) => a + x.cost_s, 0) + res.rtts.reduce((a, x) => a + x.ms, 0) / 1000, 3);
  });

  test('a screen that comes back with errors is fixed and re-sent (count more than tried)', async () => {
    // key says 50 correct of 45 tried: the coach types 50 into a pre-filled 41 and L6 refuses it; the
    // coach then raises "tried" to match, as a coach would, and the screen goes through.
    const key = keyFrom((k) => { k.blocks.urdu.story.words_correct = 50; });
    const res = await P.playCheck({ token: token(), url: 'http://bot/api/flows/child-test-check', transport: transport(), key, items, rng: P.makeRng(3), catchP: 1, costs: COSTS });
    expect(res.ok).toBe(true);
    expect(res.actions.some((a) => a.action === 'fix_error')).toBe(true);
    expect(blockRow('urdu').coach_marks.story).toMatchObject({ words_correct: 50, words_attempted: 50 });
  });

  test('a token that matches no session ends not-ok, with the reason', async () => {
    const res = await P.playCheck({ token: token('nope'), url: 'http://bot/api/flows/child-test-check', transport: transport(), key: keyFrom(), items, rng: P.makeRng(3), catchP: 1, costs: COSTS });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unavailable|DONE/);
  });
});

describe('endpointFor — where the Flow requests go', () => {
  test('mock mode: the local bot\'s endpoint; sandbox: only the sandbox host', () => {
    expect(P.endpointFor({ mode: 'mock', botUrl: 'http://127.0.0.1:3110' })).toBe('http://127.0.0.1:3110/api/flows/child-test-check');
    expect(P.endpointFor({ mode: 'sandbox' })).toBe('https://bot-sandbox.up.railway.app/api/flows/child-test-check');
    expect(() => P.endpointFor({ mode: 'sandbox', flowEndpoint: 'https://bot-production.up.railway.app/api/flows/child-test-check' })).toThrow(/production|allow/);
  });

  test('the public key is derived from FLOW_PRIVATE_KEY(_B64) and never returned as the private half', () => {
    const pub = P.publicKeyFrom({ FLOW_PRIVATE_KEY_B64: Buffer.from(KEYS.privateKey).toString('base64') });
    expect(pub).toMatch(/BEGIN PUBLIC KEY/);
    expect(pub).not.toMatch(/PRIVATE/);
  });
});
