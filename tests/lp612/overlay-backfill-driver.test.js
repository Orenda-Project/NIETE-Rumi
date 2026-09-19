/**
 * THE ENTRY POINT — bd-vrt20, the residue of bd-yhd16.
 *
 * `lp612-overlay-backfill.service` knows how to walk the cache and put the repair back. Until this
 * driver existed, nothing in the bot called it: no script, no npm entry, no cron. The repair pass
 * bd-idneu exists to run was "runnable" on paper for a week and was not runnable in fact.
 *
 * What this suite protects is not the walk — the service's own suites do that — but the four things
 * a driver can get wrong that cost production:
 *
 *   1. DRY RUN IS THE DEFAULT, AND THE DRIVER MUST NOT QUIETLY INVERT IT. The service defaults
 *      `dryRun: true`. A driver that passes an options object with `dryRun: undefined` is fine; one
 *      that passes `dryRun: false` because a flag was read backwards rewrites live R2 objects on a
 *      run somebody thought was an inventory. The no-flag call must upload nothing and patch
 *      nothing.
 *   2. THE SUMMARY GOES TO A FILE, NOT TO STDOUT. The bot's Axiom logger patches `console`, so a
 *      run's own output is swallowed or interleaved with JSON log lines. This has already cost one
 *      investigation on this bead. The summary must be readable afterwards with `cat`.
 *   3. A HALF-WORKING REPAIR MUST NOT LOOK GREEN. An aborted walk or a failed row exits non-zero.
 *   4. `--limit` MUST REACH THE SERVICE. The live run is scoped to a named, cleared row set; a
 *      limit the driver drops on the floor is a run over the whole corpus.
 *
 * Mocked at their network boundaries only: supabase, R2, the renderer (Chromium) and the model.
 * The backfill service underneath is genuine.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/config/supabase', () => {
  const state = { rows: [], updates: [] };
  const builder = () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit(n) {
        state.limits.push(n);
        return Promise.resolve({ data: state.rows.slice(0, n == null ? undefined : n), error: null });
      },
      update(patch) {
        return { eq: (col, val) => {
          state.updates.push({ patch, by: { [col]: val } });
          return Promise.resolve({ error: null });
        } };
      },
    };
    return q;
  };
  state.limits = [];
  return { from: jest.fn(builder), __state: state };
});

jest.mock('../../bot/shared/storage/r2', () => ({
  downloadFromR2: jest.fn(),
  uploadBuffer: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../bot/shared/services/lp612-render.service', () => ({
  renderLessonPlan: jest.fn(),
}));
jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { overlayDefects } = require(path.join(V, 'lint_lp.js'));

const supabase = require('../../bot/shared/config/supabase');
const { downloadFromR2, uploadBuffer } = require('../../bot/shared/storage/r2');
const { renderLessonPlan } = require('../../bot/shared/services/lp612-render.service');
const create = require('../../bot/shared/services/llm-client').__create;
const Driver = require('../../bot/scripts/lp612-overlay-backfill');

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const rawFixture = fs.readFileSync(BASE, 'utf8');
const TV = 'v9.6';
const EXISTING_UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے پہلے ہی لکھی جا چکی ہے۔';

const row = (segmentId) => ({
  id: `row-${segmentId}`,
  segment_id: segmentId,
  lang: 'ur',
  template_version: TV,
  status: 'ready',
  r2_key: `lp612/${TV}/ur/${segmentId}.pdf`,
  page_count: 4,
});

/** Authored before bd-x3dn6: every overlay pointer but the provenance pair. Needs a repair. */
const storedDoc = () => {
  const d = JSON.parse(rawFixture);
  d.ur_overlay = {};
  for (const ptr of overlayDefects.targets(d)) {
    if (ptr.startsWith('/provenance/')) continue;
    d.ur_overlay[ptr] = EXISTING_UR;
  }
  return d;
};

let outDir;

beforeEach(() => {
  jest.clearAllMocks();
  const st = supabase.__state;
  st.rows = [row('grade_9_chemistry.c01.p001-002'), row('grade_9_chemistry.c01.p003-004')];
  st.updates = [];
  st.limits = [];
  downloadFromR2.mockImplementation(async () => Buffer.from(JSON.stringify(storedDoc()), 'utf8'));
  create.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ '/provenance/chapter': 'باب', '/provenance/topic': 'موضوع' }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
  renderLessonPlan.mockImplementation(async ({ outDir: renderDir }) => {
    const pdf = path.join(renderDir, 'lesson.pdf');
    fs.writeFileSync(pdf, Buffer.from('%PDF-1.4 repaired'));
    return { pdfPath: pdf, pageCount: 4 };
  });
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-vrt20-'));
});

afterEach(() => { fs.rmSync(outDir, { recursive: true, force: true }); });

describe('1 — a run nobody flagged is an inventory, not a rewrite', () => {
  test('THE RED TEST: no flags uploads nothing and patches no row', async () => {
    const out = path.join(outDir, 'summary.json');
    const res = await Driver.main({ argv: ['--out', out] });

    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(supabase.__state.updates).toEqual([]);
    expect(res.summary.dryRun).toBe(true);
    expect(res.summary.wouldRepair).toBe(2);
    expect(res.summary.repaired).toBe(0);
    expect(res.exitCode).toBe(0);
  });

  test('--live is the only thing that writes', async () => {
    const out = path.join(outDir, 'summary.json');
    const res = await Driver.main({ argv: ['--live', '--out', out] });

    expect(res.summary.dryRun).toBe(false);
    expect(res.summary.repaired).toBe(2);
    expect(uploadBuffer).toHaveBeenCalled();
    expect(supabase.__state.updates.length).toBe(2);
  });
});

describe('2 — the summary survives the logger', () => {
  test('it is written to --out as JSON, readable with cat', async () => {
    const out = path.join(outDir, 'nested', 'summary.json');
    await Driver.main({ argv: ['--out', out] });

    expect(fs.existsSync(out)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(onDisk.dryRun).toBe(true);
    expect(onDisk.scanned).toBe(2);
    expect(Array.isArray(onDisk.rows)).toBe(true);
  });
});

describe('3 — a half-working repair does not look green', () => {
  test('a failed row on a live run exits non-zero', async () => {
    downloadFromR2.mockImplementationOnce(async () => { throw new Error('R2 is down'); });
    const res = await Driver.main({ argv: ['--live', '--out', path.join(outDir, 's.json')] });

    expect(res.summary.failed.length).toBe(1);
    expect(res.exitCode).not.toBe(0);
  });

  test('a clean dry run exits zero', async () => {
    const res = await Driver.main({ argv: ['--out', path.join(outDir, 's.json')] });
    expect(res.exitCode).toBe(0);
  });
});

describe('4 — the scope flags reach the service', () => {
  test('--limit is passed through, not dropped', async () => {
    await Driver.main({ argv: ['--limit', '81', '--out', path.join(outDir, 's.json')] });
    expect(supabase.__state.limits).toContain(81);
  });

  test('--template-version narrows the walk', async () => {
    const res = await Driver.main({
      argv: ['--template-version', TV, '--out', path.join(outDir, 's.json')],
    });
    expect(res.options.templateVersion).toBe(TV);
  });
});
