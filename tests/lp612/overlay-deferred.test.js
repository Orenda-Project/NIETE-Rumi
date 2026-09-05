/**
 * bd-zle0u, STEP 1 — THE URDU TOGGLE IS NO LONGER AUTHORED INSIDE THE REVISION LADDER.
 *
 * The history in one paragraph. For the whole life of this lane the per-request directive told
 * the model *"the Urdu toggle is built by a separate pass over the finished document. Do NOT emit
 * ur_overlay yourself"* — and that pass **did not exist**, so every English-medium book requested
 * in Urdu was delivered in English (6 of 6 ever, `overlay_dropped = true`). bd-vnyuw removed the
 * directive and made `OVERLAY_MISSING` a blocking lint defect, so the model now emits the overlay
 * inline. That works — 89 pointers, 89 applied, a 68.4 % Urdu PDF — and it costs **~+7,000
 * completion tokens on EVERY round of a five-round ladder** (measured 2026-09-05: 9–14k for the
 * non-overlay cells, 18–21k for the three overlay cells). All three overlay cells then hit
 * `AUTHOR_TIMEOUT` at 840 s. A teacher who picked «اردو» waited 14 minutes and got NOTHING, where
 * before she at least got an English lesson. That is worse, and it is live.
 *
 * So the overlay comes OUT of the ladder. This suite pins step 1 — the half that stops the
 * bleeding today:
 *
 *   1. the directive tells the model to author English and emit NO inline overlay — and, unlike
 *      the sentence that caused bd-vnyuw, what it says about the separate pass is enforced in
 *      code here rather than merely asserted in a prompt;
 *   2. `OVERLAY_MISSING` no longer gates the LADDER (`overlayExpected: false`) — it is the gate
 *      the overlay pass answers to, not a defect five authoring rounds must chase;
 *   3. a stray `ur_overlay` the model writes anyway is STRIPPED before the gates, so a
 *      half-overlaid document can never reach the renderer and serve half-Urdu prose;
 *   4. the delivery is honest: `overlay_dropped` on the row, a DISTINCT `lp612.overlay.deferred`
 *      event (rule 24(b): a deliberate deferral and a failed translation are different states and
 *      must not share one counter), and a caption that names the actual state in both languages.
 *
 * Rule 24(c) throughout: the prompt's contract is asserted in CODE, never trusted to compliance.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint, overlayDefects } = require(path.join(V, 'lint_lp.js'));

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const doc = (mut = (d) => d) => mut(JSON.parse(rawFixture));
const codes = (d, opts) => (lint(d, null, opts).fails || []).map(String).map((e) => e.split(/[\s:]/)[0]);

// ── 1 · the directive ───────────────────────────────────────────────────────

describe('the LANGUAGE directive defers the overlay instead of demanding it inline', () => {
  const { buildUserPrompt } = require('../../bot/shared/services/lp612-author.service');

  const segment = {
    segment_id: 'grade_9_chemistry.c01.p007-008',
    book_stem: 'grade_9_chemistry',
    grade: 9,
    subject: 'Chemistry',
    language: 'en',
    period_minutes: 40,
  };
  const bundle = { book: { medium: 'en', title: 'Chemistry 9', grade: 9, offset: 0 }, pages: [] };
  const langSection = (lang, medium) => {
    const b = { ...bundle, book: { ...bundle.book, medium } };
    const p = buildUserPrompt({ segment: { ...segment, language: medium }, bundle: b, lang, video: null });
    return p.slice(p.indexOf('## LANGUAGE'), p.indexOf('lesson_id:'));
  };

  it('EN-medium book asked for in Urdu: author in ENGLISH, emit NO inline overlay', () => {
    const s = langSection('ur', 'en');
    expect(s).toMatch(/ENGLISH/);
    expect(s).toMatch(/\bno\b[^.]*ur_overlay|ur_overlay[^.]*\bnot\b/i);
  });

  it('and it says WHEN the Urdu layer is built — after this document is accepted', () => {
    // The bd-vnyuw sentence was a lie because nothing built the overlay afterwards. This one is
    // true, and step 2 is what makes it true; the test that the pass exists is its own.
    const s = langSection('ur', 'en');
    expect(s).toMatch(/accepted|after/i);
    expect(s).toMatch(/separate/i);
  });

  it('UR-medium book still emits NO overlay — self-translation stays banned', () => {
    expect(langSection('ur', 'ur')).toMatch(/no ur_overlay|NO ur_overlay/i);
  });

  it('an English request against an English book still says nothing about the overlay', () => {
    expect(langSection('en', 'en')).not.toMatch(/ur_overlay/);
  });
});

// ── 2 · OVERLAY_MISSING stops gating the LADDER, and survives for the pass ──

describe('OVERLAY_MISSING is the overlay pass\'s gate, not the ladder\'s', () => {
  it('is SILENT when the caller says no inline overlay is expected', () => {
    // This is the whole timeout fix: the ladder no longer spends rounds on a defect whose repair
    // costs +7k output tokens each time.
    expect(codes(doc(), { lang: 'ur', overlayExpected: false })).not.toContain('OVERLAY_MISSING');
  });

  it('still FIRES by default — the pass checks its own output with it', () => {
    expect(codes(doc(), { lang: 'ur' })).toContain('OVERLAY_MISSING');
    expect(codes(doc(), { lang: 'ur', overlayExpected: true })).toContain('OVERLAY_MISSING');
  });

  it('the flag cannot resurrect the gate on an English render', () => {
    expect(codes(doc(), { lang: 'en', overlayExpected: true })).not.toContain('OVERLAY_MISSING');
  });

  it('overlayDefects takes the same switch directly, so the two cannot drift', () => {
    const d = doc();
    expect(overlayDefects(d, 'ur').map((x) => x.code)).toContain('OVERLAY_MISSING');
    expect(overlayDefects(d, 'ur', { expected: false })).toHaveLength(0);
  });
});

// ── 3 · a stray overlay never reaches the renderer ──────────────────────────

describe('the ladder hands back a document with NO ur_overlay on it', () => {
  jest.resetModules();
  jest.mock('../../bot/shared/services/llm-client', () => {
    const create = jest.fn();
    return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
  });

  const create = require('../../bot/shared/services/llm-client').__create;
  const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
  const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

  const BOOK = {
    title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9,
    medium: 'en', language: 'English', offset: 4,
  };
  const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
  const SEGMENT = {
    segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
    medium: 'en', language: 'English', chapter_number: 1,
    chapter_title: 'The Biological Method', chapter_key: 'g9-bio-ch1',
    subtopic_title: 'Observation and hypothesis', menu_title: 'Observation & hypothesis',
    section_ref: '1.2', printed_page_start: 11, printed_page_end: 12, pages_covered: [11, 12],
    order_index: 3, lp_type: 'SCI-9-10', segment_index: 1, day_number: 1, skill_type: 'concept',
    slo_text: 'Describe the steps of the biological method.', yt: null, notes: null,
  };
  const reply = (obj) => ({
    choices: [{ message: { content: JSON.stringify(obj) } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });

  let dir;
  beforeEach(() => {
    jest.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-defer-'));
    const d = path.join(dir, SEGMENT.book_stem);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
    fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
    for (const n of [11, 12]) {
      fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
        printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
        blocks: [
          { t: 'heading', text: `1.${n} Observation` },
          { t: 'prose', text: `The observable body text of printed page ${n}.` },
        ],
      }));
    }
    process.env.LP612_PAGE_TRUTH_DIR = dir;
    process.env.LP612_AUTHOR_ROUNDS = '0';
  });
  afterEach(() => {
    delete process.env.LP612_PAGE_TRUTH_DIR;
    delete process.env.LP612_AUTHOR_ROUNDS;
  });

  it('strips an ur_overlay the model wrote anyway — a half-Urdu render is never served', async () => {
    const withOverlay = JSON.parse(JSON.stringify(CLEAN_DOC));
    withOverlay.ur_overlay = { '/one_screen': 'خلاصہ' };
    create.mockResolvedValueOnce(reply(withOverlay));

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'ur' });

    expect(out.lpDoc.ur_overlay).toBeUndefined();
  });

  it('and does NOT spend a round on OVERLAY_MISSING — the ladder is not the overlay\'s gate', async () => {
    create.mockResolvedValue(reply(JSON.parse(JSON.stringify(CLEAN_DOC))));
    process.env.LP612_AUTHOR_ROUNDS = '3';

    const out = await authorLessonPlan({ segment: SEGMENT, lang: 'ur' });

    expect(out.fails.map(String).join(' ')).not.toMatch(/OVERLAY_MISSING/);
    expect(out.rounds).toBe(0);
  });
});

// ── 4 · the delivery is honest, in both languages ───────────────────────────

describe('the teacher is told, in her own language, that this copy is English', () => {
  const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');
  const cp = (s) => [...s].length;

  it('the honesty line exists in BOTH languages — a partial map degrades Urdu to English', () => {
    const s = UX_STRINGS.lp612OverlayDropped;
    expect(typeof s.en).toBe('string');
    expect(typeof s.ur).toBe('string');
  });

  it('it names the actual state — English now, Urdu still being prepared', () => {
    expect(UX_STRINGS.lp612OverlayDropped.en).toMatch(/English/);
    expect(UX_STRINGS.lp612OverlayDropped.en).toMatch(/Urdu/);
    // Rule 24(d): it must not claim the lesson is partly Urdu. Every one of these deliveries is
    // English end to end.
    expect(UX_STRINGS.lp612OverlayDropped.en).not.toMatch(/partly in Urdu/i);
  });

  it('the Urdu line is written in Urdu script, not Roman Urdu', () => {
    const ur = UX_STRINGS.lp612OverlayDropped.ur;
    const urduChars = (ur.match(/[؀-ۿ]/g) || []).length;
    expect(urduChars / [...ur].length).toBeGreaterThan(0.5);
  });

  it('both fit the caption body cap, measured in CODE POINTS', () => {
    // language-protocol §3: `[...s].length`, never `s.length` — they diverge on Urdu, and an
    // off-by-a-surrogate count is how a string passes locally and is rejected by Meta.
    // The line is APPENDED to lp612Caption, so it is charged against body.text (1024).
    for (const k of ['en', 'ur']) {
      expect(cp(UX_STRINGS.lp612OverlayDropped[k])).toBeLessThanOrEqual(240);
    }
  });
});

// ── 5 · the worker's distinct state ─────────────────────────────────────────

describe('a deferred overlay is its own event, not the failure counter', () => {
  const mockAuthorLessonPlan = jest.fn();
  const mockRenderLessonPlan = jest.fn();
  const mockUploadBuffer = jest.fn();
  const mockDeliverRender = jest.fn();
  const mockReadFile = jest.fn();
  const mockLogEvent = jest.fn();

  jest.mock('../../bot/shared/services/lp612-author.service', () => ({
    authorLessonPlan: (...a) => mockAuthorLessonPlan(...a),
  }));
  jest.mock('../../bot/shared/services/lp612-render.service', () => ({
    renderLessonPlan: (...a) => mockRenderLessonPlan(...a),
  }));
  jest.mock('../../bot/shared/storage/r2', () => ({ uploadBuffer: (...a) => mockUploadBuffer(...a) }));
  jest.mock('../../bot/shared/services/lp612-serving.service', () => {
    const real = jest.requireActual('../../bot/shared/services/lp612-serving.service');
    return {
      ...real,
      deliverRender: (...a) => mockDeliverRender(...a),
      r2KeyFor: (s, l, t) => `lp612/${t}/${l}/${s}.pdf`,
      assertKeyInPrefix: real.assertKeyInPrefix,
    };
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

  const JOB = {
    renderId: 'render-1',
    segmentId: 'grade_8_mathematics.c01.p006-009',
    lang: 'ur',
    templateVersion: 'v9.1',
    correlationId: 'corr-1',
  };
  /** An ENGLISH-medium book. This is the case the Urdu toggle exists for. */
  const SEGMENT = {
    segment_id: JOB.segmentId, book_stem: 'grade_8_mathematics', grade: 8, subject: 'Mathematics',
    subtopic_title: 'Rational & irrational numbers', printed_page_start: 6, printed_page_end: 9,
    language: 'en', is_religious: false,
  };

  function seed() {
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: SEGMENT, error: null });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbCalls.length = 0;
    mockDbResults.length = 0;
    mockRpc.mockReset().mockImplementation(() => Promise.resolve({ data: WAITERS, error: null }));
    mockReadFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    mockUploadBuffer.mockResolvedValue('ok');
    mockAuthorLessonPlan.mockResolvedValue({
      lpDoc: { lesson_id: 'x' }, lintClean: true, fails: [], warns: [], rounds: 1,
      model: 'anthropic/claude-sonnet-5',
    });
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 11, warnings: [],
      pagesByPart: { teach: 6, support: 5 }, overlayApplied: [],
    });
  });

  const readyPatch = () => mockDbCalls.filter((c) => c.op === 'update' && c.payload && c.payload.status === 'ready').pop();

  it('DELIVERS — an Urdu request never ends in silence', async () => {
    seed();
    const out = await Worker.process(JOB);
    expect(out.status).toBe('ready');
    expect(mockDeliverRender).toHaveBeenCalledTimes(1);
  });

  it('records overlay_dropped on the row, so every cache hit carries the honest caption', async () => {
    seed();
    await Worker.process(JOB);
    expect(readyPatch().payload).toMatchObject({ status: 'ready', overlay_dropped: true });
  });

  it('emits lp612.overlay.deferred — NOT the dropped counter', async () => {
    // A deliberate deferral and a translation that failed are different states. One counter for
    // both makes the rate of either unreadable (rule 24(b)).
    seed();
    await Worker.process(JOB);
    const names = mockLogEvent.mock.calls.map((c) => c[0]);
    expect(names).toContain('lp612.overlay.deferred');
    expect(names).not.toContain('lp612.overlay.dropped');
  });

  it('the deferred event carries the medium and the segment, so the rate is sliceable', async () => {
    seed();
    await Worker.process(JOB);
    const ev = mockLogEvent.mock.calls.find((c) => c[0] === 'lp612.overlay.deferred');
    expect(ev[1]).toMatchObject({ segmentId: JOB.segmentId, lang: 'ur', medium: 'en' });
  });

  it('an overlay that DID apply is still lp612.overlay.applied, and drops nothing', async () => {
    mockRenderLessonPlan.mockResolvedValue({
      pdfPath: '/tmp/x.pdf', htmlPath: '/tmp/x.html', pageCount: 11, warnings: [],
      pagesByPart: { teach: 6, support: 5 }, overlayApplied: ['/a', '/b'],
    });
    seed();
    await Worker.process(JOB);
    const names = mockLogEvent.mock.calls.map((c) => c[0]);
    expect(names).toContain('lp612.overlay.applied');
    expect(names).not.toContain('lp612.overlay.deferred');
    expect(readyPatch().payload.overlay_dropped).toBe(false);
  });

  it('an URDU-MEDIUM book is neither deferred nor dropped — it has nothing to toggle', async () => {
    mockDbResults.push({ data: { id: 'render-1', status: 'authoring', waiters: WAITERS }, error: null });
    mockDbResults.push({ data: { ...SEGMENT, language: 'ur' }, error: null });
    await Worker.process(JOB);
    const names = mockLogEvent.mock.calls.map((c) => c[0]);
    expect(names).not.toContain('lp612.overlay.deferred');
    expect(names).not.toContain('lp612.overlay.dropped');
    expect(readyPatch().payload.overlay_dropped).toBe(false);
  });
});
