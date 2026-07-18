/**
 * Regression test for the "Something went wrong" crash on /training when a
 * teacher is enrolled in multiple training programs whose level.order_index
 * values collide (e.g. Beacon House + Taleemabad both starting at order 0).
 *
 * WhatsApp Flow's Dropdown component silently fails to render when option
 * ids are not unique — the client returns a generic error data_exchange
 * ({error, error_message}) and the teacher sees the useless "Something went
 * wrong. try again later" banner. This bug bit Anam Masood 2026-07-16 after
 * the Beacon House modules were migrated on top of an existing Taleemabad
 * catalog; the fix composes the option id from (order_index+1, arrayPosition)
 * so ids stay unique across programs.
 *
 * The test targets the two-line surface directly rather than booting the
 * endpoint (which drags in Supabase, Redis, WhatsApp SDK, etc.). We
 * extract the option-id template from the source file and rebuild the
 * mapping so the test tracks the ACTUAL production line.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'bot',
  'shared',
  'routes',
  'teacher-training-endpoint.js'
);

function loadLevelOptionsMapper() {
  const source = fs.readFileSync(ENDPOINT_PATH, 'utf8');
  // bd-2102 — the source now partitions by vendor first (partitionByVendor)
  // and the option-id mapper runs on the per-vendor slice `vendorLevels`.
  const anchor = source.indexOf('data.level_options = vendorLevels.slice');
  if (anchor < 0) throw new Error('level_options mapper not found in endpoint source');
  const idMatch = source.slice(anchor, anchor + 400).match(/id:\s+`([^`]+)`/);
  if (!idMatch) throw new Error('Composite id template not found — has the fix regressed to a plain String?');
  const template = idMatch[1];
  // Reconstruct the mapping as a callable — templated on `${lvl.order_index + 1}_${i}`.
  return function map(catalog) {
    return catalog.slice(0, 5).map((lvl, i) => {
      const id = template
        .replace('${lvl.order_index + 1}', String(lvl.order_index + 1))
        .replace('${i}', String(i));
      return { id, title: `Level ${lvl.order_index + 1}` };
    });
  };
}

function loadOpenLevelParser() {
  const source = fs.readFileSync(ENDPOINT_PATH, 'utf8');
  if (!/parseInt\(String\(screenData\._level_order\), 10\)/.test(source)) {
    throw new Error('open_level parser is not using parseInt — composite ids will NaN out');
  }
  return function parse(idFromClient) {
    return parseInt(String(idFromClient), 10);
  };
}

describe('training home dropdown option ids', () => {
  const buildOptions = loadLevelOptionsMapper();
  const parseOpenLevel = loadOpenLevelParser();

  test('ids are unique when two programs collide on order_index (Anam bug — defence-in-depth)', () => {
    // bd-2102 partitioning normally prevents this collision by scoping the
    // TRAINING_HOME dropdown to a single vendor before the mapper runs, so
    // within one vendor's slice order_index values should already be unique.
    // The composite (order_index+1, arrayPosition) id kept as defence-in-depth
    // against the rare same-vendor collision (data-entry error, migration
    // edge, etc.). This test still enforces the invariant.
    //
    // Anam's actual production catalog snapshot from the log at
    // 2026-07-16T15:26:36Z (pre-partition state): both Taleemabad L2 and
    // Beacon House English L2 have order_index=1, etc.
    const catalog = [
      { order_index: 0, name: 'Aspiring Teacher' },
      { order_index: 1, name: 'English' },
      { order_index: 1, name: 'Emerging Practitioner' },
      { order_index: 2, name: 'Mathematics' },
      { order_index: 2, name: 'Skilled Practitioner' },
    ];
    const options = buildOptions(catalog);
    const ids = options.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['1_0', '2_1', '2_2', '3_3', '3_4']);
  });

  test('ids stay unique for a non-colliding catalog', () => {
    const catalog = [
      { order_index: 0 }, { order_index: 1 }, { order_index: 2 }, { order_index: 3 }, { order_index: 4 },
    ];
    const options = buildOptions(catalog);
    const ids = options.map(o => o.id);
    expect(new Set(ids).size).toBe(5);
  });

  test('parseInt recovers the semantic order from composite ids', () => {
    expect(parseOpenLevel('1_0')).toBe(1);
    expect(parseOpenLevel('2_1')).toBe(2);
    expect(parseOpenLevel('2_2')).toBe(2);
    expect(parseOpenLevel('3_4')).toBe(3);
  });

  test('parseInt is backward compatible with legacy plain-numeric ids', () => {
    // A teacher's WhatsApp cache might still have the pre-fix option ids;
    // parseInt tolerates them as if the position suffix were absent.
    expect(parseOpenLevel('1')).toBe(1);
    expect(parseOpenLevel('5')).toBe(5);
  });
});
