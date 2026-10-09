import { describe, expect, it } from 'vitest';
import { trainingBase, trainingPaths, type Level, type Vendor } from '../../newui/training/trainingApi';
import {
  certificateSummary, continueCard, courseTiles, journey, providerLogo, teachingLevels, TRAINING_V2_BASE,
} from './model';

/**
 * bd-fmf24g.5 — the teacher v2 Training screens' data: every value comes from the /training/* reads the
 * new UI already makes (vendors, levels, certificates, bands); these mappers only shape it.
 */

const vendor = (vendor_key: string, done: number, total: number, extra: Partial<Vendor> = {}): Vendor => ({
  vendor_key, vendor_name: vendor_key, level_count: 1, course_count: 1, module_count: total,
  completed_module_count: done, certificate_count: 0, avg_score_pct: null, ...extra,
});

const level = (id: number, vendor_key: string, order_index: number, state: Level['state'], extra: Partial<Level> = {}): Level => ({
  id, name: `L${order_index + 1}`, order_index, cpd_level: null, vendor_key, unlock_logic: 'chain', state,
  module_count: 6, completed_count: 0, courses_total: 3, courses_completed: 0, passed_at: null, cooldown_until: null,
  previous_level_order: order_index > 0 ? order_index - 1 : null, ...extra,
});

const paths = trainingPaths(TRAINING_V2_BASE);

describe('the v2 base', () => {
  it('is under /portal/teacher, and every training page below it keeps it', () => {
    expect(TRAINING_V2_BASE).toBe('/portal/teacher/training');
    expect(trainingBase('/portal/teacher/training')).toBe('/portal/teacher/training');
    expect(trainingBase('/portal/teacher/training/unit/12/quiz')).toBe('/portal/teacher/training');
    // today's pages are untouched
    expect(trainingBase('/portal/training/unit/12')).toBe('/portal/training');
    expect(trainingBase('/portal/training/v2/certificates')).toBe('/portal/training/v2');
  });
});

describe('teachingLevels', () => {
  const bands = {
    options: [
      { id: 'primary', title: 'Primary (Grades 1-5)' },
      { id: 'middle', title: 'Middle (Grades 6-8)' },
      { id: 'high', title: 'High (Grades 9-10)' },
    ],
  };
  it('names the bands she picked, short, in the options order', () => {
    expect(teachingLevels({ ...bands, selected: ['middle', 'primary'] })).toEqual(['Primary', 'Middle']);
  });
  it('keeps a title in any other shape whole', () => {
    expect(teachingLevels({ options: [{ id: 'x', title: 'Early learners' }], selected: ['x'] })).toEqual(['Early learners']);
  });
  it('is empty when nothing is picked, the read failed, or an id is unknown', () => {
    expect(teachingLevels({ ...bands, selected: [] })).toEqual([]);
    expect(teachingLevels(null)).toEqual([]);
    expect(teachingLevels({ ...bands, selected: ['gone'] })).toEqual([]);
  });
});

describe('providerLogo', () => {
  it('maps every known provider to its real logo file and anything else to nothing', () => {
    for (const key of ['TALEEMABAD', 'ISAPS', 'BEACONHOUSE', 'OXBRIDGE']) expect(providerLogo(key)).toBeTruthy();
    expect(new Set(['TALEEMABAD', 'ISAPS', 'BEACONHOUSE', 'OXBRIDGE'].map(providerLogo)).size).toBe(4);
    expect(providerLogo('SOMEONE_NEW')).toBeNull();
    expect(providerLogo(null)).toBeNull();
  });
});

describe('courseTiles', () => {
  const vendors = [vendor('OXBRIDGE', 10, 10), vendor('ISAPS', 6, 54), vendor('TALEEMABAD', 12, 50)];
  const levels = [
    level(1, 'TALEEMABAD', 0, 'certified'), level(2, 'TALEEMABAD', 1, 'in_progress'),
    level(3, 'TALEEMABAD', 2, 'locked'), level(4, 'TALEEMABAD', 3, 'locked'),
    level(10, 'ISAPS', 0, 'in_progress', { courses_total: 6, courses_completed: 1 }),
    level(20, 'OXBRIDGE', 0, 'certified', { courses_total: 2, courses_completed: 2 }),
  ];

  it('lists the providers in the page order with their real % and logo', () => {
    const tiles = courseTiles(vendors, levels, paths);
    expect(tiles.map((t) => t.key)).toEqual(['TALEEMABAD', 'ISAPS', 'OXBRIDGE']);
    expect(tiles.map((t) => t.pct)).toEqual([24, 11, 100]);
    expect(tiles.map((t) => t.label)).toEqual(['NIETE', 'I-SAPS', 'Oxbridge']);
    expect(tiles.every((t) => !!t.logo)).toBe(true);
    expect(tiles.map((t) => t.done)).toEqual([false, false, true]);
  });

  it('says where she is on a ladder, and courses for a one-level provider', () => {
    const [niete, isaps, ox] = courseTiles(vendors, levels, paths);
    expect(niete.sub).toEqual({ kind: 'level', n: 2, of: 4 });
    expect(isaps.sub).toEqual({ kind: 'courses', done: 1, total: 6 });
    expect(ox.sub).toBeNull(); // done says it all
  });

  it('opens a one-level provider at its level and a ladder at the provider page', () => {
    const [niete, isaps] = courseTiles(vendors, levels, paths);
    expect(niete.to).toBe('/portal/teacher/training/provider/TALEEMABAD');
    expect(isaps.to).toBe('/portal/teacher/training/provider/ISAPS/level/10');
  });
});

describe('certificateSummary', () => {
  it('counts every certificate and lists each provider once, in the page order', () => {
    const s = certificateSummary([
      { vendor_key: 'OXBRIDGE' }, { vendor_key: 'TALEEMABAD' }, { vendor_key: 'TALEEMABAD' }, { vendor_key: null },
    ]);
    expect(s.count).toBe(4);
    expect(s.providers.map((p) => p.key)).toEqual(['TALEEMABAD', 'OXBRIDGE']);
    expect(s.providers[0]).toMatchObject({ label: 'NIETE', initials: 'N' });
    expect(s.providers[0].logo).toBeTruthy();
  });
  it('is zero with nobody when there are none or the read failed', () => {
    expect(certificateSummary([])).toEqual({ count: 0, providers: [] });
    expect(certificateSummary(null)).toEqual({ count: 0, providers: [] });
  });
});

describe('continueCard', () => {
  const vendors = [vendor('TALEEMABAD', 12, 50)];
  const levels = [level(2, 'TALEEMABAD', 1, 'in_progress', { name: 'Emerging', completed_count: 2, module_count: 6 })];
  it('names the provider and level she continues, with the level’s real parts %', () => {
    const card = continueCard({ vendorKey: 'TALEEMABAD', levelId: 2, to: '/portal/teacher/training/unit/9' }, vendors, levels);
    expect(card).toMatchObject({
      vendorKey: 'TALEEMABAD', provider: 'NIETE', levelNumber: 2, levelName: 'Emerging', partsDone: 2, partsTotal: 6, pct: 33,
      to: '/portal/teacher/training/unit/9',
    });
    expect(card?.logo).toBeTruthy();
  });
  it('is nothing while there is nothing to continue', () => {
    expect(continueCard(null, vendors, levels)).toBeNull();
    expect(continueCard(undefined, vendors, levels)).toBeNull();
  });
  it('drops the level number for a provider that is not a ladder', () => {
    const subj = [level(7, 'BEACONHOUSE', 0, 'in_progress', { unlock_logic: 'any', name: 'English' })];
    const card = continueCard({ vendorKey: 'BEACONHOUSE', levelId: 7, to: 'x' }, [vendor('BEACONHOUSE', 1, 9)], subj);
    expect(card).toMatchObject({ levelNumber: null, levelName: 'English' });
  });
});

describe('journey', () => {
  const ladder = [
    level(1, 'TALEEMABAD', 0, 'certified'),
    level(2, 'TALEEMABAD', 1, 'in_progress', { completed_count: 2, module_count: 6 }),
    level(3, 'TALEEMABAD', 2, 'locked'),
    level(4, 'TALEEMABAD', 3, 'locked'),
    level(9, 'ISAPS', 0, 'in_progress'),
  ];

  it('draws the provider’s ladder in order: done, the level she is on, locked', () => {
    const j = journey(ladder, 'TALEEMABAD', 2, paths);
    expect(j?.nodes.map((n) => [n.n, n.state])).toEqual([[1, 'done'], [2, 'current'], [3, 'locked'], [4, 'locked']]);
    expect(j?.nodes[1]).toMatchObject({ partsDone: 2, partsTotal: 6, pct: 33 });
  });

  it('links done and open levels only; a locked level is not a link', () => {
    const j = journey(ladder, 'TALEEMABAD', 2, paths)!;
    expect(j.nodes[0].to).toBe('/portal/teacher/training/provider/TALEEMABAD/level/1');
    expect(j.nodes[1].to).toBeNull(); // she is on it
    expect(j.nodes[2].to).toBeNull();
  });

  it('fills the line up to the level she is on', () => {
    expect(journey(ladder, 'TALEEMABAD', 2, paths)?.fill).toBeCloseTo(1 / 3);
    expect(journey(ladder, 'TALEEMABAD', 1, paths)?.fill).toBe(0);
  });

  it('marks a done level she is looking at as current, and an unlocked later level as open', () => {
    const two = [level(1, 'TALEEMABAD', 0, 'certified'), level(2, 'TALEEMABAD', 1, 'not_started')];
    const j = journey(two, 'TALEEMABAD', 1, paths)!;
    expect(j.nodes.map((n) => n.state)).toEqual(['current', 'open']);
    expect(j.nodes[1].to).toBe('/portal/teacher/training/provider/TALEEMABAD/level/2');
  });

  it('is nothing for a one-level provider or a set of subjects', () => {
    expect(journey(ladder, 'ISAPS', 9, paths)).toBeNull();
    const subjects = [level(5, 'BEACONHOUSE', 0, 'in_progress', { unlock_logic: 'any' }), level(6, 'BEACONHOUSE', 1, 'not_started', { unlock_logic: 'any' })];
    expect(journey(subjects, 'BEACONHOUSE', 5, paths)).toBeNull();
  });
});
