/**
 * bd-5rz1v — the four lookups behind a portal library pick. Each one is the
 * existing code path a WhatsApp teacher already goes through, reached from the
 * portal instead of re-implemented for it:
 *
 *   resolveAsset(lessonId) — the asset her A/B group is served for that lesson:
 *                            LpAb.groupFor + LpAb.assetFor(current: currentAssetFor),
 *                            exactly what the Curriculum page's PDF link serves her.
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
    ab: {
      groupFor: jest.fn().mockResolvedValue('A'),
      assetFor: jest.fn().mockResolvedValue({ id: ASSET, r2_key: 'k' }),
    },
    currentAssetFor: jest.fn(),
    linker: { handleLPSelection: jest.fn().mockResolvedValue({ lesson_plan_link_method: 'selected_recent' }) },
    getRecentFidelityLps: jest.fn().mockResolvedValue([{ asset_id: ASSET }]),
    templateVersion: () => 't4',
    ...overrides,
  };
}

describe('bd-5rz1v — portal lesson-plan library lookups', () => {
  let Lib;
  beforeEach(() => { jest.resetModules(); Lib = require(MODULE); });

  test('a library lesson resolves to the asset her A/B group is served, through the delivery path\'s own lookups', async () => {
    const d = deps();
    const out = await Lib.resolveAsset({ userId: USER, lessonId: 'g4-sst-ch3-seg2' }, d);

    expect(out).toEqual({ assetId: ASSET });
    expect(d.catalog.lessonById).toHaveBeenCalledWith('g4-sst-ch3-seg2');
    expect(d.ab.groupFor).toHaveBeenCalledWith(USER, { grade: 4, chapter: 3 });
    expect(d.ab.assetFor).toHaveBeenCalledWith({
      group: 'A', lessonId: 'g4-sst-ch3-seg2', assetKind: 'lesson', current: d.currentAssetFor,
    });
  });

  test('a lesson the catalogue does not know, or with no asset for her group, resolves to nothing', async () => {
    const unknown = deps({ catalog: { lessonById: jest.fn().mockReturnValue(null) } });
    expect(await Lib.resolveAsset({ userId: USER, lessonId: 'x' }, unknown)).toBeNull();

    const noAsset = deps();
    noAsset.ab.assetFor.mockResolvedValue(null);
    expect(await Lib.resolveAsset({ userId: USER, lessonId: 'g4-sst-ch3-seg2' }, noAsset)).toBeNull();
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

  test('recent plans are the WhatsApp list\'s source', async () => {
    const d = deps();
    expect(await Lib.recent(USER, d)).toEqual([{ asset_id: ASSET }]);
    expect(d.getRecentFidelityLps).toHaveBeenCalledWith(USER);
  });
});
