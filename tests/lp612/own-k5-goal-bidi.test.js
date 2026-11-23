/**
 * bd-snkn32.58.8 — a grades 1–5 goal plan in Urdu prints the official goal on its own text direction.
 *
 * Seen 19 Nov (queue #155): a Grade 3 Maths goal plan in Urdu. The official Maths goal exists only in English (matrix
 * and day scripts alike), goalBoxK5 puts it in `script.goal`, and the renderer printed it inside the RTL header with
 * no isolation, so "Multiply by 2." read ".Multiply by 2". The goal line now takes its direction from its own text
 * (dir="auto", isolated): English reads left to right with the full stop at its end; an Urdu goal stays right to left.
 *
 * Two layers: the markup (always runs) and real Chromium placing the full stop (skips where there is no browser).
 */
const path = require('path');
const { renderK5Own } = require('../../bot/shared/services/lp-k5-own-render');

let chromium = null;
try {
  chromium = require(path.join(__dirname, '..', '..', 'bot', 'node_modules', 'playwright-core')).chromium;
} catch (_) { /* no browser */ }

const EN_GOAL = 'Multiply a 2-digit number by 2.';
const UR_GOAL = 'دو ہندسی عدد کو ۲ سے ضرب دیں۔';

function script(goal) {
  return {
    meta: { grade: 3, subject: 'Maths', topic: 'ضرب', minutes: 40 },
    goal,
    hook: { warmUp: { teacherAsks: 'سوال', expectedAnswer: 'جواب' } },
    iDo: { minutes: 10, steps: [{ say: 'دیکھیں' }] },
    weDo: { minutes: 10, steps: [{ say: 'مل کر' }] },
    youDo: { minutes: 10, task: 'خود کریں' },
    wrap: { minutes: 5 },
  };
}

const goalTag = (html) => (/<div class="goal"[^>]*>/.exec(html) || [''])[0];

describe('bd-snkn32.58.8 — the goal line keeps its own direction', () => {
  test('Urdu plan, English official goal: the goal line is direction-isolated', () => {
    const html = renderK5Own(script(EN_GOAL), { lang: 'ur', grade: 3, subject: 'Maths' });
    expect(html).toContain(' dir="rtl"');
    expect(goalTag(html)).toContain('dir="auto"');
    expect(html).toMatch(/\.goal\{[^}]*unicode-bidi:isolate/);
    expect(html).toContain(EN_GOAL);
  });

  test('English plan: same markup, nothing else changes', () => {
    const html = renderK5Own(script(EN_GOAL), { lang: 'en', grade: 3, subject: 'Maths' });
    expect(goalTag(html)).toContain('dir="auto"');
    expect(html).toContain(`>${EN_GOAL}</div>`);
  });

  test('no goal: the line is still there and empty, as before', () => {
    const html = renderK5Own(script(''), { lang: 'ur', grade: 3, subject: 'Maths' });
    expect(html).toMatch(/<div class="goal"[^>]*><\/div>/);
  });

  const maybe = chromium ? test : test.skip;
  maybe('Chromium: the English goal\'s full stop prints at its right end in an Urdu plan; Urdu stays RTL', async () => {
    let browser; // CI has playwright-core without its browser: the runner's Chrome, as own-k5-layout does
    try { browser = await chromium.launch(); } catch (_) { browser = await chromium.launch({ channel: 'chrome' }); }
    try {
      const page = await browser.newPage();
      const side = async (goal) => {
        await page.setContent(renderK5Own(script(goal), { lang: 'ur', grade: 3, subject: 'Maths' }));
        return page.evaluate(() => {
          const el = document.querySelector('.goal');
          const t = el.firstChild;
          const r = document.createRange();
          const last = t.textContent.length - 1;
          r.setStart(t, last); r.setEnd(t, last + 1);
          const stop = r.getBoundingClientRect();
          r.setStart(t, 0); r.setEnd(t, 1);
          const first = r.getBoundingClientRect();
          return { dir: getComputedStyle(el).direction, stopRightOfFirst: stop.left > first.left };
        });
      };
      const en = await side(EN_GOAL);
      expect(en).toEqual({ dir: 'ltr', stopRightOfFirst: true });
      const ur = await side(UR_GOAL);
      expect(ur).toEqual({ dir: 'rtl', stopRightOfFirst: false });
    } finally {
      await browser.close();
    }
  }, 30000);
});
