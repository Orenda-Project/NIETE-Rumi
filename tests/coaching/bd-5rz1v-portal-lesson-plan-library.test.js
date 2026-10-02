/**
 * bd-5rz1v — the four lookups behind a portal library pick. Each one is the
 * existing code path a WhatsApp teacher already goes through, reached from the
 * portal instead of re-implemented for it:
 *
 *   resolveAsset(lessonId) — the asset she DOWNLOADED for that lesson, when she did
 *                            (niete_lp_downloads: her A/B group's version, the record
 *                            the WhatsApp recent list reads); otherwise the lesson's
 *                            current asset. No A/B module is needed, so it behaves the
 *                            same on sandbox, staging and main.
 *   resolveAsset(assetId)  — a recent plan; the id must be a real lesson asset.
 *   readyRender            — a 6-12 lesson that has been written, on today's
 *                            template, in the language she picked it in.
 *   link                   — lp-coaching-linker.handleLPSelection with the
 *                            WhatsApp list's own row id.
 */

const MODULE = '../../bot/shared/services/coaching/portal-lesson-plan-library.service';

const USER = '1ff9fc2e-9b4a-48d4-94f3-312ad52df81b';
const ASSET = '6d1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';

function fakeSupabase(rows = {}) {
  const reads = [];
  const from = (table) => {
    const q = { _filters: {} };
    q.select = (cols) => { q._cols = cols; return q; };
    q.eq = (c, v) => { q._filters[c] = v; return q; };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => {
      reads.push({ table, cols: q._cols, filters: { ...q._filters } });
      const r = rows[table];
      return { data: typeof r === 'function' ? r(q._filters) : (r ?? null), error: null };
    };
    return q;
  };
  return { from, reads };
}

function deps(overrides = {}) {
  return {
    supabase: fakeSupabase(overrides.rows || {}),
    catalog: { lessonById: jest.fn().mockReturnValue({ book: { grade: 4 }, chapter: { number: 3 }, lesson: {} }) },
    currentAssetFor: jest.fn().mockResolvedValue({ id: 'current-asset' }),
    linker: { handleLPSelection: jest.fn().mockResolvedValue({ lesson_plan_link_method: 'selected_recent' }) },
    getRecentFidelityLps: jest.fn().mockResolvedValue([{ asset_id: ASSET }]),
    templateVersion: () => 't4',
    ...overrides,
  };
}

describe('bd-5rz1v — portal lesson-plan library lookups', () => {
  let Lib;
  beforeEach(() => { jest.resetModules(); Lib = require(MODULE); });

  test('a library lesson she downloaded resolves to the asset she downloaded — her A/B group\'s version', async () => {
    const d = deps({ rows: { niete_lp_downloads: (f) => (f.user_id === USER && f.lesson_id === 'g4-sst-ch3-seg2' && f.status === 'sent' ? { asset_id: ASSET } : null) } });
    const out = await Lib.resolveAsset({ userId: USER, lessonId: 'g4-sst-ch3-seg2' }, d);

    expect(out).toEqual({ assetId: ASSET });
    expect(d.catalog.lessonById).toHaveBeenCalledWith('g4-sst-ch3-seg2');
    expect(d.supabase.reads[0]).toMatchObject({
      table: 'niete_lp_downloads', filters: { user_id: USER, lesson_id: 'g4-sst-ch3-seg2', status: 'sent' },
    });
    expect(d.currentAssetFor).not.toHaveBeenCalled();
  });

  test('a library lesson she never downloaded resolves to its current asset', async () => {
    const d = deps();
    const out = await Lib.resolveAsset({ userId: USER, lessonId: 'g4-sst-ch3-seg2' }, d);
    expect(out).toEqual({ assetId: 'current-asset' });
    expect(d.currentAssetFor).toHaveBeenCalledWith('g4-sst-ch3-seg2', 'lesson');
  });

  test('a lesson the catalogue does not know, or with no current asset, resolves to nothing', async () => {
    const unknown = deps({ catalog: { lessonById: jest.fn().mockReturnValue(null) } });
    expect(await Lib.resolveAsset({ userId: USER, lessonId: 'x' }, unknown)).toBeNull();
    expect(unknown.supabase.reads).toHaveLength(0);

    const noAsset = deps({ currentAssetFor: jest.fn().mockResolvedValue(null) });
    expect(await Lib.resolveAsset({ userId: USER, lessonId: 'g4-sst-ch3-seg2' }, noAsset)).toBeNull();
  });

  test('the A/B module is not a dependency: nothing here requires it', () => {
    const src = require('fs').readFileSync(require.resolve(MODULE), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/require\([^)]*lp-ab-ch310/);
  });

  test('a recent plan\'s asset id must be a real lesson asset', async () => {
    const d = deps({ rows: { niete_lp_assets: (f) => (f.id === ASSET && f.asset_kind === 'lesson' ? { id: ASSET } : null) } });
    expect(await Lib.resolveAsset({ userId: USER, assetId: ASSET }, d)).toEqual({ assetId: ASSET });
    expect(await Lib.resolveAsset({ userId: USER, assetId: 'not-real' }, d)).toBeNull();
  });

  test('a 6-12 lesson is attachable only once written: ready, on today\'s template, in her language', async () => {
    const d = deps({ rows: { niete_lp612_renders: { r2_key: 'lp612/renders/a.pdf' } } });
    const out = await Lib.readyRender({ segmentId: 'g7-sci-ch2-s3', lang: 'ur' }, d);

    expect(out).toEqual({ r2Key: 'lp612/renders/a.pdf' });
    expect(d.supabase.reads[0]).toMatchObject({
      table: 'niete_lp612_renders',
      filters: { segment_id: 'g7-sci-ch2-s3', lang: 'ur', template_version: 't4', status: 'ready' },
    });
  });

  test('an unwritten 6-12 lesson is not attachable', async () => {
    expect(await Lib.readyRender({ segmentId: 'g7-sci-ch2-s3', lang: 'en' }, deps())).toBeNull();
  });

  test('link goes through the WhatsApp list\'s linker with the list\'s own row id', async () => {
    const d = deps();
    const out = await Lib.link('cs-1', ASSET, d);

    expect(d.linker.handleLPSelection).toHaveBeenCalledWith('cs-1', `lp_select_${ASSET}_cs-1`);
    expect(out).toEqual({ lesson_plan_link_method: 'selected_recent' });
  });

  test('the current-asset lookup is lp-v8-delivery.currentAssetFor\'s select: the is_current row for that lesson and kind', async () => {
    const supabase = fakeSupabase({ niete_lp_assets: (f) => (f.is_current === true ? { id: ASSET } : null) });
    const out = await Lib.currentAssetFrom(supabase)('g4-sst-ch3-seg2', 'lesson');
    expect(out).toEqual({ id: ASSET });
    expect(supabase.reads[0]).toMatchObject({
      table: 'niete_lp_assets',
      filters: { lesson_id: 'g4-sst-ch3-seg2', asset_kind: 'lesson', is_current: true },
    });
  });

  test('recent plans are the WhatsApp list\'s source', async () => {
    const d = deps();
    expect(await Lib.recent(USER, d)).toEqual([{ asset_id: ASSET }]);
    expect(d.getRecentFidelityLps).toHaveBeenCalledWith(USER);
  });
});
