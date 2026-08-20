/**
 * bd-43478 — the BAND_PICKER screen in the teacher-training Flow.
 *
 * Replaces the dead end 353 teachers currently hit: entryErrorScreen("No
 * training assigned yet … contact your NIETE program lead"). Instead they are
 * asked which grades they teach, and land in the training they just unlocked.
 *
 * BUG-144 is the load-bearing constraint here. INIT must return a routing-model
 * ENTRY POINT — a node with NO incoming edges — or the client rejects the WHOLE
 * Flow with "invalid-screen-transition … already have incoming nodes", taking
 * training down for every teacher, not just the unassigned ones. So BAND_PICKER
 * becomes the entry point and VENDOR_PICKER inherits an incoming edge.
 *
 * The reverse trip ("change what I teach") is deliberately NOT a declared edge:
 * a data_exchange response can re-render any screen, exactly as
 * back_to_vendors already returns VENDOR_PICKER from TRAINING_HOME without a
 * TRAINING_HOME -> VENDOR_PICKER edge. Declaring it would make the graph
 * cyclic, and no Flow in this repo declares a cycle.
 */

const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/teacher-training-flow-v1.json'), 'utf8'));

const screenIds = FLOW.screens.map(s => s.id);
const screenById = new Map(FLOW.screens.map(s => [s.id, s]));

describe('BAND_PICKER — the routing model stays valid (BUG-144)', () => {
  test('BAND_PICKER exists', () => {
    expect(screenIds).toContain('BAND_PICKER');
  });

  test('BAND_PICKER is an ENTRY POINT — nothing routes into it', () => {
    const incoming = Object.entries(FLOW.routing_model)
      .filter(([, outs]) => outs.includes('BAND_PICKER'))
      .map(([from]) => from);
    expect(incoming).toEqual([]);
  });

  test('BAND_PICKER routes forward into VENDOR_PICKER', () => {
    expect(FLOW.routing_model.BAND_PICKER).toContain('VENDOR_PICKER');
  });

  test('exactly one entry point exists', () => {
    // Two entry points is as broken as none — INIT can only return one.
    const targets = new Set(Object.values(FLOW.routing_model).flat());
    const entries = Object.keys(FLOW.routing_model).filter(s => !targets.has(s));
    expect(entries).toEqual(['BAND_PICKER']);
  });

  test('the routing graph is ACYCLIC — no flow in this repo declares a cycle', () => {
    const rm = FLOW.routing_model;
    const cycles = [];
    for (const [a, outs] of Object.entries(rm)) {
      for (const b of outs) if ((rm[b] || []).includes(a)) cycles.push(`${a}<->${b}`);
    }
    expect(cycles).toEqual([]);
  });

  test('every routing target is a real screen', () => {
    for (const target of new Set(Object.values(FLOW.routing_model).flat())) {
      expect(screenIds).toContain(target);
    }
  });

  test('version is a Meta-recognised Flow JSON SCHEMA version', () => {
    // `version` is Meta's SCHEMA version, NOT a content version — inventing
    // "5.2" to mark this change made the publish fail validation with
    // INVALID_FLOW_JSON_VERSION. The valid values are the ones Meta ships;
    // these are the four in use across this repo's flows.
    expect(['5.1', '6.2', '6.3', '7.0']).toContain(String(FLOW.version));
  });
});

describe('BAND_PICKER — the screen itself', () => {
  const screen = () => screenById.get('BAND_PICKER');

  test('is not terminal', () => {
    expect(screen().terminal).toBe(false);
  });

  test('offers a multi-select CheckboxGroup, not a radio group', () => {
    // The whole Row 6 case is a teacher who teaches primary AND middle.
    const json = JSON.stringify(screen().layout);
    expect(json).toContain('CheckboxGroup');
    expect(json).not.toContain('RadioButtonsGroup');
  });

  test('the checkbox group is required', () => {
    const cb = JSON.stringify(screen().layout).match(/"type":"CheckboxGroup"[^}]*/)[0];
    expect(cb).toContain('"required":true');
  });

  test('submits _action=save_bands with the selection', () => {
    const json = JSON.stringify(screen().layout);
    expect(json).toContain('save_bands');
    expect(json).toContain('${form.band_choice}');
  });

  test('pre-fills the current selection so a change starts from today', () => {
    expect(JSON.stringify(screen().layout)).toContain('${data.init_bands}');
  });

  test('carries a cooldown notice slot with its own visibility flag', () => {
    // Hidden on a first-ever selection: there is nothing to lose yet.
    expect(screen().data).toHaveProperty('cooldown_notice');
    expect(screen().data).toHaveProperty('notice_visible');
  });

  test('never labels the choice a bare "Level"', () => {
    // "level" is overloaded: training_levels holds CPD career stages for NIETE
    // and SUBJECTS for Beacon House. Sheet row 5 is a teacher already confused
    // by that collision.
    const opts = screen().data.band_options.__example__;
    for (const o of opts) {
      expect(o.title).toMatch(/Grades?\s/);
      expect(o.title).not.toMatch(/^Level\b/i);
    }
    expect(opts.map(o => o.id)).toEqual(['PRIMARY', 'MIDDLE', 'HIGH']);
  });

  test('every ${data.*} reference in the layout is declared in data', () => {
    const declared = new Set(Object.keys(screen().data));
    const used = [...JSON.stringify(screen().layout).matchAll(/\$\{data\.([a-z_]+)\}/g)]
      .map(m => m[1]);
    for (const u of used) expect(declared).toContain(u);
  });
});
