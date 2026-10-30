/**
 * v34 printed-paper fixes the renderer owns (bd-5jmnfj.4.58):
 *   1. an MCQ that carries a table printed no table (G5 Maths Q1 (a) xviii): the table prints between the picture and the options;
 *   2. a picture item whose stem holds the blank («This is a ____.», G1 English Q12) printed no answer line under the picture;
 *   3. a Urdu fill-in blank was a fixed «___» whatever the box word, so «گھونسلے» did not fit (G1 Urdu Q5): the blank grows with the longest box word;
 *   4. a section the teacher note sends to the answer copy (G5 Urdu B and C) still printed blanks and write boxes on the paper.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-30T07:00:00.000Z';
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const bodyOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '');
const PIC = { kind: 'object', name: 'bell', src: 'data:image/png;base64,iVBORw0KGgo=' };

function itemsFor(slot, band) {
  return Array.from({ length: slot.generate }, (_, i) => ({
    slot: slot.slot, question: `Question ${i + 1} for ${slot.slot}`, marks: slot.marks_each, blooms: band,
    ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three', 'd) four'], answer: 'a) one' } : { answer: String(i + 1) }),
    scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
  }));
}

function treeFor(subject, custom = () => null) {
  const tree = { unseen: { objective: {}, subjective: {} } };
  subject.sections.forEach((sec) => {
    const bands = Object.entries(sec.levels).filter(([, n]) => n > 0).map(([b]) => b);
    sec.slots.forEach((slot, i) => {
      const items = custom(slot) || itemsFor(slot, bands[i % bands.length]);
      (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...items);
    });
  });
  return tree;
}

function paperFor(presetId, subjectKey, grade, custom, tweak) {
  const P = Patterns.get(presetId).subjects[subjectKey];
  const tree = treeFor(P, custom);
  const { examJson } = applyLayout(tree, P, { kind: 'pages', chapters: null, pages: '1-100' }, { now: NOW });
  if (tweak) tweak(examJson);
  return { P, tree, html: R.renderPaper({ examJson, grade, subject: subjectKey, allowShort: true }) };
}

describe('an MCQ with a table prints the table before its options', () => {
  const TABLE = { headers: ['Student', '1', '2', '3', '4', '5', '6', '7'], rows: [['Marks', '8', '6', '9', '6', '7', '6', '10']] };
  const withTable = (slot) => {
    if (slot.shape !== 'mcq' || slot.slot !== firstMcqSlot()) return null;
    const items = itemsFor(slot, 'Understand');
    items[0] = { ...items[0], question: 'Look at the marks of seven students. What is the mode?', table: TABLE, options: ['a) 9', 'b) 8', 'c) 7', 'd) 6'], answer: 'd) 6' };
    return items;
  };
  const firstMcqSlot = () => Patterns.get('fde_g5_2027').subjects.maths.sections.flatMap((s) => s.slots).find((s) => s.shape === 'mcq').slot;

  test('the table cells print and sit before the first option', () => {
    const { html } = paperFor('fde_g5_2027', 'maths', 5, withTable);
    expect(visible(html)).toContain('What is the mode?'); // the item itself prints
    const at = bodyOf(html).indexOf('<th>Student</th>');
    expect(at).toBeGreaterThan(-1); // the header's own "Student Name" box is not a <th>
    expect(bodyOf(html)).toContain('<td>Marks</td>');
    expect(bodyOf(html)).toContain('<td>10</td>');
    expect(at).toBeLessThan(bodyOf(html).indexOf('<div class="opts', at));
  });

  test('an MCQ with no table prints no table', () => {
    const { html } = paperFor('fde_g5_2027', 'maths', 5);
    expect(bodyOf(html)).not.toContain('<table class="data">');
  });
});

describe('a picture item with its blank in the stem still prints an answer line under the picture', () => {
  const pics = (slot) => (slot.slot === 'g1.english.C.Q12'
    ? itemsFor(slot, 'Remember').map((q) => ({ ...q, question: 'This is a ____.', picture: PIC, answer: 'This is a bell.' }))
    : null);

  test('every Q12 picture is followed by a write box', () => {
    const { html } = paperFor('fde_g1_2026', 'english', 1, pics);
    const pieces = bodyOf(html).split('<div class="pic pic-object">').slice(1);
    expect(pieces.length).toBe(5); // five items
    const withBox = pieces.filter((s) => /^[\s\S]{0,300}?class="write-box"/.test(s));
    expect(withBox.length).toBe(5);
  });
});

describe('a Urdu fill-in blank is as wide as the longest box word', () => {
  const sizeOf = (words) => {
    const custom = (slot) => (slot.slot === 'g1.urdu.B.Q5'
      ? itemsFor(slot, 'Understand').map((q, i) => ({ ...q, question: 'پرندے ___ میں رہتے ہیں۔', ...(i === 0 ? { words } : {}) }))
      : null);
    const { html } = paperFor('fde_g1_2026', 'urdu', 1, custom);
    const marker = bodyOf(html).split('پرندے')[1].split('رہتے')[0]; // the markup between the two halves of the sentence
    const under = Math.max(0, ...(marker.match(/_+/g) || ['']).map((s) => s.length));
    const minw = Math.max(0, ...[...marker.matchAll(/min-width:\s*([\d.]+)/g)].map((m) => parseFloat(m[1])));
    return Math.max(under, minw);
  };

  test('a long box word gives a wider blank than a short one', () => {
    expect(sizeOf(['کان', 'سورج', 'ستارے', 'کڑوا', 'گھونسلے'])).toBeGreaterThan(sizeOf(['کان', 'سورج', 'ستارے', 'کڑوا', 'پھول']));
  });

  test('the blank is at least as long as the longest word in letters', () => {
    expect(sizeOf(['کان', 'سورج', 'ستارے', 'کڑوا', 'گھونسلے'])).toBeGreaterThanOrEqual([...'گھونسلے'].length);
  });
});

describe('a section the note sends to the answer copy prints no blanks on the paper', () => {
  const compre = (slot) => (slot.shape === 'comprehension'
    ? [{
      slot: slot.slot, question: 'q', marks: slot.marks_each, blooms: 'Understand', answer: 'x', passage: 'پیراگراف',
      parts: [
        { key: 'questions', questions: Array.from({ length: 5 }, (_, i) => `سوال ${i + 1}`) },
        { key: 'antonyms', antonyms: [['اچھا', 'برا'], ['دن', 'رات']] },
      ],
      scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
    }] : null);

  test('Section B (answer_on answer_sheet) holds no blank span and no write space', () => {
    const { html } = paperFor('fde_g5_2027', 'urdu', 5, compre);
    const secB = bodyOf(html).split('data-section="B"')[1].split('<section')[0];
    expect(secB).not.toMatch(/class="blank"/);
    expect(secB).not.toMatch(/class="(write-box|work-box|work-square)"/);
  });
});

describe('bd-5jmnfj.4.58.7.6: a pick part on the answer copy still prints its word-class labels', () => {
  const KINDS = ['اسم معرفہ', 'اسم نکرہ', 'اسم صفت', 'فعل'];
  const pickItem = (slot) => (slot.shape === 'comprehension'
    ? [{
      slot: slot.slot, question: 'q', marks: slot.marks_each, blooms: 'Understand', answer: 'x', passage: 'پیراگراف',
      parts: [{ key: 'pick', pick: Object.fromEntries(KINDS.map((k) => [k, ['الف', 'ب', 'ج', 'د']])) }],
      scheme: { points: [{ kind: 'A', text: 'correct', marks: slot.marks_each }] },
    }] : null);
  const pickPart = (html) => {
    const secB = bodyOf(html).split('data-section="B"')[1].split('<section')[0];
    return secB.split('سوال: پیراگراف سے چن کر لکھیں')[1].split('<div class="part">')[0];
  };

  test('on the answer sheet every pick kind label prints and no blank span does', () => {
    const { html } = paperFor('fde_g5_2027', 'urdu', 5, pickItem);
    const part = pickPart(html);
    KINDS.forEach((k) => expect(part).toContain(k));
    expect(part).not.toMatch(/class="blank"/);
  });

  test('on the question paper the labels and the blanks both still print', () => {
    const onPaper = (ex) => { ex._layout.sections.find((x) => x.id === 'B').answer_on = 'question_paper'; };
    const { html } = paperFor('fde_g5_2027', 'urdu', 5, pickItem, onPaper);
    const part = pickPart(html);
    KINDS.forEach((k) => expect(part).toContain(k));
    expect(part).toMatch(/class="blank"/);
  });
});
