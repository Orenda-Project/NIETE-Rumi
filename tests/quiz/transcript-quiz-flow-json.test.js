/**
 * docs/flows/transcript-quiz-flow.json — structural test for the /quiz Flow
 * (lesson list with in-Flow paging → per-lesson results/actions → done).
 *
 * Modelled on bot/tests/lp-v8/flow-json.test.js, the only place in either
 * codebase that actually enforces Meta's NavigationList limits and the
 * forward-only routing rule. The constraints below are Meta's, not ours —
 * verified against Meta's Flow JSON reference and confirmed live: an asset
 * upload of this exact shape to a WABA returned `validation_errors: []`.
 */

const fs = require('fs');
const path = require('path');

// Flow JSON lives at repo-root docs/flows, same dir bot/scripts/setup/flow-configs.js
// resolves FLOWS_DIR to — this file sits at repo-root tests/quiz, two levels up.
const FLOW_PATH = path.resolve(__dirname, '../../docs/flows/transcript-quiz-flow.json');

const SCREEN_ORDER = ['LESSONS', 'LESSON', 'DONE'];
const cps = (s) => [...String(s)].length;

// Every layout node, flattened, so a `text`/`label` check reaches nodes
// nested inside a Form rather than only its direct children.
function collectNodes(node, acc = []) {
  if (Array.isArray(node)) {
    for (const n of node) collectNodes(n, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    acc.push(node);
    for (const v of Object.values(node)) collectNodes(v, acc);
  }
  return acc;
}

describe('transcript-quiz-flow.json', () => {
  let flow;
  beforeAll(() => { flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8')); });

  test('uses a NavigationList-capable version (>=6.2) and data API 3.0', () => {
    expect(parseFloat(flow.version)).toBeGreaterThanOrEqual(6.2);
    expect(flow.data_api_version).toBe('3.0');
  });

  test('has exactly the three screens of the drill: LESSONS -> LESSON -> DONE', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(SCREEN_ORDER);
  });

  test('routing_model is forward-only — no self route, no backward route', () => {
    expect(flow.routing_model).toEqual({
      LESSONS: ['LESSON'],
      LESSON: ['DONE'],
      DONE: [],
    });
    // Meta rejects publish with INVALID_ROUTING_MODEL on a self or backward
    // route. In-screen paging is a runtime data_exchange response that
    // re-renders the SAME screen id (LESSONS), which is why there is
    // deliberately no LESSONS -> LESSONS edge here — paging never routes.
    for (const [from, tos] of Object.entries(flow.routing_model)) {
      for (const to of tos) {
        expect(to).not.toBe(from);
        expect(SCREEN_ORDER.indexOf(to)).toBeGreaterThan(SCREEN_ORDER.indexOf(from));
      }
    }
    expect(Object.keys(flow.routing_model).sort()).toEqual([...SCREEN_ORDER].sort());
  });

  test('LESSONS holds exactly ONE NavigationList and nothing else', () => {
    const screen = flow.screens.find((s) => s.id === 'LESSONS');
    expect(screen.layout.children).toHaveLength(1);
    expect(screen.layout.children[0].type).toBe('NavigationList');
    // Meta forbids combining a NavigationList with any other component type,
    // Footer and Form included.
    const asText = JSON.stringify(screen.layout);
    expect((asText.match(/"NavigationList"/g) || []).length).toBe(1);
    expect(asText).not.toMatch(/"Footer"|"Form"|"TextHeading"|"TextBody"|"TextCaption"|"TextInput"/);
  });

  test('LESSON holds no NavigationList, and a Form with heading/body/radio/footer', () => {
    const screen = flow.screens.find((s) => s.id === 'LESSON');
    const asText = JSON.stringify(screen.layout);
    expect(asText).not.toMatch(/"NavigationList"/);

    const form = screen.layout.children.find((c) => c.type === 'Form');
    expect(form).toBeDefined();
    const kids = collectNodes(form.children);
    expect(kids.some((n) => n.type === 'TextHeading')).toBe(true);
    expect(kids.some((n) => n.type === 'TextBody')).toBe(true);

    const radio = kids.find((n) => n.type === 'RadioButtonsGroup');
    expect(radio).toBeDefined();
    expect(radio.name).toBe('tq_action');

    const footer = kids.find((n) => n.type === 'Footer');
    expect(footer).toBeDefined();
    expect(footer['on-click-action'].name).toBe('data_exchange');
    expect(footer['on-click-action'].payload.step).toBe('action');
    expect(footer['on-click-action'].payload.action).toBe('${form.tq_action}');
  });

  test('DONE is terminal, has no NavigationList, and closes with a complete Footer', () => {
    const screen = flow.screens.find((s) => s.id === 'DONE');
    expect(screen.terminal).toBe(true);
    const asText = JSON.stringify(screen.layout);
    expect(asText).not.toMatch(/"NavigationList"/);
    const footer = collectNodes(screen.layout).find((n) => n.type === 'Footer');
    expect(footer).toBeDefined();
    expect(footer['on-click-action'].name).toBe('complete');
  });

  test('every NavigationList __example__ item respects the 20-item / 30 / 20 / 80 code-point caps', () => {
    let checked = 0;
    for (const screen of flow.screens) {
      const ex = screen.data && screen.data.items && screen.data.items.__example__;
      if (!ex) continue;
      expect(ex.length).toBeLessThanOrEqual(20);
      for (const item of ex) {
        expect(item.id).toBeDefined();
        expect(cps(item['main-content'].title)).toBeLessThanOrEqual(30);
        if (item['main-content'].description) expect(cps(item['main-content'].description)).toBeLessThanOrEqual(20);
        if (item['main-content'].metadata) expect(cps(item['main-content'].metadata)).toBeLessThanOrEqual(80);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('every NavigationList item carries its own data_exchange action, steps exactly lesson/page', () => {
    const steps = new Set();
    let checked = 0;
    for (const screen of flow.screens) {
      const ex = screen.data && screen.data.items && screen.data.items.__example__;
      if (!ex) continue;
      for (const item of ex) {
        expect(item['on-click-action'].name).toBe('data_exchange');
        expect(item['on-click-action'].payload.step).toBeDefined();
        steps.add(item['on-click-action'].payload.step);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect([...steps].sort()).toEqual(['lesson', 'page']);
  });

  test('no start.image anywhere carries a data: URI prefix — Meta renders a placeholder for those', () => {
    expect(JSON.stringify(flow)).not.toMatch(/"image"\s*:\s*"data:/);
  });

  test('the whole flow is far inside Meta\'s 10 MB JSON cap', () => {
    expect(Buffer.byteLength(JSON.stringify(flow))).toBeLessThan(200 * 1024);
  });

  test('flow-configs.js points at a transcript-quiz JSON file that EXISTS in FLOWS_DIR', () => {
    const cfg = fs.readFileSync(
      path.resolve(__dirname, '../../bot/scripts/setup/flow-configs.js'),
      'utf8',
    );
    const m = /jsonPath:\s*path\.join\(FLOWS_DIR,\s*'([^']*transcript-quiz[^']*)'\)/.exec(cfg);
    expect(m).not.toBeNull();
    expect(fs.existsSync(path.resolve(__dirname, '../../docs/flows', m[1]))).toBe(true);
  });

  // Every rendered string is a ${data.*} binding, never literal copy — the
  // endpoint serves the teacher's own language, so the Flow layout itself
  // must carry no fixed-language text (language-protocol, root rule 20).
  test('no screen title, and no text/label in any layout, is a plain literal string', () => {
    const BINDING = /^\$\{data\.[a-z_]+\}$/;
    for (const screen of flow.screens) {
      expect(screen.title).toMatch(BINDING);
      for (const node of collectNodes(screen.layout)) {
        if (typeof node.text === 'string') expect(node.text).toMatch(BINDING);
        if (typeof node.label === 'string') expect(node.label).toMatch(BINDING);
      }
    }
  });

  // `version` is the Flow JSON SCHEMA version, not a version of our content, and
  // raising it raises the minimum WhatsApp build that can render the Flow. Bumping
  // it to 7.1 for a content change published cleanly — Meta accepted it, zero
  // validation errors — and then answered "Something went wrong" on a real handset,
  // on a payload that matched the contract exactly. Nothing in this repo is above
  // 7.0; do not lead the fleet on a schema version to ship a copy change.
  test('the Flow JSON schema version stays at one this deployment has proven', () => {
    expect(flow.version).toBe('7.0');
  });
});
