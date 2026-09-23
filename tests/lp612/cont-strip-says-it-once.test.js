/**
 * bd-vvs8z -- THE CONTINUATION STRIP PRINTS THE GRADE AND SUBJECT THE FOOTER ALREADY PRINTED.
 *
 * OPERATOR, with a screenshot of a continuation page: *"the header/footer has too many lines"*,
 * and *"English too has wasted white space"*. What the screenshot holds, in order down the page:
 *
 *     Grade 3 Math · Ch.2 · Plus and Minus Mysteries · pp. 32     <- the footer's left half
 *     page 2 of 8                                                 <- the footer's right half
 *     Subtraction with and without                · Grade 3 Math ·  <- the strip, both halves
 *     regrouping                                    continued        wrapping
 *
 * `Grade 3 Math` is printed TWICE in one piece of page furniture. She has asked for exactly
 * this before, in these words: *"why does it land twice? the name? just once should be enough,
 * pls cut repetition"*.
 *
 * WHICH COPY GOES. The footer's, not the strip's -- the footer is the identity line (grade,
 * subject, chapter, printed pages, page n of m) and it is the copy that is on EVERY page,
 * including page 1 where there is no strip at all. The strip's job is narrower: it says which
 * LESSON this loose sheet continues, and the lesson is named by its topic. Grade and subject
 * inside it are a second answer to a question the footer eight lines above already answered.
 *
 * AND THE STRIP COSTS ONE LINE, STRUCTURALLY. Dropping the words is not enough on its own: the
 * strip is a flex row of two runs that both wrap, so a long topic and a long trailing run cost
 * two lines whatever they say. The footer solved this same problem the same way and recorded
 * why (`.foot .fl` / `.foot .fr`): "a nowrap block has exactly one line box whatever it holds;
 * overflow+ellipsis is what keeps that from running off the page edge instead." A running head
 * that clips a long topic is the right trade -- the topic is printed in full in the hero on
 * page 1, and clamping only ever SHRINKS the measured strip, so the packer's page budget cannot
 * lose a pixel to it.
 *
 * NOT IN SCOPE, AND SAID OUT LOUD: the footer's own two line boxes. They are a structural
 * guarantee delivered to an earlier operator request (*"footer to take no more than 2 lines
 * pls"*) and the halves are stacked because side by side they overflowed the 478px column.
 * This bead takes the strip from two lines to one and the grade+subject from twice to once.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { buildHtml, setPageFormat } = require(path.join(VENDOR, 'lib', 'template'));

const FIXTURE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const baseDoc = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** A build with a page break, so a continuation page -- and therefore a strip -- exists. */
const build = (opts = {}) => buildHtml(baseDoc(), {
  docDir: path.dirname(FIXTURE), lang: 'en', breaks: { teach: [4], support: [] }, ...opts,
}).html;

const sheet = (html) => html.split('<style>')[1].split('</style>')[0]
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\(data:[^)]*\)/g, 'url()');
const rule = (html, sel) => {
  const m = sheet(html).match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`));
  return m ? m[0] : null;
};

/** The continuation strip element, by a balanced `<div>` scan. */
function strip(html) {
  const i = html.indexOf('<div class="contstrip">');
  if (i < 0) return null;
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(i, re.lastIndex);
  }
  return null;
}
// the emitted separator is the entity, not the glyph -- assert on what the file holds
const stripText = (html) => strip(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** The second teach page: strip, any repeated section bar, content, footer. */
const contPage = (html) => html.split('<div class="page" id="t2"')[1].split('<div class="page"')[0];

afterEach(() => setPageFormat('phone'));

describe('bd-vvs8z: the continuation furniture says grade+subject once', () => {
  test('the strip names the lesson and says continued -- and nothing else', () => {
    expect(stripText(build())).toBe('Multiplying two 2×2 matrices &middot; continued');
  });

  test('grade and subject appear ONCE in the whole of a continuation page\'s furniture', () => {
    const page = contPage(build());
    const furniture = strip(build()) + page.slice(page.indexOf('<div class="foot">'));
    expect(furniture.match(/Mathematics/g)).toHaveLength(1);
    expect(furniture.match(/Grade 9/g)).toHaveLength(1);
  });

  test('the footer keeps the copy -- it is the identity line, and it is on page 1 too', () => {
    const page = contPage(build());
    const foot = page.slice(page.indexOf('<div class="foot">'));
    expect(foot).toContain('Grade 9');
    expect(foot).toContain('Mathematics');
  });

  test('the strip is ONE line box whatever the topic holds', () => {
    const html = build();
    // the run that can grow clamps; the run that closes it cannot wrap at all
    const runs = [...strip(html).matchAll(/<span class="([\w-]+)"/g)].map((m) => m[1]);
    expect(runs).toHaveLength(2);
    const [topic, tail] = runs.map((c) => rule(html, `.contstrip .${c}`));
    expect(topic).toMatch(/white-space:\s*nowrap/);
    expect(topic).toMatch(/text-overflow:\s*ellipsis/);
    expect(topic).toMatch(/min-width:\s*0/);
    expect(tail).toMatch(/white-space:\s*nowrap/);
  });

  test('the topic run is styled by its own class, not by a bare descendant selector', () => {
    // `.contstrip span` also caught every span `rich()` emits inside the topic -- a formula or
    // a citation in a lesson title was silently repainted muted 14px by the furniture rule.
    expect(sheet(build())).not.toContain('.contstrip span{');
  });

  test('a4 carries the same one-line strip', () => {
    const html = build({ format: 'a4' });
    expect(stripText(html)).toBe('Multiplying two 2×2 matrices &middot; continued');
    expect(rule(html, '.contstrip')).toMatch(/display:\s*flex/);
  });
});
