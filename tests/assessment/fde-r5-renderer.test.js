/**
 * What the fifth review round found on recorded board-pattern papers, each
 * through the real chain: applyLayout → normaliseScheme → renderPaper /
 * renderMarkingScheme.
 *
 *   1. A list of words prints on the paper only when the slot says it is a
 *      word bank: English Q5 printed the four rhyming words, which is the key.
 *   2. A sub-question the model already lettered «a) …» is not lettered twice.
 *   3. A situation whose answer lives on the parent («a) … b) … c) …») prints
 *      each part on its sub row, and the parent's scheme prints once.
 *   4. The Maths-only legend lines stay on the Maths scheme only.
 *   5. On an Urdu page a Latin token with digits (K-2, COVID-19) keeps its
 *      Western digits, isolated left to right.
 *
 * Pure: HTML strings, no browser.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
}

function laid(name, subject, mutate) {
  let exam = applyLayout(fixture(name), P.subjects[subject], { kind: 'fde' }, { now: NOW }).examJson;
  exam = normaliseScheme(exam).examJson;
  if (mutate) mutate(exam);
  return exam;
}

const paperOf = (exam, subject) => R.renderPaper({ examJson: exam, grade: 5, subject, answerLines: true, allowShort: true });
const schemeOf = (exam, subject) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject, allowShort: true });

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

// The paper block(s) of one slot (a `.q` div carrying data-slot), up to the next block.
function blocksOf(html, slot) {
  const out = [];
  const re = new RegExp(`<div class="q[^"]*" data-slot="${slot.replace(/\./g, '\\.')}">`, 'g');
  let m;
  while ((m = re.exec(html))) {
    const rest = html.slice(m.index);
    const next = rest.slice(1).search(/<div class="(q|slot)[ "]|<\/section>/);
    out.push(next < 0 ? rest : rest.slice(0, next + 1));
  }
  return out;
}

// The scheme rows of one slot.
function rowsOf(html, slot) {
  const re = new RegExp(`<tr data-row="${slot.replace(/\./g, '\\.')}">[\\s\\S]*?</tr>`, 'g');
  return html.match(re) || [];
}

// ── 1. words print only where the pattern says they are a word bank ──────────

describe('1. a word list prints only for a word-bank slot', () => {
  it('english Q5 (rhyming words) never prints its words: they are the answer', () => {
    const html = paperOf(laid('r5-english', 'english'), 'english');
    const [q5] = blocksOf(html, 'english.C.Q5');
    expect(q5).toBeDefined();
    expect(q5).not.toMatch(/class="word-(box|line)"/);
    expect(visible(q5)).not.toContain('white, night');
  });

  it('english Q4 (use these words in sentences) still prints its six words', () => {
    const html = paperOf(laid('r5-english', 'english'), 'english');
    const [q4] = blocksOf(html, 'english.C.Q4');
    expect(q4).toMatch(/class="word-box"/);
    for (const w of ['forgiveness', 'annoyance', 'urban', 'gratitude', 'ancient', 'sacrifice']) expect(q4).toContain(w);
  });

  it('a paper laid out before the flag existed still prints Q4 and not Q5', () => {
    const exam = laid('r5-english', 'english', (e) => {
      for (const sec of e._layout.sections) for (const slot of sec.slots) delete slot.print_words;
    });
    const html = paperOf(exam, 'english');
    expect(blocksOf(html, 'english.C.Q4')[0]).toMatch(/class="word-box"/);
    expect(blocksOf(html, 'english.C.Q5')[0]).not.toMatch(/class="word-(box|line)"/);
  });

  it('the pattern marks exactly the printed word lists, and Q5 asks for no words', () => {
    const flagged = [];
    for (const key of Object.keys(P.subjects)) {
      for (const sec of P.subjects[key].sections) for (const slot of sec.slots) if (slot.print_words === true) flagged.push(slot.slot);
    }
    expect(flagged.sort()).toEqual(['english.C.Q4', 'urdu.C.Q3', 'urdu.C.Q5']);
    const q5 = P.subjects.english.sections.flatMap((s) => s.slots).find((s) => s.slot === 'english.C.Q5');
    expect(q5.prompt_rule).not.toMatch(/`words` =/);
    expect(q5.prompt_rule).toMatch(/no `words`/);
  });
});

// ── 2. a sub-question is lettered once ───────────────────────────────────────

describe('2. a sub-question the model lettered is not lettered twice', () => {
  it('science Q2(b): «a) Why…» prints as one «a)»', () => {
    const html = paperOf(laid('r5-science-q2b', 'science'), 'science');
    const text = visible(html);
    expect(text).toContain('a) Why did glitter appear');
    expect(text).not.toMatch(/\b([abc])\)\s+\1\)/);
    expect(text).toContain('b) What happened to the glitter');
    expect(text).toContain('c) Suggest one habit');
  });
});

// ── 3. situation rows carry an answer, the parent scheme prints once ────────

describe('3. a situation scheme prints every part and the parent scheme once', () => {
  const html = schemeOf(laid('r5-science-q2b', 'science'), 'science');
  const rows = rowsOf(html, 'science.B.Q2b');

  it('parent-answer shape: each sub row prints its own part of the parent answer', () => {
    const ans = rows.map((r) => (/<td class="ans">([\s\S]*?)<\/td>/.exec(r) || [])[1] || '');
    expect(visible(ans[0])).toContain('Glitter spread through handshakes and touched surfaces');
    expect(visible(ans[0])).not.toContain('Washing with soap');
    expect(visible(ans[1])).toContain('Washing with soap and water removed most of the glitter');
    expect(visible(ans[2])).toContain('Regular handwashing with soap breaks the chain');
  });

  it('per-sub shape: each sub row keeps its own answer', () => {
    const text = rows.map(visible).join('\n');
    expect(text).toContain('The nails in the salty water');
    expect(text).toContain('A chemical change, because a new substance (rust) has formed.');
  });

  it("each situation's accept and common error print exactly once", () => {
    const text = visible(html);
    const count = (s) => text.split(s).length - 1;
    expect(count('saying handwashing removes every germ')).toBe(1);
    expect(count('any two of the three sub-answers with a reason about contact')).toBe(1);
    expect(count('thinking rust goes away when the nails are dried')).toBe(1);
    expect(count('a correct reason for the first chosen sub-question')).toBe(1);
  });

  it('every sub row still says what it is worth (2.5)', () => {
    const subRows = rows.filter((r) => /<td class="n">[^<]*[abc]\)/.test(visible(r)) || /[abc]\)<\/td>/.test(r));
    expect(subRows.length).toBe(6);
    subRows.forEach((r) => expect(r).toContain('2.5'));
  });
});

// ── 4. the legend carries only this subject's lines ─────────────────────────

describe('4. the Maths-only legend lines stay on the Maths scheme', () => {
  const MATHS_LINES = /arithmetic slip|no working earns/;

  it('a Science scheme has no Maths legend line', () => {
    const html = schemeOf(laid('r5-science-q2b', 'science'), 'science');
    const legend = /<div class="box legend">[\s\S]*?<\/div><ul>[\s\S]*?<\/ul><\/div>/.exec(html)[0];
    expect(legend).not.toMatch(MATHS_LINES);
    expect(legend).toContain('Grades (FDE p.115)');
    // Only the chips this scheme prints are keyed: Science Q2(b) prints A only.
    expect(legend).toContain('A = answer');
    expect(legend).not.toContain('M = method');
    expect(legend).not.toContain('U = unit');
  });

  it('an English scheme has no Maths legend line', () => {
    const html = schemeOf(laid('r5-english', 'english'), 'english');
    expect(html).not.toMatch(MATHS_LINES);
    expect(html).toContain('K = key point');
  });

  it('a Maths scheme keeps every line', () => {
    const exam = laid('maths', 'maths');
    const text = visible(schemeOf(exam, 'maths'));
    for (const line of P.subjects.maths.legend.lines_en) expect(text).toContain(line);
  });

  it('an Urdu-medium scheme keeps its bands line left to right', () => {
    const html = schemeOf(laid('r5-sst-urdu', 'social_studies'), 'social_studies');
    const legend = /<div class="box legend">[\s\S]*?<\/ul><\/div>/.exec(html)[0];
    expect(legend).toMatch(/<span class="ascii">A\+ 90–100[^<]*<\/span>/);
    expect(legend).not.toContain('حساب میں چوک');
  });

  it('a paper laid out with the old shared legend still drops the Maths lines', () => {
    const exam = laid('r5-science-q2b', 'science', (e) => {
      const old = JSON.parse(JSON.stringify(P.subjects.maths.legend));
      delete old.subject;
      delete old.key_from_chips;
      e._layout.legend = old;
    });
    expect(schemeOf(exam, 'science')).not.toMatch(MATHS_LINES);
  });
});

// ── 5. a Latin token keeps its own digits on an Urdu page ───────────────────

describe('5. an Urdu page prints K-2 and COVID-19 as written', () => {
  const exam = laid('r5-sst-urdu', 'social_studies');

  it('the paper isolates the Latin token with its Western digits', () => {
    const html = paperOf(exam, 'social_studies');
    expect(html).toContain('<bdi class="ltr" dir="ltr">K-2</bdi>');
    expect(html).toContain('<bdi class="ltr" dir="ltr">COVID-19</bdi>');
    expect(html).not.toMatch(/K-<span class="num">/);
    // A number that is not part of a Latin token is still Urdu digits.
    expect(html).toContain('<span class="num">۲۰۲۰</span>');
  });

  it('the scheme does the same, and keeps Urdu digits for 8,126', () => {
    const html = schemeOf(exam, 'social_studies');
    expect(html).toContain('<bdi class="ltr" dir="ltr">K-2</bdi>');
    expect(html).toContain('<span class="num">۸,۱۲۶</span>');
  });
});

// ── Round 2 ─────────────────────────────────────────────────────────────────

// The strip's answer letters in paper order, read from the marking scheme.
function stripLetters(html, slot) {
  const strip = new RegExp(`<div class="strip" data-row="${slot.replace(/\./g, '\\.')}">([\\s\\S]*?)</div>`).exec(html)[1];
  return [...strip.matchAll(/<span class="sc">([\s\S]*?)<\/span>(?=\s*<span class="sc">|$)/g)]
    .map((m) => visible(m[1]).replace(/[·،]\s*$/, '').trim().split(/\s+/).pop());
}

// The letter of the option whose bare text is the item's key text, on the laid-out paper.
function letterOfText(q, letters) {
  const bare = (s) => R.bareOption(s);
  return letters[q.options.map(bare).indexOf(bare(q.answer))];
}

function liveItems(exam, slot) {
  const out = [];
  for (const types of Object.values(exam.unseen)) for (const list of Object.values(types)) for (const q of list) if (q.slot === slot && !q.removed) out.push(q);
  return out;
}

describe('A. a text key that starts like a letter is read by its text', () => {
  it('English: «a dog», «A bird» and «an» print the letter of that option', () => {
    const exam = laid('r5-mcq-textkeys-en', 'english');
    const got = stripLetters(schemeOf(exam, 'english'), 'english.A.Q1a');
    const items = liveItems(exam, 'english.A.Q1a');
    const want = items.map((q) => (/^[a-d]\)/.test(q.answer) ? q.answer[0] : letterOfText(q, ['a', 'b', 'c', 'd'])));
    expect(want.slice(0, 2)).toEqual(['b', 'c']);
    expect(got).toEqual(want);
  });

  it('Urdu: «بکری» and «بارش» are not read as the letter ب', () => {
    const exam = laid('r5-mcq-textkeys-ur', 'urdu');
    const got = stripLetters(schemeOf(exam, 'urdu'), 'urdu.A.Q1');
    const items = liveItems(exam, 'urdu.A.Q1');
    const L = ['الف', 'ب', 'ج', 'د'];
    const want = items.map((q) => {
      const m = /^(الف|ب|ج|د)\)/.exec(q.answer);
      return m ? m[1] : letterOfText(q, L);
    });
    expect(want.every(Boolean)).toBe(true);
    expect(got).toEqual(want);
  });
});

describe('C. slot prompt rules (data level: the prompt builder is not on this base)', () => {
  const slotOf = (subject, id) => Patterns.subjectOf('fde_g5_2027', subject).sections.flatMap((s) => s.slots).find((s) => s.slot === id);

  it('science Q2(b): each sub-question is an object with its own answer and a 2.5-mark scheme, unlettered', () => {
    const rule = slotOf('science', 'science.B.Q2b').prompt_rule;
    expect(rule).toMatch(/\{question, answer, scheme: \{points, accept, common_error\}\}/);
    expect(rule).toMatch(/points add up to 2\.5/);
    expect(rule).toMatch(/no letter/i);
    expect(rule).not.toMatch(/three sub-questions a, b, c/);
  });

  it.each([['english', 'english.B.Q2'], ['urdu', 'urdu.B.Q2']])('%s Q2 asks for two spare pick words of each kind, copied as written', (subject, id) => {
    const slot = slotOf(subject, id);
    const pick = slot.parts_spec.find((p) => p.pick).pick;
    for (const [kind, need] of Object.entries(pick)) {
      expect({ kind, asks: slot.prompt_rule.includes(`"${kind}":[${need + 2}`) }).toEqual({ kind, asks: true });
    }
    expect(slot.prompt_rule).toMatch(/exactly as written in the (passage|paragraph), inflection included/);
  });

  it('english Q2(ii) never points at an underlined, bold or italic word', () => {
    const rule = slotOf('english', 'english.B.Q2').prompt_rule;
    expect(rule).toMatch(/never refer to an underlined, bold or italic word; quote the word/i);
  });
});

describe('D. the SST map frame book page stays unset until the book confirms it', () => {
  it('social_studies.A.Q2 frame.book_page is null', () => {
    const slot = Patterns.subjectOf('fde_g5_2027', 'social_studies').sections.flatMap((s) => s.slots).find((s) => s.slot === 'social_studies.A.Q2');
    expect(slot.frame.book_page).toBeNull();
  });
});

describe('B. a partial scope names the subject\'s own unit word', () => {
  const covers = (subject, chapters) => applyLayout({ unseen: {} }, P.subjects[subject], { kind: 'chapters', chapters }, { now: NOW }).examJson._layout.scope;
  it.each([
    ['science', 'Covers Chapters 3–4; every section set from these chapters.', 'Covers Chapter 3; every section set from this chapter.'],
    ['social_studies', 'Covers Chapters 3–4; every section set from these chapters.', 'Covers Chapter 3; every section set from this chapter.'],
    ['urdu', 'Covers Lessons 3–4; every section set from these lessons.', 'Covers Lesson 3; every section set from this lesson.'],
    ['english', 'Covers Units 3–4; every section set from these units.', 'Covers Unit 3; every section set from this unit.'],
    ['maths', 'Covers Units 3–4; every section set from these units.', 'Covers Unit 3; every section set from this unit.'],
  ])('%s', (subject, many, one) => {
    expect(covers(subject, [3, 4]).covers_en).toBe(many);
    expect(covers(subject, [3]).covers_en).toBe(one);
  });
  it('Urdu says اسباق for lessons and keeps the singular for one', () => {
    expect(covers('urdu', [3, 4]).covers_ur).toBe('احاطہ: اسباق 3–4؛ ہر حصہ انہی اسباق سے۔');
    expect(covers('urdu', [3]).covers_ur).toBe('احاطہ: سبق 3؛ ہر حصہ اسی سبق سے۔');
    expect(covers('science', [3]).covers_ur).toBe('احاطہ: باب 3؛ ہر حصہ اسی باب سے۔');
  });
});
