'use strict';

/**
 * Coach forms for every grade, 1 to 5. EGRA and EGMA have no per-grade forms (the RWP May 2026 instrument was one form
 * for Grades 1-5; Core EGMA is written for Grades 1-3 and RWP ran it to Grade 5), so the new forms hold the same items
 * as the forms already fielded: Grades 1 and 2 take coach.G3.A, Grade 4 takes coach.G5.A (its maths pick). The api
 * resolves `coach.G<grade>.A`, so a Grade 1 or Grade 4 session gets its own form once the form exists.
 */

const fs = require('fs');
const path = require('path');
const sa = require('../../shared/services/child-test/app/sa-api.service');
const bank = require('../../shared/data/child-test/item-bank.sa.v1.json');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const SAME_AS = { 'coach.G1.A': 'coach.G3.A', 'coach.G2.A': 'coach.G3.A', 'coach.G4.A': 'coach.G5.A' };
const COACH_FORMS = ['coach.G1.A', 'coach.G2.A', 'coach.G3.A', 'coach.G4.A', 'coach.G5.A'];
const tasksOf = (form) => Object.fromEntries(Object.entries(bank.tasks)
  .filter(([k]) => k.startsWith(`${form}/`)).map(([k, v]) => [k.slice(form.length + 1), v]));

describe('coach forms for Grades 1-5', () => {
  test('the five coach forms exist, each for its own grade', () => {
    for (const id of COACH_FORMS) {
      expect([id, bank.forms[id] && bank.forms[id].surface]).toEqual([id, 'coach']);
      expect(bank.forms[id].grades).toEqual([Number(id[7])]);
    }
  });

  test('G1 and G2 hold the G3 items, G4 the G5 items: same lists, same tasks, same maths form', () => {
    for (const [id, base] of Object.entries(SAME_AS)) {
      const f = bank.forms[id];
      const b = bank.forms[base];
      for (const k of ['order', 'full', 'blocks', 'rdf_auto', 'rdf_manual', 'rdf', 'maths_form', 'set']) expect([id, k, f[k]]).toEqual([id, k, b[k]]);
      expect(tasksOf(id)).toEqual(tasksOf(base));
    }
  });

  test('every item of the RDF auto / manual lists carries its src, and the Rwanda P6 numerals are in none', () => {
    for (const id of COACH_FORMS) {
      const f = bank.forms[id];
      expect(f.rdf_auto.includes('ma.number_id_upper')).toBe(false);
      for (const t of f.rdf_auto) {
        const task = bank.tasks[`${id}/${t}`];
        const items = [...((task.tap && task.tap.items) || []), ...((task.record && task.record.items) || [])];
        for (const it of items) expect([id, t, it.id, typeof it.src]).toEqual([id, t, it.id, 'string']);
      }
    }
  });

  test('each new form has its own file and its UR and EN runtime batteries', () => {
    for (const id of Object.keys(SAME_AS)) {
      for (const rel of [`sa/${id}.json`, `sa/sa.${id}.ur.json`, `sa/sa.${id}.en.json`]) expect([rel, fs.existsSync(path.join(DATA, rel))]).toEqual([rel, true]);
    }
  });
});

describe('a session of grade N resolves coach.GN.A', () => {
  const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
  const world = (grade) => {
    const session = { id: 'sess-g', coach_user_id: COACH, draw_id: 'd-g', visit_key: 'day:x', grade, form: 'A', item_bank_version: 'sa-battery', status: 'in_progress', device: {} };
    return {
      enabled: async () => true,
      store: { getSession: async () => ({ ok: true, session }) },
      saStore: { summary: async () => ({ ok: true, block: 'rdf_auto' }) },
      bank,
      now: () => new Date('2026-10-22T05:00:00Z'),
      log: () => {}, logError: () => {},
      rdfW3Forms: true,
    };
  };

  test.each([1, 2, 4])('grade %i: the RDF auto battery of coach.G%i.A', async (grade) => {
    const out = await sa.saBattery({ userId: COACH, sessionId: 'sess-g' }, world(grade));
    const id = `coach.G${grade}.A`;
    expect(out.status).toBe('ok');
    expect(Object.keys(out.battery.forms)).toEqual([id]);
    expect(Object.keys(out.battery.tasks)).toEqual(bank.forms[id].rdf_auto.map((t) => `${id}/${t}`));
  });
});
