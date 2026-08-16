/**
 * FEAT-059 / bd-m3gre — pakistan-lp-flow-v3.json structural test (TDD, red first).
 *
 * Modelled on 02_Main Rumi Bot's tests/storybook/flow-json.test.js, which is the
 * only place the NavigationList limits are actually enforced anywhere in either
 * codebase. v2's JSON does ship (docs/flows/pakistan-lp-flow-v2.json) but had no
 * structural test, so nothing enforced Meta's item/character caps or the
 * forward-only routing rule on the Flow teachers were actually being served.
 * v3 closes that.
 */

const fs = require('fs');
const path = require('path');

// Flow JSON lives at the REPO ROOT docs/flows, not bot/docs/flows — that is
// where scripts/setup/flow-configs.js resolves FLOWS_DIR to.
const FLOW_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'flows', 'pakistan-lp-flow-v3.json');

const SELECTION_SCREENS = ['SELECT_GRADE', 'SELECT_SUBJECT', 'SELECT_CHAPTER', 'SELECT_LESSON', 'SELECT_LESSON_MORE'];
const cps = (s) => [...String(s)].length;

describe('pakistan-lp-flow-v3.json', () => {
  let flow;
  beforeAll(() => { flow = JSON.parse(fs.readFileSync(FLOW_PATH, 'utf8')); });

  test('uses a NavigationList-capable version (>=6.2) and data API 3.0', () => {
    expect(parseFloat(flow.version)).toBeGreaterThanOrEqual(6.2);
    expect(flow.data_api_version).toBe('3.0');
  });

  test('has the six screens of the drill: grade → subject → chapter → lesson → (more) → success', () => {
    expect(flow.screens.map((s) => s.id)).toEqual([
      'SELECT_GRADE', 'SELECT_SUBJECT', 'SELECT_CHAPTER', 'SELECT_LESSON', 'SELECT_LESSON_MORE', 'SUCCESS',
    ]);
    expect(flow.screens.length).toBeLessThanOrEqual(10);   // Meta cap
  });

  test('routing_model is forward-only — no self route, no backward route', () => {
    const order = flow.screens.map((s) => s.id);
    expect(flow.routing_model).toEqual({
      SELECT_GRADE: ['SELECT_SUBJECT'],
      SELECT_SUBJECT: ['SELECT_CHAPTER'],
      SELECT_CHAPTER: ['SELECT_LESSON'],
      SELECT_LESSON: ['SELECT_LESSON_MORE', 'SUCCESS'],
      SELECT_LESSON_MORE: ['SUCCESS'],
      SUCCESS: [],
    });
    // Meta rejects publish with INVALID_ROUTING_MODEL on a self or backward route.
    for (const [from, tos] of Object.entries(flow.routing_model)) {
      for (const to of tos) {
        expect(to).not.toBe(from);
        expect(order.indexOf(to)).toBeGreaterThan(order.indexOf(from));
      }
    }
    expect(Object.keys(flow.routing_model).sort()).toEqual([...order].sort());
  });

  test('every selection screen has exactly ONE NavigationList and nothing else interactive', () => {
    for (const id of SELECTION_SCREENS) {
      const screen = flow.screens.find((s) => s.id === id);
      expect(screen).toBeDefined();
      const children = JSON.stringify(screen.layout.children);
      expect((children.match(/"NavigationList"/g) || []).length).toBe(1);
      // Meta forbids combining a NavigationList with other interactive components,
      // Footer included — that is why the aggregate progress line lives on the
      // Flow-OPEN chat bubble instead of inside the Flow.
      expect(children).not.toMatch(/"Dropdown"|"RadioButtonsGroup"|"CheckboxGroup"|"Footer"|"TextInput"|"TextArea"/);
    }
  });

  test('SUCCESS is terminal, has no NavigationList, and closes with a Footer', () => {
    const s = flow.screens.find((x) => x.id === 'SUCCESS');
    expect(s.terminal).toBe(true);
    expect(JSON.stringify(s.layout)).not.toMatch(/NavigationList/);
    expect(JSON.stringify(s.layout)).toMatch(/"Footer"/);
  });

  test('every screen binds the data its NavigationList reads', () => {
    for (const id of SELECTION_SCREENS) {
      const screen = flow.screens.find((s) => s.id === id);
      expect(screen.data).toHaveProperty('items');
      expect(screen.data.items.type).toBe('array');
      expect(JSON.stringify(screen.layout)).toContain('${data.items}');
    }
  });

  test('every __example__ item respects the 20-item / 30 / 20 / 80 caps', () => {
    for (const screen of flow.screens) {
      const ex = screen.data && screen.data.items && screen.data.items.__example__;
      if (!ex) continue;
      expect(ex.length).toBeLessThanOrEqual(20);
      for (const item of ex) {
        expect(item.id).toBeDefined();
        expect(cps(item['main-content'].title)).toBeLessThanOrEqual(30);
        if (item['main-content'].description) expect(cps(item['main-content'].description)).toBeLessThanOrEqual(20);
        if (item['main-content'].metadata) expect(cps(item['main-content'].metadata)).toBeLessThanOrEqual(80);
      }
    }
  });

  test('every item carries its own data_exchange action with a routable step', () => {
    const steps = new Set();
    for (const screen of flow.screens) {
      const ex = screen.data && screen.data.items && screen.data.items.__example__;
      if (!ex) continue;
      for (const item of ex) {
        expect(item['on-click-action'].name).toBe('data_exchange');
        expect(item['on-click-action'].payload.step).toBeDefined();
        steps.add(item['on-click-action'].payload.step);
      }
    }
    // The dispatcher routes purely on payload.step (the storybooks pattern).
    expect([...steps].sort()).toEqual(['chapter', 'grade', 'lesson', 'lesson_page', 'subject']);
  });

  test('no start.image carries a data: URI prefix — Meta renders a placeholder for those', () => {
    expect(JSON.stringify(flow)).not.toMatch(/"image"\s*:\s*"data:/);
  });

  test('the whole flow is far inside the 10 MB JSON cap', () => {
    expect(Buffer.byteLength(JSON.stringify(flow))).toBeLessThan(200 * 1024);
  });

  test('the pagination screen exists so a >20-lesson chapter is reachable, not truncated', () => {
    // grade_1_maths ch3 has 24 lessons — page 1 shows 19 + a More row, page 2 the rest.
    const more = flow.screens.find((s) => s.id === 'SELECT_LESSON_MORE');
    expect(more).toBeDefined();
    expect(flow.routing_model.SELECT_LESSON).toContain('SELECT_LESSON_MORE');
  });

  test('flow-configs.js points at a file that EXISTS, in the dir FLOWS_DIR resolves to', () => {
    const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'setup', 'flow-configs.js'), 'utf8');
    const m = /jsonPath:\s*path\.join\(FLOWS_DIR,\s*'([^']*pakistan-lp[^']*)'\)/.exec(cfg);
    expect(m).not.toBeNull();
    expect(fs.existsSync(path.join(__dirname, '..', '..', '..', 'docs', 'flows', m[1]))).toBe(true);
  });
});
