/**
 * v37 layout fixes the renderer owns (round 6, W-render):
 *   1. the key's story box under Listening was labelled «Read aloud», the read-aloud task's label (G1 English);
 *   2. G2 English Q1 passage printed once, so items (h)-(j) on the next page had no passage in view;
 *   3. G2 Urdu Q2 alphabet order had no alphabet strip on the page;
 *   4. G2 Urdu Q7, Q8, Q9 ask for five sentences or turns and got one unruled box;
 *   5. G5 Urdu Q2 ب part marks printed «۰۸» and «۰۲», which reads like a dot.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const { oralSheet } = require('../../bot/shared/services/assessment/fde-oral-sheet');
const V = require('../../bot/shared/services/assessment/fde-render-v37');

const NOW = '2026-10-30T07:00:00.000Z';
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function itemsFor(slot, band) {
  return Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} for ${slot.slot}`, marks: slot.marks_each, blooms: band,
    ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three', 'd) four'], answer: 'a) one' } : { answer: String(i + 1) }),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
  }));
}

function paperFor(presetId, subjectKey, grade, custom) {
  const P = Patterns.get(presetId).subjects[subjectKey];
  const tree = { unseen: { objective: {}, subjective: {} } };
  P.sections.forEach((sec) => {
    const bands = Object.entries(sec.levels).filter(([, n]) => n > 0).map(([b]) => b);
    sec.slots.forEach((slot, i) => {
      const items = (custom && custom(slot)) || itemsFor(slot, bands[i % bands.length]);
      (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...items);
    });
  });
  const { examJson } = applyLayout(tree, P, { kind: 'pages', chapters: null, pages: '1-100' }, { now: NOW });
  return R.renderPaper({ examJson, grade, subject: subjectKey, allowShort: true });
}

describe('the oral sheet labels a story box by its task', () => {
  const ctx = { medium: 'en', text: (s) => String(s) };
  const oral = (kind) => ({
    title_en: 'Oral', title_ur: 'x', marks: 5,
    tasks: [{ id: kind, kind, label_en: kind, label_ur: kind, marks: 5, scoring: 'each', rubric: [{ marks: 1, en: 'Each', ur: 'ہر' }] }],
    content: [{ id: kind, script: 'Ali has a ball.', items: [{ ask: 'What?', answer: 'Ball' }] }],
  });
  test('a listening story is not labelled Read aloud', () => {
    const html = oralSheet(oral('listening'), ctx);
    expect(html).toContain('Listening story (teacher reads aloud)');
    expect(html).not.toMatch(/class="k">Read aloud</);
  });
  test('the read-aloud task keeps its label', () => {
    expect(oralSheet(oral('read_aloud'), ctx)).toMatch(/class="k">Read aloud</);
  });
  test('Urdu names the story too', () => {
    const html = oralSheet(oral('listening'), { medium: 'ur', text: (s) => String(s) });
    expect(html).toContain(V.LISTEN_LABEL.ur);
    expect(V.LISTEN_LABEL.ur).not.toBe('پڑھ کر سنائیں');
  });
});

describe('marks print without a leading zero', () => {
  test('marksText strips it and leaves other text alone', () => {
    expect(V.marksText('08')).toBe('8');
    expect(V.marksText('02')).toBe('2');
    expect(V.marksText('10')).toBe('10');
    expect(V.marksText('0')).toBe('0');
    expect(V.marksText('{t:20}')).toBe('{t:20}');
    expect(V.marksText('20 نمبر')).toBe('20 نمبر');
    expect(V.marksText(null)).toBe(null);
  });
  test('G5 Urdu paper prints no ۰۸ or ۰۲', () => {
    const html = visible(paperFor('fde_g5_2027', 'urdu', 5));
    expect(html).not.toMatch(/(^|\s)۰[۱-۹](\s|$)/);
    expect(html).toMatch(/(^|\s)۸(\s|$)/);
  });
});

describe('G2 Urdu Q2 prints the alphabet strip', () => {
  test('the strip is in order, extended letters included', () => {
    const strip = V.alphabetStrip();
    const letters = [...strip.matchAll(/<span>(.*?)<\/span>/g)].map((m) => m[1]);
    expect(letters.indexOf('ب')).toBeLessThan(letters.indexOf('پ'));
    expect(letters.indexOf('پ')).toBeLessThan(letters.indexOf('ت'));
    expect(letters.indexOf('ت')).toBeLessThan(letters.indexOf('ٹ'));
    expect(letters.indexOf('ج')).toBeLessThan(letters.indexOf('چ'));
    expect(letters.length).toBeGreaterThanOrEqual(38);
  });
  test('the paper prints it once, with Q2, in Urdu only', () => {
    const html = paperFor('fde_g2_2026', 'urdu', 2);
    expect(html.match(/class="alpha-strip"/g)).toHaveLength(1);
    expect(paperFor('fde_g2_2026', 'english', 2).replace(/<style[\s\S]*?<\/style>/g, '')).not.toContain('alpha-strip');
  });
});

describe('G2 Urdu Q7, Q8, Q9 get one ruled, numbered line per sentence or turn', () => {
  test('lineCount reads the count from the instruction', () => {
    expect(V.lineCount({ instruction_ur: 'تصویر دیکھ کر پانچ جملے لکھیں۔' })).toBe(5);
    expect(V.lineCount({ instruction_ur: 'دو دوستوں کے درمیان پانچ باتوں کا مکالمہ لکھیں۔' })).toBe(5);
    expect(V.lineCount({ instruction_ur: 'کہانی لکھیں۔' })).toBe(0);
    expect(V.lineCount({ instruction_en: 'Write five sentences.' })).toBe(5);
    expect(V.lineCount({})).toBe(0);
  });
  test('ruledLines gives n numbered rows', () => {
    const html = V.ruledLines(5, (s) => s);
    expect(html.match(/class="rl"/g)).toHaveLength(5);
    expect(html).toContain('>5<');
  });
  test('each of the three slots prints five ruled lines and no single big box', () => {
    const html = paperFor('fde_g2_2026', 'urdu', 2);
    for (const id of ['g2.urdu.B.Q7', 'g2.urdu.B.Q8', 'g2.urdu.B.Q9']) {
      const q = html.split(`data-slot="${id}"`)[1].split('data-slot=')[0];
      expect(q.match(/class="rl"/g)).toHaveLength(5);
      expect(q).not.toMatch(/class="write-box"/);
    }
  });
});

describe('G2 English Q1 shows the passage with every item', () => {
  const comp = (slot) => {
    if (slot.slot !== 'g2.english.A.Q1') return null;
    return [{ slot: slot.slot, question: '', passage: 'Sana lives next to a small park.', marks: 20, blooms: 'Remember',
      questions: Array.from({ length: 10 }, (_, i) => ({ question: `Item ${i + 1}?`, answer: 'x', marks: 2 })),
      answer: 'x', scheme: { points: [{ kind: 'A', text: 'ok', marks: 20 }] } }];
  };
  test('the passage is printed again before item (h)', () => {
    const html = paperFor('fde_g2_2026', 'english', 2, comp);
    const q = html.split('data-slot="g2.english.A.Q1"')[1].split('data-slot=')[0];
    expect(q.match(/Sana lives next to a small park\./g)).toHaveLength(2);
    expect(q.indexOf('passage reprint')).toBeLessThan(q.indexOf('Item 8?'));
    expect(q.indexOf('passage reprint')).toBeGreaterThan(q.indexOf('Item 7?'));
  });
  test('a short set is not reprinted', () => {
    expect(V.reprintAt(7)).toBe(0);
    expect(V.reprintAt(10)).toBe(7);
    expect(V.passageAgain('P', 'en')).toContain('reprint');
  });
});
