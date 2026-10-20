'use strict';
/**
 * bd-gzfdu9 — the catalogue data file the engine reads (bot/shared/data/video-catalog.v1.json).
 */
const path = require('path');
const C = require('../../../bot/shared/services/coaching/video-reco/catalog');
const FIXTURE = require('./fixtures/catalog.fixture.json');

test('the committed data file loads, carries a version, aliases and ≥ 1 module', () => {
  const cat = C.load();
  expect(cat.version).toMatch(/^catalog-v\d/);
  expect(C.version()).toBe(cat.version);
  expect(cat.modules.length).toBeGreaterThanOrEqual(1);
  expect(cat.aliases.C1).toEqual({ exact: 'C1', approx: [], name: "Quality Questioning (Bloom's Aligned)" });
  expect(Array.isArray(cat.holes)).toBe(true);
});

test('load() is cached (same object twice)', () => {
  expect(C.load()).toBe(C.load());
});

test('segment(segId) → {module, segment}; unknown → null; holes ride along', () => {
  const cat = C.fromData(FIXTURE);
  expect(cat.holes).toEqual(['D3', 'F7']);
  const hit = cat.segment('11-s2');
  expect(hit.module.module_id).toBe(11);
  expect(hit.segment.start_s).toBe(100);
  expect(cat.segment('99-s1')).toBeNull();
  expect(cat.segment(null)).toBeNull();
});

test('fromData of junk → an empty catalogue, never a throw', () => {
  const cat = C.fromData(null);
  expect(cat.modules).toEqual([]);
  expect(cat.segment('10-s1')).toBeNull();
  expect(cat.aliases).toEqual({});
  expect(cat.holes).toEqual([]);
});

test('the data file path is bot/shared/data/video-catalog.v1.json', () => {
  expect(C.DATA_FILE).toBe(path.join(__dirname, '../../../bot/shared/data/video-catalog.v1.json'));
});
