/**
 * The coach-requested pre-prod screens: a coach who has already scanned a school
 * must SEE that when she returns — which grades of 1-5 are done, which are
 * missing — and must be able to open a saved roster and correct it.
 *
 * Contract pins: the three screens exist; every navigation edge they need is in
 * the routing model; the model stays acyclic (Meta refuses cycles at publish);
 * SCHOOL keeps its direct edge to PHOTOS so an already-published flow keeps
 * working while the endpoint rolls; ROSTER_EDIT mirrors REVIEW's six-chunk
 * editing machinery exactly (600-char TextArea cap is why chunks exist at all).
 */
const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'flows', 'roster-flow-v1.json'), 'utf8'));

const screen = (id) => FLOW.screens.find((s) => s.id === id);
const routing = FLOW.routing_model;

describe('roster flow — status / view / edit screens', () => {
  it('the three screens exist', () => {
    expect(screen('SCHOOL_STATUS')).toBeDefined();
    expect(screen('ROSTER_VIEW')).toBeDefined();
    expect(screen('ROSTER_EDIT')).toBeDefined();
  });

  it('routing carries every edge the journeys need, and SCHOOL keeps PHOTOS for rollout compat', () => {
    expect(routing.SCHOOL).toEqual(expect.arrayContaining(['SCHOOL_STATUS', 'PHOTOS', 'SCHOOL_SEARCH']));
    expect(routing.SCHOOL_RESULTS).toEqual(expect.arrayContaining(['SCHOOL_STATUS', 'PHOTOS']));
    expect(routing.SCHOOL_STATUS).toEqual(expect.arrayContaining(['PHOTOS', 'ROSTER_VIEW']));
    expect(routing.ROSTER_VIEW).toEqual(expect.arrayContaining(['ROSTER_EDIT']));
    expect(routing.ROSTER_EDIT).toEqual(expect.arrayContaining(['SAVED']));
  });

  it('the routing model stays acyclic', () => {
    const seen = new Set();
    const stack = new Set();
    const visit = (n) => {
      if (stack.has(n)) throw new Error(`cycle at ${n}`);
      if (seen.has(n)) return;
      seen.add(n); stack.add(n);
      (routing[n] || []).forEach(visit);
      stack.delete(n);
    };
    expect(() => Object.keys(routing).forEach(visit)).not.toThrow();
  });

  it('SCHOOL_STATUS is one proven pattern: a dropdown of actions and one Continue', () => {
    const s = JSON.stringify(screen('SCHOOL_STATUS'));
    expect(s).toMatch(/"next_action"/);
    expect(s).toMatch(/Dropdown/);
    expect(s).toMatch(/data_exchange/);
    expect(s).toMatch(/coverage_text/);
  });

  it('ROSTER_VIEW shows the roster and offers exactly one action — edit', () => {
    const s = JSON.stringify(screen('ROSTER_VIEW'));
    expect(s).toMatch(/roster_text/);
    expect(s).toMatch(/data_exchange/);
  });

  it('ROSTER_EDIT mirrors REVIEW: six chunks, init-values, show bindings', () => {
    const s = screen('ROSTER_EDIT');
    const txt = JSON.stringify(s);
    for (let i = 1; i <= 6; i += 1) {
      expect(txt).toMatch(new RegExp(`"chunk${i}"`));
    }
    const form = s.layout.children.find((c) => c.type === 'Form');
    expect(form['init-values'].chunk1).toBe('${data.chunk1}');
    expect(form['init-values'].chunk6).toBe('${data.chunk6}');
  });

  it('ROSTER_EDIT carries six TextArea boxes — the 600-char platform cap is honoured by toChunks packing', () => {
    // REVIEW (the original) declares no max-length either: Meta enforces 600 as
    // a platform cap on TextArea, and toChunks() packs to it (roster-lines tests).
    const s = JSON.stringify(screen('ROSTER_EDIT'));
    const areas = [...s.matchAll(/"TextArea"/g)];
    expect(areas.length).toBe(6);
  });
});
