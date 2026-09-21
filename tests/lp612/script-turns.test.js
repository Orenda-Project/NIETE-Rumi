/**
 * bd-rv2pk — THE TEACHER'S SCRIPT IS A COLUMN OF TURNS, NOT A PARAGRAPH.
 *
 * OPERATOR: *"how can we further reduce the text dump? be creative and volley design based
 * questions for lps that can be rendered on html"* — and, asked to choose, she took a
 * **two-column call-and-response**, answers **always visible in both views**, **"keep the quote,
 * chip the action"**, and **one continuous plan** with the primary teach cap raised 4 -> 9.
 *
 * So the reduction here is SCAN COST, not word count. Nothing is hidden, collapsed behind a
 * `<details>`, moved to the support sheet or deleted. Measured over the 38-lesson G4 Ch9 corpus, a
 * move's script printed as 228 paragraphs of a median 10 sentences; the same words parse to 1,203
 * turns (d0_script.py), of which 954 reach this renderer — a turn is a row and no word is dropped.
 *
 * WHAT THE CORPUS THEN SAID ABOUT THE SECOND COLUMN: 8 of those 1,203 turns — 7 of the 954 that
 * render, 0.73% — carry an answer the script actually supplies. A reserved column would narrow
 * all 954 rows to serve seven, so the answer rides its own row at the READING EDGE and the heads
 * print only on a block that has one. An `ask` the script does not answer gets a ruled waiting
 * space — the plan does not know what this class will say, and a proxy there would be a lie in
 * the one place she is about to check a child against.
 *
 * WHAT MUST NOT CHANGE: G6-12. `turns` is the additive-field pattern proven by `board.panels`
 * (SYNC §3.16, §3.17) — optional, preferred by the renderer when present, with the flat `steps`
 * strings left as the home the lint profile, Stage E's voicenotes and the WhatsApp body already
 * address. The fixture is a G6-12 document and carries no `turns`, so the first block below is the
 * control: it takes the fallback branch and renders exactly as it did.
 */

const fs = require('fs');
const path = require('path');

const { buildHtml } = require('../../bot/vendor/lp-v9/lib/template');
const { LABELS } = require('../../bot/vendor/lp-v9/lib/overlay');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const doc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const build = (d, lang = 'en') => buildHtml(d, { lang, docDir: path.dirname(FIXTURE) }).html;

/** The emitted sheet, comments and font payloads stripped — what a CSS parser sees. */
function sheet(d, lang = 'en') {
  const out = build(d || doc(), lang);
  return out.slice(out.indexOf('<style>') + 7, out.lastIndexOf('</style>'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/url\(data:[^)]*\)/g, 'url(data:)');
}

/** The document body — never the sheet, so a selector name cannot satisfy a content assertion. */
const body = (d, lang) => build(d, lang).split('</style>').pop();
/** The I-Do block, scripted. `steps` stays exactly as authored: it is the fallback, not a draft. */
const TURNS = [
  { kind: 'do', text: 'Build one class time-capsule plan from the exact sequence.', ref: 'p.180' },
  { kind: 'say', text: 'Let us create the class project plan together from the page.' },
  { kind: 'routine', name: 'CUBES',
    parts: ['Circle: 2023 and 5.', 'Underline: what year would our capsule open?',
            'Solve together — what is 2023 plus 5?'],
    expect: ['2028'] },
  { kind: 'calc', text: 'We write 2023 + 5 = 2028 on the board.' },
  { kind: 'frame', text: 'My starting year is ___ and it opens in ___.' },
  { kind: 'ask', text: '5 years is the same as how many months?', expect: ['60'] },
  { kind: 'ask', text: 'Where do YOU see something that comes back after a number of years?' },
];

function scripted(d, turns = TURNS) {
  for (const s of d.sections) {
    for (const b of s.blocks) {
      if (b.type === 'worked_example' || b.type === 'faded_example') b.turns = turns;
    }
  }
  return d;
}

const rows = (h) => [...h.matchAll(/<div class="tn (k-\w+)">/g)].map((m) => m[1]);

/** The FIRST scripted block. `scripted()` scripts both moves, so a per-block count has to say
 *  which block it counts or it silently asserts twice the number it means. A long script is now
 *  split across sibling pieces (bd-ilzfs), so the I-DO's script is every `.scr` up to the WE-DO
 *  card -- one box or five, the turns counted here are still that one block's. */
const OPEN = '<div class="scr">';
const firstScript = (h) => {
  const from = h.indexOf(OPEN) + OPEN.length;
  const to = h.indexOf('class="blk exq we', from);
  return h.slice(from, to === -1 ? h.length : to);
};

// ── the control ─────────────────────────────────────────────────────────────

describe('a document with no `turns` renders exactly as it did', () => {
  test('the G6-12 fixture still prints its steps as an ordered list', () => {
    const html = body(doc());
    expect(html).toContain('the product is defined');
    expect(html).toContain('Row 1 with column 2: you fill this in.');
    expect(html).not.toContain('class="scr"');
    expect(html).not.toContain('class="tn ');
  });

  test('the heads never print for it, so no block claims a response it has none of', () => {
    const html = body(doc());
    expect(html).not.toContain(LABELS.en.classSays);
  });

  test('an EMPTY `turns` is not a script — it falls back, it does not print a blank column', () => {
    const html = body(scripted(doc(), []));
    expect(html).not.toContain('class="scr"');
    expect(html).toContain('the product is defined');
  });
});

// ── one row per turn ────────────────────────────────────────────────────────

describe('the script becomes one row per turn', () => {
  test('every turn is a row, in authored order, and each carries its own kind', () => {
    const html = body(scripted(doc()));
    expect(rows(html).slice(0, 7)).toEqual(
      ['k-do', 'k-say', 'k-routine', 'k-calc', 'k-frame', 'k-ask', 'k-ask']);
  });

  test('the kind classes are `k-` prefixed, because three of the six are already v9 blocks', () => {
    // `.say` is the blue say-aloud box — 4px rule, 13px padding. An unprefixed kind would have
    // put every line of speech inside one.
    const css = sheet();
    expect(css).toMatch(/\.say\{[^}]*padding:7px 13px/);
    expect(css).toContain('.tn.k-say');
    expect(body(scripted(doc()))).not.toMatch(/<div class="tn say">/);
  });

  test('the flat `steps` do not ALSO print — stored twice, printed once', () => {
    // ONE HOME PER SOURCE FIELD is about the page, not the JSON. `steps` stays in the document
    // for lint, Stage E's voicenotes and the WhatsApp body; only `turns` reaches paper.
    const d = scripted(doc());
    const html = body(d);
    expect(html).toContain('Let us create the class project plan');
    expect(html).not.toContain('Row 1 with column 2: you fill this in.');
    const ido = d.sections[1].blocks.find((b) => b.id === 'ido');
    expect(ido.steps.length).toBeGreaterThan(0);
  });

  test('no word of a turn is lost on the way to the page', () => {
    const html = body(scripted(doc()));
    for (const t of TURNS) {
      for (const s of [t.text, ...(t.parts || []), ...(t.expect || [])].filter(Boolean)) {
        expect(html).toContain(s.replace(/&/g, '&amp;'));
      }
    }
  });
});

// ── the marks ───────────────────────────────────────────────────────────────

describe('only the exceptions are marked', () => {
  test('speech carries its quote marks in CSS, never in the string', () => {
    // 682 of the 954 rendered turns are speech. The marks make a row read as her words, but in
    // the string they would ride into the voicenote and the WhatsApp body, which want the
    // sentence and not its punctuation furniture.
    const css = sheet();
    expect(css).toMatch(/\.tn\.k-say \.tx::before\{[^}]*content:"[“‘]"/);
    expect(css).toMatch(/\.tn\.k-say \.tx::after\{[^}]*content:"[”’]"/);
    const html = body(scripted(doc()));
    expect(html).toContain('<span class="tx">Let us create the class project plan together from the page.</span>');
  });

  test('Urdu takes its own quote pair, because that is what its source carries', () => {
    const css = sheet(scripted(doc()), 'ur');
    expect(css).toMatch(/\.tn\.k-say \.tx::before\{[^}]*content:"‘"/);
    expect(css).toMatch(/\.tn\.k-say \.tx::after\{[^}]*content:"’"/);
  });

  test('the action is a stage direction: a caret and do-green ink, and no quotes', () => {
    // Over the 114 steps carrying both, a median 33% of an action's content words appear in
    // its `say` and 1 of 114 reaches 70%. It is a stage direction, not a restatement, so it
    // keeps every word and the renderer marks it by ROLE instead of chipping it to a verb.
    const css = sheet();
    expect(css).toMatch(/\.tn\.k-do\{[^}]*color:var\(--s-do-ink\)/);
    expect(css).toMatch(/\.tn\.k-do \.tx::before\{[^}]*content:"[▸◂]/);
  });

  test('a question is ruled on the reading edge, and the rule follows the script', () => {
    for (const [lang, edge] of [['en', 'left'], ['ur', 'right']]) {
      const ask = sheet(scripted(doc()), lang).match(/\.tn\.k-ask\{([^}]*)\}/);
      expect(ask).not.toBeNull();
      expect(ask[1]).toContain(`border-${edge}:2px solid var(--s-teach-line)`);
      expect(ask[1]).toContain(`padding-${edge}:7px`);
    }
  });

  test('a frame is the card she holds up, dashed because the blank is the point', () => {
    const css = sheet();
    expect(css).toMatch(/\.tn\.k-frame\{[^}]*border:1px dashed/);
    expect(body(scripted(doc()))).toContain('My starting year is ___ and it opens in ___.');
  });

  test('a sum gets tabular digits, so the numbers line up down the column', () => {
    expect(sheet()).toMatch(/\.tn\.k-calc\{[^}]*font-variant-numeric:tabular-nums/);
  });

  test('the ladder is respected: the marks move fill, line and case only', () => {
    // v9.4's rule. A new size or family would put the script on a type scale of its own.
    const css = sheet();
    for (const k of ['do', 'ask', 'frame', 'calc', 'routine']) {
      const rule = css.match(new RegExp(`\\.tn\\.k-${k}\\{([^}]*)\\}`));
      if (rule) expect(rule[1]).not.toMatch(/font-family|font-size/);
    }
    // And no `.ar`-prefixed class: `.ar` is the bare Arabic-script line-height rule at
    // template.js:378, and the nastaliq suite asserts a non-Urdu sheet emits no `.ar{`.
    expect(css).not.toMatch(/(^|\s)\.ar\{/m);
  });
});

// ── the routine ─────────────────────────────────────────────────────────────

describe('a named procedure stays one turn', () => {
  test('its steps are one box with one name, not four unrelated rows', () => {
    // CUBES's steps are re-narrated 13 times over the corpus. Letting the mark in "Underline:
    // what year would our capsule open?" claim a row splits one procedure she already knows.
    const html = body(scripted(doc()));
    expect(rows(firstScript(html)).filter((k) => k === 'k-routine')).toHaveLength(1);
    expect(html).toContain('<span class="rn">CUBES</span>');
    const ol = html.match(/<ol class="rs">([\s\S]*?)<\/ol>/);
    expect(ol).not.toBeNull();
    expect(ol[1].match(/<li>/g)).toHaveLength(3);
  });

  test('a nameless routine prints its parts and invents no heading', () => {
    const html = body(scripted(doc(), [{ kind: 'routine', parts: ['Circle the number.'] }]));
    expect(html).toContain('Circle the number.');
    expect(html).not.toContain('class="rn"');
  });
});

// ── the response ────────────────────────────────────────────────────────────

describe('the response is on the row, not in a column', () => {
  test('the heads print once, and only on a block whose script supplies an answer', () => {
    const html = body(scripted(doc()));
    expect(html).toContain(LABELS.en.teacher);
    expect(html).toContain(LABELS.en.classSays);
    expect(html.match(/<div class="tn hd">/g)).toHaveLength(2);   // i-do and we-do
  });

  test('a script that answers nothing gets no heads at all', () => {
    const html = body(scripted(doc(), [{ kind: 'say', text: 'Read the title with me.' }]));
    expect(html).toContain('class="scr"');
    expect(html).not.toContain(LABELS.en.classSays);
  });

  test('a supplied answer is a pill at the reading edge, under its own turn', () => {
    const html = body(scripted(doc()));
    expect(html).toContain('<div class="rp"><span class="pl">60</span></div>');
    expect(html).toContain('<span class="pl">2028</span>');
    for (const [lang, edge] of [['en', 'right'], ['ur', 'left']]) {
      const rp = sheet(scripted(doc()), lang).match(/\.tn \.rp\{([^}]*)\}/);
      expect(rp[1]).toContain(`text-align:${edge}`);
    }
  });

  test('an unanswered ASK gets a RULED SPACE, never an invented answer', () => {
    const html = body(scripted(doc()));
    // The last turn asks and supplies nothing. It gets somewhere to write, not a guess.
    expect(html).toMatch(/comes back after a number of years\?<\/span><div class="rp"><span class="wait"><\/span><\/div>/);
    expect(sheet()).toMatch(/\.tn \.wait\{[^}]*border-bottom:1px dashed/);
  });

  test('only an ASK waits — a statement with no answer gets no empty slot', () => {
    const html = body(scripted(doc(), [{ kind: 'say', text: 'Read the title with me.' }]));
    expect(html).not.toContain('class="wait"');
    expect(html).not.toContain('class="rp"');
  });

  test('there is no reserved answer column anywhere in the sheet', () => {
    const css = sheet();
    expect(css).not.toMatch(/\.scr\{[^}]*grid-template-columns/);
    expect(css).toMatch(/\.scr\{[^}]*flex-direction:column/);
  });
});

// ── the page citation ───────────────────────────────────────────────────────

describe('a trailing page citation is a chip, not the first words of the row', () => {
  test('it floats to the reading edge beside its turn', () => {
    expect(body(scripted(doc()))).toContain('<span class="pref">p.180</span>');
    for (const [lang, edge] of [['en', 'right'], ['ur', 'left']]) {
      expect(sheet(scripted(doc()), lang)).toMatch(
        new RegExp(`\\.tn \\.pref\\{[^}]*float:${edge}`));
    }
  });

  test('a turn with no ref emits no chip', () => {
    expect(body(scripted(doc(), [{ kind: 'say', text: 'Read the title.' }])))
      .not.toContain('class="pref"');
  });
});

describe('both languages name the two edges', () => {
  test('the labels exist in en and ur, and the Urdu render uses them', () => {
    expect(LABELS.en.teacher).toBe('Teacher');
    expect(LABELS.en.classSays).toBe('Class says');
    expect(LABELS.ur.teacher).toBeTruthy();
    expect(LABELS.ur.classSays).toBeTruthy();
    const html = body(scripted(doc()), 'ur');
    expect(html).toContain(LABELS.ur.classSays);
  });

  test('the turn text takes its own direction under RTL, like every other prose run', () => {
    // A row is a span, so it is not covered by the bare `li`/`p` selector the mixed-script
    // rule uses. An English sentence inside an Urdu plan must still lay out LTR.
    expect(sheet(scripted(doc()), 'ur')).toMatch(/\.tn \.tx, \.tn \.pl, \.tn \.rn,/);
  });
});
