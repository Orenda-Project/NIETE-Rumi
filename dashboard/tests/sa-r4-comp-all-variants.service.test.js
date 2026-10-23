'use strict';
/**
 * Round 4, re-walk: the Urdu rotated passage (select2024) still asked one question. Its questions carry needs_line, not
 * gate.min_words, and the round-4 rule only ran for questions with min_words gates.
 * Under sa_comp_all_questions the rule holds for every comprehension task that hangs on a passage, whatever its variant:
 * 10+ words read, not stopped on the first line → every question.
 * Walks every served battery (sa.*.json) × every comprehension task × every variant, as served with every switch ON.
 */
const fs = require('fs');
const path = require('path');
const core = require('../sa/sa-core');
const { applySwitches } = require('../routes/sa-battery-switches');

const DIR = path.join(__dirname, '../../bot/shared/data/child-test/sa');
const FILES = fs.readdirSync(DIR).filter((f) => /^sa\..+\.json$/.test(f)).sort();
const ON = { rdfW3Forms: true, passageRotation: true, compAllQuestions: true };

function clock() { let t = 0; return { now: () => t }; }
/** The task as the page runs it once variant v is picked (sa-page.js rotate). */
function pick(t, v) {
  const c = { ...t, practice: [] };
  delete c.variants;
  if (v) { c.items = v.items; if (v.passage) c.passage = v.passage; if (v.stop) c.stop = v.stop; }
  return c;
}
function cases() {
  const out = [];
  for (const f of FILES) {
    const b = applySwitches(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')), ON);
    expect(b.ui && b.ui.comp_all_questions).toBe(true);
    for (const t of b.tasks) {
      const d = t.depends_on;
      if (!d || !(d.items_read_upto || d.upto_item)) continue;
      const dep = b.tasks.find((x) => x.id === d.task);
      const vs = Array.isArray(t.variants) && t.variants.length ? t.variants : [null];
      vs.forEach((v, i) => {
        const dv = v && Array.isArray(dep.variants) ? dep.variants[i] : null;
        out.push({ name: `${f} ${t.id} ${v ? v.id : 'base'}`, dep: pick(dep, dv), comp: pick(t, v) });
      });
    }
  }
  return out;
}
function walk(c, wordsRead) {
  const k = clock();
  const r = core.createRunner({ battery: { battery_id: 'b', tasks: [c.dep, c.comp] }, now: k.now, mic: () => 'ok', comp_all_questions: true });
  r.start(); r.instructionDone(); r.begin(); r.done(); r.lastWord(wordsRead - 1); r.next();
  const v = r.view();
  if (v.task && v.task.id !== c.comp.id) return { stop: 'not_reached' };
  if (v.phase === 'task_end' || v.result) return { stop: v.result && v.result.stop_reason, asked: [] };
  r.instructionDone(); r.begin();
  const asked = [];
  while (r.view().phase === 'running') { asked.push(r.view().item.id); r.answer('spoken'); }
  return { asked };
}

const ALL = cases();

test('the walk covers both languages, all five grades and the rotated Urdu select2024 variant', () => {
  expect(ALL.length).toBeGreaterThan(50);
  for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) expect(ALL.some((c) => c.name.includes(`.${g}.`))).toBe(true);
  for (const l of ['.ur.json', '.en.json']) expect(ALL.some((c) => c.name.includes(l))).toBe(true);
  expect(ALL.some((c) => /ur\.story_comp_w3 select2024/.test(c.name))).toBe(true);
});

describe.each(ALL.map((c) => [c.name, c]))('%s', (_n, c) => {
  test('15 words read (the live case: end of line 2) → every question', () => {
    expect(walk(c, 15).asked).toEqual(c.comp.items.map((q) => q.id));
  });
  test('exactly 10 words read → every question', () => {
    expect(walk(c, 10).asked).toEqual(c.comp.items.map((q) => q.id));
  });
});
