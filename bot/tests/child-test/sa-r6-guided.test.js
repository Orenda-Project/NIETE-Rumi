'use strict';
/**
 * Round 6, bar S (DESIGN_R6 §3, RULINGs R6-1, R6-3, R6-8): the guided tier's content on the RDF forms.
 *   - every W3 task of the Grade 1-3 coach forms carries script.guided, each line a clip in the page's language;
 *     no Grade 4-5 or game form carries any;
 *   - no ready line of its own: the ready line is the task's test_intro + begin at every grade (R6-3 (b));
 *   - {Do} carries the constraints of the task's own instruction and adds none (§3.1a);
 *   - the button is never called by a colour; Urdu says «زور سے» for "out loud" (R6-8);
 *   - the plan points only at the task's own practice items; no practice item is a scored item of a task of the same
 *     kind (R6-3 (c)); a shared check item is flagged;
 *   - the coach API payload never carries the lines; the committed battery files are what the builder makes.
 */
const fs = require('fs');
const path = require('path');
const { buildSaBank, splitSaBankWithRuntime } = require('../../shared/services/child-test/sa/build');
const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const bank = buildSaBank({ v3: read('item-bank.v3.json'), extra: read('item-bank.sa-extra.v1.json'), w3: read('item-bank.sa-w3.v1.json') });
const files = splitSaBankWithRuntime(bank);
const battery = (g, lang) => files[`sa/sa.coach.G${g}.A.${lang}.json`];
const task = (g, lang, id) => battery(g, lang).tasks.find((t) => t.id === id);
/** Every line of a guided block (a demo's lines sit one level down). */
function linesOf(gd) {
  const out = [];
  for (const [k, v] of Object.entries(gd)) {
    if (k === 'kind' || k === 'mechanic' || k === 'plan') continue;
    if (Array.isArray(v)) out.push(...v);
    else if (v && v.text == null) out.push(...Object.values(v));
    else out.push(v);
  }
  return out;
}
// The constraint each kind's own instruction carries, per page language (§3.1a).
const CONSTRAINTS = {
  letter_names: { en: [/NAME/i, /sound/i], ur: [/نام/, /آواز/] },
  letter_sounds: { en: [/sound/i, /name/i], ur: [/آواز/, /نام/] },
  words: { en: [/word/i], ur: [/پورا لفظ/] },
  number_id: { en: [/number/i, /out loud|aloud/i], ur: [/نمبر/] },
  sums: { en: [/head/i, /out loud|aloud/i], ur: [/سوچیں/] },
  fluency: { en: [/answer/i, /out loud|aloud/i], ur: [/جواب/] },
};

describe('the guided tier on the RDF forms (sa_guided_instructions)', () => {
  test.each([1, 2, 3])('Grade %i: every RDF auto task carries script.guided, each line a clip in the page\'s language', (g) => {
    for (const lang of ['ur', 'en']) {
      const b = battery(g, lang);
      expect(b.rdf_auto.length).toBe(17);
      for (const id of b.rdf_auto) {
        const gd = task(g, lang, id).script.guided;
        expect([id, !!gd]).toEqual([id, true]);
        expect(gd.ready).toBeUndefined();
        for (const l of linesOf(gd)) {
          expect(typeof l.text).toBe('string');
          expect(l.audio).toMatch(new RegExp(`^sa/v1/${lang}/[0-9a-f]{12}\\.mp3$`));
          expect(l.text).not.toMatch(/green|ہرا|ہرے/i);
          if (lang === 'ur') { expect(l.text).not.toMatch(/[A-Za-z]/); expect(l.text).not.toMatch(/اونچی آواز/); }
        }
      }
    }
  });

  test.each([4, 5])('Grade %i: no task carries script.guided', (g) => {
    for (const lang of ['ur', 'en']) for (const t of battery(g, lang).tasks) expect([t.id, t.script && t.script.guided]).toEqual([t.id, undefined]);
  });
  test('no game form carries script.guided', () => {
    for (const [rel, b] of Object.entries(files)) if (/sa\.game\./.test(rel)) for (const t of b.tasks) expect(t.script && t.script.guided).toBeFalsy();
  });

  test('the ready line is the task\'s own test_intro + begin, byte-equal at Grade 2 and Grade 5', () => {
    for (const lang of ['ur', 'en']) for (const id of battery(2, lang).rdf_auto) {
      const a = task(2, lang, id).script; const b = task(5, lang, id).script;
      expect([id, a.test_intro, a.begin]).toEqual([id, b.test_intro, b.begin]);
    }
  });

  test('{Do} carries the constraints of the task\'s own instruction (the same at Grade 5)', () => {
    for (const lang of ['ur', 'en']) for (const id of battery(2, lang).rdf_auto) {
      const gd = task(2, lang, id).script.guided;
      const c = CONSTRAINTS[gd.kind];
      if (!c) continue;
      const intro5 = task(5, lang, id).script.intro.text;
      for (const re of c[lang]) { expect([id, gd.do.text]).toEqual([id, expect.stringMatching(re)]); expect([id, intro5]).toEqual([id, expect.stringMatching(re)]); }
    }
  });

  test('letter names name letters of the task\'s own alphabet', () => {
    expect(task(2, 'en', 'ur.letter_names5').script.guided.do.text).toMatch(/alif, bay, pay/);
    expect(task(2, 'en', 'en.letter_names5').script.guided.do.text).toMatch(/A, B, C/);
    expect(task(2, 'ur', 'en.letter_names5').script.guided.do.text).toMatch(/اے، بی، سی/);
  });

  test('the comprehension permission is spoken only because the task\'s own intro carries it at every grade', () => {
    for (const lang of ['ur', 'en']) for (const id of ['ur.story_comp_w3', 'en.story_comp_w3']) {
      expect(task(5, lang, id).script.intro.text).toMatch(lang === 'ur' ? /اردو یا انگریزی/ : /Urdu or English/i);
      expect(task(2, lang, id).script.guided.steps[1].text).toMatch(lang === 'ur' ? /اردو میں یا انگریزی میں/ : /Urdu or English/);
    }
  });

  test('sums carry the replay line in the demo; fluency its "one after another" line', () => {
    expect(task(2, 'ur', 'ma.add2i').script.guided.demo.replay.text).toBe('اگر سوال دوبارہ سننا ہو تو یہ والا بٹن دبائیں۔');
    expect(task(2, 'en', 'ma.fluency1m').script.guided.see_more.text).toMatch(/one after another/);
    expect(task(2, 'en', 'ur.words4').script.guided.demo.replay).toBeUndefined();
  });

  test('the plan uses only the task\'s own practice items, never a scored item of the same kind (R6-3 (c))', () => {
    for (const lang of ['ur', 'en']) for (const g of [1, 2, 3]) {
      const b = battery(g, lang);
      const scored = {};
      for (const t of b.tasks.filter((x) => b.rdf_auto.includes(x.id))) {
        const kind = t.script.guided.kind;
        const key = `${t.lang}.${kind === 'letter_sounds' ? 'letters' : kind}`;
        (scored[key] = scored[key] || new Set());
        for (const it of t.items || []) scored[key].add(String(it.show != null ? it.show : it.target));
      }
      for (const id of b.rdf_auto) {
        const t = task(g, lang, id);
        const { plan, kind } = t.script.guided;
        if (!plan) continue;
        for (const r of ['demo', 'turn', 'check', 'retry']) if (plan[r] != null) expect([id, r, plan[r] < t.practice.length]).toEqual([id, r, true]);
        expect(plan.check_item_shared).toBe(plan.check === plan.demo);
        if (kind === 'discrimination' || kind === 'missing' || kind === 'sums' || kind === 'fluency' || kind === 'number_id') continue;
        const key = `${t.lang}.${kind === 'letter_sounds' ? 'letters' : kind}`;
        for (const p of t.practice) expect([id, scored[key].has(String(p.show != null ? p.show : p.target))]).toEqual([id, false]);
      }
    }
  });

  test('every guided line is in the voice manifest', () => {
    const keys = new Set(voiceManifest(bank).map((r) => r.key));
    for (const g of [1, 2, 3]) for (const lang of ['ur', 'en']) for (const t of battery(g, lang).tasks) {
      if (t.script && t.script.guided) for (const l of linesOf(t.script.guided)) expect(keys.has(l.audio)).toBe(true);
    }
  });

  test('the committed battery files are what the builder makes', () => {
    for (const [rel, obj] of Object.entries(files)) expect([rel, fs.readFileSync(path.join(DATA, rel), 'utf8')]).toEqual([rel, `${JSON.stringify(obj)}\n`]);
  });
});
