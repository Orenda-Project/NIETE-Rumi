/**
 * bd-7oxt5 -- THE WARM-UP NEVER SAID WHAT IT WAS.
 *
 * OPERATOR: *"warm up should beprior knowledge activation strategy, not just 3 questions"*,
 * and then *"Warm up - look up research and tell me what strategies to add there, it should
 * be just 1 not multiple strategies since opening is a whole provocation on its own."*
 *
 * The W band printed the q/a pairs and a `kind` per row, and nothing on it named the MOVE the
 * teacher was making with them. Three questions with answers beside them read as a quiz; the
 * same three under "Prerequisite retrieval -- partner whisper" read as a strategy she is
 * running, which is the thing a coach observes and the thing the research is about.
 *
 * ONE name, not a list. The opening is already a two-part box -- settle, then provoke (SYNC
 * §3.22) -- and stacking a second strategy label onto the settle half competes with the hook
 * for the same few centimetres. The schema allows one string and the renderer prints one chip.
 *
 * IT IS OPTIONAL AND IT STAYS DARK. Nothing in the corpus authors it yet; an unauthored
 * warm-up prints exactly as it did, with no empty chip and no placeholder.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template.js');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const STRAT = 'Prerequisite retrieval — partner whisper';

function render(mut, build = {}) {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const intro = (doc.sections || []).find((s) => s.id === 'introduction');
  if (!intro) throw new Error('fixture has no introduction section');
  intro.warmup = intro.warmup || { items: [{ q: 'What is 8 + 2?', a: '10', kind: 'prerequisite' }] };
  if (mut) mut(intro.warmup, doc);
  return buildHtml(doc, { docDir: path.dirname(FIXTURE), ...build }).html;
}

/**
 * The warm-up band's own markup, so an assertion cannot pass on a match elsewhere.
 * Matched WITHOUT the closing quote: `openBand` appends `opn ofirst` to this very class
 * attribute when the warm-up opens the settle-then-provoke box (SYNC §3.22), so the rendered
 * attribute is `class="blk wu opn ofirst"` and an exact-quote match finds nothing.
 */
function band(html) {
  const i = html.indexOf('class="blk wu');
  if (i < 0) return '';
  const j = html.indexOf('class="blk', i + 10);
  return html.slice(i, j < 0 ? i + 4000 : j);
}

describe('bd-7oxt5: the warm-up names the one strategy it runs', () => {
  test('an authored strategy prints inside the W band', () => {
    const b = band(render((w) => { w.strategy = STRAT; }));
    expect(b).toContain(STRAT);
  });

  test('it carries its own class, so the stylesheet can set it apart from an item', () => {
    expect(band(render((w) => { w.strategy = STRAT; }))).toMatch(/class="wstrat"/);
  });

  test('nothing is printed when nothing is authored -- no empty chip', () => {
    const b = band(render(null));
    expect(b).not.toMatch(/class="wstrat"/);
    expect(b).toContain('class="blk wu');
  });

  test('a blank or whitespace strategy is the same as none', () => {
    expect(band(render((w) => { w.strategy = '   '; }))).not.toMatch(/class="wstrat"/);
  });

  test('the items still print, in order, beneath it', () => {
    const b = band(render((w) => {
      w.strategy = STRAT;
      w.items = [
        { q: 'First question', a: 'one', kind: 'prerequisite' },
        { q: 'Second question', a: 'two', kind: 'spaced' },
      ];
    }));
    expect(b.indexOf(STRAT)).toBeLessThan(b.indexOf('First question'));
    expect(b.indexOf('First question')).toBeLessThan(b.indexOf('Second question'));
  });

  test('an Urdu strategy is printed as authored, in the Urdu band', () => {
    const UR = 'پیشگی معلومات کی بازیافت';
    const b = band(render((w) => { w.strategy = UR; }, { lang: 'ur' }));
    expect(b).toContain(UR);
  });

  test('the strategy is escaped, not injected', () => {
    const b = band(render((w) => { w.strategy = '<script>x</script>'; }));
    expect(b).not.toContain('<script>x</script>');
    expect(b).toContain('&lt;script&gt;');
  });
});
