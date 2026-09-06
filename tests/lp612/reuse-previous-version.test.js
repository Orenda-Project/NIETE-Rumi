/**
 * BUMPING THE TEMPLATE VERSION MUST NOT RE-AUTHOR THE CORPUS — bd-oak77.12.
 *
 * The R2 cache key is `lp612/{tv}/{lang}/{segment}.pdf`, so moving
 * LP_612_TEMPLATE_VERSION from v9.1 to v9.2 turns every already-cached lesson into a miss.
 * Today a miss means the LLM writes the lesson again — minutes and dollars per segment, for a
 * document we already have: the worker uploads the exact document that made each PDF as
 * `lp612/{tv}/{lang}/{segment}.lp.json`, beside the PDF, on every successful run.
 *
 * So a version bump is a RE-RENDER, not a re-authoring. What is pinned here:
 *
 *   • the lineage is data, and `previousTemplateVersions` reads it — with an env override that
 *     can also be an explicit OFF switch, because the one thing worse than re-authoring is
 *     re-rendering a stored document a schema-breaking template no longer accepts;
 *   • on a hit, `authorLessonPlan` is NEVER called and the PDF still lands on the NEW key;
 *   • an Urdu reuse never re-translates — the stored `ur` document already carries `ur_overlay`;
 *   • the row can NAME a reused render (`model_used: 'reused:v9.1'`, `rounds_used: 0`), because a
 *     reused lesson that is indistinguishable from an authored one is rule 24(d) all over again;
 *   • BOTH arms are measured (rule 24(b)) — `lp612.render.reused` and `lp612.render.reuse_miss`;
 *   • a stored object that is present but unusable falls THROUGH to authoring rather than
 *     throwing or rendering a broken lesson.
 */

const mockAuthorLessonPlan = jest.fn();
const mockOverlayLessonPlan = jest.fn();
const mockRenderLessonPlan = jest.fn();
const mockUploadBuffer = jest.fn();
const mockDownloadFromR2 = jest.fn();
const mockDeliverRender = jest.fn();
const mockReadFile = jest.fn();
const mockLogEvent = jest.fn();

jest.mock('../../bot/shared/services/lp612-author.service', () => ({
  authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
  overlayLessonPlan: (...a) => mockOverlayLessonPlan(...a),
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: (...a) => mockRenderLessonPlan(...a),
}));
jest.mock('../../bot/shared/storage/r2', () => ({
  uploadBuffer: (...a) => mockUploadBuffer(...a),
  downloadFromR2: (...a) => mockDownloadFromR2(...a),
}));
// The serving service is the REAL one apart from the send: `readStoredDoc` is the code under
// test here, and a double for it would make this suite pass while production still re-authored.
jest.mock('../../bot/shared/services/lp612-serving.service', () => {
  const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
  return { ...real, deliverRender: (...a) => mockDeliverRender(...a) };
});
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: (...a) => mockLogEvent(...a) }));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: { ...jest.requireActual('fs').promises, readFile: (...a) => mockReadFile(...a) },
}));

const mockDbCalls = [];
const mockDbResults = [];
function mockBuilder(table) {
  const state = { table, op: null, payload: null, filters: [] };
  const settle = () => {
    mockDbCalls.push({ ...state });
    if (state.op === 'update') {
      const idFilter = state.filters.find((f) => f[0] === 'id');
      return Promise.resolve({ data: { id: idFilter ? idFilter[1] : 'row' }, error: null });
    }
    return Promise.resolve(mockDbResults.length ? mockDbResults.shift() : { data: null, error: null });
  };
  const b = {
    update: (p) => { state.op = 'update'; state.payload = p; return b; },
    select: () => b,
    eq: (c, v) => { state.filters.push([c, v]); return b; },
    single: settle,
    maybeSingle: settle,
    then: (res, rej) => settle().then(res, rej),
  };
  return b;
}
const WAITERS = [{ user_id: 'u1', phone: '923001111111' }];
const mockRpc = jest.fn(() => Promise.resolve({ data: WAITERS, error: null }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((t) => mockBuilder(t)),
  rpc: (...a) => mockRpc(...a),
}));

const Worker = require('../../bot/workers/lp612-author.worker');
const Flags = require('../../bot/shared/config/lp612-flags');

const SEG_ID = 'grade_9_chemistry.c01.p007-008';

const JOB = {
  renderId: 'render-1',
  segmentId: SEG_ID,
  lang: 'en',
  templateVersion: 'v9.2',
  correlationId: 'corr-1',
};

const SEGMENT = {
  segment_id: SEG_ID,
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  subtopic_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  language: 'en',
  is_religious: false,
};

/** A stored document, of the shape the worker uploaded beside the v9.1 PDF. */
const STORED_DOC = {
  lesson_id: 'grade_9_chemistry.c01.p007-008',
  schema_version: '2.0',
  template_version: 'v9.1',
  one_screen: 'Branches of chemistry, in one screen.',
  materials: ['blackboard'],
  objectives: ['name the branches'],
  sections: [{ id: 'introduction', minutes: 5, blocks: [] }],
  page2: { practice: [] },
};

const STORED_DOC_UR = { ...STORED_DOC, ur_overlay: { '/one_screen': 'کیمیا کی شاخیں' } };

function seed(seg = SEGMENT) {
  mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
  mockDbResults.push({ data: seg, error: null });
}

/** downloadFromR2 that resolves ONLY for the keys named, and rejects everything else the way R2
 *  does on a miss — the shape `readStoredDoc` has to tolerate without throwing. */
function r2Holding(map) {
  mockDownloadFromR2.mockImplementation(async (key) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      return Buffer.from(map[key], 'utf8');
    }
    throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' });
  });
}

const lastPatch = () => mockDbCalls.filter((c) => c.op === 'update').pop();
const eventsNamed = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);
const uploadedKeys = () => mockUploadBuffer.mock.calls.map((c) => c[1]);
const uploadedJson = () => {
  const call = mockUploadBuffer.mock.calls.find((c) => /\.lp\.json$/.test(c[1]));
  return call ? JSON.parse(call[0].toString('utf8')) : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDbCalls.length = 0;
  mockDbResults.length = 0;
  delete process.env.LP_612_TEMPLATE_FALLBACK;
  mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
  mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
  mockUploadBuffer.mockResolvedValue('ok');
  mockDownloadFromR2.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
  mockAuthorLessonPlan.mockResolvedValue({
    lpDoc: { lesson_id: 'freshly-authored', one_screen: 'new', sections: [] },
    lintClean: true, fails: [], warns: [], rounds: 3,
    model: 'anthropic/claude-sonnet-5',
  });
  mockOverlayLessonPlan.mockResolvedValue({
    overlay: { '/one_screen': 'خلاصہ' }, coverage: 1, usage: { total_tokens: 1 },
  });
  mockRenderLessonPlan.mockResolvedValue({
    pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 9, warnings: [],
    pagesByPart: { teach: 5, support: 4 }, overlayApplied: ['/one_screen'],
  });
});

afterEach(() => { delete process.env.LP_612_TEMPLATE_FALLBACK; });

// ── 1 · the lineage is data, and it has an off switch ───────────────────────

describe('previousTemplateVersions', () => {
  test('v9.2 falls back to v9.1', () => {
    expect(Flags.previousTemplateVersions('v9.2')).toEqual(['v9.1']);
  });

  test('the oldest version in the lineage has nothing behind it', () => {
    expect(Flags.previousTemplateVersions('v9.1')).toEqual([]);
  });

  test('an unknown version claims no ancestry rather than guessing one', () => {
    expect(Flags.previousTemplateVersions('v10.0')).toEqual([]);
  });

  test('LP_612_TEMPLATE_FALLBACK overrides the lineage exactly, and drops tv itself', () => {
    process.env.LP_612_TEMPLATE_FALLBACK = 'v9.1, v9.0 ,v9.2';
    expect(Flags.previousTemplateVersions('v9.2')).toEqual(['v9.1', 'v9.0']);
  });

  test('an EMPTY LP_612_TEMPLATE_FALLBACK is the off switch — no reuse at all', () => {
    process.env.LP_612_TEMPLATE_FALLBACK = '';
    expect(Flags.previousTemplateVersions('v9.2')).toEqual([]);
  });

  test('the lineage lists only versions today\'s renderer accepts, newest first', () => {
    expect(Flags.TEMPLATE_VERSION_LINEAGE[0]).toBe(Flags.DEFAULT_TEMPLATE_VERSION);
  });
});

// ── 2 · the load-bearing one: a v9.2 miss re-renders v9.1 with ZERO LLM calls ──

describe('a template bump re-renders the stored document instead of re-authoring it', () => {
  test('no LLM call, new key, and the row names the reuse', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify(STORED_DOC) });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    // THE POINT OF THE WHOLE LANE.
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    // …and the render still happened, onto the NEW version's key.
    expect(mockRenderLessonPlan).toHaveBeenCalledTimes(1);
    expect(uploadedKeys()[0]).toBe(`lp612/v9.2/en/${SEG_ID}.pdf`);
    expect(uploadedKeys()).toContain(`lp612/v9.2/en/${SEG_ID}.lp.json`);
    // The document that was drawn is the stored one, not something re-invented.
    expect(mockRenderLessonPlan.mock.calls[0][0].lpDoc).toMatchObject({ lesson_id: STORED_DOC.lesson_id });

    // Rule 24(d): a reused render is NAMEABLE on the row.
    const done = lastPatch();
    expect(done.payload).toMatchObject({
      status: 'ready',
      r2_key: `lp612/v9.2/en/${SEG_ID}.pdf`,
      model_used: 'reused:v9.1',
      rounds_used: 0,
    });
    expect(done.payload.lint_clean).toBeNull();
    expect(done.payload.lint_fails).toBeNull();

    // Rule 24(b): the hit arm is measured.
    const reused = eventsNamed('lp612.render.reused');
    expect(reused.length).toBe(1);
    expect(reused[0][1]).toMatchObject({
      renderId: 'render-1',
      segmentId: SEG_ID,
      lang: 'en',
      fromVersion: 'v9.1',
      toVersion: 'v9.2',
      llmCalls: 0,
    });
    expect(eventsNamed('lp612.render.reuse_miss').length).toBe(0);
  });

  test('the one_screen served to the teacher comes from the stored document', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify(STORED_DOC) });
    seed();
    await Worker.process(JOB);
    expect(lastPatch().payload.one_screen).toBe(STORED_DOC.one_screen);
  });
});

// ── 3 · an Urdu reuse never re-translates ───────────────────────────────────

describe('a reused Urdu document is not translated a second time', () => {
  const UR_JOB = { ...JOB, lang: 'ur' };

  test('overlayLessonPlan is never called, and the stored document is what is delivered', async () => {
    r2Holding({ [`lp612/v9.1/ur/${SEG_ID}.lp.json`]: JSON.stringify(STORED_DOC_UR) });
    seed({ ...SEGMENT, language: 'en' });   // an ENGLISH-medium book, asked for in Urdu

    const out = await Worker.process(UR_JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).not.toHaveBeenCalled();
    // The stored `ur` document ALREADY carries ur_overlay — re-running the pass is pure spend and
    // could change the lesson under a teacher who has already been served it.
    expect(mockOverlayLessonPlan).not.toHaveBeenCalled();
    expect(uploadedKeys()[0]).toBe(`lp612/v9.2/ur/${SEG_ID}.pdf`);
    expect(uploadedJson()).toMatchObject({ ur_overlay: STORED_DOC_UR.ur_overlay });
  });
});

// ── 4 · the miss arm, and the normal path untouched ─────────────────────────

describe('nothing stored anywhere', () => {
  test('the lesson is authored exactly as it is today, and the miss is measured', async () => {
    mockDownloadFromR2.mockRejectedValue(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(lastPatch().payload.model_used).toBe('anthropic/claude-sonnet-5');
    expect(lastPatch().payload.rounds_used).toBe(3);

    // Rule 24(b): a denominator that only exists when things go well is not a denominator.
    const miss = eventsNamed('lp612.render.reuse_miss');
    expect(miss.length).toBe(1);
    expect(miss[0][1]).toMatchObject({
      renderId: 'render-1', segmentId: SEG_ID, toVersion: 'v9.2', tried: ['v9.1'],
    });
    expect(eventsNamed('lp612.render.reused').length).toBe(0);
  });

  test('with reuse switched off, neither arm is emitted — there was no attempt to report', async () => {
    process.env.LP_612_TEMPLATE_FALLBACK = '';
    seed();
    await Worker.process(JOB);
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(mockDownloadFromR2).not.toHaveBeenCalled();
    expect(eventsNamed('lp612.render.reused').length).toBe(0);
    expect(eventsNamed('lp612.render.reuse_miss').length).toBe(0);
  });
});

// ── 5 · present but unusable is not the same fact as absent ─────────────────

describe('a stored object that is present but unusable', () => {
  test('unparseable JSON falls through to authoring rather than throwing', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: '{"lesson_id": "half a doc"' });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(eventsNamed('lp612.render.reused').length).toBe(0);
  });

  test('a JSON object with no sections is refused — never rendered into a broken lesson', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: JSON.stringify({ lesson_id: 'x', note: 'not a doc' }) });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
    expect(mockRenderLessonPlan.mock.calls[0][0].lpDoc.lesson_id).toBe('freshly-authored');
  });

  test('a JSON scalar is not a document', async () => {
    r2Holding({ [`lp612/v9.1/en/${SEG_ID}.lp.json`]: '"just a string"' });
    seed();

    const out = await Worker.process(JOB);

    expect(out.status).toBe('ready');
    expect(mockAuthorLessonPlan).toHaveBeenCalledTimes(1);
  });
});
