/**
 * What the sixth review round asked of the board-pattern renderer, each through
 * the real chain: applyLayout → normaliseScheme → renderPaper / renderMarkingScheme.
 *
 *   1. The Social Studies map frame is 100 mm tall.
 *   2. A slot's last item never starts a page alone (break-before: avoid).
 *   3. A frame whose book page is not confirmed prints no page number; the
 *      teacher is sent to the book's outline map instead.
 *   4. The Science diagram caption is the title only (the duty is in the scheme).
 *   5. Free model fields (`topics`, `table`, `passage`) print only on slots
 *      whose pattern names them, and still print where it does.
 *
 * Pure: HTML strings, no browser. Fictional fixtures only.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;
const clone = (o) => JSON.parse(JSON.stringify(o));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
}

function laid(raw, subject) {
  const exam = applyLayout(raw, P[subject], { kind: 'fde' }, { now: NOW }).examJson;
  return normaliseScheme(exam).examJson;
}

const paperOf = (exam, subject) => R.renderPaper({ examJson: exam, grade: 5, subject, answerLines: true, allowShort: true });
const schemeOf = (exam, subject) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject, allowShort: true });

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// The element starting at `from` (an opening <div>), up to its own closing tag.
function elementAt(html, from) {
  const re = /<div\b[^>]*>|<\/div>/g;
  re.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(from, re.lastIndex);
  }
  return html.slice(from);
}

// The opening tags of an element's direct <div> children.
function childTags(element) {
  const inner = element.slice(element.indexOf('>') + 1, element.lastIndexOf('</div>'));
  const out = [];
  const re = /<div\b[^>]*>|<\/div>/g;
  let depth = 0;
  let m;
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('</')) depth -= 1;
    else {
      if (depth === 0) out.push(m[0]);
      depth += 1;
    }
  }
  return out;
}

// A Social Studies paper whose map item names no book page.
const SST_MAP = {
  unseen: {
    subjective: {
      'Map Labelling': [{
        slot: 'social_studies.A.Q2',
        question: 'پاکستان کا نقشہ',
        answer: 'ملک الف، ملک ب، ملک ج، ملک د، صوبہ ایک، صوبہ دو، صوبہ تین، صوبہ چار، علاقہ پانچ، سمندر',
        scheme: { points: [{ text: 'ہر درست نشاندہی', marks: 10, kind: 'A' }] },
      }],
    },
  },
};

const DIGITS = '[0-9۰-۹]';
const PAGE_REF = new RegExp(`p\\.\\s*${DIGITS}|(^|[^\\u0600-\\u06FF])ص\\s*${DIGITS}`);

describe('r6 renderer', () => {
  it('sst frame is 100 mm', () => {
    const html = paperOf(laid(SST_MAP, 'social_studies'), 'social_studies');
    expect(html).toMatch(/<div class="frame" id="fde-frame-social_studies\.A\.Q2" style="height:100mm">/);
    expect(html).not.toContain('height:110mm');
  });

  it('last item of a slot carries break-before avoid', () => {
    const html = paperOf(laid(fixture('science'), 'science'), 'science');
    // The rule: the last item of a slot never moves to a new page alone.
    expect(html).toMatch(/\.slot > \.q:last-child\s*\{[^}]*break-before:\s*avoid/);
    // And every slot's last child is that item, so the rule reaches it.
    const starts = [...html.matchAll(/<div class="slot[ "]/g)].map((m) => m.index);
    expect(starts.length).toBeGreaterThan(3);
    for (const at of starts) {
      const kids = childTags(elementAt(html, at));
      const items = kids.filter((t) => /^<div class="q[ "]/.test(t));
      if (!items.length) continue;
      expect(kids[kids.length - 1]).toMatch(/^<div class="q[ "]/);
    }
  });

  it('frame without a confirmed page prints no page number', () => {
    const exam = laid(SST_MAP, 'social_studies');
    exam._layout.frame_pages = { 'social_studies.A.Q2': 2 };
    const paper = paperOf(exam, 'social_studies');
    const scheme = schemeOf(exam, 'social_studies');
    const frame = elementAt(paper, paper.indexOf('<div class="frame"'));
    expect(visible(frame)).not.toMatch(PAGE_REF);
    const before = visible(elementAt(scheme, scheme.indexOf('<div class="box before">')));
    const supplies = visible(elementAt(scheme, scheme.indexOf('<div class="box supplies">')));
    expect(before).not.toMatch(PAGE_REF);
    expect(supplies).not.toMatch(PAGE_REF);
    // The teacher is sent to the book's outline map, with no page.
    expect(before).toContain('کتاب کا خاکہ نقشہ');
    expect(supplies).toContain('کتاب کا خاکہ نقشہ');
    // The question-paper page is a fact read from the PDF and still prints.
    expect(before).toContain('صفحہ ۲');
  });

  it('an unknown paper page reads once in Urdu (no doubled «سوالیہ پرچہ»)', () => {
    const scheme = schemeOf(laid(SST_MAP, 'social_studies'), 'social_studies');
    const before = visible(elementAt(scheme, scheme.indexOf('<div class="box before">')));
    expect(before).toContain('کتاب کا خاکہ نقشہ، سوالیہ پرچہ دیکھیں');
    expect(before).not.toContain('سوالیہ پرچہ سوالیہ پرچہ');
  });

  it('frame without a confirmed page prints no page number (en)', () => {
    // An English paper whose frame is a map with no book page.
    const exam = laid(fixture('science'), 'science');
    exam._layout.supplies = exam._layout.supplies.map((s) => (s.slot === 'science.A.Q1b'
      ? { ...s, kind: 'map', book_page: null, line_en: 'Q1 (b): Map' } : s));
    exam._layout.frame_pages = { 'science.A.Q1b': 1 };
    const scheme = schemeOf(exam, 'science');
    const before = visible(elementAt(scheme, scheme.indexOf('<div class="box before">')));
    const supplies = visible(elementAt(scheme, scheme.indexOf('<div class="box supplies">')));
    expect(before).not.toMatch(PAGE_REF);
    expect(supplies).not.toMatch(PAGE_REF);
    expect(before).toContain("the book's outline map");
    expect(supplies).toContain("the book's outline map");
    expect(before).toContain('page 1');
  });

  it('a frame with a confirmed book page still prints it', () => {
    const scheme = schemeOf(laid(fixture('science'), 'science'), 'science');
    const before = visible(elementAt(scheme, scheme.indexOf('<div class="box before">')));
    expect(before).toMatch(/book p\. \d+/);
    expect(before).not.toContain("the book's outline map");
  });

  it('science frame caption is the title only', () => {
    const exam = laid(fixture('science'), 'science');
    const q = Object.values(exam.unseen.subjective).flat().find((x) => x.slot === 'science.A.Q1b');
    const paper = paperOf(exam, 'science');
    const caption = /<div class="frame-title">([\s\S]*?)<\/div>/.exec(paper);
    expect(caption).not.toBeNull();
    expect(visible(caption[1]).trim()).toBe(`Diagram: ${String(q.question).trim()}`);
    expect(visible(paper)).not.toContain('drawn on the board');
    // The duty stays in the scheme's "You add" line.
    expect(visible(schemeOf(exam, 'science'))).toContain('You add: the diagram to label');
    const slot = P.science.sections.flatMap((s) => s.slots).find((s) => s.slot === 'science.A.Q1b');
    expect(slot.frame.title_en).toBe('Diagram: {q}');
    expect(slot.frame.title_ur).toBe('خاکہ: {q}');
  });

  it('slots whose pattern names topics, table or passage still print them', () => {
    const english = laid({ unseen: { subjective: { 'Paragraph Writing': [{
      slot: 'english.C.Q8', question: '', topics: ['A Rainy Day', 'My School Garden', 'A Visit to a Park'], answer: '',
    }] } } }, 'english');
    const v = visible(paperOf(english, 'english'));
    expect(v).toContain('A Rainy Day');
    expect(v).toContain('A Visit to a Park');
    const maths = paperOf(laid(fixture('maths'), 'maths'), 'maths');
    expect(maths).toContain('<table class="data">');
    const poem = paperOf(laid(fixture('r5-english'), 'english'), 'english');
    const q5 = fixture('r5-english').unseen.subjective;
    const passage = Object.values(q5).flat().find((x) => x.slot === 'english.C.Q5').passage;
    expect(visible(poem)).toContain(visible(passage.split('\n')[0]).trim());
  });

  it('stray topics stay off the paper; a table or passage on any slot still prints (an item keeps its data)', () => {
    const raw = clone(fixture('science'));
    const q3 = Object.values(raw.unseen.subjective).flat().find((q) => q.slot === 'science.C.Q3a');
    q3.table = { headers: ['STRAYHEAD'], rows: [['STRAYCELL']] };
    q3.passage = 'STRAYPASSAGE text.';
    q3.topics = ['STRAYTOPIC'];
    const v = visible(paperOf(laid(raw, 'science'), 'science'));
    expect(v).toContain('STRAYHEAD');
    expect(v).toContain('STRAYPASSAGE');
    expect(v).not.toContain('STRAYTOPIC');
  });

  it('Urdu: a number glued to a unit takes Urdu digits; a Latin token keeps its own', () => {
    const raw = { unseen: { subjective: { 'Short Questions': [{ slot: 'social_studies.C.Q5', question: 'ایک تھیلے میں 5kg چاول، 10cm رسی اور K-2 کی تصویر ہے۔', answer: '5', marks: 4 }] } } };
    const paper = paperOf(laid(raw, 'social_studies'), 'social_studies');
    expect(paper).not.toMatch(/<bdi[^>]*>5kg<\/bdi>/);
    expect(paper).not.toMatch(/<bdi[^>]*>10cm<\/bdi>/);
    expect(paper).toContain('<span class="num">۵</span>');
    expect(paper).toContain('<span class="num">۱۰</span>');
    expect(paper).toContain('<bdi class="ltr" dir="ltr">K-2</bdi>');
  });

  it('situation: a parent answer with no letters prints once on the parent row', () => {
    const raw = { unseen: { subjective: { 'Logical Reasoning': [{
      slot: 'science.B.Q2b', question: 'A class rubbed two balloons on wool and held them near paper bits.',
      questions: [{ question: 'What happened to the paper?' }, { question: 'Why?' }, { question: 'Name one more test.' }],
      answer: 'The bits jumped up; the rubbed balloon pulls them; try it with a comb.',
    }] } } };
    const scheme = schemeOf(laid(raw, 'science'), 'science');
    const v = visible(scheme);
    expect(v.split('The bits jumped up').length - 1).toBe(1);
    // A lettered parent answer still splits onto the sub rows and is not printed whole as well.
    const lettered = clone(raw);
    lettered.unseen.subjective['Logical Reasoning'][0].answer = 'a) The bits jumped up. b) The balloon pulls them. c) A comb.';
    const v2 = visible(schemeOf(laid(lettered, 'science'), 'science'));
    expect(v2).toContain('The balloon pulls them.');
    expect(v2.split('The bits jumped up').length - 1).toBe(1);
    expect(v2).not.toContain('b) The balloon pulls them. c)');
  });
});
