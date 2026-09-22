/**
 * bd-yjmxh -- THE PHASE HEADING NEVER SAYS WHICH MOVE IT IS.
 *
 * OPERATOR, verbatim: *"In teacher Models Section - It should have an I Do tag on the
 * right for clarity"*.
 *
 * `worked_example` prints one pill and that pill carries the block's TITLE -- "Teacher
 * models", "Worked example", whatever the author wrote. None of those words is the name
 * of the move. A teacher scanning a crowded primary page can see that a box is a box and
 * that it is amber, but nothing on the page says *I am the one holding the pen here*.
 * The gradual-release ladder is the spine of the lesson and it was printed nowhere.
 *
 * The infrastructure to say it has existed since bd-hlk39 -- `bar()` takes a `move` and
 * emits a `.mv` pill -- but it is fed from `section.move`, which NO document in the
 * corpus authors. That is why the feedback keeps coming back: the feature shipped and
 * then printed nothing. So the move is DERIVED, from the one thing every document
 * already carries: the block id. `i-do` / `worked` are I DO, `we-do` is WE DO,
 * `you-do` / `you-do-task` are YOU DO, and every other id -- `hook`, `big-idea`,
 * `halfway`, `board-plan`, `keywords`, `remember`, `hw` -- carries no move and must
 * render exactly as it did.
 *
 * THE COLOUR BELONGS TO THE MOVE, NOT THE SUBJECT (decided, bd-f6opy, and re-confirmed
 * when the operator rejected a per-subject hue). So the pill reuses the three fills that
 * pass already costed -- I DO `--amber`, WE DO `--band-we`, YOU DO `--leaf` -- and
 * invents no token. `--cool`, `--plum` and `--clay` do not exist; a `var(--cool,#hex)`
 * literal makes lint_lp fail the whole document as a placeholder.
 *
 * "ON THE RIGHT" IS A READING EDGE, NOT A SIDE. In Urdu the line starts on the right, so
 * the end of the heading is the LEFT, and the pill floats there. The Urdu label is real
 * Urdu, parallel in register to the two strings the overlay already ships
 * (`مل کر کریں` / `خود کریں`), and the rule declares NO line-height at all -- a px
 * leading on Nastaliq clips the descenders (render law R6).
 *
 * PRIMARY ONLY, like every move surface before it (bd-f6opy §6, bd-u9vji). The grade 9
 * control is here to prove a G6-12 plan gains nothing.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));
// bd-yjmxh -- the labels are DATA (rule 20): they live in BOTH overlay language blocks and are
// read from there, never spelled out here. A literal in a test is how en and ur drift apart.
const { LABELS } = require(path.join(VENDOR, 'lib', 'overlay'));
const EN = [LABELS.en.iDo, LABELS.en.weDo, LABELS.en.youDo];

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** The same fixture re-provenanced to grade 4 -- the one thing `isPrimary` reads. */
function doc(extra) {
  const d = baseDoc();
  d.provenance = { ...d.provenance, grade: 4, subject: 'English', ...(extra || {}) };
  return d;
}

const built = (d, lang) => buildHtml(d, { docDir: path.dirname(FIXTURE), lang: lang || 'en' });
const body = (d, lang) => built(d, lang).html.split('</style>').pop();
const sheet = (d, lang) => {
  const h = built(d, lang).html;
  return h.slice(0, h.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
};
/** One CSS rule's declaration block, by exact selector. */
const rule = (css, sel) => {
  const m = css.match(new RegExp(`(?:^|[},])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};
/** Every move tag on the page, in print order, as [move class, printed label]. */
const tags = (h) => [...h.matchAll(/<span class="mvt([^"]*)">([^<]*)<\/span>/g)]
  .map((m) => [m[1].trim(), m[2].trim()]);

afterEach(() => setPageFormat('phone'));

/* ------------------------------------------------- 1. the move is named, and derived */

describe('every gradual-release block names its move', () => {
  test('the teacher-models block prints an I DO tag', () => {
    expect(tags(body(doc()))).toContainEqual(['', LABELS.en.iDo]);
  });

  test('all three moves print, in ladder order, each in its own class', () => {
    expect(tags(body(doc()))).toEqual([['', EN[0]], ['we', EN[1]], ['you', EN[2]]]);
  });

  test('the move is read off the block id, not the block type or the subject', () => {
    const d = doc({ subject: 'Urdu' });
    d.sections.find((s) => s.id === 'development').blocks.find((b) => b.id === 'ido').id = 'i-do';
    d.sections.find((s) => s.id === 'activity').blocks.find((b) => b.id === 'youdo').id = 'you-do-task';
    expect(tags(body(d)).map(([, t]) => t)).toEqual(EN);
  });

  test('a block with no move in its id prints no tag at all', () => {
    const d = doc();
    for (const s of d.sections) for (const b of s.blocks || []) b.id = 'remember';
    expect(tags(body(d))).toEqual([]);
  });

  test('the title the block already carried still prints, beside the move', () => {
    expect(body(doc())).toContain('I do — p.24, worked example 1');
  });
});

/* --------------------------------------------------------- 2. the paint, and only it */

describe('the tag is painted by the move, out of the tokens that exist', () => {
  const CSS = sheet(doc());

  test('each move reuses the fill bd-f6opy already costed for it', () => {
    expect(rule(CSS, '.mvt')).toMatch(/background:\s*var\(--amber\)/);
    expect(rule(CSS, '.mvt.we')).toMatch(/background:\s*var\(--band-we\)/);
    expect(rule(CSS, '.mvt.you')).toMatch(/background:\s*var\(--leaf\)/);
  });

  test('it invents no token and writes no raw hex a lint would call a placeholder', () => {
    const own = ['.mvt', '.mvt.we', '.mvt.you'].map((s) => rule(CSS, s)).join(';');
    expect(own).not.toMatch(/--(?:cool|plum|clay)\b/);
    expect(own).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });

  test('amber carries navy ink, so the one light fill is still readable', () => {
    expect(rule(CSS, '.mvt')).toMatch(/color:\s*var\(--navy\)/);
  });
});

/* ------------------------------------------------- 3. "on the right" is a reading edge */

describe('the tag sits at the end of the heading, in both directions', () => {
  test('English floats it right', () => {
    expect(rule(sheet(doc()), '.mvt')).toMatch(/float:\s*right/);
  });

  test('Urdu mirrors it to the left, which is where an RTL line ends', () => {
    expect(rule(sheet(doc(), 'ur'), '.mvt')).toMatch(/float:\s*left/);
  });

  test('it never declares a leading, so Nastaliq keeps its descenders (R6)', () => {
    expect(rule(sheet(doc(), 'ur'), '.mvt')).not.toMatch(/line-height/);
  });
});

/* ------------------------------------------------------------- 4. the Urdu vocabulary */

describe('the move has a name in Urdu too', () => {
  test('all three print in real Urdu, not a transliteration and not English', () => {
    expect(tags(body(doc(), 'ur')).map(([, t]) => t))
      .toEqual(['کر کے دکھائیں',
                'مل کر کریں',
                'خود کریں']);
  });
});

/* ------------------------------------------------------------- 5. the G6-12 control */

describe('a G6-12 plan gains nothing', () => {
  test('no move tag is printed and no rule exists to paint one', () => {
    expect(tags(body(baseDoc()))).toEqual([]);
    expect(/<html[^>]*\bclass="[^"]*\bpri\b/.test(built(baseDoc()).html)).toBe(false);
  });
});
