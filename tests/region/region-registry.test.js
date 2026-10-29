/**
 * region-registry — which regions exist, and who owns each (bd-97daxo.2).
 *
 * The six ICT sectors belong to FDE's programme (users.organization 'niete'); Gilgit-Baltistan
 * belongs to Moawin. The list lives in region_features rows, not in code, so a dashboard can be
 * pointed at a different organization's regions and a new region is a row, not a release.
 *
 * Unlike region-features (which fails OPEN so an LP is never blocked), the registry fails CLOSED:
 * a dashboard that cannot read it must refuse, never show every region.
 */

const fs = require('fs');
const path = require('path');

const ROWS = [
  { region: 'tarnol', organization: 'niete', display_name: 'Tarnol', sort_order: 6, is_active: true },
  { region: 'b.k', organization: 'niete', display_name: 'B.K', sort_order: 1, is_active: true },
  { region: 'sihala', organization: 'niete', display_name: 'Sihala', sort_order: 2, is_active: true },
  { region: 'urban-i', organization: 'niete', display_name: 'Urban-I', sort_order: 3, is_active: true },
  { region: 'nilore', organization: 'niete', display_name: 'Nilore', sort_order: 4, is_active: true },
  { region: 'urban-ii', organization: 'niete', display_name: 'Urban-II', sort_order: 5, is_active: true },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true },
  { region: 'retired', organization: 'niete', display_name: 'Retired', sort_order: 7, is_active: false },
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true },
];

/** A supabase-shaped client whose select() resolves to the given result, counting reads. */
function clientReturning(result) {
  const reads = { n: 0 };
  const client = {
    from: (table) => {
      expect(table).toBe('region_features');
      return {
        select: async () => {
          reads.n += 1;
          if (result instanceof Error) throw result;
          return result;
        },
      };
    },
  };
  return { client, reads };
}

function load() {
  jest.resetModules();
  const reg = require('../../bot/shared/services/region-registry');
  reg._clearCache();
  return reg;
}

describe('region-registry', () => {
  it("lists an organization's active regions in sort order, as schools.region spells them", async () => {
    const reg = load();
    const { client } = clientReturning({ data: ROWS, error: null });
    expect(await reg.regionsForOrganization(client, 'niete'))
      .toEqual(['B.K', 'Sihala', 'Urban-I', 'Nilore', 'Urban-II', 'Tarnol']);
    expect(await reg.regionsForOrganization(client, 'moawin')).toEqual(['Gilgit-Baltistan']);
    expect(await reg.regionsForOrganization(client, 'nobody')).toEqual([]);
  });

  it('names the owner of a region whatever its case or spelling source', async () => {
    const reg = load();
    const { client } = clientReturning({ data: ROWS, error: null });
    expect(await reg.organizationForRegion(client, 'Sihala')).toBe('niete');
    expect(await reg.organizationForRegion(client, ' gilgit-baltistan ')).toBe('moawin');
    expect(await reg.organizationForRegion(client, 'Gilgit-Baltistan')).toBe('moawin');
    expect(await reg.organizationForRegion(client, 'Retired')).toBeNull();
    expect(await reg.organizationForRegion(client, 'Durbeen')).toBeNull();
    expect(await reg.organizationForRegion(client, null)).toBeNull();
  });

  it('fails closed: a read error throws instead of returning every region or none', async () => {
    const reg = load();
    const { client } = clientReturning({ data: null, error: { message: 'pool exhausted' } });
    await expect(reg.regionsForOrganization(client, 'niete')).rejects.toThrow(/region registry/i);
    const thrown = clientReturning(new Error('socket hang up'));
    await expect(reg.regionsForOrganization(thrown.client, 'niete')).rejects.toThrow(/region registry/i);
  });

  it('caches one read for five minutes, and never caches a failure', async () => {
    const reg = load();
    const { client, reads } = clientReturning({ data: ROWS, error: null });
    await reg.regionsForOrganization(client, 'niete');
    await reg.organizationForRegion(client, 'Sihala');
    expect(reads.n).toBe(1);

    const reg2 = load();
    const bad = clientReturning({ data: null, error: { message: 'down' } });
    await expect(reg2.regionsForOrganization(bad.client, 'niete')).rejects.toThrow();
    await expect(reg2.regionsForOrganization(bad.client, 'niete')).rejects.toThrow();
    expect(bad.reads.n).toBe(2);
  });
});

describe('V1.8.5 region registry migration', () => {
  const readSql = () => fs.readFileSync(
    path.join(__dirname, '../../infrastructure/supabase/migrations/V1.8.5__region_registry.sql'), 'utf8');

  it("seeds FDE's six sectors in the order the dashboards already show them", () => {
    const { SECTORS } = require('../../dashboard/lib/analytics-lists');
    const sql = readSql();
    const rows = [...sql.matchAll(/\('([^']+)',\s*'niete',\s*'([^']+)',\s*(\d+)\)/g)]
      .map((m) => ({ key: m[1], name: m[2], order: Number(m[3]) }))
      .sort((a, b) => a.order - b.order);
    expect(rows.map((r) => r.name)).toEqual([...SECTORS]);
    for (const r of rows) expect(r.key).toBe(r.name.toLowerCase());
  });

  it('touches only the registry columns of a sector row that already exists (LP flags stay as they are)', () => {
    const upsert = readSql().match(/ON CONFLICT \(region\) DO UPDATE SET([\s\S]*?);/);
    expect(upsert).not.toBeNull();
    const set = upsert[1];
    expect(set).toMatch(/organization/);
    expect(set).not.toMatch(/curriculum|pic_lp|gamma_lp|framework|languages|subjects|textbooks/);
  });

  it('adds Gilgit-Baltistan under Moawin, with pic-to-LP off', () => {
    const m = readSql().match(/INSERT INTO region_features \(([^)]*)\)\s*VALUES\s*\(('gilgit-baltistan'[^)]*)\)/);
    expect(m).not.toBeNull();
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = m[2].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
    const row = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
    expect(row).toMatchObject({
      region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', pic_lp_enabled: 'false',
    });
  });
});
