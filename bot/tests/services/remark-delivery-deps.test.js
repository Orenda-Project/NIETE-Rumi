/**
 * The seam between the live wiring and the pure service.
 *
 * remark-delivery.test.js exercises submitRemark with hand-built deps, and every
 * score row it writes is already shaped {ordinal, score}. Nothing exercised
 * makeDeliveryDeps — the code that actually produces those rows in production —
 * so the suite stayed green while no teacher ever received a coaching note.
 *
 * What broke: loadScores selected `indicator_ordinal` and returned the rows
 * untouched, while computeS requires `ordinal` and throws on anything else. That
 * throw happens ABOVE both try/catch blocks in submitRemark, so it took the
 * narrative, the teacher's note AND the principal's confirmation with it. Scores
 * still persisted and the principal still saw SUCCESS, which is why it looked
 * healthy from the outside.
 *
 * The retry worker got this right all along (it maps indicator_ordinal → ordinal),
 * so these tests pin the contract at the boundary the two halves disagreed about:
 * whatever loadScores returns must be something computeS accepts.
 */
const path = require('path');

const SUPABASE_PATH = path.join(__dirname, '../../shared/config/supabase.js');

/** Chainable stub returning the row shape PostgREST really hands back. */
function makeStub(rows) {
  const calls = { from: [], select: [], eq: [] };
  const chain = {
    select(cols) { calls.select.push(cols); return chain; },
    eq(col, val) { calls.eq.push([col, val]); return chain; },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
  return { calls, client: { from(t) { calls.from.push(t); return chain; } } };
}

function loadDeps(stubClient) {
  jest.resetModules();
  jest.doMock(SUPABASE_PATH, () => stubClient, { virtual: false });
  jest.doMock(path.join(__dirname, '../../shared/utils/logger.js'), () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
  }));
  const { makeDeliveryDeps } = require('../../shared/services/remark/remark-delivery.deps');
  return makeDeliveryDeps({
    principal: { id: 'p-1', phone_number: '923001234567', first_name: 'Sara' },
    teacherLabelFor: () => 'Ayesha Bibi',
  });
}

afterEach(() => { jest.resetModules(); jest.dontMock(SUPABASE_PATH); });

// The five STEPS indicators as Postgres returns them.
const DB_ROWS = [
  { indicator_ordinal: 1, score: 3 },
  { indicator_ordinal: 2, score: 4 },
  { indicator_ordinal: 3, score: 2 },
  { indicator_ordinal: 4, score: 3 },
  { indicator_ordinal: 5, score: 4 },
];

describe('loadScores returns rows computeS can read', () => {
  test('every row carries a numeric `ordinal`, not just `indicator_ordinal`', async () => {
    const deps = loadDeps(makeStub(DB_ROWS).client);
    const rows = await deps.loadScores('r-1');

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(typeof row.ordinal).toBe('number');
      expect(typeof row.score).toBe('number');
    }
  });

  test('computeS accepts them — the throw that killed every delivery', async () => {
    const deps = loadDeps(makeStub(DB_ROWS).client);
    const rows = await deps.loadScores('r-1');

    // Required after the mock so the module under test shares it.
    const { computeS } = require('../../shared/services/remark/remark-rubric');
    expect(() => computeS(rows)).not.toThrow();

    const { s_score, s_pct } = computeS(rows);
    expect(s_score).toBe(16);
    expect(typeof s_pct).toBe('number');
  });

  test('the ordinals survive the mapping in order', async () => {
    const deps = loadDeps(makeStub(DB_ROWS).client);
    const rows = await deps.loadScores('r-1');
    expect(rows.map((r) => r.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((r) => r.score)).toEqual([3, 4, 2, 3, 4]);
  });

  test('an empty result stays empty rather than becoming a bad row', async () => {
    const deps = loadDeps(makeStub([]).client);
    await expect(deps.loadScores('r-1')).resolves.toEqual([]);
  });

  test('still reads the scores table, scoped to the remark', async () => {
    const stub = makeStub(DB_ROWS);
    const deps = loadDeps(stub.client);
    await deps.loadScores('r-1');
    expect(stub.calls.from).toEqual(['supervisor_remark_scores']);
    expect(stub.calls.eq).toEqual([['remark_id', 'r-1']]);
  });
});

/**
 * bd-43519 — the 24-hour window.
 *
 * sendToTeacher sent ONE free-form text and treated a false return as terminal.
 * WhatsApp only accepts free-form inside 24h of the teacher's last inbound
 * message, and a principal scoring her whole roster in one sitting is scoring
 * teachers who are mostly cold — so the note was rejected by Meta, the remark
 * was marked deliveryPending, and the retry worker that would have re-sent it is
 * scheduled nowhere. The teacher was told nothing, and the principal was told
 * "it will retry".
 *
 * A UTILITY template IS accepted outside the window. These tests pin the
 * fallback: free-form first (free, no approval coupling), template second.
 *
 * Class P (pre-merge): whatsapp.service is a FIRST-PARTY module being mocked, so
 * the last test here asserts the real module still exposes the surface the mock
 * pretends to have. Without it the mock can drift into fiction and these tests
 * would keep passing against a method that no longer exists.
 */
const WA_PATH = path.join(__dirname, '../../shared/services/whatsapp.service.js');
const { templateCodeFor } = require('../../shared/config/languages');

const NARRATIVE = {
  opening: 'What a term you have had.',
  strengths: 'You listen closely  to your students.\nYou adjust when it is not landing.',
  growth: 'Your next horizon is the quieter students.',
  action_plan: 'Ask one question, then wait five seconds.',
};

function loadDepsWithWa(wa, rows = DB_ROWS) {
  jest.resetModules();
  jest.doMock(SUPABASE_PATH, () => makeStub(rows).client, { virtual: false });
  jest.doMock(path.join(__dirname, '../../shared/utils/logger.js'), () => ({
    logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(),
  }));
  jest.doMock(WA_PATH, () => wa, { virtual: false });
  const { makeDeliveryDeps } = require('../../shared/services/remark/remark-delivery.deps');
  return makeDeliveryDeps({
    principal: { id: 'p-1', phone_number: '923001234567', first_name: 'Sara' },
    teacherLabelFor: () => 'Ayesha Bibi',
  });
}

const TEACHER_EN = { id: 't-1', first_name: 'Fatima', phone_number: '923273222269', preferred_language: 'en' };
const TEACHER_UR = { id: 't-2', first_name: 'Ayesha', phone_number: '923273222270', preferred_language: 'ur' };

afterEach(() => { jest.dontMock(WA_PATH); });

describe('sendToTeacher falls back to a template outside the 24h window', () => {
  test('a rejected free-form send is retried as the UTILITY template', async () => {
    const wa = { sendMessage: jest.fn().mockResolvedValue(false), sendTemplate: jest.fn().mockResolvedValue(true) };
    const deps = loadDepsWithWa(wa);
    await expect(deps.sendToTeacher({ teacher: TEACHER_EN, narrative: NARRATIVE, language: 'en' }))
      .resolves.toBeTruthy();
    expect(wa.sendMessage).toHaveBeenCalledTimes(1);
    expect(wa.sendTemplate).toHaveBeenCalledTimes(1);
    const [to, name, lang] = wa.sendTemplate.mock.calls[0];
    expect(to).toBe('923273222269');
    expect(name).toBe('remark_teacher_feedback_v1');
    expect(lang).toBe('en_US');           // NOT 'en' — Meta hard-fails on that
  });

  test("the Urdu teacher gets the Urdu template, via the registry's code", async () => {
    const wa = { sendMessage: jest.fn().mockResolvedValue(false), sendTemplate: jest.fn().mockResolvedValue(true) };
    const deps = loadDepsWithWa(wa);
    await deps.sendToTeacher({ teacher: TEACHER_UR, narrative: NARRATIVE, language: 'ur' });
    expect(wa.sendTemplate.mock.calls[0][2]).toBe(templateCodeFor('ur'));
  });

  test('the five body params are name + the four narrative sections, in shape order', async () => {
    const wa = { sendMessage: jest.fn().mockResolvedValue(false), sendTemplate: jest.fn().mockResolvedValue(true) };
    const deps = loadDepsWithWa(wa);
    await deps.sendToTeacher({ teacher: TEACHER_EN, narrative: NARRATIVE, language: 'en' });
    const components = wa.sendTemplate.mock.calls[0][3];
    const body = components.find((c) => c.type === 'body');
    expect(body.parameters.map((p) => p.text)).toEqual([
      'Fatima',
      NARRATIVE.opening,
      'You listen closely to your students. You adjust when it is not landing.',
      NARRATIVE.growth,
      NARRATIVE.action_plan,
    ]);
  });

  test('no param carries a newline, tab or run of spaces — Meta rejects the whole send', async () => {
    const wa = { sendMessage: jest.fn().mockResolvedValue(false), sendTemplate: jest.fn().mockResolvedValue(true) };
    const deps = loadDepsWithWa(wa);
    await deps.sendToTeacher({ teacher: TEACHER_EN, narrative: NARRATIVE, language: 'en' });
    const body = wa.sendTemplate.mock.calls[0][3].find((c) => c.type === 'body');
    for (const p of body.parameters) {
      expect(p.text).not.toMatch(/[\n\r\t]/);
      expect(p.text).not.toMatch(/ {5}/);
    }
  });

  test('a teacher inside the window costs no template send', async () => {
    const wa = { sendMessage: jest.fn().mockResolvedValue(true), sendTemplate: jest.fn().mockResolvedValue(true) };
    const deps = loadDepsWithWa(wa);
    await deps.sendToTeacher({ teacher: TEACHER_EN, narrative: NARRATIVE, language: 'en' });
    expect(wa.sendMessage).toHaveBeenCalledTimes(1);
    expect(wa.sendTemplate).not.toHaveBeenCalled();
  });

  test('when BOTH fail it throws, so the remark stays deliveryPending', async () => {
    const wa = { sendMessage: jest.fn().mockResolvedValue(false), sendTemplate: jest.fn().mockResolvedValue(false) };
    const deps = loadDepsWithWa(wa);
    await expect(deps.sendToTeacher({ teacher: TEACHER_EN, narrative: NARRATIVE, language: 'en' }))
      .rejects.toThrow(/deliver/i);
  });

  test('Class P: the real whatsapp.service really exposes what the mock fakes', () => {
    jest.resetModules();
    // whatsapp.service → storage/r2.js → @aws-sdk, a bot-only dep absent when
    // the root suite runs (CI does root `npm test` BEFORE `bot/ npm ci`).
    // Mocked virtually so this guard can load the REAL service either way.
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: class {}, PutObjectCommand: class {},
      DeleteObjectCommand: class {}, GetObjectCommand: class {},
    }), { virtual: true });
    jest.doMock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }), { virtual: true });
    const real = require('../../shared/services/whatsapp.service');
    expect(typeof real.sendMessage).toBe('function');
    expect(typeof real.sendTemplate).toBe('function');
  });
});
