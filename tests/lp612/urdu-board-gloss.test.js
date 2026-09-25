/**
 * THE BOARD BLOCK ON AN URDU PLAN KEEPS ITS ENGLISH, AND GAINS ONE URDU LINE — bd-oak77.42.
 *
 * Operator decision: in an Urdu render of an ENGLISH-medium book the `board` block — what the
 * teacher leaves written on the board, kept in the exam's language on purpose (`frozenReason` in
 * lib/overlay.js, and `overlayTargets` in lint_lp.js never offers its `text`) — still prints its
 * English byte for byte. Directly under it goes ONE Urdu line explaining it for the teacher.
 *
 * The line comes from the overlay, as a DERIVED pointer: `<board block pointer>/gloss`. The
 * English board text is offered to the overlay pass under that key, the original `text` stays
 * frozen. If the overlay lacks the line, the linter names the gap the way it names a missing
 * objective (OVERLAY_OBJECTIVES_MISSING, bd-oak77.40). English renders and Urdu-medium books do
 * not move.
 */

const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const FIXTURES = path.join(__dirname, '__fixtures__');
const RAW = JSON.stringify(require(path.join(FIXTURES, 'v9_gate_base.lp.json')));
const load = () => JSON.parse(RAW);

// The overlay pass's model call — the network boundary, never the service under test.
jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));
const { buildHtml } = require(path.join(V, 'lib', 'template.js'));
const { lint, overlayDefects } = require(path.join(V, 'lint_lp.js'));

// The fixture's two board blocks: introduction block 3 (with KaTeX) and conclusion block 0.
const BOARDS = ['/sections/0/blocks/3', '/sections/3/blocks/0'];
const GLOSS = BOARDS.map((p) => `${p}/gloss`);
const boardText = (d, p) => p.split('/').slice(1).reduce((o, k) => o[k], d).text;

const UR = 'یہ اردو ہدایت ہے جو اس سبق کے لیے لکھی گئی ہے۔';
const UR_GLOSS = ['تختے پر لکھی بات کا مطلب: ضرب سے پہلے ترتیب دیکھیں۔', 'قطار اور کالم کو جوڑا جوڑا ضرب دیں، پھر جمع کریں۔'];
const targets = (d) => overlayDefects.targets(d);
/** Every OTHER offered pointer translated — the gloss is what each test decides about. */
const bodyOverlay = (d) => Object.fromEntries(targets(d).filter((p) => !p.endsWith('/gloss')).map((p) => [p, UR]));
const withGloss = (d) => ({ ...bodyOverlay(d), [GLOSS[0]]: UR_GLOSS[0], [GLOSS[1]]: UR_GLOSS[1] });

const render = (d, lang) => {
  const { doc, errors } = applyOverlay(d, lang);
  return { errors, html: buildHtml(doc, { lang, docDir: FIXTURES }).html };
};

/** Each board block's English line, `.t`, as printed. */
// A block prints as a page atom: `<div data-atom class="blk board sp-2">`.
const BOARD_OPEN = '<div[^>]*class="blk board[^"]*"[^>]*>';
const boardLines = (html) => [...html.matchAll(new RegExp(`${BOARD_OPEN}[\\s\\S]*?<div class="t">([\\s\\S]*?)</div>`, 'g'))]
  .map((m) => m[1]);
/** What follows each board block's `.t`, up to the next block — where the gloss line must sit. */
const afterBoard = (html) => [...html.matchAll(new RegExp(
  `${BOARD_OPEN}[\\s\\S]*?<div class="t">[\\s\\S]*?</div>([\\s\\S]*?)(?=<div[^>]*class="(?:blk|bar)\\b|</section|<div class="page|$)`, 'g'))]
  .map((m) => m[1]);
const decode = (s) => s.replace(/&#x200F;|&#8207;|&rlm;/gi, '‏').replace(/&middot;|&#183;|&#xB7;/gi, '·');
const text = (s) => decode(s.replace(/<[^>]*>/g, '')).trim();

// ── (a) the Urdu render: English board text untouched, one Urdu line under it ────

describe('(a) an Urdu render of an English-medium book with the gloss in its overlay', () => {
  const d = load();
  d.ur_overlay = withGloss(d);
  const ur = render(d, 'ur');
  const en = render(d, 'en');

  test('the gloss pointers are accepted by the overlay — no OVERLAY_INVALID', () => {
    expect(ur.errors).toEqual([]);
  });

  test('each board block prints its English text byte-identical to the English render', () => {
    const got = boardLines(ur.html);
    expect(got).toHaveLength(2);
    expect(got).toEqual(boardLines(en.html));
    // ...and that is the author's English, not an overlay string.
    expect(text(got[1])).toBe(boardText(d, BOARDS[1]));
  });

  test.each([0, 1])('board %i: directly under it, ONE RTL Urdu line led by RLM, no ·', (i) => {
    const tail = afterBoard(ur.html)[i] || '';
    const line = tail.match(/<div[^>]*class="[^"]*\bgloss\b[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    expect({ hasGlossLine: !!line }).toEqual({ hasGlossLine: true });
    const [whole, inner] = line;
    expect(whole).toMatch(/\bdir="rtl"/);
    expect(whole).toMatch(/\blang="ur"/);
    const t = text(inner);
    expect(t.startsWith('‏')).toBe(true);
    expect(t).toContain(UR_GLOSS[i]);
    expect(decode(whole)).not.toContain('·');
    // exactly one gloss line per board block
    expect((tail.match(/class="[^"]*\bgloss\b/g) || []).length).toBe(1);
  });

  test('the gloss line is set in the Nastaliq stack', () => {
    const css = ur.html.match(/<style>([\s\S]*?)<\/style>/)[1];
    const rule = css.match(/\.gloss\s*\{[^}]*\}/);
    expect({ hasRule: !!rule }).toEqual({ hasRule: true });
    expect(rule[0]).toMatch(/Noto Nastaliq Urdu/);
  });

  test('the stored document is not rewritten — the board block keeps only its text', () => {
    expect(Object.keys(d.sections[0].blocks[3]).sort()).toEqual(['text', 'type']);
  });
});

// ── (b) an overlay without the gloss is a named lint defect ──────────────────────

describe('(b) an Urdu overlay that lacks the board gloss', () => {
  const codeOf = (fails) => fails.map((f) => f.split(':')[0]);

  test.each(GLOSS)('missing %s: lint names OVERLAY_BOARD_GLOSS_MISSING and the pointer', (ptr) => {
    const d = load();
    d.ur_overlay = withGloss(d);
    delete d.ur_overlay[ptr];
    const covered = Object.keys(d.ur_overlay).length / targets(d).length;
    expect(covered).toBeGreaterThan(0.9);   // coverage is NOT what this test is about

    const { fails } = lint(d, null, { lang: 'ur', overlayExpected: true });
    expect(codeOf(fails)).toContain('OVERLAY_BOARD_GLOSS_MISSING');
    expect(fails.find((f) => f.startsWith('OVERLAY_BOARD_GLOSS_MISSING'))).toContain(ptr);
  });

  test('a blank gloss is not a gloss', () => {
    const d = load();
    d.ur_overlay = withGloss(d);
    d.ur_overlay[GLOSS[0]] = '  ';
    expect(overlayDefects(d, 'ur', { expected: true }).map((x) => x.code)).toContain('OVERLAY_BOARD_GLOSS_MISSING');
  });

  test('control: with both glosses present the defect is absent', () => {
    const d = load();
    d.ur_overlay = withGloss(d);
    const { fails } = lint(d, null, { lang: 'ur', overlayExpected: true });
    expect(codeOf(fails)).not.toContain('OVERLAY_BOARD_GLOSS_MISSING');
  });

  test('not demanded of an English render or an Urdu-medium book', () => {
    const d = load();
    d.ur_overlay = bodyOverlay(d);
    expect(overlayDefects(d, 'en', { expected: true }).map((x) => x.code)).not.toContain('OVERLAY_BOARD_GLOSS_MISSING');
    const u = load();
    u.provenance.medium = 'ur';
    expect(overlayDefects(u, 'ur', { expected: true })).toEqual([]);
  });
});

// ── (c) the gloss is offered to the overlay pass, for English-medium books only ──

describe('(c) the gloss target reaches the overlay pass', () => {
  test('overlayTargets offers <board>/gloss and still never offers the board text', () => {
    const t = targets(load());
    for (const p of GLOSS) expect(t).toContain(p);
    for (const p of BOARDS) expect(t).not.toContain(`${p}/text`);
  });

  test('an Urdu-medium book is offered no gloss', () => {
    const u = load();
    u.provenance.medium = 'ur';
    expect(targets(u).filter((p) => p.endsWith('/gloss'))).toEqual([]);
  });

  test('the overlay prompt carries the English board text under the gloss key, and the answer survives', async () => {
    const create = require('../../bot/shared/services/llm-client').__create;
    const { overlayLessonPlan } = require('../../bot/shared/services/lp612-author.service');
    const d = load();
    const answer = withGloss(d);
    create.mockReset();
    create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 8000, completion_tokens: 7000, total_tokens: 15000 },
    });

    const out = await overlayLessonPlan({
      lpDoc: d, segment: { segment_id: 'grade_9_mathematics.c01.p024-025', subject: 'Mathematics', grade: 9 },
    });

    const messages = create.mock.calls[0][0].messages;
    const user = messages.find((m) => m.role === 'user').content;
    const map = JSON.parse(user.slice(user.indexOf('{')));
    for (let i = 0; i < 2; i += 1) expect(map[GLOSS[i]]).toBe(boardText(d, BOARDS[i]));
    for (const p of BOARDS) expect(map).not.toHaveProperty(`${p}/text`);
    // the kept overlay still carries the glosses — the sanitizer does not drop a derived pointer
    expect(out.overlay[GLOSS[0]]).toBe(UR_GLOSS[0]);
    expect(out.overlay[GLOSS[1]]).toBe(UR_GLOSS[1]);
  });
});

// ── (d) guards: what must not move ───────────────────────────────────────────────

describe('(d) unchanged', () => {
  test('ENGLISH render: a gloss in the overlay changes nothing on the page', () => {
    const a = load();
    a.ur_overlay = withGloss(a);
    const b = load();
    b.ur_overlay = bodyOverlay(b);   // both carry Urdu, so the font embedding is the same
    const ha = render(a, 'en').html;
    expect(ha).toBe(render(b, 'en').html);
    expect(ha).not.toMatch(/class="[^"]*\bgloss\b/);
    expect(text(boardLines(ha)[1])).toBe(boardText(a, BOARDS[1]));
  });

  test('URDU render without a gloss prints no empty gloss line', () => {
    const d = load();
    d.ur_overlay = bodyOverlay(d);
    expect(render(d, 'ur').html).not.toMatch(/class="[^"]*\bgloss\b/);
  });

  test('URDU-MEDIUM book: its board prints as before, with no gloss line', () => {
    const u = load();
    u.provenance.medium = 'ur';
    const html = render(u, 'ur').html;
    expect(html).not.toMatch(/class="[^"]*\bgloss\b/);
    expect(boardLines(html)).toHaveLength(2);
  });
});
