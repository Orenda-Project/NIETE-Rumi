/**
 * bd-yjmxh — THE BOARD IS DRAWN AS A BOARD, AND A PRACTICE ITEM IS TWO ROWS.
 *
 * OPERATOR: *"the write on the board should be rendered, it cant be in html? heading colour anf
 * formatting should be differenyt / its a block of text that should show clearly how it should be
 * ordered rather than give a script of what to draw and how / the practice sectionbs are too texty,
 * how can we render appropriately on html?"*
 *
 * "it cant be in html?" turned out to be a bug report, not a capability question. `boardWork.content`
 * is authored AS A BOARD -- blank-line groups, each with its own heading, in the order they go up --
 * and it arrived in `board.text` as one string. HTML collapses `\n` to a space, so 38 authored boards
 * printed as 38 run-on paragraphs. Nothing was ever missing: the newlines WERE the layout.
 *
 * So `board` gained an optional `panels`, and this suite pins the three things that answer her:
 *
 *   1. ORDER IS VISIBLE. Each panel prints in authored order behind a numbered chip, so the
 *      sequence is a thing she can see rather than a thing she has to reconstruct from prose.
 *   2. THE FORMATTING IS DIFFERENT, on purpose. `.board` is the one block deliberately OFF the
 *      surface ladder (SYNC §3.16): every other block is a tint with a hairline, and this one is a
 *      white sheet inside a 2px navy frame, because it is the only block describing a physical
 *      object in the room. Its label is the kie.ai gold, which measures 1.45:1 on white and so
 *      CANNOT be bare text -- it sits on a filled navy bar at 8.16:1. That constraint is also what
 *      makes it visibly unlike its neighbours, which is what she asked for.
 *   3. THE SCRIPT STOPS PRINTING. `page2.board_final.draw_order` narrates a board; a panelled board
 *      IS one, printed centimetres above it in the same section. Two accounts of one board, one of
 *      them prose, is the wall she was reading.
 *
 * WHAT MUST NOT CHANGE: G6-12 is untouched. The fixture is a G6-12 document -- `text`-only boards and
 * an authored `draw_order` -- and the first block of tests asserts it renders exactly as it did. The
 * drop in (3) is keyed on `panels` being present, not on a grade, so an authored draw order survives
 * for every document that has no laid-out board to replace it.
 *
 * PRACTICE: the item was `q` and `a` on one flowing line joined by an arrow. Measured on the corpus,
 * 93 of 306 problems also open with a citation glued to the front of the question ("p.104, Pinky's
 * Poem Puzzlers 1: Which dance..."), which pushed the question itself onto a second line. The
 * citation now rides in `ref`, which the schema already defined, and the answer is its own labelled
 * row -- so the eye finds the question, then the answer, instead of one string containing both.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const build = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;

/** The emitted sheet, comments and font payloads stripped — what a CSS parser sees. */
function sheet(d) {
  const out = build(d || doc());
  const open = out.indexOf('<style>');
  return out.slice(open + 7, out.lastIndexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/** The document body — never the sheet, so a selector name cannot satisfy a content assertion. */
const body = (d, lang) => build(d, lang).split('</style>').pop();

/** Replace every board in the flow with a laid-out one. */
function panelled(d) {
  const b = {
    type: 'board',
    id: 'board-plan',
    text: 'CHAPTER 9 REVIEW:\n\nsway = side to side\n\nTIME\n1 week = 7 days',
    title: 'Chapter 9 review',
    panels: [
      { rows: [{ term: 'sway', gloss: 'side to side' }] },
      { label: 'Time', rows: [{ text: 'Copy the table.' }, { term: '1 week', gloss: '7 days' }] },
    ],
  };
  d.sections[0].blocks = d.sections[0].blocks.map((x) => (x.type === 'board' ? b : x));
  d.sections[3].blocks = d.sections[3].blocks.filter((x) => x.type !== 'board');
  return d;
}

describe('a text-only board is exactly what it was', () => {
  test('it still prints its one string, and the authored draw order still prints with it', () => {
    const html = body(doc());
    expect(html).toContain('the inner pair matches, so the product is defined');
    expect(html).toContain(LABELS.en.drawOrder);
    expect(html).toContain('Circle the inner pair and write');
    // No panel markup exists to be emitted for it.
    expect(html).not.toContain('class="bp"');
  });
});

describe('a panelled board shows the order it goes up in', () => {
  test('every authored panel prints, behind its own number, in authored order', () => {
    const html = body(panelled(doc()));
    const chips = [...html.matchAll(/<span class="bn">(\d+)<\/span>/g)].map((m) => m[1]);
    expect(chips).toEqual(['1', '2']);
    expect(html.indexOf('side to side')).toBeLessThan(html.indexOf('Copy the table.'));
  });

  test('the chip counts panels, not rows — it is a place in the build, not a question number', () => {
    // Panel 2 holds two rows and is still panel 2.
    const html = body(panelled(doc()));
    expect(html.match(/class="bn"/g)).toHaveLength(2);
  });

  test('a panel heading and the board title are printed, and are not panels themselves', () => {
    const html = body(panelled(doc()));
    expect(html).toContain('<div class="btitle">Chapter 9 review</div>');
    expect(html).toContain('>Time</div>');
    expect(html.indexOf('Chapter 9 review')).toBeLessThan(html.indexOf('class="bn"'));
  });

  test('a term and its gloss land in the two columns; a bare line spans both', () => {
    const html = body(panelled(doc()));
    expect(html).toContain('<span class="bk">sway</span><span class="bg">side to side</span>');
    expect(html).toContain('<span class="bx">Copy the table.</span>');
  });

  test('nothing is dropped: the words of `text` all survive into the panels', () => {
    const html = body(panelled(doc()));
    for (const w of ['sway', 'side to side', '1 week', '7 days', 'Time']) {
      expect(html).toContain(w);
    }
  });

  test('`text` is the fallback for a board the parse could not panel', () => {
    const d = panelled(doc());
    d.sections[0].blocks.forEach((b) => { if (b.type === 'board') delete b.panels; });
    expect(body(d)).toContain('CHAPTER 9 REVIEW');
  });
});

/**
 * bd-i44jn. THE LINE BETWEEN TWO BOARDS IS A CONNECTOR, NOT A ROW OF EITHER.
 *
 * Operator, on the G4 English Ch.9 Day 6 render: *"Write on the board sould be concise and
 * pointed"*. The author of that lesson drew two finished boxes with an arrow between them --
 * "APPLY THE CLUE" -- and the parse, which grouped on blank lines alone, made all of it one
 * panel of 15 rows. d0_board now opens a new panel where a box closes before another opens,
 * and hands the line in the gap through as `connector`.
 *
 * It prints BETWEEN the two numbered panels because that is where the teacher chalks it. As a
 * row it read as something to write inside the second board, which is the opposite of the
 * relationship the author drew. `connector` is additive: a board without one is byte-for-byte
 * what it was, and G6-12 emits none.
 */
describe('a connector joins two boards without becoming either one', () => {
  const joined = (d) => {
    const b = d.sections[0].blocks.find((x) => x.type === 'board');
    b.panels[1].connector = '\u2192 APPLY THE CLUE \u2192';
    return d;
  };

  test('it prints once, between the panel it leaves and the panel it leads into', () => {
    const html = body(joined(panelled(doc())));
    expect(html.match(/class="bcon"/g)).toHaveLength(1);
    expect(html).toContain('APPLY THE CLUE');
    expect(html.indexOf('side to side')).toBeLessThan(html.indexOf('bcon'));
    expect(html.indexOf('bcon')).toBeLessThan(html.indexOf('Copy the table.'));
  });

  test('it is not a row and does not take a panel number of its own', () => {
    const html = body(joined(panelled(doc())));
    expect(html.match(/class="bn"/g)).toHaveLength(2);
    expect(html).not.toContain('<span class="bx">\u2192 APPLY THE CLUE');
  });

  test('a board with no connector is exactly the board it was', () => {
    expect(body(panelled(doc()))).not.toContain('bcon');
  });

  test('the connector is styled as a joint, not as board content', () => {
    const css = sheet(panelled(doc()));
    expect(css).toMatch(/\.board \.bcon\{[^}]*text-align:center/);
    expect(css).toMatch(/\.board \.bcon\{[^}]*font-weight:800/);
  });
});

describe('the board-plan SCRIPT gives way to the board itself', () => {
  test('a laid-out board suppresses `board_final.draw_order`', () => {
    const html = body(panelled(doc()));
    expect(html).not.toContain(LABELS.en.drawOrder);
    expect(html).not.toContain('Circle the inner pair and write');
  });

  test('the drop is keyed on `panels`, not on the grade or the profile', () => {
    // Same document, panels removed: the authored order comes straight back.
    const d = panelled(doc());
    d.sections[0].blocks.forEach((b) => { if (b.type === 'board') delete b.panels; });
    expect(body(d)).toContain(LABELS.en.drawOrder);
  });

  test('an empty `panels` array is not a laid-out board', () => {
    const d = panelled(doc());
    d.sections[0].blocks.forEach((b) => { if (b.type === 'board') b.panels = []; });
    expect(body(d)).toContain(LABELS.en.drawOrder);
  });
});

describe('the board is formatted unlike anything next to it', () => {
  test('it is a white sheet in a navy frame, not a tint with a hairline', () => {
    const css = sheet();
    expect(css).toMatch(/\.board\{[^}]*background:#fff/);
    expect(css).toMatch(/\.board\{[^}]*border:2px solid var\(--navy\)/);
  });

  test('the label is gold ON navy — never gold on white, which measures 1.45:1', () => {
    const css = sheet();
    const lbl = css.match(/\.board \.lbl\{([^}]*)\}/);
    expect(lbl).not.toBeNull();
    expect(lbl[1]).toContain('color:var(--board-gold)');
    expect(lbl[1]).toContain('background:var(--navy)');
    expect(css).toMatch(/--board-gold:\s*#FFD05E/i);
  });

  test('NEITHER TRACK MAY EXCEED THE PANEL — a clipped board column is a lost one (bd-59vvo)', () => {
    // `max-content 1fr` sizes the term column to the LONGEST term and refuses to shrink, and a
    // bare `1fr` floors at the gloss's own min-content. Ten G4 Ch9 boards whose terms are whole
    // sentences ("Jojo _____ to eat pizza on Fridays.") therefore laid out wider than the sheet
    // and printed the entire gloss column off the right edge. This is the one block the teacher
    // copies onto a real board, so a column that runs off the page is a column she never gets.
    const css = sheet();
    const bb = css.match(/\.board \.bb\{([^}]*)\}/);
    expect(bb).not.toBeNull();
    expect(bb[1]).toContain('grid-template-columns:fit-content(50%) minmax(0,1fr)');
    expect(bb[1]).not.toMatch(/max-content/);
    expect(css).toMatch(/\.board \.bp\{[^}]*grid-template-columns:18px minmax\(0,1fr\)/);
  });

  test('the heading says WRITE on the board — an instruction, in both languages', () => {
    expect(LABELS.en.board).toBe('Write on the board');
    expect(LABELS.ur.board).toContain('لکھیے');
    expect(body(panelled(doc()), 'ur')).toContain(LABELS.ur.board);
  });
});

describe('a practice item is a question row and an answer row', () => {
  test('the answer sits on its own labelled row, not glued to the question', () => {
    const html = body(doc());
    expect(html).toContain(`<span class="al">${LABELS.en.answer}</span>`);
    expect(html).toMatch(/<div class="arow"><span class="al">/);
    // `.ar` is the Arabic-script line-height rule (template.js:378); the answer row must
    // not squat on it — the nastaliq suite asserts a non-Urdu sheet emits no `.ar{`.
    expect(sheet()).not.toMatch(/(^|\s)\.ar\{/m);
    // The question closes its own row before the answer opens one.
    expect(html).toMatch(/<\/div>\s*<div class="arow">/);
  });

  test('the citation is a chip beside the question, not the first words of it', () => {
    const d = doc();
    const pr = d.sections[2].blocks.find((b) => b.type === 'practice');
    pr.items[0].ref = 'p.104, Poem Puzzlers 1';
    pr.items[0].q = 'Which dance is matched with the word?';
    const html = body(d);
    expect(html).toContain('<span class="ref">p.104, Poem Puzzlers 1</span>');
    expect(html).toMatch(/<span class="q">Which dance is matched/);
  });

  test('the answer row is indented behind a rule on the reading edge, in both scripts', () => {
    // `start` resolves per language, so the rule follows the text rather than the page.
    const rule = (lang, edge) => {
      const out = build(doc(), lang);
      const css = out.slice(out.indexOf('<style>') + 7, out.lastIndexOf('</style>'))
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const ar = css.match(/\.pr \.arow\{([^}]*)\}/);
      expect(ar).not.toBeNull();
      expect(ar[1]).toContain(`border-${edge}:2px solid`);
      expect(ar[1]).toContain(`margin-${edge}:25px`);
    };
    rule('en', 'left');
    rule('ur', 'right');
  });
});
