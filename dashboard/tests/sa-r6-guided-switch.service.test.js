'use strict';
/**
 * Round 6, bar S (DESIGN_R6 §6): the switch sa_guided_instructions reaches the battery.
 *   - its value names grades: JSON true = [1, 2, 3]; a list of grades 1-5; anything else OFF;
 *   - ON for a form whose grades are all listed: script.guided kept, ui.guided + ui.guided_grades;
 *   - otherwise (OFF, or a form not listed): script.guided dropped, no ui key added (the battery as built before);
 *   - the route reads it per request, and a failed read is OFF.
 */
const fs = require('fs');
const path = require('path');
const { SWITCHES, applySwitches } = require('../routes/sa-battery-switches');
const { gradesOf, createGradesFlag } = require('../routes/sa-grades-flag');

const FORMS = path.join(__dirname, '..', '..', 'bot', 'shared', 'data', 'child-test', 'sa');
const form = (name) => JSON.parse(fs.readFileSync(path.join(FORMS, name), 'utf8'));
const hasGuided = (b) => b.tasks.some((t) => t.script && t.script.guided);
const strip = (b) => ({ ...b, tasks: b.tasks.map((t) => {
  if (!t.script || !t.script.guided) return t;
  const { guided: _g, ...script } = t.script;
  return { ...t, script };
}) });

describe('sa_guided_instructions: the value names grades', () => {
  test('true is Grades 1-3; a list is its grades; anything else is OFF', () => {
    expect(SWITCHES.guidedInstructions).toBe('sa_guided_instructions');
    expect(gradesOf(true)).toEqual([1, 2, 3]);
    expect(gradesOf([2])).toEqual([2]);
    expect(gradesOf([3, 1, 3])).toEqual([1, 3]);
    for (const v of [false, 'true', '"true"', 1, [], [0], [6], [2.5], ['2'], { enabled: true }, null, undefined]) expect(gradesOf(v)).toBeNull();
  });
  test('the reader: the stored value, OFF on no client, an error or a throw', async () => {
    const db = (value, error) => () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }) }) }) }) });
    for (const [d, want] of [[db([2]), [2]], [db(true), [1, 2, 3]], [db('yes'), null], [db(undefined), null], [db([2], { message: 'x' }), null], [() => null, null],
      [() => { throw new Error('down'); }, null]]) {
      const g = createGradesFlag({ db: d, key: 'k' });
      expect(g()).toBeNull(); // never waits: OFF until the first read lands
      await g.ready();
      expect(g()).toEqual(want);
    }
  });
});

describe('applySwitches: the guided lines only where the switch names the form\'s grade', () => {
  const g2 = form('sa.coach.G2.A.ur.json');
  const g3 = form('sa.coach.G3.A.en.json');
  const g5 = form('sa.coach.G5.A.ur.json');
  test('the Grade 1-3 forms carry the lines as built', () => { expect(hasGuided(g2)).toBe(true); expect(hasGuided(g5)).toBe(false); });
  test('OFF: no task carries script.guided, nothing else changes, no ui key', () => {
    const off = applySwitches(g2, { rdfW3Forms: true });
    expect(hasGuided(off)).toBe(false);
    expect(off.ui).toBeUndefined();
    expect(JSON.stringify(off)).toBe(JSON.stringify(applySwitches(strip(g2), { rdfW3Forms: true })));
  });
  test('ON [2]: Grade 2 keeps them and says so; Grade 3 does not', () => {
    const on2 = applySwitches(g2, { rdfW3Forms: true, guidedGrades: [2] });
    expect(hasGuided(on2)).toBe(true);
    expect(on2.ui).toEqual({ guided: true, guided_grades: [2] });
    const on3 = applySwitches(g3, { rdfW3Forms: true, guidedGrades: [2] });
    expect(hasGuided(on3)).toBe(false);
    expect(on3.ui).toBeUndefined();
  });
  test('ON true: Grades 1-3; a Grade 5 form is untouched (no lines, no ui key)', () => {
    expect(applySwitches(g3, { rdfW3Forms: true, guidedGrades: [1, 2, 3] }).ui).toEqual({ guided: true, guided_grades: [1, 2, 3] });
    const on5 = applySwitches(g5, { rdfW3Forms: true, guidedGrades: [1, 2, 3, 4, 5] });
    expect(JSON.stringify(on5)).toBe(JSON.stringify(applySwitches(g5, { rdfW3Forms: true })));
  });
  test('with other switches ON the guided keys sit beside theirs', () => {
    expect(applySwitches(g2, { rdfW3Forms: true, oneAtATime: true, guidedGrades: [2] }).ui).toEqual({ one_at_a_time: true, guided: true, guided_grades: [2] });
  });
});

describe('the route reads the switch', () => {
  const express = require('express');
  const { createSaEngineRouter } = require('../routes/sa-engine.routes');
  test('[2]: the Grade 2 battery is guided; OFF (null) it is not; a throwing reader is OFF', async () => {
    for (const [reader, want] of [[() => [2], true], [() => null, false], [() => { throw new Error('x'); }, false]]) {
      const app = express();
      app.use(createSaEngineRouter({ on: () => true, rdfW3Forms: () => true, guidedGrades: reader, env: {} }));
      const srv = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
      try {
        const b = await (await fetch(`http://127.0.0.1:${srv.address().port}/sa/batteries/sa.coach.G2.A.ur.json`)).json();
        expect(!!(b.ui && b.ui.guided)).toBe(want);
        expect(hasGuided(b)).toBe(want);
        if (want) expect(b.ui.guided_grades).toEqual([2]);
      } finally { srv.close(); }
    }
  });
});
