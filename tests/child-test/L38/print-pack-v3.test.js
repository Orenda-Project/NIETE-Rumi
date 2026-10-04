/**
 * Child test v3 — the print pack (L38, bd-s1oo0.50.4; CONTRACT §21.7, design COACH_JOURNEY_V3).
 *
 * What the operator prints for each coach, once a term:
 *   - child stimulus booklets, one task per A4 side: Urdu reading and English reading (shared by
 *     Grades 3 and 5, neutral band), Maths Grade 3 (green) and Maths Grade 5 (blue);
 *   - coach protocol cards: per language and per maths grade, the coach's hand only;
 *   - a cover, then everything in one PRINT_ME_v3.
 *
 * These run the real HTML builders against a fixture in the §21.3 bank shape
 * (fixtures/item-bank.v3.fixture.json, built from R7 + R9 by lanes/L38/script/make_fixture.py).
 * The browser half (A4, no overflow, scale ≥ 1) is real-render-v3.test.js.
 */

const BANK = require('./fixtures/item-bank.v3.fixture.json');
const v3 = require('../../../bot/shared/services/child-test/render/v3');
const { anchorFor } = require('../../../bot/shared/services/child-test/scoring/reach');
const { resolveUx } = require('../../../bot/shared/config/ux-strings');

const clone = (x) => JSON.parse(JSON.stringify(x));
const A = BANK.sets.A;
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const urDigits = (s) => String(s).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
const one = (s) => String(s).replace(/\s+/g, ' ').trim();

function visibleText(s) {
  return String(s)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[⁦-⁩‎‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pages(htmlStr) {
  const out = [];
  const re = /<section class="page([^"]*)"([^>]*)>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(htmlStr))) {
    const attrs = {};
    m[2].replace(/data-([a-z-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
    const style = (m[2].match(/style="([^"]*)"/) || [])[1] || '';
    out.push({ cls: m[1], attrs, style, raw: m[0], text: visibleText(m[3]) });
  }
  return out;
}

/** The outer HTML of the first <div> whose opening tag matches `sel` (a regex source), balanced. */
function divs(raw, sel) {
  const out = [];
  const open = new RegExp(`<div\\b[^>]*${sel}[^>]*>`, 'g');
  let m;
  while ((m = open.exec(raw))) {
    let depth = 0;
    const re = /<(\/?)div\b[^>]*>/g;
    re.lastIndex = m.index;
    let t;
    while ((t = re.exec(raw))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { out.push(raw.slice(m.index, re.lastIndex)); break; }
    }
  }
  return out;
}
const fitOf = (p) => divs(p.raw, 'class="fit')[0] || '';
const items = (html) => [...html.matchAll(/<div class="it"[^>]*>([\s\S]*?)<\/div>/g)].map((x) => visibleText(x[1]));

describe('child booklets — reading (Urdu, English): one task per side, shared by Grades 3 and 5', () => {
  const ur = pages(v3.buildBookletHtml({ bank: BANK, set: 'A', booklet: 'ur' }));
  const en = pages(v3.buildBookletHtml({ bank: BANK, set: 'A', booklet: 'en' }));

  it('Urdu: letters, words, story in battery order; the made-up-words gap gets no page; no listening page', () => {
    expect(ur.filter((p) => p.attrs.audience === 'child').map((p) => p.attrs.task)).toEqual(['ur.letters', 'ur.words', 'ur.story']);
    expect(ur.some((p) => p.attrs.task === 'ur.nonwords' || p.attrs.task === 'ur.listening')).toBe(false);
  });

  it('English: letters, made-up words, words, story; no listening page', () => {
    expect(en.filter((p) => p.attrs.audience === 'child').map((p) => p.attrs.task)).toEqual(['en.letters', 'en.nonwords', 'en.words', 'en.story']);
  });

  it('every side says "Grades 3 and 5" in a neutral band that is neither the Grade 3 green nor the Grade 5 blue, with the set label', () => {
    for (const p of [...ur, ...en].filter((x) => x.attrs.audience === 'child')) {
      expect(p.text).toContain(resolveUx('childTestPrintV3GradesBoth', { language: 'en' }));
      expect(p.text).toContain('Set A · Oct–Dec 2026');
      const band = (p.style.match(/--band:(#[0-9A-Fa-f]{6})/) || [])[1];
      expect(band).toBe(v3.NEUTRAL.hex);
      expect([v3.GRADE_COLOUR[3].hex, v3.GRADE_COLOUR[5].hex]).not.toContain(band);
    }
  });

  it('letters: 100 items, 10 per row, right to left in Nastaliq, from the bank in order', () => {
    const p = ur.find((x) => x.attrs.task === 'ur.letters');
    const main = divs(p.raw, 'class="grid main')[0];
    expect(main).toMatch(/class="grid main ur"/);
    expect(main).toMatch(/dir="rtl"/);
    expect(main).toMatch(/--cols:10/);
    expect(items(main)).toEqual(A.reading.ur.letters.items);
  });

  it('made-up and familiar words: 5 per row; English in the Andika face', () => {
    const nw = en.find((x) => x.attrs.task === 'en.nonwords');
    const main = divs(nw.raw, 'class="grid main')[0];
    expect(main).toMatch(/class="grid main en"/);
    expect(main).toMatch(/--cols:5/);
    expect(items(main)).toEqual(A.reading.en.nonwords.items);
    const w = ur.find((x) => x.attrs.task === 'ur.words');
    expect(items(divs(w.raw, 'class="grid main')[0])).toEqual(A.reading.ur.words.items);
    const css = v3.buildBookletHtml({ bank: BANK, set: 'A', booklet: 'en' });
    expect(css).toMatch(/\.grid\.en\{[^}]*font-family:'CTAndika'/);
    expect(css).toMatch(/\.grid\.ur\{[^}]*font-family:'CTNastaliq'/);
  });

  it('Urdu type has a line height of at least 1.9 everywhere it is set (Nastaliq needs the room, bd-j41md)', () => {
    const css = v3.buildBookletHtml({ bank: BANK, set: 'A', booklet: 'ur' }) + v3.buildCoachCardHtml({ bank: BANK, set: 'A', card: 'ur' });
    const heights = [...css.matchAll(/\.[a-z.]*\bur\b[^{]*\{[^}]*line-height:([\d.]+)/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(3);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(1.9);
  });

  it('each grid page carries its practice row, separated and marked "Practice", with the bank practice items', () => {
    for (const [pg, spec] of [[ur, A.reading.ur.letters], [ur, A.reading.ur.words], [en, A.reading.en.letters], [en, A.reading.en.nonwords], [en, A.reading.en.words]]) {
      const p = pg.find((x) => x.attrs.task === spec.task);
      const pr = divs(p.raw, 'class="practice')[0];
      expect(pr).toBeTruthy();
      expect(visibleText(pr)).toContain(resolveUx('childTestPrintV3Practice', { language: 'en' }));
      expect(items(pr)).toEqual(spec.practice);
      expect(p.raw.indexOf('class="practice')).toBeLessThan(p.raw.indexOf('class="grid main'));
    }
  });

  it('story: printed line by line as the bank\'s lines, so "line 1" and the §20 anchors are what the child sees', () => {
    for (const [pg, s] of [[ur, A.reading.ur.story], [en, A.reading.en.story]]) {
      const p = pg.find((x) => x.attrs.task === s.task);
      const lines = [...p.raw.matchAll(/<div class="sl"[^>]*>([\s\S]*?)<\/div>/g)].map((x) => visibleText(x[1]));
      expect(lines).toHaveLength(s.story.lines.length);
      const words = lines.join(' ').split(' ').map((w) => w.replace(/[.,۔،]/g, '')).filter(Boolean);
      expect(words).toEqual(s.story.tokens.map((w) => w.replace(/[.,۔،]/g, '')));
    }
  });

  it('no item numbers, answers or questions on a reading child side', () => {
    for (const p of [...ur, ...en].filter((x) => x.attrs.audience === 'child')) {
      const t = visibleText(fitOf(p));
      expect(t).not.toMatch(/[0-9۰-۹٠-٩]/);
      expect(t).not.toMatch(/[?؟]/);
    }
  });
});

describe('child booklets — maths, per grade and colour', () => {
  for (const g of [3, 5]) {
    const id = `ma${g}`;
    const M = A.maths[String(g)];
    const ps = pages(v3.buildBookletHtml({ bank: BANK, set: 'A', booklet: id }));
    const child = ps.filter((p) => p.attrs.audience === 'child');
    const page = (t) => child.find((p) => p.attrs.task === t);

    it(`G${g}: the seven tasks in Core EGMA order, no word-problem page, in the grade's colour`, () => {
      expect(child.map((p) => p.attrs.task)).toEqual(['ma.number_id', 'ma.discrimination', 'ma.missing', 'ma.add1', 'ma.sub1', 'ma.add2', 'ma.sub2']);
      for (const p of child) {
        expect(p.style).toContain(`--band:${v3.GRADE_COLOUR[g].hex}`);
        expect(p.text).toContain(`Grade ${g}`);
      }
    });

    it(`G${g}: number ID: 20 numbers, 4 rows of 5, nothing else in the grid`, () => {
      const main = divs(page('ma.number_id').raw, 'class="grid main')[0];
      expect(main).toMatch(/--cols:5/);
      expect(items(main)).toEqual(M.number_id.items.map(String));
    });

    it(`G${g}: which is bigger: the practice pairs, then 10 pairs, with no answer marked`, () => {
      const p = page('ma.discrimination');
      const pr = divs(p.raw, 'class="practice')[0];
      const pair = (h) => [...h.matchAll(/<div class="pair"[^>]*>([\s\S]*?)<\/div>/g)].map((x) => visibleText(x[1]));
      expect(pair(pr)).toEqual(M.discrimination.practice.map((x) => `${x.a} ${x.b}`));
      expect(pair(divs(p.raw, 'class="mains')[0])).toEqual(M.discrimination.items.map((x) => `${x.a} ${x.b}`));
      expect(p.raw).not.toMatch(/class="[^"]*\bans\b/);
    });

    it(`G${g}: missing number: practice + 10 rows of boxes, each with one empty box and no answer`, () => {
      const p = page('ma.missing');
      const rows = (h) => [...h.matchAll(/<div class="seq"[^>]*>([\s\S]*?)<\/div><!--seq-->/g)].map((x) => x[1]);
      const main = rows(divs(p.raw, 'class="mains')[0]);
      expect(main).toHaveLength(10);
      main.forEach((r, i) => {
        const cells = [...r.matchAll(/<span class="cell( blank)?"[^>]*>([^<]*)<\/span>/g)];
        expect(cells.map((c) => (c[1] ? null : Number(c[2])))).toEqual(M.missing.items[i].seq);
        expect(cells.filter((c) => c[1]).every((c) => c[2] === '')).toBe(true);
      });
      expect(rows(divs(p.raw, 'class="practice')[0])).toHaveLength(M.missing.practice.length);
    });

    it(`G${g}: quick + and quick −: 20 each; harder + and −: 5 each; printed "a + b =" with no answer`, () => {
      for (const [t, spec, n] of [['ma.add1', M.add1, 20], ['ma.sub1', M.sub1, 20], ['ma.add2', M.add2, 5], ['ma.sub2', M.sub2, 5]]) {
        const its = items(divs(page(t).raw, 'class="grid main')[0]);
        expect(its).toHaveLength(n);
        expect(its).toEqual(spec.items.map((x) => `${x.a} ${x.op === '-' ? '−' : '+'} ${x.b} =`));
      }
    });

    it(`G${g}: no item numbers or labels on a maths child side`, () => {
      for (const p of child) expect(p.raw).not.toMatch(/class="tag"|data-label=/);
    });
  }
});

describe('a gap task gets no page, and the cover says so', () => {
  const bank = clone(BANK);
  bank.sets.A.maths['5'].discrimination = { task: 'ma.discrimination', gap: true, reason: 'No official upper-grade items' };

  it('the G5 maths booklet skips the gap; G3 is unchanged', () => {
    const g5 = pages(v3.buildBookletHtml({ bank, set: 'A', booklet: 'ma5' })).filter((p) => p.attrs.audience === 'child');
    expect(g5.map((p) => p.attrs.task)).not.toContain('ma.discrimination');
    expect(g5).toHaveLength(6);
    const g3 = pages(v3.buildBookletHtml({ bank, set: 'A', booklet: 'ma3' })).filter((p) => p.attrs.audience === 'child');
    expect(g3).toHaveLength(7);
  });

  it('the cover lists every gap with its reason', () => {
    const cover = pages(v3.buildPrintMeHtml({ bank, set: 'A' })).find((p) => p.attrs.page === 'cover');
    expect(cover.text).toContain('ur.nonwords');
    expect(cover.text).toContain(BANK.sets.A.reading.ur.nonwords.reason);
    expect(cover.text).toContain('ma.discrimination');
    expect(cover.text).toContain('No official upper-grade items');
  });

  it('pageFor names the booklet and page for the step message, and null for a gap or a task with no sheet', () => {
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 3, task: 'ur.letters' })).toEqual({ booklet: 'ur', page: 1 });
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 5, task: 'ur.words' })).toEqual({ booklet: 'ur', page: 2 });
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 3, task: 'ur.story' })).toEqual({ booklet: 'ur', page: 3 });
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 3, task: 'en.story' })).toEqual({ booklet: 'en', page: 4 });
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 3, task: 'ur.nonwords' })).toBeNull();
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 3, task: 'ur.listening' })).toBeNull();
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 3, task: 'ma.word_problems' })).toBeNull();
    expect(v3.pageFor({ bank: BANK, set: 'A', grade: 5, task: 'ma.add1' })).toEqual({ booklet: 'ma5', page: 4 });
    expect(v3.pageFor({ bank, set: 'A', grade: 5, task: 'ma.add1' })).toEqual({ booklet: 'ma5', page: 3 });
  });
});

describe('coach protocol cards — the coach\'s hand, never the child\'s', () => {
  const blockOf = (p, task) => divs(p.raw, `data-task="${task.replace('.', '\\.')}"`)[0];
  const ofCard = (card) => pages(v3.buildCoachCardHtml({ bank: BANK, set: 'A', card }));

  for (const lang of ['ur', 'en']) {
    const R = A.reading[lang];
    const ps = ofCard(lang);
    const all = ps.map((p) => p.raw).join('');
    const block = (task) => ps.map((p) => blockOf(p, task)).find(Boolean);

    it(`${lang}: one sheet (two sides), coach audience, "don't show the child" on every side`, () => {
      expect(ps).toHaveLength(2);
      for (const p of ps) {
        expect(p.attrs.audience).toBe('coach');
        expect(p.text).toContain(resolveUx('childTestCoachCardDontShow', { language: 'en' }));
      }
    });

    it(`${lang}: the listening story to read aloud twice, and its 6 questions with answers`, () => {
      const b = visibleText(block(`${lang}.listening`));
      expect(b).toContain(resolveUx('childTestPrintV3ReadTwice', { language: lang }));
      expect(b).toContain(one(R.listening.story.text));
      expect(R.listening.questions).toHaveLength(6);
      for (const q of R.listening.questions) {
        expect(b).toContain(one(q.prompt));
        expect(q.accept.some((a) => b.includes(one(a)))).toBe(true);
      }
    });

    it(`${lang}: the reading questions with the §20 "only if the child read past «…»" anchors and answers`, () => {
      const html = block(`${lang}.story`);
      const b = visibleText(html);
      R.story.questions.forEach((q, i) => {
        expect(b).toContain(one(q.prompt));
        expect(q.accept.some((a) => b.includes(one(a)))).toBe(true);
        const note = (html.match(new RegExp(`data-reach="${q.id}"[^>]*>([\\s\\S]*?)</span>`)) || [])[1];
        if (i === 0 && Number(q.needs_line) === 1) expect(note).toBeUndefined();
        else expect(visibleText(note)).toContain(anchorFor(R.story, q));
      });
    });

    it(`${lang}: every task's lines to say, verbatim from the bank (the English card also gives the Urdu)`, () => {
      for (const kind of ['listening', 'letters', 'nonwords', 'words', 'story']) {
        const t = R[kind];
        if (t.gap) continue;
        const b = visibleText(block(t.task)) + ' ' + visibleText(block('common') || '');
        for (const [key, line] of Object.entries(t.script)) {
          expect([key, b]).toEqual([key, expect.stringContaining(one(lang === 'ur' ? urDigits(line.ur) : line.en))]);
          if (lang === 'en') expect([key, b]).toEqual([key, expect.stringContaining(one(urDigits(line.ur)))]);
        }
      }
    });

    it(`${lang}: the stop rule for each task`, () => {
      const rule = { first_row: 'childTestPrintV3StopFirstRow', first_line: 'childTestPrintV3StopFirstLine' };
      for (const kind of ['letters', 'nonwords', 'words', 'story']) {
        const t = R[kind];
        if (t.gap) continue;
        const n = t.per_row || 0;
        const expected = resolveUx(rule[t.stop.type], { language: lang, params: { n: lang === 'ur' ? urDigits(n) : n } });
        expect(visibleText(block(t.task))).toContain(visibleText(expected));
        expect(visibleText(block(t.task))).toContain(visibleText(resolveUx('childTestPrintV3StopTimed', { language: lang })));
      }
    });

    it(`${lang}: a gap task is named as skipped, with no lines to say`, () => {
      if (!R.nonwords.gap) return;
      const b = visibleText(block(R.nonwords.task));
      expect(b).toContain(resolveUx('childTestPrintV3GapSkip', { language: lang }));
    });

    it(`${lang}: no child-facing sheet content leaks: nothing here is marked for the child`, () => {
      expect(all).not.toMatch(/data-audience="child"/);
    });
  }

  for (const g of [3, 5]) {
    const M = A.maths[String(g)];
    const ps = ofCard(`ma${g}`);
    const block = (task) => ps.map((p) => blockOf(p, task)).find(Boolean);

    it(`maths G${g}: one sheet in the grade's colour`, () => {
      expect(ps).toHaveLength(2);
      for (const p of ps) expect(p.style).toContain(`--band:${v3.GRADE_COLOUR[g].hex}`);
    });

    it(`maths G${g}: number ID with every number`, () => {
      const t = visibleText(block('ma.number_id'));
      for (const n of M.number_id.items) expect(t).toContain(String(n));
    });

    it(`maths G${g}: every pair with the bigger number circled`, () => {
      const html = block('ma.discrimination');
      const circled = [...html.matchAll(/<span class="ans"[^>]*>([^<]*)<\/span>/g)].map((x) => x[1]);
      expect(circled).toEqual([...M.discrimination.practice, ...M.discrimination.items].map((x) => String(x.answer)));
    });

    it(`maths G${g}: every missing number`, () => {
      const html = block('ma.missing');
      const ans = [...html.matchAll(/<b class="ma"[^>]*>([^<]*)<\/b>/g)].map((x) => x[1]);
      expect(ans).toEqual([...M.missing.practice, ...M.missing.items].map((x) => String(x.answer)));
    });

    it(`maths G${g}: all sums with answers`, () => {
      for (const t of ['add1', 'sub1', 'add2', 'sub2']) {
        const b = visibleText(block(`ma.${t}`));
        for (const x of M[t].items) expect(b).toContain(`${x.a} ${x.op === '-' ? '−' : '+'} ${x.b} = ${x.answer}`);
      }
    });

    it(`maths G${g}: the 6 word problems in Urdu with answers`, () => {
      const html = block('ma.word_problems');
      const b = visibleText(html);
      expect(M.word_problems.items).toHaveLength(6);
      for (const w of M.word_problems.items) {
        expect(b).toContain(one(urDigits(w.prompt_ur)));
        expect(html).toMatch(new RegExp(`data-wp="${w.id}"[\\s\\S]*?${urDigits(w.answer)}`));
      }
    });

    it(`maths G${g}: every task's Urdu lines and its stop rule; the harder sums say when to skip`, () => {
      for (const kind of ['number_id', 'discrimination', 'missing', 'add1', 'sub1', 'add2', 'sub2', 'word_problems']) {
        const t = M[kind];
        const b = visibleText(block(t.task));
        const said = b + ' ' + visibleText(block('common') || '');
        for (const line of Object.values(t.script)) expect(said).toContain(one(urDigits(line.ur)));
        if (t.stop.type === 'consecutive_errors') {
          expect(b).toContain(visibleText(resolveUx('childTestPrintV3StopConsecutive', { language: 'ur', params: { n: urDigits(t.stop.n) } })));
        }
      }
      for (const kind of ['add2', 'sub2']) {
        expect(visibleText(block(`ma.${kind}`))).toContain(visibleText(resolveUx('childTestPrintV3SkipIfL1Zero', { language: 'ur' })));
      }
    });
  }

  it('a line said the same way in several tasks prints once, in "Lines for every task"; a task\'s own lines stay with it', () => {
    const ps = ofCard('ma3');
    const common = ps.map((p) => blockOf(p, 'common')).find(Boolean);
    expect(visibleText(common)).toContain(resolveUx('childTestPrintV3CommonLines', { language: 'ur' }));
    const all = ps.map((p) => p.text).join(' ');
    const begin = one(urDigits(A.maths['3'].add1.script.begin.ur));
    expect(all.split(begin).length - 1).toBe(1);
    expect(visibleText(blockOf(ps[0], 'ma.number_id') || blockOf(ps[1], 'ma.number_id'))).toContain(one(urDigits(A.maths['3'].number_id.script.intro.ur)));
  });

  it('body type is at least 13 pt', () => {
    expect(v3.COACH_PT.body).toBeGreaterThanOrEqual(13);
  });
});

describe('PRINT_ME_v3: cover, coach cards, then the booklets, each part starting on a fresh sheet', () => {
  const ps = pages(v3.buildPrintMeHtml({ bank: BANK, set: 'A' }));

  it('34 sides in print order', () => {
    expect(ps).toHaveLength(34);
    expect(ps[0].attrs.page).toBe('cover');
    const parts = [];
    ps.forEach((p, i) => { if (p.attrs.part && (!parts.length || parts[parts.length - 1].part !== p.attrs.part)) parts.push({ part: p.attrs.part, at: i }); });
    expect(parts.map((x) => x.part)).toEqual(['coach-ur', 'coach-en', 'coach-ma3', 'coach-ma5', 'booklet-ur', 'booklet-en', 'booklet-ma3', 'booklet-ma5']);
    for (const x of parts) expect(x.at % 2).toBe(0); // 0-based even = a front side
  });

  it('the cover says what to print, the kit per coach, how many copies, and to laminate everything after the cover', () => {
    const c = ps[0].text;
    expect(c).toMatch(/double-sided, flip on the long edge/);
    expect(c).toMatch(/one copy per coach/i);
    expect(c).toMatch(/laminate/i);
    expect(c).toMatch(/Kit per coach/);
    expect(c).toMatch(/counters/i);
  });
});
