'use strict';

/**
 * The extra SA subtasks (DESIGN §2b) built from item-bank.sa-extra.v1.json: every item and every keyed answer comes
 * from that file (official items only), each task sits where §2b puts it, and the engine runs it.
 */

const path = require('path');
const fs = require('fs');

const DATA = path.join(__dirname, '../../shared/data/child-test');
const core = require('../../../dashboard/sa/sa-core.js');
const extra = require('../../shared/data/child-test/item-bank.sa-extra.v1.json');

const read = (rel) => JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
const bank = read('item-bank.sa.v1.json');
const EXTRA = ['ma.patterns', 'ma.patterns_hi', 'ma.number_repr', 'ma.ordering', 'ma.fluency_l34', 'ma.word_problems_l2'];

/** "extra:maths.patterns.items[3]" → that item. */
function resolve(ref) {
  const m = /^extra:maths\.([a-z0-9_]+)\.items\[(\d+)\]$/.exec(ref);
  return m ? extra.maths[m[1]].items[Number(m[2])] : undefined;
}

describe('SA extra subtasks (DESIGN §2b)', () => {
  test('every form carries the extras; Grades 4-5 forms also carry upper-grade number ID', () => {
    for (const [id, f] of Object.entries(bank.forms)) {
      const want = f.grades.some((g) => g >= 4) ? [...EXTRA, 'ma.number_id_upper'] : EXTRA;
      expect([id, f.extra.filter((t) => t.startsWith('ma.'))]).toEqual([id, want]);
    }
  });

  test('coach: extras in the full form, the blocks the 18 v3 tasks (RULING #16); game: extras on the maths island, tower = the core battery', () => {
    const c = bank.forms['coach.G3.A'];
    expect(c.full.slice(-EXTRA.length)).toEqual(EXTRA);
    expect(c.blocks.B4).toEqual(['ma.number_id', 'ma.discrimination', 'ma.missing']);
    expect(c.blocks.B3).toEqual(['ur.listening', 'en.listening']);
    const g = bank.forms['game.G45'];
    expect(g.islands.maths.slice(-7)).toEqual([...EXTRA, 'ma.number_id_upper']);
    expect(g.tower).toHaveLength(20);
    expect(g.tower.some((t) => EXTRA.includes(t))).toBe(false);
  });

  test('every extra item cites its source item, and the keyed answer is the source\'s', () => {
    const extras = Object.entries(bank.tasks).filter(([k]) => /\/ma\.(patterns|number_repr|ordering|fluency_l34|word_problems_l2|number_id_upper)/.test(k));
    expect(extras.length).toBeGreaterThan(0);
    for (const [k, t] of extras) {
      for (const it of t.tap.items) {
        const s = resolve(it.src);
        expect([k, it.id, s !== undefined]).toEqual([k, it.id, true]);
        const want = s.numeral != null ? s.numeral : Array.isArray(s.answer) ? s.answer.join(', ') : s.answer;
        expect([k, it.id, String(it.target)]).toEqual([k, it.id, String(want)]);
        if (it.options) expect(it.options).toContain(it.target);
      }
    }
  });

  test('picture items stay out until their pictures exist, and say so', () => {
    const t = bank.tasks['coach.G3.A/ma.number_repr'];
    expect(t.tap.items.map((i) => i.id)).toEqual(['ma.number_repr.2b', 'ma.number_repr.3a', 'ma.number_repr.3b', 'ma.number_repr.4a', 'ma.number_repr.4b']);
    expect(t.deviation).toMatch(/represent_1a, represent_1b, represent_2a held out/);
  });

  test('the Urdu battery shows the pattern options as Urdu words, with the target among them; the engine runs it', () => {
    const b = read('sa/sa.coach.G3.A.ur.json');
    const p = b.tasks.find((t) => t.id === 'ma.patterns');
    expect(p.items[0].options).toEqual(['ستارہ', 'تکون', 'دائرہ', 'چوکور']);
    expect(p.items[0].target).toBe('دائرہ');
    expect(p.items[0].option_keys).toContain('circle');
    expect(b.tasks.find((t) => t.id === 'ma.patterns_hi').depends_on).toEqual({ task: 'ma.patterns', skip_if_zero: true });
    expect(core.validate(b)).toBe(true);
  });

  test('Jugnu has an intro in both languages for every extra task', () => {
    for (const [k, t] of Object.entries(bank.tasks).filter(([key]) => EXTRA.some((e) => key.endsWith(`/${e}`)))) {
      expect([k, typeof t.script.intro.en, typeof t.script.intro.ur]).toEqual([k, 'string', 'string']);
      expect(t.script.intro.audio.ur).toMatch(/^sa\/v1\/ur\//);
    }
  });
});
