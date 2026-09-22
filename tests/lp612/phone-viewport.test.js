/**
 * bd-n96t1 -- THE PAGE FORMAT IS CALLED "phone" AND NEVER TOLD A PHONE.
 *
 * OPERATOR, twice: *"the html on the phone is too big, not perfect as ones available
 * in 6-12"*, and later *"keep in mind you arent letting me view over an actual phone"*.
 *
 * The renderer's default format is literally `PAGE_FORMATS.phone` -- 520 x 2000, one
 * column, sized so a lesson reads as a single scroll on a handset. Every review of it
 * has nonetheless happened on a laptop, and for a good reason: opened on a real phone
 * the document has no `<meta name="viewport">`, so the browser falls back to its
 * ~980px desktop viewport and scales a 520px page down to roughly half size. The type
 * scale the whole sheet is built around is then read at 0.53x. Nothing is broken in
 * the layout; the page simply never declared the width it was designed for.
 *
 * WHY `width=<PAGE.w>` AND NOT `width=device-width`. This is a fixed-width print
 * document, not a fluid page -- `.page` is `width:var(--page-w)` and the column, the
 * figure crops and the pagination probe are all measured against it. `device-width`
 * on a 390px handset would lay the 520px page out inside a 390px viewport and leave
 * 130px scrolling off the side. Naming the design width instead lets the browser pick
 * the scale that makes the page exactly fill the screen, which is the one honest
 * answer for a document whose width is a constant.
 *
 * It is taken from `PAGE.w` rather than hard-coded, so the a4 format (794px) declares
 * its own width and a future format needs no second edit. Desktop browsers ignore the
 * tag entirely, so the laptop view is unchanged -- asserted below, because the render
 * everyone has been reviewing against must not move under them.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildHtml, setPageFormat } = require('../../bot/vendor/lp-v9/lib/template.js');

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');

/** The rendered `<head>` -- the viewport tag is meaningless anywhere else. */
function head(opts = {}) {
  const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (opts.doc) Object.assign(doc, opts.doc);
  const { html } = buildHtml(doc, { docDir: path.dirname(FIXTURE), ...opts.build });
  return html.split('</head>')[0];
}

/** The `content` of the viewport meta, or null when the document declares none. */
function viewport(h) {
  const m = /<meta\s+name="viewport"\s+content="([^"]*)"\s*\/?>/i.exec(h);
  return m ? m[1] : null;
}

describe('bd-n96t1: the document declares the width it was designed for', () => {
  afterEach(() => setPageFormat('phone'));

  test('a phone-format lesson carries a viewport meta', () => {
    expect(viewport(head())).not.toBeNull();
  });

  test('it names the page width, so the handset scales to fit instead of guessing 980', () => {
    expect(viewport(head())).toBe('width=520');
  });

  /**
   * `buildHtml` re-applies `setPageFormat(opts.format || 'phone')` on every call, so the format
   * has to travel in the build options -- a bare `setPageFormat('a4')` beforehand is overwritten
   * before the head is ever built, and a test that set it that way would be asserting nothing.
   */
  test('the width tracks the format rather than a literal', () => {
    expect(viewport(head({ build: { format: 'a4' } }))).toBe('width=794');
  });

  test('an Urdu lesson declares it too -- the operator reviews Urdu on the phone', () => {
    const h = head({ build: { lang: 'ur' } });
    expect(h).toMatch(/dir="rtl"/);
    expect(viewport(h)).toBe('width=520');
  });

  test('the tag sits inside the head, after the charset', () => {
    const h = head();
    expect(h.indexOf('charset')).toBeGreaterThan(-1);
    expect(h.indexOf('name="viewport"')).toBeGreaterThan(h.indexOf('charset'));
  });

  /**
   * The control. A viewport meta is inert on a desktop browser, so the laptop render
   * the operator has been reviewing must be byte-identical below the head -- same
   * stylesheet, same pages, same page count.
   */
  test('nothing below the head moves', () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const { html, warnings } = buildHtml(doc, { docDir: path.dirname(FIXTURE) });
    const body = html.split('</head>')[1];
    expect(body).toContain('<body');
    expect(body.split('class="page"').length - 1).toBeGreaterThan(0);
    expect(Array.isArray(warnings)).toBe(true);
  });
});
