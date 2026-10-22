/**
 * Child test check Flow (bd-s1oo0.6) — the endpoint (POST /api/flows/child-test-check).
 *
 * Token: <coachUserId>:child-test-check:<sessionId>. Every request re-reads the session and checks it
 * belongs to the coach in the token. INIT opens URDU pre-filled from the block's ai_marks; each
 * screen's footer saves that block's coach_marks + coach_edits at once (closing the Flow loses
 * nothing); MATHS marks the session checked and returns DONE. ai_marks are never written.
 *
 * Real: endpoint, payload builder, check store, Flow encryption (with a key pair made here, the way
 * Meta encrypts). Mocked: the database client (in-memory), the log sinks.
 */
const crypto = require('crypto');
const { createFakeSupabase } = require('../../observe2/helpers/fake-supabase');

const KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
process.env.FLOW_PRIVATE_KEY = KEYS.privateKey;

let mockFake;
jest.mock('../../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({ ...jest.requireActual('../../../bot/shared/utils/structured-logger'), logEvent: jest.fn() }));

const Logger = require('../../../bot/shared/utils/logger');
const { logEvent } = require('../../../bot/shared/utils/structured-logger');
const FlowEncryptionService = require('../../../bot/shared/services/flow-encryption.service');
const Check = require('../../../bot/shared/routes/child-test-check-endpoint');
const F = require('./fixtures/ai-marks');

// Form logic is tested against fixed bars (bars.DEFAULT_BARS); the real calibration is tested in real-thresholds.test.js.
const Bars = require('../../../bot/shared/services/child-test/check-flow/bars');
Bars.__pinBarsForTest(Bars.DEFAULT_BARS);   // at load: some screens are built while the suite is collected
afterAll(() => Bars.__pinBarsForTest(null));


const token = (sid = 'sess-1', uid = 'coach-1') => `${uid}:child-test-check:${sid}`;
const blockRow = (block) => mockFake.__tables.child_test_blocks.find((r) => r.session_id === 'sess-1' && r.block === block);

function seed(blocks = { urdu: F.urduConfident(), english: F.englishConfident(), maths: F.mathsConfident() }) {
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', preferred_language: 'ur' }],
    child_test_sessions: [{ id: 'sess-1', coach_user_id: 'coach-1', grade: 3, form: 'A', student_id: 'stu-1', draw_id: 'draw-1', status: 'in_progress', timings: {} }],
    child_test_draws: [{ id: 'draw-1', roll_number: '14', grade: '3' }],
    child_test_blocks: Object.entries(blocks).map(([block, ai], i) => ({
      id: `blk-${i}`, session_id: 'sess-1', block, ai_marks: ai, ai_status: ai ? 'scored' : 'failed', coach_marks: null, coach_edits: null, checked_at: null,
    })),
  });
}

/** Post back what the screen arrived with, plus the fields the coach had to fill. */
function posted(screen, data, fills = {}) {
  const p = { URDU: 'u_', ENGLISH: 'e_', MATHS: 'm_' }[screen];
  const out = { screen };
  for (const [k, v] of Object.entries(data)) {
    const m = k.match(/^(wc|wa|fl|fw|sw|qc|qa|wp|q\d|fs\d|nw\d|n\d|w\d)_i$/);
    if (m) out[`${p}${m[1]}`] = v;
  }
  for (const [k, f] of [['flag_on', 'flag'], ['nwc_on', 'nwc'], ['numc_on', 'numc']]) if (data[k]) out[`${p}${f}`] = data[k];
  return { ...out, ...fills };
}
const URDU_FILLS = { u_q3: 'none', u_fs1: 'correct', u_fs2: 'wrong', u_fs4: 'none', u_fs5: 'correct', u_nw4: 'wrong' };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CHILD_TEST_ENABLED = 'true';
  seed();
});

describe('INIT', () => {
  test('opens URDU pre-filled from the urdu block, the child never by roll (L25), in the coach\'s language', async () => {
    const out = await Check.handleChildTestCheckInit(token());
    expect(out.screen).toBe('URDU');
    expect(out.data).toMatchObject({ wc_i: '41', wa_i: '45', flag_on: ['w4', 'w8'], q1_i: 'correct', q3_i: '' });
    expect(out.data.child_line).not.toMatch(/۱۴|رول/);   // the roster has a roll; it is never shown (L25)
    expect(out.data.child_line).toContain('جماعت ۳');     // Urdu digits (bd-s1oo0.27)
    expect(out.data.t_wc).toBe('درست الفاظ');
  });

  test('another coach\'s token opens an empty, closable screen and reads nothing of the child', async () => {
    const out = await Check.handleChildTestCheckInit(token('sess-1', 'coach-2'));
    expect(out.screen).toBe('URDU');
    expect(out.data).toMatchObject({ story_v: false, fb_v: false, q1_v: false, fs_sec_v: false, nwc_v: false, nw1_v: false, wc_i: '0', q1_i: 'none' });
    expect(out.data.status_line).toMatch(/دستیاب نہیں/);
    expect(out.data.child_line).toBe('');
  });

  test('a malformed token is treated the same way', async () => {
    const out = await Check.handleChildTestCheckInit('nonsense');
    expect(out.data.story_v).toBe(false);
  });

  test('with CHILD_TEST_ENABLED off the check is not available', async () => {
    process.env.CHILD_TEST_ENABLED = 'false';
    const out = await Check.handleChildTestCheckInit(token());
    expect(out.data.story_v).toBe(false);
    expect(out.data.status_line).toMatch(/دستیاب نہیں/);
  });
});

describe('timings L8 measures from (check.opened at INIT, check.submitted at the last save)', () => {
  const timings = () => mockFake.__tables.child_test_sessions[0].timings || {};

  test('INIT stamps check.opened once; reopening keeps the first time', async () => {
    await Check.handleChildTestCheckInit(token());
    const first = timings()['check.opened'];
    expect(first).toEqual(expect.any(String));
    await new Promise((r) => setTimeout(r, 5));
    await Check.handleChildTestCheckInit(token());
    expect(timings()['check.opened']).toBe(first);
  });

  test('another coach\'s token stamps nothing', async () => {
    await Check.handleChildTestCheckInit(token('sess-1', 'coach-2'));
    expect(timings()['check.opened']).toBeUndefined();
  });

  test('a timing that fails to save still opens the screen', async () => {
    const realFrom = mockFake.from;
    mockFake.from = (t) => {
      const q = realFrom(t);
      if (t !== 'child_test_sessions') return q;
      return new Proxy(q, { get: (o, k) => (k === 'update' ? () => ({ eq: () => ({ select: async () => ({ data: null, error: { message: 'down' } }) }) }) : o[k]) });
    };
    const out = await Check.handleChildTestCheckInit(token());
    mockFake.from = realFrom;
    expect(out.screen).toBe('URDU');
    expect(out.data.wc_i).toBe('41');
    expect(timings()['check.opened']).toBeUndefined();
    expect(Logger.logToFile).toHaveBeenCalledWith(expect.stringContaining('recordTiming failed'), expect.objectContaining({ key: 'check.opened' }), 'error');
  });
});

describe('each screen saves its block as it is submitted', () => {
  test('URDU: saves coach_marks + coach_edits on the urdu block, leaves ai_marks alone, returns ENGLISH', async () => {
    const aiBefore = JSON.stringify(blockRow('urdu').ai_marks);
    const init = await Check.handleChildTestCheckInit(token());
    const out = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, { ...URDU_FILLS, u_wc: '43' }));
    expect(out.screen).toBe('ENGLISH');
    expect(out.data.wc_i).toBe('17');
    const row = blockRow('urdu');
    expect(row.coach_marks.story.words_correct).toBe(43);
    expect(row.coach_edits).toEqual(expect.arrayContaining([{ path: 'story.words_correct', ai: 41, coach: 43 }]));
    expect(row.checked_at).toEqual(expect.any(String));
    expect(JSON.stringify(row.ai_marks)).toBe(aiBefore);
    const writes = mockFake.__calls.filter((c) => c.action !== 'select');
    expect(writes.every((c) => !('ai_marks' in (c.values || {})))).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('child_test.check_block_saved', expect.objectContaining({ sessionId: 'sess-1', block: 'urdu', edits: expect.any(Number) }));
  });

  test('a bad count comes back on the same screen with a message, and nothing is written', async () => {
    const init = await Check.handleChildTestCheckInit(token());
    const out = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, { ...URDU_FILLS, u_wc: '99' }));
    expect(out.screen).toBe('URDU');
    expect(Object.keys(out.data.error_messages)).toEqual(['u_wc']);
    expect(out.data.wc_i).toBe('99');
    expect(blockRow('urdu').coach_marks).toBeNull();
  });

  test('the screen id is read from the payload, as the footers post it', async () => {
    const init = await Check.handleChildTestCheckInit(token());
    const out = await Check.handleChildTestCheckDataExchange(token(), undefined, posted('URDU', init.data, URDU_FILLS));
    expect(out.screen).toBe('ENGLISH');
  });

  test('MATHS saves maths, marks the session checked and returns DONE with the session id', async () => {
    const init = await Check.handleChildTestCheckInit(token());
    const eng = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, URDU_FILLS));
    const maths = await Check.handleChildTestCheckDataExchange(token(), 'ENGLISH', posted('ENGLISH', eng.data, { e_nw8: 'none' }));
    expect(maths.screen).toBe('MATHS');
    const done = await Check.handleChildTestCheckDataExchange(token(), 'MATHS', posted('MATHS', maths.data, { m_n6: 'wrong', m_w3: 'unreadable', m_wp: 'correct' }));
    expect(done.screen).toBe('DONE');
    expect(done.data.session_id).toBe('sess-1');
    expect(blockRow('maths').coach_marks.maths.quick_sums.correct).toBe(12);
    expect(blockRow('english').checked_at).toEqual(expect.any(String));
    // L3's session status has no "checked"; the check's end is a timing, and every block has checked_at
    expect(mockFake.__tables.child_test_sessions[0].status).toBe('in_progress');
    expect(mockFake.__tables.child_test_sessions[0].timings['check.submitted']).toEqual(expect.any(String));
    expect(['urdu', 'english', 'maths'].every((b) => blockRow(b).checked_at)).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('child_test.check_done', expect.objectContaining({ sessionId: 'sess-1' }));
  });

  test('a block with no row yet (no maths recording arrived) gets one, holding only the coach\'s marks', async () => {
    seed({ urdu: F.urduConfident(), english: F.englishConfident() });
    const init = await Check.handleChildTestCheckInit(token());
    const eng = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, URDU_FILLS));
    const m = await Check.handleChildTestCheckDataExchange(token(), 'ENGLISH', posted('ENGLISH', eng.data, { e_nw8: 'none' }));
    expect(m.screen).toBe('MATHS');
    expect(m.data.qc_i).toBe('');
    expect(m.data.status_line).toMatch(/ریکارڈنگ/);
    const fills = { m_qc: '10', m_qa: '12', m_wp: 'wrong' };
    for (let i = 1; i <= 8; i += 1) fills[`m_n${i}`] = 'correct';
    for (let i = 1; i <= 4; i += 1) fills[`m_w${i}`] = 'correct';
    const done = await Check.handleChildTestCheckDataExchange(token(), 'MATHS', posted('MATHS', m.data, fills));
    expect(done.screen).toBe('DONE');
    const row = blockRow('maths');
    expect(row.ai_marks).toBeUndefined();
    expect(row.coach_marks.maths.quick_sums).toMatchObject({ correct: 10, attempted: 12 });
    expect(row.coach_edits).toEqual(expect.arrayContaining([{ path: 'maths.quick_sums.correct', ai: null, coach: 10 }]));
  });
});

describe('ownership and failures', () => {
  test('another coach\'s token saves nothing and gets the not-available DONE', async () => {
    const out = await Check.handleChildTestCheckDataExchange(token('sess-1', 'coach-2'), 'URDU', { screen: 'URDU', u_wc: '1' });
    expect(out.screen).toBe('DONE');
    expect(out.data.done_line).toMatch(/دستیاب نہیں/);
    expect(mockFake.__calls.filter((c) => c.action !== 'select')).toEqual([]);
  });

  test('a save that fails is shown to the coach and logged at error level', async () => {
    const init = await Check.handleChildTestCheckInit(token());
    // let the re-reads through and fail the write of the urdu block
    const realFrom = mockFake.from;
    mockFake.from = (t) => {
      const q = realFrom(t);
      if (t !== 'child_test_blocks') return q;
      const update = q.update;
      q.update = (v) => { mockFake.__failNext({ message: 'connection reset' }); return update(v); };
      return q;
    };
    const out = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, URDU_FILLS));
    expect(out.screen).toBe('DONE');
    expect(out.data.done_line).toBe('محفوظ نہیں ہوا');
    expect(Logger.logError).toHaveBeenCalledWith(expect.stringContaining('child_test'), expect.objectContaining({ sessionId: 'sess-1', block: 'urdu' }));
  });

  test('reopening after URDU was saved shows the coach\'s own marks', async () => {
    const init = await Check.handleChildTestCheckInit(token());
    await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, { ...URDU_FILLS, u_wc: '43' }));
    const again = await Check.handleChildTestCheckInit(token());
    expect(again.data.wc_i).toBe('43');
    expect(again.data.q3_i).toBe('none');
    expect(again.data.status_line).toMatch(/پہلے محفوظ/);
  });

  test('coach marks are written once: a saved block submitted again unchanged goes on, changed is refused on screen', async () => {
    const init = await Check.handleChildTestCheckInit(token());
    await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', init.data, { ...URDU_FILLS, u_wc: '43' }));
    const firstSave = blockRow('urdu').checked_at;
    const again = await Check.handleChildTestCheckInit(token());
    const changed = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', again.data, { u_wc: '40' }));
    expect(changed.screen).toBe('URDU');
    expect(changed.data.status_line).toMatch(/بدلا نہیں جا سکتا/);
    expect(changed.data.wc_i).toBe('43');
    expect(blockRow('urdu').coach_marks.story.words_correct).toBe(43);
    expect(blockRow('urdu').checked_at).toBe(firstSave);
    const same = await Check.handleChildTestCheckDataExchange(token(), 'URDU', posted('URDU', changed.data));
    expect(same.screen).toBe('ENGLISH');
  });
});

describe('through the encryption, the way Meta calls it', () => {
  function encrypt(body) {
    const aesKey = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(body), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const encryptedKey = crypto.publicEncrypt({ key: KEYS.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey);
    return { req: { encrypted_flow_data: enc.toString('base64'), encrypted_aes_key: encryptedKey.toString('base64'), initial_vector: iv.toString('base64') }, aesKey, iv };
  }
  function decrypt(b64, aesKey, iv) {
    const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
    const buf = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-128-gcm', aesKey, flipped);
    d.setAuthTag(buf.subarray(buf.length - 16));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
  }

  test('INIT and ping round-trip through processEncryptedRequest and the dispatcher', async () => {
    expect(FlowEncryptionService.isConfigured()).toBe(true);
    const a = encrypt({ version: '3.0', action: 'INIT', flow_token: token() });
    const res = decrypt(await FlowEncryptionService.processEncryptedRequest(a.req, Check.handleChildTestCheckFlow), a.aesKey, a.iv);
    expect(res.screen).toBe('URDU');
    expect(res.data.wc_i).toBe('41');
    expect(res.version).toBeUndefined();
    const p = encrypt({ version: '3.0', action: 'ping' });
    expect(decrypt(await FlowEncryptionService.processEncryptedRequest(p.req, Check.handleChildTestCheckFlow), p.aesKey, p.iv)).toEqual({ data: { status: 'active' } });
  });
});
