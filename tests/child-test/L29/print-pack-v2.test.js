/**
 * Child test v2 — the print pack (L29, bd-s1oo0.46.5; design COACH_JOURNEY_V2 §5, CONTRACT §19).
 *
 * The pack the operator prints: per grade and set, three laminated A4 cards (Urdu, English, Maths),
 * each one task per side; one coach page (English front, Urdu back); the "before the first child"
 * setup picture; and PRINT_ME, everything for one coach in print order behind a cover page.
 *
 * These run the real HTML builders against a contract-shaped item bank. What they prove:
 *   - the child sees the item-bank text and nothing else: no answers, no questions, no word
 *     problems, no item numbers on the reading cards;
 *   - every card says which grade, subject and set it is, in the grade's colour;
 *   - Urdu prose on the coach page uses Urdu digits;
 *   - the setup picture is a drawing with its three labels, at the size the bot sends.
 * The browser half (pages, pixels) is real-render-v2.test.js (opt-in, needs Chromium).
 */

const bank = require('../L2/fixtures/item-bank.fixture.json');
const v2 = require('../../../bot/shared/services/child-test/render/v2');

const formOf = (g, f) => bank.grades[String(g)].forms[f];

function visibleText(s) {
  return String(s)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// One <section class="page" …>…</section> per printed side, with its data attributes.
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

const SET_A = { grade: 3, set: 'A' };

describe('child cards (v2)', () => {
  for (const grade of [3, 5]) {
    describe(`grade ${grade}`, () => {
      const form = formOf(grade, 'A');
      const out = v2.buildCardsHtml({ grade, set: 'A', form });
      const ps = pages(out);
      const side = (card, s) => ps.find((p) => p.attrs.card === card && p.attrs.side === s);

      it('has six sides in order: Urdu, English, Maths, each front then back', () => {
        expect(ps.map((p) => `${p.attrs.card}/${p.attrs.side}`)).toEqual([
          'urdu/front', 'urdu/back', 'english/front', 'english/back', 'maths/front', 'maths/back',
        ]);
        for (const p of ps) expect(p.attrs.audience).toBe('child');
      });

      it('prints the whole story, in order, on the front — and only the story', () => {
        for (const block of ['urdu', 'english']) {
          const p = side(block, 'front');
          const body = visibleText(p.raw.replace(/<header[\s\S]*?<\/header>/, ''));
          expect(body).toBe(form[block].story.text.replace(/\s+/g, ' ').trim());
        }
      });

      it('puts the fallback on the back: the "only if" line, 10 letters, then 10 words', () => {
        for (const block of ['urdu', 'english']) {
          const p = side(block, 'back');
          const fb = form[block].fallback;
          expect(fb.letters).toHaveLength(10);
          expect(fb.words).toHaveLength(10);
          expect(p.text).toContain(block === 'urdu' ? 'صرف اس صورت میں' : "Only if the child can't read the story");
          let at = 0;
          for (const t of [...fb.letters, ...fb.words]) {
            const i = p.raw.indexOf(`>${t}<`, at);
            expect(i).toBeGreaterThan(-1);
            at = i;
          }
        }
      });

      it('has no item numbers on a reading card', () => {
        for (const block of ['urdu', 'english']) {
          for (const s of ['front', 'back']) {
            const body = visibleText(side(block, s).raw.replace(/<header[\s\S]*?<\/header>/, ''));
            expect(body).not.toMatch(/[0-9۰-۹]/);
          }
        }
      });

      it('maths front: A–D number pairs and 1–4 sums from the May set, printed with true signs', () => {
        const oral = v2.oralMaths({ grade, set: 'A', form }).items;
        const p = side('maths', 'front');
        expect(oral.compare).toHaveLength(4);
        expect(oral.sums).toHaveLength(4);
        ['A', 'B', 'C', 'D'].forEach((l, i) => {
          const c = oral.compare[i];
          expect(p.raw).toMatch(new RegExp(`data-label="${l}"[\\s\\S]*?>${c.a}<[\\s\\S]*?>${c.b}<`));
        });
        oral.sums.forEach((s, i) => {
          expect(p.raw).toContain(`data-label="${i + 1}"`);
          expect(p.text).toContain(v2.mathsDisplay(s.prompt));
        });
        expect(p.text).not.toMatch(/\d\s*-\s*\d/); // a hyphen is not a minus
      });

      it('maths back carries no items', () => {
        const p = side('maths', 'back');
        const body = visibleText(p.raw.replace(/<header[\s\S]*?<\/header>/, ''));
        expect(body).toBe('');
      });

      it('shows no answer anywhere on a child card', () => {
        const oral = v2.oralMaths({ grade, set: 'A', form }).items;
        const all = ps.map((p) => p.text).join(' ');
        expect(all).not.toContain('=');
        // a sum's answer may only appear inside another printed item (G5: 8 × 9 = 72, and 72 ÷ 6 is item 4)
        let rest = all;
        for (const s of oral.sums) rest = rest.split(v2.mathsDisplay(s.prompt)).join(' ');
        for (const c of oral.compare) rest = rest.split(new RegExp(`(?<![0-9])(${c.a}|${c.b})(?![0-9])`)).join(' ');
        for (const s of oral.sums) expect(rest).not.toMatch(new RegExp(`(?<![0-9])${s.answer}(?![0-9])`));
        for (const w of oral.word_problems) {
          if (w.prompt_ur) expect(all).not.toContain(w.prompt_ur.slice(0, 12));
          if (w.prompt_en) expect(all).not.toContain(w.prompt_en.slice(0, 12));
        }
        // an accepted answer is often a word of the story itself, so it may only appear on a story front
        const notStory = ps.filter((p) => p.attrs.side !== 'front' || p.attrs.card === 'maths').map((p) => p.text).join(' ');
        for (const block of ['urdu', 'english']) {
          for (const q of form[block].questions || []) {
            expect(all).not.toContain(q.prompt);
            for (const a of q.accept || []) expect(notStory).not.toContain(a);
          }
        }
      });

      it('every side wears the grade colour and its label in the corner', () => {
        const colour = v2.GRADE_COLOUR[grade];
        expect(colour.name).toBe(grade === 3 ? 'green' : 'blue');
        for (const p of ps) {
          expect(p.raw).toContain(`--band:${colour.hex}`);
          const subject = { urdu: 'Urdu', english: 'English', maths: 'Maths' }[p.attrs.card];
          expect(p.text).toContain(`Grade ${grade} · ${subject}`);
          expect(p.text).toContain('Set A · Oct–Dec 2026');
        }
      });
    });
  }

  it('the two grades are different colours', () => {
    expect(v2.GRADE_COLOUR[3].hex).not.toBe(v2.GRADE_COLOUR[5].hex);
  });

  it('Set B is labelled for next term and stamped "do not print yet" only when asked', () => {
    const b = v2.buildCardsHtml({ grade: 3, set: 'B', form: formOf(3, 'B'), notYet: true });
    const ps = pages(b);
    for (const p of ps) {
      expect(p.text).toContain('Set B · Jan–Mar 2027');
      expect(p.text).toContain('Next term — do not print yet');
    }
    const a = v2.buildCardsHtml({ grade: 3, set: 'A', form: formOf(3, 'A') });
    expect(visibleText(a)).not.toContain('do not print yet');
  });

  it('takes the oral maths items from the item bank when it has them (L27), else the CONTRACT §19 table', () => {
    const form = JSON.parse(JSON.stringify(formOf(3, 'A')));
    expect(v2.oralMaths({ grade: 3, set: 'A', form }).source).toBe('contract-table');
    form.maths.oral = {
      compare: [{ id: 'c1', a: 41, b: 14, answer: 41 }, { id: 'c2', a: 7, b: 9, answer: 9 }, { id: 'c3', a: 300, b: 299, answer: 300 }, { id: 'c4', a: 1201, b: 1210, answer: 1210 }],
      sums: [{ id: 's1', prompt: '12+3', answer: 15 }, { id: 's2', prompt: '18-5', answer: 13 }, { id: 's3', prompt: '64-23', answer: 41 }, { id: 's4', prompt: '47+38', answer: 85 }],
      word_problems: [],
    };
    const r = v2.oralMaths({ grade: 3, set: 'A', form });
    expect(r.source).toBe('item-bank');
    const out = v2.buildCardsHtml({ grade: 3, set: 'A', form });
    expect(out).toContain('>1201<');
    expect(out).toContain('64 − 23');
  });
});

describe('coach page (v2)', () => {
  const out = v2.buildCoachPageHtml({});
  const ps = pages(out);

  it('is one sheet: English front, Urdu back, for the coach', () => {
    expect(ps.map((p) => `${p.attrs.lang}/${p.attrs.side}`)).toEqual(['en/front', 'ur/back']);
    for (const p of ps) expect(p.attrs.audience).toBe('coach');
  });

  it('carries the sitting picture, what to bring, the five rules and "you never count", in both languages', () => {
    for (const p of ps) {
      expect(p.raw).toContain('<svg');
      expect((p.raw.match(/class="rule-item"/g) || []).length).toBe(5);
    }
    const [en, ur] = ps;
    for (const s of ['What to bring', 'One child at a time', 'face down', 'right', 'wrong', 'point to the next word', 'Never stop the recording', 'The phone tells you every step', 'you never count']) {
      expect(en.text).toContain(s);
    }
    for (const s of ['ساتھ لائیں', 'ایک وقت میں ایک بچہ', 'الٹا', 'اگلے لفظ', 'ریکارڈنگ', 'فون آپ کو ہر قدم بتائے گا', 'گنتی']) {
      expect(ur.text).toContain(s);
    }
  });

  it('numbers the rules itself, in each language\'s digits (no browser list markers)', () => {
    const [en, ur] = ps;
    for (const p of ps) expect(p.raw).not.toMatch(/<ol(?![^>]*list-none)/);
    expect((en.raw.match(/<span class="num">([1-5])<\/span>/g) || []).length).toBe(5);
    expect((ur.raw.match(/<span class="num">([۱-۵])<\/span>/g) || []).length).toBe(5);
  });

  it('writes Urdu digits in Urdu prose (Latin digits only inside an isolated atom)', () => {
    const ur = ps[1].raw
      .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
      .replace(/<[^>]*class="[^"]*\bltr\b[^"]*"[^>]*>[^<]*<\/[^>]+>/g, ' ');
    expect(visibleText(ur)).not.toMatch(/[0-9]/);
    expect(visibleText(ps[1].raw)).toMatch(/[۰-۹]/);
  });
});

describe('setup picture (v2)', () => {
  for (const lang of ['en', 'ur']) {
    it(`${lang}: a drawing with three labels, ≤ 1080 px wide and aspect ≤ 1.24`, () => {
      const svg = v2.setupPictureSvg(lang);
      const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      expect(vb).not.toBeNull();
      const [w, h] = [Number(vb[1]), Number(vb[2])];
      expect(h / w).toBeLessThanOrEqual(1.24);
      expect((svg.match(/class="label"/g) || []).length).toBe(3);
      for (const id of ['coach', 'child', 'desk', 'card', 'phone', 'class']) expect(svg).toContain(`id="${id}"`);
      const page = v2.buildSetupPictureHtml(lang);
      expect(v2.SETUP_PICTURE.cssWidth * v2.SETUP_PICTURE.scale).toBeLessThanOrEqual(1080);
      expect(page).toContain(svg);
    });
  }

  it('labels say where to sit, where the card goes and how to hold the phone', () => {
    const en = visibleText(v2.setupPictureSvg('en'));
    expect(en).toMatch(/away from the class/i);
    expect(en).toMatch(/card flat/i);
    expect(en).toMatch(/screen away from the child/i);
    const ur = visibleText(v2.setupPictureSvg('ur'));
    expect(ur).toContain('کلاس سے دور');
    expect(ur).toContain('کارڈ');
    expect(ur).toContain('اسکرین');
  });
});

describe('PRINT_ME (v2)', () => {
  // PRINT_ME carries the coach cards (L33), which need the v2 bank's coach lines and oral maths:
  // the committed bank, not the v1-shaped L2 fixture.
  const realBank = require('../../../bot/shared/data/child-test/item-bank.v1.json');
  const out = v2.buildPrintMeHtml({ itemBank: realBank, set: 'A' });
  const ps = pages(out);

  it('is everything for one coach, in print order, behind a cover', () => {
    expect(ps.map((p) => p.attrs.page)).toEqual([
      'cover', 'cover-back', 'coach/en', 'coach/ur',
      'g3/coachcard', 'g3/coachcard-back', 'g5/coachcard', 'g5/coachcard-back',
      'g3/urdu/front', 'g3/urdu/back', 'g3/english/front', 'g3/english/back', 'g3/maths/front', 'g3/maths/back',
      'g5/urdu/front', 'g5/urdu/back', 'g5/english/front', 'g5/english/back', 'g5/maths/front', 'g5/maths/back',
    ]);
  });

  it('cover says what to laminate and how many copies', () => {
    const c = ps[0].text;
    expect(c).toMatch(/laminate/i);
    expect(c).toMatch(/one copy per coach/i);
    expect(c).toMatch(/double-sided/i);
    expect(c).toContain('Set A · Oct–Dec 2026');
  });

  it('Set B pack says "next term — do not print yet" on the cover', () => {
    const b = pages(v2.buildPrintMeHtml({ itemBank: realBank, set: 'B' }));
    expect(b[0].text).toMatch(/Next term — do not print yet/);
    expect(b[0].text).toContain('Set B · Jan–Mar 2027');
  });
});
