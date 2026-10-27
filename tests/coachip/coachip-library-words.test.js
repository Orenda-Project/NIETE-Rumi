'use strict';
/**
 * fix-r5 s2 item 21 (qa-coach 073257 (1); COPY §0 rule 7 "words off coach screens"): no library string a coach or RM
 * reads carries a schema field name or any other snake_case token (`independent_practice_steps`, `peer_review`,
 * `letter_name_routine_only` …). Walked two ways: through the real S5 shaper (`interventionShape`, what GET /i/:w
 * serves) for every intervention in the library, and over every English/Urdu display field of the raw file, the
 * deferred ones included, so a string cannot reach a screen by another route.
 */
const path = require('path');
const { interventionShape } = require('../../dashboard/services/coachip-coach-read.service');
const S = require('../../dashboard/services/coachip-shapes');

const LIB = require(path.join(__dirname, '..', '..', 'dashboard', 'data', 'coachip', 'INTERVENTIONS.json'));
const SNAKE = /[a-z]+_[a-z_]+/;
// Urdu wraps Latin runs in LRI … PDI (COPY §0 rule 3): `⁦peer⁩_⁦review⁩` is still `peer_review` on screen.
const plain = (s) => String(s).replace(/[⁦-⁩]/g, '');

/** The display fields of one intervention (raw keys), as interventionShape and rm/circle read them. */
function displayStrings(i) {
  const out = [];
  const add = (where, v) => { if (typeof v === 'string' && v) out.push([`${i.id}.${where}`, v]); };
  add('title_en', i.title_en); add('title_ur', i.title_ur);
  if (i.teacher_action_step) { add('step_en', i.teacher_action_step.step_en); add('step_ur', i.teacher_action_step.step_ur); }
  add('with_whom', i.with_whom); add('with_whom_ur', i.with_whom_ur);
  add('duration', i.duration); add('duration_ur', i.duration_ur);
  (i.materials || []).forEach((m, k) => { add(`materials[${k}].name`, m.name); add(`materials[${k}].name_ur`, m.name_ur); });
  add('rehearsal_script_en', i.rehearsal_script_en); add('rehearsal_script_ur', i.rehearsal_script_ur);
  add('debrief_script_en', i.debrief_script_en); add('debrief_script_ur', i.debrief_script_ur);
  const cw = i.check_it_worked || {};
  add('look_for', cw.look_for); add('look_for_ur', cw.look_for_ur); add('coach_tick', cw.coach_tick); add('coach_tick_ur', cw.coach_tick_ur);
  (i.evidence || []).forEach((e, k) => { add(`evidence[${k}].finding`, e.finding); add(`evidence[${k}].finding_ur`, e.finding_ur); });
  return out;
}

/** Every Text ({en, ur}) inside a shaped payload. */
function texts(v, where, out = []) {
  if (Array.isArray(v)) { v.forEach((x, k) => texts(x, `${where}[${k}]`, out)); return out; }
  if (!v || typeof v !== 'object') return out;
  if (typeof v.en === 'string' && typeof v.ur === 'string' && Object.keys(v).length === 2) {
    out.push([`${where}.en`, v.en], [`${where}.ur`, v.ur]);
    return out;
  }
  for (const [k, x] of Object.entries(v)) if (k !== 'i_id' && k !== 'ref' && k !== 'kind' && k !== 'source' && k !== 'library_version') texts(x, `${where}.${k}`, out);
  return out;
}

describe('the intervention library carries no schema words on a coach or RM screen', () => {
  test('GET /i/:w shape (interventionShape) for every intervention: no snake_case token in any en/ur string', () => {
    const bad = [];
    for (const i of LIB.interventions) {
      for (const [where, s] of texts(interventionShape(i, S.library().version), i.id)) if (SNAKE.test(plain(s))) bad.push(`${where}: ${plain(s).match(SNAKE)[0]}`);
    }
    expect(bad).toEqual([]);
  });

  test('every display field of the raw file, deferred interventions included', () => {
    const all = [...LIB.interventions, ...((LIB.deferred && LIB.deferred.interventions) || [])];
    const bad = [];
    for (const i of all) for (const [where, s] of displayStrings(i)) if (SNAKE.test(plain(s))) bad.push(`${where}: ${plain(s).match(SNAKE)[0]}`);
    expect(bad).toEqual([]);
  });

  test("I-IP-NOPLAN-1's plan line reads the agreed plain English; its Urdu is unchanged", () => {
    const i = LIB.interventions.find((x) => x.id === 'I-IP-NOPLAN-1');
    const line = i.materials.find((m) => m.ref === 'independent_practice_steps');
    expect(line.name).toBe("The linked plan's own practice line, read aloud as the task (FLN plans give about 10 minutes for it)");
    expect(line.name_ur).toBe('منصوبے کی اپنی سطر: خود مشق');
  });
});
