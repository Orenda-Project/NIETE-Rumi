/**
 * Word is built but not good enough to offer yet.
 *
 * The .docx IS a real Word file — `file(1)` says "Microsoft Word 2007+" and the
 * bytes start PK\x03\x04, so the renderer/extension contract holds. What it is
 * not is a good PAPER: the marking header stacks as separate lines instead of a
 * table, there are no borders, and the question layout is flat. A teacher who
 * picks Word to edit her paper gets something worse than the PDF.
 *
 * So it ships dark behind its own flag, separate from the generator's and from
 * editing's, and is improved incrementally.
 *
 * Two gates, not one. Hiding the option is a UI courtesy; refusing the FORMAT is
 * the gate — a stale client, a replayed completion, or anyone posting the
 * payload by hand must not be able to ask for a format the deployment has
 * switched off.
 */

const mockFlag = jest.fn();
jest.mock('../../bot/shared/config/feature-flags', () => ({
  isAssessmentGeneratorEnabled: jest.fn().mockResolvedValue(true),
  isAssessmentEditingEnabled: jest.fn().mockResolvedValue(false),
  isAssessmentDocxEnabled: (...a) => mockFlag(...a),
  ASSESSMENT_GENERATOR_KEY: 'assessment_generator_enabled',
  ASSESSMENT_EDITING_KEY: 'assessment_editing_enabled',
  ASSESSMENT_DOCX_KEY: 'assessment_docx_enabled',
}));

const { formatsOnOffer, resolveFormat } =
  require('../../bot/shared/services/assessment/assessment-format');

beforeEach(() => { jest.clearAllMocks(); mockFlag.mockResolvedValue(false); });

describe('what the confirm screen offers', () => {
  test('flag OFF: PDF only — Word is not shown at all', async () => {
    expect((await formatsOnOffer()).map((o) => o.id)).toEqual(['pdf']);
  });

  test('flag ON: both, PDF first so it stays the pre-selected default', async () => {
    mockFlag.mockResolvedValue(true);
    const offered = await formatsOnOffer();
    expect(offered.map((o) => o.id)).toEqual(['pdf', 'docx']);
    expect(offered[0].id).toBe('pdf');
  });

  test('every offered option carries a title a teacher can read', async () => {
    mockFlag.mockResolvedValue(true);
    for (const o of await formatsOnOffer()) {
      expect(typeof o.title).toBe('string');
      expect(o.title.length).toBeGreaterThan(3);
    }
  });
});

describe('what the server will actually render', () => {
  test('flag OFF: a docx request falls back to PDF rather than being honoured', async () => {
    // The gate, not the courtesy. A stale client still has the old screen and
    // will happily post output_format=docx.
    expect(await resolveFormat('docx')).toBe('pdf');
    expect(await resolveFormat('word')).toBe('pdf');
  });

  test('flag ON: a docx request is honoured', async () => {
    mockFlag.mockResolvedValue(true);
    expect(await resolveFormat('docx')).toBe('docx');
    expect(await resolveFormat('word')).toBe('docx');
  });

  test('pdf is unaffected either way', async () => {
    expect(await resolveFormat('pdf')).toBe('pdf');
    mockFlag.mockResolvedValue(true);
    expect(await resolveFormat('pdf')).toBe('pdf');
  });

  test('nonsense still falls back to PDF, flag or no flag', async () => {
    for (const v of ['rtf', '', undefined, null]) {
      expect(await resolveFormat(v)).toBe('pdf');
    }
    mockFlag.mockResolvedValue(true);
    for (const v of ['rtf', '', undefined, null]) {
      expect(await resolveFormat(v)).toBe('pdf');
    }
  });

  test('the flag failing closed means PDF, never a broken Word paper', async () => {
    mockFlag.mockRejectedValue(new Error('supabase down'));
    expect(await resolveFormat('docx')).toBe('pdf');
  });
});

describe('the renderer contract is untouched by the gate', () => {
  const { rendererFor } = require('../../bot/shared/services/assessment/assessment-format');

  test('rendererFor still binds extension to renderer', () => {
    // The gate decides WHICH format; rendererFor still guarantees the bytes and
    // the filename agree. Those are separate jobs and must stay that way.
    expect(rendererFor('docx').ext).toBe('docx');
    expect(rendererFor('pdf').ext).toBe('pdf');
  });
});

describe('the CONFIRM screen is driven by the flag, end to end', () => {
  const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  const mockSupabase = { from: jest.fn() };
  jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
  jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
  jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.mock('../../bot/shared/services/queue', () => ({ queueJob: jest.fn() }));

  const { handleAssessmentGenDataExchange: exchange } =
    require('../../bot/shared/routes/assessment-gen-endpoint');

  const SESSION = {
    userId: 'u1', grade: 4, subject: 'science', chapterNumber: 3,
    pageRanges: '34-41', questionCount: 10, questionTypes: [], contentSource: 'unseen',
  };

  beforeEach(() => {
    mockRedis.get.mockResolvedValue(SESSION);
    mockRedis.set.mockResolvedValue(true);
    mockFlag.mockResolvedValue(false);
  });

  test('flag OFF: the screen offers PDF only', async () => {
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '10', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.screen).toBe('CONFIRM');
    expect(res.data.formats.map((f) => f.id)).toEqual(['pdf']);
  });

  test('flag ON: the screen offers both, PDF first', async () => {
    mockFlag.mockResolvedValue(true);
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '10', pick_types: false }, 'u1:assessment-gen:1');
    expect(res.data.formats.map((f) => f.id)).toEqual(['pdf', 'docx']);
  });

  test('the screen data is RESOLVED, never a bare promise', async () => {
    // confirmScreen became async to consult the flag. A caller that forgot to
    // await it would put a Promise where the Flow expects an array, and the
    // client would render an empty list — the same silent shape as the
    // NavigationList cap.
    const res = await exchange('u1', 'QUESTIONS',
      { content_source: 'unseen', question_count: '10', pick_types: false }, 'u1:assessment-gen:1');
    expect(Array.isArray(res.data.formats)).toBe(true);
    expect(typeof res.data.formats.then).toBe('undefined');
  });
});
