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

  test('VENDOR_PICKER routes FORWARD into BAND_PICKER', () => {
    // The direction matters: BAND_PICKER as entry point charged every teacher
    // who already has bands an extra tap on every open. VENDOR_PICKER is the
    // majority case and therefore the entry point.
    expect(FLOW.routing_model.VENDOR_PICKER).toContain('BAND_PICKER');
  });

  test('exactly one entry point exists, and it is VENDOR_PICKER', () => {
    // Two entry points is as broken as none — INIT can only return one.
    const targets = new Set(Object.values(FLOW.routing_model).flat());
    const entries = Object.keys(FLOW.routing_model).filter(s => !targets.has(s));
    expect(entries).toEqual(['VENDOR_PICKER']);
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

  test('the editable state has ONE action, not a save/continue split', () => {
    // It carried two — "Save these grades" and "Continue to my training" —
    // which forced a choice the teacher never wants to make, and silently threw
    // away an edit if they tapped Continue. One button saves and moves on; an
    // unchanged save is a no-op that does not spend the 48h cooldown.
    //
    // Scoped to the EDITABLE form: the blocked state carries its own single
    // action (back_to_training), which is a different screen state, not a
    // second choice offered at the same time.
    const forms = screen().layout.children.filter(c => c.type === 'Form');
    const editable = forms.find(f => JSON.stringify(f).includes('CheckboxGroup'));
    const json = JSON.stringify(editable);
    expect(json).not.toContain('continue_to_training');
    expect((json.match(/data_exchange/g) || []).length).toBe(1);
  });

  test('submits the selection with a state-driven action', () => {
    // The action is templated (${data.primary_action}) rather than the literal
    // 'save_bands', so the one Footer can be Save when editable and Back when
    // blocked. The endpoint supplies save_bands / back_to_training.
    const json = JSON.stringify(screen().layout);
    expect(json).toContain('${data.primary_action}');
    expect(json).toContain('${form.band_choice}');
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../bot/shared/routes/teacher-training-endpoint.js'), 'utf8');
    expect(src).toContain("primary_action: blocked ? 'back_to_training' : 'save_bands'");
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

describe('VENDOR_PICKER — bands are shown, not gated behind a confirm step', () => {
  const vp = () => screenById.get('VENDOR_PICKER');

  test('carries an "Edit Teacher Level" link into BAND_PICKER', () => {
    // Label set by the operator (2026-08-21) and used verbatim on the portal
    // too, so the two surfaces read the same.
    const json = JSON.stringify(vp().layout);
    expect(json).toContain('change_bands');
    expect(json).toContain('Edit Teacher Level');
  });

  test('the edit link has its own visibility flag', () => {
    // Hidden when there are no bands to edit — that teacher gets the
    // setup-prompt row instead, which routes to the same screen.
    expect(vp().data).toHaveProperty('bands_edit_visible');
    expect(JSON.stringify(vp().layout)).toContain('${data.bands_edit_visible}');
  });

  test('it is still the entry point, so nobody pays a tap to reach training', () => {
    const targets = new Set(Object.values(FLOW.routing_model).flat());
    expect(Object.keys(FLOW.routing_model).filter(s => !targets.has(s)))
      .toEqual(['VENDOR_PICKER']);
  });

  test('the caption slot can carry the bands summary', () => {
    expect(vp().data).toHaveProperty('hero_caption');
  });
});

describe('every screen render supplies EVERY ${data.*} field it references', () => {
  // The bug this pins: buildBandSetupPrompt omitted bands_edit_visible, and an
  // omitted field is NOT treated as false — the client keeps the value it last
  // had (or the schema __example__). So the setup screen rendered BOTH "Choose
  // the grades you teach" AND "Edit the grades I teach", which are mutually
  // exclusive. entryErrorScreen had the same latent omission.
  const fs = require('fs');
  const path = require('path');
  const SRC = fs.readFileSync(
    path.join(__dirname, '../../bot/shared/routes/teacher-training-endpoint.js'), 'utf8');

  const RENDERS = [
    ['buildVendorPicker', 'VENDOR_PICKER'],
    ['buildBandSetupPrompt', 'VENDOR_PICKER'],
    ['entryErrorScreen', 'VENDOR_PICKER'],
    ['buildBandPicker', 'BAND_PICKER'],
  ];

  test.each(RENDERS)('%s supplies every field %s declares', (fn, screenId) => {
    const start = SRC.indexOf(`function ${fn}`);
    expect(start).toBeGreaterThan(-1);
    const body = SRC.slice(start, SRC.indexOf('\n}\n', start));
    const declared = Object.keys(screenById.get(screenId).data);
    const missing = declared.filter(k => !body.includes(k));
    expect(missing).toEqual([]);
  });
});

describe('BAND_PICKER — the blocked state offers no way to submit', () => {
  const bp = () => screenById.get('BAND_PICKER');
  const form = () => bp().layout.children.find(c => c.type === 'Form');
  const kids = () => form().children;

  test('carries two mutually exclusive states', () => {
    expect(bp().data).toHaveProperty('form_visible');
    expect(bp().data).toHaveProperty('blocked_visible');
  });

  test('the checkbox group is hidden in the blocked state', () => {
    const cb = kids().find(c => c.type === 'CheckboxGroup');
    expect(cb.visible).toBe('${data.form_visible}');
  });

  test('the refusal is a heading + body, not a grey caption', () => {
    const blocked = kids().filter(c => c.visible === '${data.blocked_visible}');
    const types = blocked.map(c => c.type);
    expect(types).toContain('TextSubheading');
    expect(types).toContain('TextBody');
  });

  test('there is exactly ONE Footer, whose action switches with the state', () => {
    // A blocked teacher must have no way to submit. Rather than two footers
    // (Meta renders only one per screen), the single footer's action is driven
    // by ${data.primary_action}: save_bands when editable, back_to_training
    // when blocked.
    const footers = kids().filter(c => c.type === 'Footer');
    expect(footers).toHaveLength(1);
    expect(JSON.stringify(footers[0])).toContain('${data.primary_action}');
  });

  test('no Form carries a `visible` property', () => {
    // Meta rejects it: INVALID_PROPERTY_KEY "Property 'visible' is not allowed
    // in 'Form' component." An earlier revision used two conditionally-visible
    // Forms and failed to publish. State is expressed per-CHILD instead.
    for (const sc of FLOW.screens) {
      for (const c of sc.layout.children) {
        if (c.type === 'Form') expect(c.visible).toBeUndefined();
      }
    }
  });
});
