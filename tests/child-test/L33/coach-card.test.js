/**
 * Child test v2 — the printed coach card (L33, bd-s1oo0.46.10).
 *
 * The EGRA/EGMA assessor's own sheet, simplified: one laminated A4 side per grade and set that the
 * coach holds and the child never sees. It carries what the step message carries on the phone:
 *   - per story (Urdu, English): the words to say (start, go on, stop, questions intro, fallback) and
 *     the 3 questions in the order they are asked, each with its accepted answers in small type;
 *   - maths: pairs A–D with the bigger number, sums 1–4 with answers, the two word problems in large
 *     Urdu type with the answer, and the maths lines to say;
 *   - a footer rule: turn the child's card face down before questions and word problems.
 *
 * Everything on it comes from the item bank (child-test-items-v2). The tests prove that by rendering
 * the committed bank, then a copy of it with sentinel values, and finding the sentinels — not the
 * originals — on the card. The browser half (one page, no overflow) is real-render-v2.test.js.
 */

const BANK = require('../../../bot/shared/data/child-test/item-bank.v1.json');
const v2 = require('../../../bot/shared/services/child-test/render/v2');
const { resolveUx } = require('../../../bot/shared/config/ux-strings');

const clone = (x) => JSON.parse(JSON.stringify(x));
const formOf = (bank, g, f) => bank.grades[String(g)].forms[f];

function visibleText(s) {
  return String(s)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[⁦-⁩]/g, '')
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
    out.push({ cls: m[1], attrs, raw: m[0], text: visibleText(m[3]) });
  }
  return out;
}

/** The inner HTML of the first element carrying data-<attr>="<value>" (balanced on <div>). */
function part(raw, attr, value) {
  const open = raw.indexOf(`data-${attr}="${value}"`);
  if (open < 0) return null;
  const start = raw.lastIndexOf('<', open);
  let depth = 0;
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(raw))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return raw.slice(start, re.lastIndex);
  }
  return null;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ur = (n) => String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
// fallback sits with the reading lines, before the questions: a child who can't read line 1 never reaches them
const SCRIPT_ORDER = ['start', 'fallback', 'go_on', 'stop', 'questions_intro'];

describe('coach card (v2, L33)', () => {
  for (const grade of [3, 5]) {
    for (const set of ['A', 'B']) {
      describe(`grade ${grade} set ${set}`, () => {
        const form = formOf(BANK, grade, set);
        const html = v2.buildCoachCardHtml({ grade, set, form, notYet: set === 'B' });
        const ps = pages(html);
        const card = ps[0];

        it('is one side, for the coach, in the grade colour, with the set label', () => {
          expect(ps).toHaveLength(1);
          expect(card.attrs.audience).toBe('coach');
          expect(card.attrs.card).toBe('coachcard');
          expect(card.attrs.grade).toBe(String(grade));
          expect(card.raw).toContain(`--band:${v2.GRADE_COLOUR[grade].hex}`);
          expect(card.text).toContain(v2.setLabel(set));
          expect(card.text).toContain(`Grade ${grade}`);
        });

        it('says "Coach card · don\'t show the child" in English and Urdu, from the catalog', () => {
          const header = visibleText(card.raw.match(/<header[\s\S]*?<\/header>/)[0]);
          expect(header).toContain(norm(resolveUx('childTestCoachCardDontShow', { language: 'en' })));
          expect(header).toContain(visibleText(resolveUx('childTestCoachCardDontShow', { language: 'ur' })));
          expect(resolveUx('childTestCoachCardDontShow', { language: 'en' })).toMatch(/don't show the child/i);
        });

        for (const block of ['urdu', 'english']) {
          it(`${block}: the words to say, in order, then the 3 questions in order, each with its accepted answers`, () => {
            const b = part(card.raw, 'block', block);
            expect(b).not.toBeNull();
            const t = visibleText(b);
            let at = -1;
            for (const k of SCRIPT_ORDER) {
              const line = norm(form[block].script[k]);
              const i = t.indexOf(line, at + 1);
              expect({ k, found: i > at }).toEqual({ k, found: true });
              at = i;
            }
            expect(form[block].questions).toHaveLength(3);
            let qAt = t.indexOf(norm(form[block].script.questions_intro));
            form[block].questions.forEach((q, n) => {
              const qi = t.indexOf(norm(q.prompt), qAt + 1);
              expect({ q: q.id, inOrder: qi > qAt }).toEqual({ q: q.id, inOrder: true });
              qAt = qi;
              const acc = part(b, 'accept', q.id);
              expect(acc).not.toBeNull();
              const accText = visibleText(acc);
              const shown = [...acc.matchAll(/<bdi>([\s\S]*?)<\/bdi>/g)].map((m) => visibleText(m[1]));
              // every printed answer is a bank answer, and every bank answer is printed or contains,
              // as whole words, a shorter printed one ("a small plant" is covered by "plant")
              const bankNorm = q.accept.map(norm);
              for (const a of shown) expect(bankNorm).toContain(a);
              // an English question prints its English answers; "(or the same in Urdu)" stands for the
              // bank's Urdu translations, so the coach still knows an Urdu answer counts
              const URDU = /[\u0600-\u06FF]/;
              const hasUrdu = bankNorm.some((a) => URDU.test(a));
              const expected = block === 'english' && bankNorm.some((a) => !URDU.test(a)) ? bankNorm.filter((a) => !URDU.test(a)) : bankNorm;
              if (block === 'english') {
                expect(shown.some((a) => URDU.test(a))).toBe(false);
                expect(accText.includes(norm(resolveUx('childTestCoachCardAcceptAlsoUrdu', { language: 'en' })))).toBe(hasUrdu);
              }
              for (const a of expected) {
                const covered = shown.includes(a) || shown.some((o) => ` ${a} `.includes(` ${o} `));
                expect({ a, covered }).toEqual({ a, covered: true });
              }
              expect(shown.length).toBeGreaterThan(0);
              for (const a of shown) expect(accText).toContain(a);
              // small type, under its own question
              expect(acc).toMatch(/class="acc[ "]/);
              expect(n).toBeLessThan(3);
            });
          });
        }

        it('urdu block is right-to-left Urdu, numbered in Urdu digits; english block is left-to-right', () => {
          const u = part(card.raw, 'block', 'urdu');
          expect(u).toMatch(/^<div[^>]*dir="rtl"/);
          expect(u).toMatch(/^<div[^>]*lang="ur"/);
          expect(visibleText(u)).not.toMatch(/[0-9]/);
          const e = part(card.raw, 'block', 'english');
          expect(e).toMatch(/^<div[^>]*dir="ltr"/);
        });

        it('maths: pairs A–D with the bigger number, sums 1–4 with answers, both in Latin numerals', () => {
          const m = part(card.raw, 'block', 'maths');
          const oral = form.maths.oral;
          oral.compare.forEach((c, i) => {
            const row = visibleText(part(m, 'pair', 'ABCD'[i]));
            expect(row).toContain('ABCD'[i]);
            expect(row).toContain(String(c.a));
            expect(row).toContain(String(c.b));
            expect(c.answer).toBe(Math.max(c.a, c.b));
            expect(visibleText(part(m, 'bigger', 'ABCD'[i]))).toBe(String(c.answer));
          });
          oral.sums.forEach((s, i) => {
            const row = visibleText(part(m, 'sum', String(i + 1)));
            expect(row).toContain(`${v2.mathsDisplay(s.prompt)} = ${s.answer}`);
          });
        });

        it('maths: the two word problems in large Urdu type as read aloud, each with its answer', () => {
          const m = part(card.raw, 'block', 'maths');
          const oral = form.maths.oral;
          expect(oral.word_problems).toHaveLength(2);
          oral.word_problems.forEach((w) => {
            const p = part(m, 'wp', w.id);
            expect(p).toMatch(/dir="rtl"/);
            expect(visibleText(p)).toContain(norm(w.prompt_ur));
            expect(visibleText(p)).toContain(ur(w.answer));
            expect(p).toMatch(/class="wp[ "]/);
          });
        });

        it('maths: the lines to say, from the bank', () => {
          const t = visibleText(part(card.raw, 'block', 'maths'));
          for (const k of ['start', 'compare', 'sum', 'next', 'wp_intro', 'stop']) {
            expect({ k, has: t.includes(norm(form.maths.oral.script[k])) }).toEqual({ k, has: true });
          }
        });

        it('ends with the rule: card face down before questions and word problems; never show this card', () => {
          const f = visibleText(part(card.raw, 'rule', 'facedown'));
          expect(f).toContain(norm(resolveUx('childTestCoachCardRule', { language: 'en' })));
          expect(f).toContain(visibleText(resolveUx('childTestCoachCardRule', { language: 'ur' })));
          expect(resolveUx('childTestCoachCardRule', { language: 'en' }))
            .toBe("Turn the child's card face down before the questions and the word problems. Don't show this card to the child.");
        });

        it('body type is at least 13 pt and the fit pass may not shrink it', () => {
          const fit = card.raw.match(/<div class="fit cc"[^>]*>/)[0];
          expect(Number(fit.match(/data-min="([\d.]+)"/)[1])).toBeGreaterThanOrEqual(1);
          expect(v2.COACH_CARD_PT.body).toBeGreaterThanOrEqual(13);
          expect(v2.COACH_CARD_PT.wp).toBeGreaterThan(v2.COACH_CARD_PT.body);
        });

        it('Set B is stamped next term; Set A is not', () => {
          if (set === 'B') expect(card.text).toContain(v2.NOT_YET);
          else expect(card.text).not.toContain(v2.NOT_YET);
        });
      });
    }
  }

  it('takes every question, accepted answer, line and number from the bank, never a copy', () => {
    const bank = clone(BANK);
    const f = formOf(bank, 3, 'A');
    f.urdu.questions[1].prompt = 'سوال-ٹیسٹ-الف';
    f.urdu.questions[2].accept = ['جواب-ٹیسٹ-ب'];
    f.english.questions[0].prompt = 'SENTINEL QUESTION ONE?';
    f.english.questions[0].accept = ['sentinel answer', 'پودا-ٹیسٹ'];
    f.urdu.questions[0].accept = ['قبول-ٹیسٹ', 'قبول-ٹیسٹ کے ساتھ'];
    f.english.script.go_on = 'SENTINEL keep going';
    f.urdu.script.fallback = 'متبادل-ٹیسٹ';
    f.maths.oral.sums[0] = { ...f.maths.oral.sums[0], prompt: '40 + 7', answer: 47 };
    f.maths.oral.compare[0] = { ...f.maths.oral.compare[0], a: 401, b: 399, answer: 401 };
    f.maths.oral.word_problems[0] = { ...f.maths.oral.word_problems[0], prompt_ur: 'عبارتی-ٹیسٹ ۹ سیب', answer: 99 };
    f.maths.oral.script.wp_intro = 'تعارف-ٹیسٹ';
    const t = pages(v2.buildCoachCardHtml({ grade: 3, set: 'A', form: f }))[0].text;
    expect(t).not.toContain('پودا-ٹیسٹ'); // English question: its Urdu answer is covered by "(or the same in Urdu)"
    expect(t).toContain('accept (or the same in Urdu): sentinel answer');
    expect(t).not.toContain('قبول-ٹیسٹ کے ساتھ'); // covered by the shorter accepted answer
    for (const s of ['سوال-ٹیسٹ-الف', 'جواب-ٹیسٹ-ب', 'SENTINEL QUESTION ONE?', 'sentinel answer', 'قبول-ٹیسٹ',
      'SENTINEL keep going', 'متبادل-ٹیسٹ', '40 + 7 = 47', '401', '399', 'عبارتی-ٹیسٹ ۹ سیب', '۹۹', 'تعارف-ٹیسٹ']) {
      expect({ s, has: t.includes(s) }).toEqual({ s, has: true });
    }
    const orig = formOf(BANK, 3, 'A');
    for (const s of [orig.urdu.questions[1].prompt, orig.english.questions[0].prompt, orig.english.script.go_on,
      orig.maths.oral.word_problems[0].prompt_ur, '14 + 1 = 15']) {
      expect(t).not.toContain(norm(s));
    }
  });

  it('refuses a form without the coach lines, questions or oral maths (no hand-copied fallback)', () => {
    for (const cut of [(f) => { delete f.urdu.script; }, (f) => { f.english.questions = []; }, (f) => { delete f.maths.oral; },
      (f) => { f.maths.oral.word_problems = []; }, (f) => { delete f.maths.oral.script; }]) {
      const f = clone(formOf(BANK, 5, 'A'));
      cut(f);
      expect(() => v2.buildCoachCardHtml({ grade: 5, set: 'A', form: f })).toThrow(/coach card/);
    }
  });
});

describe('PRINT_ME with coach cards (L33)', () => {
  const ps = pages(v2.buildPrintMeHtml({ itemBank: BANK, set: 'A' }));

  it('puts the Grade 3 then the Grade 5 coach card after the coach page, each with a blank back', () => {
    expect(ps.map((p) => p.attrs.page)).toEqual([
      'cover', 'cover-back', 'coach/en', 'coach/ur',
      'g3/coachcard', 'g3/coachcard-back', 'g5/coachcard', 'g5/coachcard-back',
      'g3/urdu/front', 'g3/urdu/back', 'g3/english/front', 'g3/english/back', 'g3/maths/front', 'g3/maths/back',
      'g5/urdu/front', 'g5/urdu/back', 'g5/english/front', 'g5/english/back', 'g5/maths/front', 'g5/maths/back',
    ]);
    for (const id of ['g3/coachcard', 'g3/coachcard-back', 'g5/coachcard', 'g5/coachcard-back']) {
      expect(ps.find((p) => p.attrs.page === id).attrs.audience).toBe('coach');
    }
  });

  it('cover table lists the coach cards: laminate, one per coach, never shown to the child', () => {
    const c = ps[0].raw;
    expect(c).toMatch(/<tr><td>5–6<\/td><td>[^<]*(<span[^>]*><\/span>)?Grade 3 · Coach card[^<]*<\/td><td>Yes<\/td><td>1<\/td><\/tr>/);
    expect(c).toMatch(/<tr><td>7–8<\/td><td>[^<]*(<span[^>]*><\/span>)?Grade 5 · Coach card[^<]*<\/td><td>Yes<\/td><td>1<\/td><\/tr>/);
    expect(c).toMatch(/<tr><td>9–10<\/td><td>[^<]*(<span[^>]*><\/span>)?Grade 3 · Urdu card/);
    expect(ps[0].text).toMatch(/2 laminated coach cards/);
    expect(ps[0].text).toMatch(/never shown to the child/i);
  });

  it('no answer or question reaches a child side of the pack', () => {
    const child = ps.filter((p) => p.attrs.audience === 'child');
    expect(child).toHaveLength(12);
    const all = child.map((p) => p.text).join(' ');
    expect(all).not.toContain('=');
    for (const g of [3, 5]) {
      const f = formOf(BANK, g, 'A');
      for (const block of ['urdu', 'english']) for (const q of f[block].questions) expect(all).not.toContain(norm(q.prompt));
      for (const w of f.maths.oral.word_problems) expect(all).not.toContain(norm(w.prompt_ur).slice(0, 12));
      expect(all).not.toContain(norm(resolveUx('childTestCoachCardDontShow', { language: 'en' })));
    }
  });

  it('Set B pack carries the Set B coach cards, stamped', () => {
    const b = pages(v2.buildPrintMeHtml({ itemBank: BANK, set: 'B' }));
    const cc = b.find((p) => p.attrs.page === 'g5/coachcard');
    expect(cc.text).toContain(v2.setLabel('B'));
    expect(cc.text).toContain(v2.NOT_YET);
    expect(cc.text).toContain(norm(formOf(BANK, 5, 'B').maths.oral.word_problems[1].prompt_ur));
  });
});
